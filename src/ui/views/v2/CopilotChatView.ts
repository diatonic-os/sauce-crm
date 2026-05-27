// Working chat surface for the Sauce Copilot. Wraps the V2 CopilotRuntime
// (provider + RAG + tool-use) in a real Obsidian ItemView.
//
// Layout (imitates the reference composer, adapted to Sauce):
//   header bar  — inline model picker (provider → model + embeddings) + icon
//                 toolbar (New chat / Settings / History / More)
//   body        — transcript; when empty, shows Relevant Notes + Suggested
//                 Skills (our analogue of "suggested prompts")
//   footer      — textarea + mic + send

import {
  ItemView,
  MarkdownRenderer,
  Modal,
  Menu,
  Notice,
  Setting,
  setIcon,
  TFile,
  WorkspaceLeaf,
} from "obsidian";
import type SauceGraphPlugin from "../../../main";
import type { ChatMessage } from "../../../copilot/ICopilotProvider";
import type { CopilotSession } from "../../../copilot/ConversationStore";
import {
  sharedModelCatalog,
  type CatalogModel,
} from "../../../copilot/ModelCatalog";
import type { EmbedProviderId } from "../../../settings/FeatureSettings";
import { SlashSuggest, type SlashItem } from "../../widgets/SlashSuggest";
import type { DocFormat } from "../../../services/DocumentHarvest";
import { type ViewTypeId, asViewTypeId } from "@/types/brands";

export const VIEW_COPILOT_CHAT: ViewTypeId = asViewTypeId("sauce-copilot-chat");

type ChatProvider = "anthropic" | "openai" | "ollama" | "lmstudio";
const CHAT_PROVIDERS: { id: ChatProvider; label: string }[] = [
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" },
  { id: "ollama", label: "Ollama" },
  { id: "lmstudio", label: "LM Studio" },
];
const EMBED_PROVIDERS: EmbedProviderId[] = ["lmstudio", "ollama", "openai"];

// Web Speech API surface (Electron/Chromium). Mobile unsupported per manifest.
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult:
    | ((ev: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
        resultIndex: number;
      }) => void)
    | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;
function getSpeechRecognition(): SpeechRecognitionCtor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export class CopilotChatView extends ItemView {
  private history: ChatMessage[] = [];
  private inputEl!: HTMLTextAreaElement;
  private transcriptEl!: HTMLDivElement;
  private suggestionsEl!: HTMLDivElement;
  private providerSel!: HTMLSelectElement;
  private modelSel!: HTMLSelectElement;
  private embedSel!: HTMLSelectElement;
  private micButton: HTMLButtonElement | null = null;
  private recognition: SpeechRecognitionLike | null = null;
  // S4: "/" slash picker + the skill it forces on the next send (if any).
  private slashSuggest: SlashSuggest | null = null;
  private pendingForceSkill: string | null = null;
  private isListening = false;
  private showRelevant = true;
  private showSuggested = true;
  // Session persistence — a session is saved to _addenda/_copilot on New chat
  // and on view close, so the History popover can list/replay it.
  private sessionId = `s-${Date.now()}`;
  private sessionCreatedTs = Date.now();
  private firstUserMsg = "";

  constructor(
    leaf: WorkspaceLeaf,
    public plugin: SauceGraphPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_COPILOT_CHAT;
  }
  getDisplayText(): string {
    return "Sauce: SauceBot";
  }
  override getIcon(): string {
    return "message-circle";
  }

  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("sauce-view");
    root.addClass("sauce-copilot");

    this.buildHeader(root);
    this.transcriptEl = root.createDiv({ cls: "sauce-copilot-transcript" });
    this.suggestionsEl = this.transcriptEl.createDiv({
      cls: "sauce-cp-suggestions",
    });
    this.buildInput(root);
    void this.renderSuggestions();
  }

  // ---------- Header: inline model picker + icon toolbar ----------
  private buildHeader(root: HTMLElement): void {
    const bar = root.createDiv({ cls: "sauce-copilot-bar" });

    const models = bar.createDiv({ cls: "sauce-cp-models" });
    const cur = this.plugin.copilot?.getSettings();

    // Provider → Model (two-stage). Model options carry a status hint.
    this.providerSel = this.labeledSelect(models, "Provider");
    for (const p of CHAT_PROVIDERS)
      this.option(this.providerSel, p.id, p.label);
    this.providerSel.value = (cur?.provider as ChatProvider) ?? "anthropic";
    this.providerSel.onchange = () => {
      void this.onProviderChange();
    };

    this.modelSel = this.labeledSelect(models, "Model");
    this.modelSel.onchange = () => {
      void this.onModelChange();
    };

    // Embeddings model (RAG) — separate provider/model resolved from settings.
    this.embedSel = this.labeledSelect(models, "Embeddings");
    this.embedSel.onchange = () => {
      void this.onEmbedChange();
    };

    const actions = bar.createDiv({ cls: "sauce-copilot-actions" });
    this.iconButton(actions, "circle-plus", "New chat", () =>
      this.newSession(),
    );
    this.iconButton(actions, "settings-2", "Chat settings", () =>
      this.openChatSettings(),
    );
    this.iconButton(actions, "history", "History", () => this.openHistory());
    this.iconButton(actions, "more-horizontal", "More", (ev) =>
      this.openMoreMenu(ev),
    );

    void this.refreshModelOptions();
    void this.refreshEmbedOptions();
  }

  private labeledSelect(parent: HTMLElement, label: string): HTMLSelectElement {
    const wrap = parent.createDiv({ cls: "sauce-cp-field" });
    wrap.createEl("label", { cls: "sauce-cp-field-label", text: label });
    return wrap.createEl("select", { cls: "sauce-cp-select dropdown" });
  }
  private option(
    sel: HTMLSelectElement,
    value: string,
    text: string,
    selected = false,
  ): void {
    const o = sel.createEl("option", { text });
    o.value = value;
    if (selected) o.selected = true;
  }
  private iconButton(
    parent: HTMLElement,
    icon: string,
    tip: string,
    onClick: (ev: MouseEvent) => void,
  ): HTMLButtonElement {
    const b = parent.createEl("button", {
      cls: "sauce-cp-icon clickable-icon",
    });
    setIcon(b, icon);
    b.setAttribute("aria-label", tip);
    b.title = tip;
    b.onclick = (ev) => onClick(ev);
    return b;
  }

  // ---------- Model catalog wiring ----------
  private needsKey(provider: string): boolean {
    const s = this.plugin.copilot?.getSettings();
    const isLocal = provider === "ollama" || provider === "lmstudio";
    return !isLocal && !s?.apiKey;
  }

  private async refreshModelOptions(): Promise<void> {
    const provider = this.providerSel.value as ChatProvider;
    const cur = this.plugin.copilot?.getSettings();
    this.modelSel.empty();
    this.modelSel.createEl("option", { text: "loading…" }).value = "";
    let models: CatalogModel[] = [];
    try {
      models = await sharedModelCatalog(this.plugin.logger ?? null).list({
        provider,
        ...(cur?.baseUrl !== undefined ? { endpoint: cur.baseUrl } : {}),
        ...(cur?.apiKey !== undefined ? { apiKey: cur.apiKey } : {}),
        logger: this.plugin.logger ?? null,
      });
    } catch {
      /* fall through to empty */
    }
    this.modelSel.empty();
    const hint = this.needsKey(provider) ? "  · needs API key" : "";
    if (!models.length) {
      this.modelSel.createEl("option", { text: "— no models —" }).value = "";
      return;
    }
    for (const m of models)
      this.option(
        this.modelSel,
        m.id,
        `${m.label}${hint}`,
        m.id === cur?.model,
      );
    if (!models.some((m) => m.id === cur?.model))
      this.modelSel.value = models[0]!.id; // models.length > 0 confirmed by early-return above
  }

  private async refreshEmbedOptions(): Promise<void> {
    const rag = this.plugin.settings.features.rag;
    const provider = rag.provider;
    const pc = rag.providers[provider];
    this.embedSel.empty();
    let models: CatalogModel[] = [];
    try {
      models = await sharedModelCatalog(this.plugin.logger ?? null).list({
        provider,
        endpoint: pc.endpoint,
        apiKey: this.plugin.settings.copilot.apiKey,
        kind: "embedding",
        logger: this.plugin.logger ?? null,
      });
    } catch {
      /* empty */
    }
    // Prefix with the embed provider so it's clear which provider supplies them.
    const head = this.embedSel.createEl("option", { text: `${provider} ▾` });
    head.value = "";
    head.disabled = true;
    if (!models.length) {
      this.option(this.embedSel, pc.model || "", pc.model || "— none —", true);
      return;
    }
    for (const m of models)
      this.option(this.embedSel, m.id, m.label, m.id === pc.model);
    if (pc.model && !models.some((m) => m.id === pc.model))
      this.option(this.embedSel, pc.model, `${pc.model} (custom)`, true);
  }

  private async onProviderChange(): Promise<void> {
    const provider = this.providerSel.value as ChatProvider;
    this.plugin.settings.copilot.provider = provider;
    await this.plugin.saveSettings();
    this.plugin.copilot?.updateSettings?.({ provider });
    await this.refreshModelOptions();
    await this.onModelChange();
  }
  private async onModelChange(): Promise<void> {
    const model = this.modelSel.value;
    if (!model) return;
    this.plugin.settings.copilot.model = model;
    await this.plugin.saveSettings();
    this.plugin.copilot?.updateSettings?.({ model });
  }
  private async onEmbedChange(): Promise<void> {
    const model = this.embedSel.value;
    if (!model) return;
    const rag = this.plugin.settings.features.rag;
    rag.providers[rag.provider].model = model;
    await this.plugin.saveSettings();
    (
      this.plugin as unknown as { syncEmbeddingConfig?: () => void }
    ).syncEmbeddingConfig?.();
  }

  // ---------- Suggestions: Relevant Notes + Suggested Skills ----------
  private async renderSuggestions(): Promise<void> {
    const c = this.suggestionsEl;
    c.empty();
    if (this.history.length > 0) {
      c.hide();
      return;
    }
    c.show();

    if (this.showRelevant) {
      const sec = c.createDiv({ cls: "sauce-cp-sec" });
      sec.createEl("h4", { cls: "sauce-cp-sec-title", text: "Relevant Notes" });
      const active = this.app.workspace.getActiveFile();
      const related =
        active instanceof TFile
          ? (this.plugin.search?.related(active, 5) ?? [])
          : [];
      if (!related.length) {
        sec.createEl("p", {
          cls: "sauce-cp-empty",
          text: active
            ? "No relevant notes found."
            : "Open a note to see related entities.",
        });
      } else {
        for (const hit of related) {
          const row = sec.createDiv({ cls: "sauce-cp-card sauce-clickable" });
          row.createEl("div", {
            cls: "sauce-cp-card-title",
            text: hit.file.basename,
          });
          row.createEl("div", {
            cls: "sauce-cp-card-sub",
            text: hit.file.path,
          });
          row.onclick = () =>
            void this.app.workspace.getLeaf(false).openFile(hit.file as TFile);
        }
      }
    }

    if (this.showSuggested) {
      const sec = c.createDiv({ cls: "sauce-cp-sec" });
      sec.createEl("h4", {
        cls: "sauce-cp-sec-title",
        text: "Suggested Skills",
      });
      const skills = this.plugin.skills?.list() ?? [];
      if (!skills.length) {
        sec.createEl("p", {
          cls: "sauce-cp-empty",
          text: "No skills enabled — turn some on in Settings → Skills.",
        });
      } else {
        for (const s of skills.slice(0, 8)) {
          const row = sec.createDiv({ cls: "sauce-cp-card" });
          const body = row.createDiv({ cls: "sauce-cp-card-main" });
          body.createEl("div", { cls: "sauce-cp-card-title", text: s.id });
          if (s.description)
            body.createEl("div", {
              cls: "sauce-cp-card-sub",
              text: s.description,
            });
          const add = row.createEl("button", {
            cls: "sauce-cp-icon clickable-icon",
          });
          setIcon(add, "plus");
          add.title = "Insert into prompt";
          add.onclick = () => {
            const active = this.app.workspace.getActiveFile()?.basename;
            const ref = active ? ` for [[${active}]]` : "";
            this.inputEl.value = `Use the "${s.id}" skill${ref}. `;
            this.inputEl.focus();
          };
        }
      }
    }
  }

  // ---------- Footer input ----------
  private buildInput(root: HTMLElement): void {
    const inputRow = root.createDiv({ cls: "sauce-copilot-input" });
    this.inputEl = inputRow.createEl("textarea", {
      cls: "sauce-copilot-textarea",
      attr: {
        placeholder: "Ask about your graph…  ( ⌘/Ctrl + Enter to send )",
      },
    });
    const SR = getSpeechRecognition();
    if (SR) {
      this.micButton = this.iconButton(
        inputRow,
        "mic",
        "Dictate (Web Speech API)",
        () => this.toggleVoice(SR),
      );
      this.micButton.addClass("sauce-copilot-mic");
    }
    // S7: paperclip upload — audio → transcribe (inserts the transcript into
    // the composer), documents → RAG harvest. Uses a detached file input so no
    // inline style is needed to hide it (G-001).
    const attach = this.iconButton(
      inputRow,
      "paperclip",
      "Attach audio (transcribe) or a document (RAG)",
      () => {
        const fi = document.createElement("input");
        fi.type = "file";
        fi.accept =
          ".m4a,.mp3,.wav,.mp4,.ogg,.webm,.flac,.md,.txt,.pdf,.docx";
        fi.onchange = () => {
          const f = fi.files?.[0];
          if (f) void this.handleUpload(f);
        };
        fi.click();
      },
    );
    attach.addClass("sauce-cp-attach");
    const send = this.iconButton(
      inputRow,
      "send",
      "Send  ( ⌘/Ctrl + Enter )",
      () => void this.askNow(),
    );
    send.addClass("sauce-cp-send");
    this.registerDomEvent(this.inputEl, "keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void this.askNow();
      }
    });

    // S4: typing "/" opens the skill/command picker. Skills force a tool call
    // on the next send; command macros substitute their prompt text.
    this.slashSuggest = new SlashSuggest(this.inputEl, {
      getItems: () => {
        const skills: SlashItem[] = (this.plugin.skills?.enabled() ?? []).map(
          (s) => ({ id: s.id, label: s.id, detail: s.description, kind: "skill" }),
        );
        const cmds: SlashItem[] = (
          this.plugin.settings.copilot?.slashCommands ?? []
        ).map((c) => ({ id: c.id, label: c.name, kind: "command" }));
        return [...skills, ...cmds];
      },
      onSelect: (item) => this.onSlashSelect(item),
    });
    this.slashSuggest.attach();
  }

  /** S4: a "/" pick — a skill arms forceSkill for the next send; a command
   *  macro substitutes its prompt text into the input for the user to edit. */
  private onSlashSelect(item: SlashItem): void {
    if (item.kind === "skill") {
      this.pendingForceSkill = item.id;
      this.inputEl.value = "";
      this.inputEl.setAttribute(
        "placeholder",
        `Running /${item.id} — type your message and send…`,
      );
      this.inputEl.focus();
      return;
    }
    const cmd = (this.plugin.settings.copilot?.slashCommands ?? []).find(
      (c) => c.id === item.id,
    );
    this.inputEl.value = (cmd?.prompt ?? "").replace("{}", "");
    this.inputEl.focus();
  }

  private newSession(): void {
    void this.persistCurrentSession();
    this.history = [];
    this.sessionId = `s-${Date.now()}`;
    this.sessionCreatedTs = Date.now();
    this.firstUserMsg = "";
    this.transcriptEl.empty();
    this.suggestionsEl = this.transcriptEl.createDiv({
      cls: "sauce-cp-suggestions",
    });
    void this.renderSuggestions();
  }

  /** Persist the current transcript to _addenda/_copilot via ConversationStore
   *  (auto-named from the first user message). Best-effort; no-op when empty. */
  private async persistCurrentSession(): Promise<void> {
    if (!this.history.length || !this.plugin.copilot) return;
    const s = this.plugin.copilot.getSettings();
    const session: CopilotSession = {
      id: this.sessionId,
      createdTs: this.sessionCreatedTs,
      updatedTs: Date.now(),
      model: s?.model ?? "",
      provider: s?.provider ?? "",
      skillSet: [],
      messages: this.history,
      tokenIn: 0,
      tokenOut: 0,
    };
    try {
      await this.plugin.copilot.persistSession(session, this.firstUserMsg);
    } catch {
      /* persistence is best-effort */
    }
  }

  // ---------- Chat Settings popover (real, bound settings only) ----------
  private openChatSettings(): void {
    const cfg = this.plugin.settings.copilot;
    const modal = new Modal(this.plugin.app);
    modal.modalEl.addClass("sauce-modal");
    modal.titleEl.setText("Chat settings");
    const c = modal.contentEl.createDiv({ cls: "sauce-section" });
    const save = async () => {
      await this.plugin.saveSettings();
      this.plugin.copilot?.updateSettings?.(cfg);
    };

    new Setting(c)
      .setName("Temperature")
      .setDesc("Lower = more deterministic.")
      .addSlider((s) =>
        s
          .setLimits(0, 1, 0.05)
          .setDynamicTooltip()
          .setValue(cfg.temperature ?? 0.4)
          .onChange(async (v) => {
            cfg.temperature = v;
            await save();
          }),
      );
    new Setting(c)
      .setName("Token limit")
      .setDesc("Max tokens per response.")
      .addSlider((s) =>
        s
          .setLimits(256, 8192, 128)
          .setDynamicTooltip()
          .setValue(cfg.maxTokens ?? 4096)
          .onChange(async (v) => {
            cfg.maxTokens = v;
            await save();
          }),
      );
    new Setting(c)
      .setName("Context turns")
      .setDesc("Prior turns to include (0 = none).")
      .addSlider((s) =>
        s
          .setLimits(0, 50, 1)
          .setDynamicTooltip()
          .setValue(cfg.contextTurns ?? 15)
          .onChange(async (v) => {
            cfg.contextTurns = v;
            await save();
          }),
      );
    new Setting(c).setName("Stream responses").addToggle((t) =>
      t.setValue(cfg.stream !== false).onChange(async (v) => {
        cfg.stream = v;
        await save();
      }),
    );
    new Setting(c)
      .setName("System prompt")
      .setDesc("Sent before every conversation.")
      .addTextArea((t) =>
        t.setValue(cfg.systemPrompt ?? "").onChange(async (v) => {
          cfg.systemPrompt = v;
          await save();
        }),
      );

    modal.open();
  }

  // ---------- History popover ----------
  private async openHistory(): Promise<void> {
    const modal = new Modal(this.plugin.app);
    modal.modalEl.addClass("sauce-modal");
    modal.titleEl.setText("Chat history");
    const c = modal.contentEl.createDiv({ cls: "sauce-section" });
    const root = "_addenda/_copilot";
    const adapter = this.app.vault.adapter;
    let files: string[] = [];
    try {
      if (await adapter.exists(root))
        files = (await adapter.list(root)).files.filter((f) =>
          f.endsWith(".md"),
        );
    } catch {
      /* ignore */
    }
    if (!files.length) {
      c.createEl("p", {
        cls: "sauce-cp-empty",
        text: "No saved sessions yet.",
      });
    } else {
      for (const path of files.sort().reverse().slice(0, 50)) {
        const row = c.createDiv({ cls: "sauce-cp-card sauce-clickable" });
        row.createEl("div", {
          cls: "sauce-cp-card-title",
          text: path.split("/").pop()?.replace(/\.md$/, "") ?? path,
        });
        row.onclick = () => {
          const f = this.app.vault.getAbstractFileByPath(path);
          if (f instanceof TFile)
            void this.app.workspace.getLeaf(false).openFile(f);
          modal.close();
        };
      }
    }
    modal.open();
  }

  // ---------- More menu ----------
  private openMoreMenu(ev: MouseEvent): void {
    const m = new Menu();
    m.addItem((i) =>
      i
        .setTitle("Suggested Skills")
        .setIcon("sparkles")
        .setChecked(this.showSuggested)
        .onClick(() => {
          this.showSuggested = !this.showSuggested;
          void this.renderSuggestions();
        }),
    );
    m.addItem((i) =>
      i
        .setTitle("Relevant Notes")
        .setIcon("file-text")
        .setChecked(this.showRelevant)
        .onClick(() => {
          this.showRelevant = !this.showRelevant;
          void this.renderSuggestions();
        }),
    );
    m.addSeparator();
    m.addItem((i) =>
      i
        .setTitle("Refresh suggestions")
        .setIcon("refresh-cw")
        .onClick(() => void this.renderSuggestions()),
    );
    m.addItem((i) =>
      i
        .setTitle("Rebuild LanceDB index")
        .setIcon("database")
        .onClick(() => {
          const ms = (
            this.plugin as unknown as {
              mirrorSync?: { fullResync: () => Promise<number> };
            }
          ).mirrorSync;
          if (!ms) {
            new Notice("LanceDB not installed.");
            return;
          }
          new Notice("Rebuilding index…");
          void ms
            .fullResync()
            .then((n) => new Notice(`Index rebuilt: ${n} entities.`));
        }),
    );
    m.showAtMouseEvent(ev);
  }

  // ---------- Voice ----------
  private toggleVoice(SR: SpeechRecognitionCtor): void {
    if (this.isListening && this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        /* */
      }
      return;
    }
    const rec = new SR();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    let baseValue = this.inputEl.value;
    if (baseValue && !baseValue.endsWith(" ")) baseValue += " ";
    rec.onresult = (ev) => {
      let finalText = "",
        interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i]! as ArrayLike<{ transcript: string }> & { // i < results.length — bounds-checked
          isFinal?: boolean;
        };
        if (res.isFinal) finalText += res[0]!.transcript; // SpeechRecognition result always has ≥1 alternative
        else interim += res[0]!.transcript;
      }
      if (finalText) baseValue += finalText;
      this.inputEl.value = baseValue + interim;
    };
    rec.onerror = (ev) => {
      new Notice(`Speech recognition error: ${ev.error}`);
      this.stopRecognition();
    };
    rec.onend = () => this.stopRecognition();
    this.recognition = rec;
    this.isListening = true;
    if (this.micButton) {
      this.micButton.addClass("is-listening");
    }
    try {
      rec.start();
    } catch (e) {
      new Notice(`Could not start dictation: ${(e as Error).message}`);
      this.stopRecognition();
    }
  }
  private stopRecognition(): void {
    this.isListening = false;
    this.recognition = null;
    if (this.micButton) this.micButton.removeClass("is-listening");
  }

  override async onClose(): Promise<void> {
    if (this.recognition) {
      try {
        this.recognition.stop();
      } catch {
        /* */
      }
      this.recognition = null;
    }
    this.isListening = false;
    this.slashSuggest?.detach();
    this.slashSuggest = null;
    await this.persistCurrentSession();
  }

  // ---------- Ask ----------
  private async askNow(): Promise<void> {
    const copilot = this.plugin.copilot;
    if (!copilot) {
      new Notice("SauceBot not initialized");
      return;
    }
    const q = this.inputEl.value.trim();
    if (!q) return;
    if (!this.firstUserMsg) this.firstUserMsg = q;
    this.inputEl.value = "";
    // Consume any armed slash-skill for this send, then reset the affordance.
    const forceSkill = this.pendingForceSkill ?? undefined;
    this.pendingForceSkill = null;
    this.inputEl.setAttribute(
      "placeholder",
      "Ask about your graph…  ( ⌘/Ctrl + Enter to send )",
    );
    this.suggestionsEl.hide();
    this.appendMessage("user", q);
    const assistantEl = this.appendMessage("assistant", "");
    let text = "";
    try {
      const activePath = this.plugin.app.workspace.getActiveFile()?.path;
      for await (const ev of copilot.ask(q, activePath, this.history, {
        ...(forceSkill !== undefined ? { forceSkill } : {}),
      })) {
        if (ev.type === "text") {
          text += ev.delta;
          // Stream as plain text for responsiveness (re-rendering markdown on
          // every token is too costly); the final markdown render happens on
          // the `done` event below.
          assistantEl.setText(text);
          this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
        } else if (ev.type === "done") {
          if (ev.reason === "error") {
            assistantEl.setText(text + `\n\n[error: ${ev.error ?? "unknown"}]`);
          } else {
            await this.renderMarkdownInto(assistantEl, text);
          }
          this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
        }
      }
      this.history.push({ role: "user", content: q });
      this.history.push({ role: "assistant", content: text });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      assistantEl.setText(`[error: ${msg}]`);
    }
  }

  private appendMessage(
    role: "user" | "assistant",
    text: string,
  ): HTMLDivElement {
    const wrap = this.transcriptEl.createDiv({
      cls: `sauce-copilot-msg sauce-copilot-${role}`,
    });
    wrap.createEl("strong", { text: role === "user" ? "you" : "saucebot" });
    return wrap.createDiv({ cls: "sauce-copilot-body", text });
  }

  /** S7: handle a paperclip upload — audio is transcribed (transcript inserted
   *  into the composer); documents are harvested into the RAG doc-chunk store. */
  private async handleUpload(file: File): Promise<void> {
    const name = file.name.toLowerCase();
    if (/\.(m4a|mp3|wav|mp4|ogg|webm|flac)$/.test(name)) {
      const path = (file as { path?: string }).path;
      if (!path) {
        new Notice("Audio transcription needs a desktop file path.");
        return;
      }
      new Notice("SauceBot: transcribing…");
      const r = await this.plugin.skills?.run("transcribe", {
        audio_path: path,
      });
      if (r && r.ok) {
        const text = (
          (r.payload as { text?: string } | undefined)?.text ?? ""
        ).trim();
        if (text) {
          this.inputEl.value =
            (this.inputEl.value ? this.inputEl.value + "\n\n" : "") + text;
          this.inputEl.focus();
          new Notice("SauceBot: transcript inserted into the composer.");
        } else {
          new Notice("SauceBot: transcription produced no text.");
        }
      } else {
        new Notice(
          `SauceBot: transcribe failed${r && !r.ok ? ` — ${r.reason}` : ""}.`,
        );
      }
      return;
    }
    // Document → RAG harvest (embedded into LanceDB doc chunks).
    if (!this.plugin.documentHarvest) {
      new Notice("Document RAG is unavailable (LanceDB off).");
      return;
    }
    try {
      const format: DocFormat = name.endsWith(".pdf")
        ? "pdf"
        : name.endsWith(".docx")
          ? "docx"
          : name.endsWith(".md")
            ? "md"
            : "txt";
      const input =
        format === "md" || format === "txt"
          ? { id: file.name, name: file.name, format, text: await file.text() }
          : {
              id: file.name,
              name: file.name,
              format,
              bytes: new Uint8Array(await file.arrayBuffer()),
            };
      await this.plugin.documentHarvest.harvest(input);
      new Notice(`SauceBot: added "${file.name}" to document context.`);
    } catch (e) {
      new Notice(
        `SauceBot: harvest failed — ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }

  /** Render assistant markdown into `el` (replacing any plain-text stream).
   *  Uses Obsidian's MarkdownRenderer so links, code blocks, lists, and
   *  `[[wikilinks]]` render properly (S7). Best-effort: on failure the plain
   *  text already shown remains. */
  private async renderMarkdownInto(
    el: HTMLElement,
    markdown: string,
  ): Promise<void> {
    try {
      const sourcePath = this.plugin.app.workspace.getActiveFile()?.path ?? "";
      el.empty?.();
      await MarkdownRenderer.render(
        this.plugin.app,
        markdown,
        el,
        sourcePath,
        this,
      );
    } catch {
      el.textContent = markdown;
    }
  }
}
