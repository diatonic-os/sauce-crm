// Working chat surface for the Sauce Copilot. Wraps the V2 SauceBotRuntime
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
import type { ChatMessage } from "../../../saucebot/ISauceBotProvider";
import type { SauceBotSession } from "../../../saucebot/ConversationStore";
import {
  sharedModelCatalog,
  formatModelLabel,
  type CatalogModel,
} from "../../../saucebot/ModelCatalog";
import type { EmbedProviderId } from "../../../settings/FeatureSettings";
import { SlashSuggest, type SlashItem } from "../../widgets/SlashSuggest";
import { SauceViewHelp } from "../../components/v2/SauceViewHelp";
import {
  FloatingDropdown,
  type FloatingOption,
} from "../../components/v2/FloatingDropdown";
import {
  newChatId,
  newConversationId,
  newMessageId,
} from "../../../saucebot/Ids";
import { buildTurnTrace, type TurnTrace } from "../../../saucebot/ChatTrace";
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

export class SauceBotChatView extends ItemView {
  private history: ChatMessage[] = [];
  private inputEl!: HTMLTextAreaElement;
  private transcriptEl!: HTMLDivElement;
  private suggestionsEl!: HTMLDivElement;
  private providerSel!: HTMLSelectElement;
  private modelSel!: HTMLSelectElement;
  private modelStatusEl: HTMLElement | null = null;
  private embedProviderSel!: HTMLSelectElement;
  private embedSel!: HTMLSelectElement;
  // Icon control-panel triggers (slim row under the branded header). Each opens
  // a borderless FloatingDropdown that drives the matching backing <select>.
  private providerIcon!: HTMLButtonElement;
  private modelIcon!: HTMLButtonElement;
  private embedProviderIcon!: HTMLButtonElement;
  private embedIcon!: HTMLButtonElement;
  private providerDd: FloatingDropdown | null = null;
  private modelDd: FloatingDropdown | null = null;
  private embedProviderDd: FloatingDropdown | null = null;
  private embedDd: FloatingDropdown | null = null;
  private micButton: HTMLButtonElement | null = null;
  private recognition: SpeechRecognitionLike | null = null;
  // S4: "/" slash picker + the skill it forces on the next send (if any).
  private slashSuggest: SlashSuggest | null = null;
  private pendingForceSkill: string | null = null;
  private isListening = false;
  private help!: SauceViewHelp;
  // One-shot "brain still building" warning per view session.
  private brainWarned = false;
  // Streaming state: guards re-entrant sends and drives the send⇄stop toggle.
  private streaming = false;
  private streamAbort = false;
  private sendBtn: HTMLButtonElement | null = null;
  private showRelevant = true;
  private showSuggested = true;
  // Session persistence — a session is saved to _addenda/_copilot on New chat
  // and on view close, so the History popover can list/replay it.
  private sessionId = `s-${Date.now()}`;
  // Stable trace ids: chatId per view load, conversationId per session.
  private chatId = newChatId();
  private conversationId = newConversationId();
  private turns: TurnTrace[] = [];
  private turnIndex = 0;
  private sessionTokenIn = 0;
  private sessionTokenOut = 0;
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

    // Branded Sauce header + toggleable help (top-left "?").
    this.help = new SauceViewHelp();
    this.help.mountHeader(root, {
      title: "SauceBot",
      icon: "message-circle",
      subtitle: "Chat grounded in your relationship graph + brain",
    });

    this.buildHeader(root);
    this.transcriptEl = root.createDiv({ cls: "sauce-copilot-transcript" });
    this.suggestionsEl = this.transcriptEl.createDiv({
      cls: "sauce-cp-suggestions",
    });
    this.buildInput(root);
    this.registerHelp();
    void this.renderSuggestions();
  }

  /** Per-field help, shown when the header "?" is toggled on. Detailed yet
   *  simple — written for non-developers. */
  private registerHelp(): void {
    // Help anchors the visible control-panel icons (the backing <select>s are
    // hidden); the text still describes the underlying setting each icon drives.
    this.help.register(
      this.providerIcon,
      "Provider",
      "Which AI service answers. 'LM Studio' and 'Ollama' run free models on this computer; 'Anthropic' and 'OpenAI' are paid cloud services that need an API key (set in Settings). Click the icon to choose.",
    );
    this.help.register(
      this.modelIcon,
      "Model",
      "The specific model that replies. The label shows its context size (e.g. 32k), quantization, and 'tools' if it can use your CRM tools. A ● means it's already loaded in LM Studio (faster first reply). Click the icon to choose.",
    );
    this.help.register(
      this.embedProviderIcon,
      "Embeddings provider",
      "Embeddings turn your notes into vectors so SauceBot can find the most relevant people and notes. This picks which service creates them — a local one is free and private. Click the icon to choose.",
    );
    this.help.register(
      this.embedIcon,
      "Embedding model",
      "The model used to index your vault for search. Smaller is faster; larger can be more accurate. Only embedding-type models are listed here. Click the icon to choose.",
    );
    this.help.register(
      this.inputEl,
      "Message box",
      "Ask anything about your relationships or notes. Type '/' to run a skill or command. Press ⌘/Ctrl+Enter to send. The Brain grounds answers in your vault, so it cites real people and notes.",
    );
    if (this.micButton)
      this.help.register(
        this.micButton,
        "Voice dictation",
        "Click to speak your message instead of typing (uses your browser's speech recognition).",
      );
    if (this.sendBtn)
      this.help.register(
        this.sendBtn,
        "Send / Stop",
        "Sends your message. While SauceBot is replying it becomes a Stop button — click to cancel a long answer.",
      );
  }

  // ---------- Header: slim icon control panel + hidden backing selects ----------
  // The four <select> elements remain the source of truth (and keep their
  // onchange handlers) but live in a visually-hidden container. A thin row of
  // icons drives them via borderless FloatingDropdowns, keeping responses + the
  // message bar as the visual focal points.
  private buildHeader(root: HTMLElement): void {
    const bar = root.createDiv({ cls: "sauce-copilot-bar" });

    // Hidden backing selects — kept in the DOM so their state + onchange wiring
    // (and the help-callout anchors) are preserved untouched.
    const backing = bar.createDiv({ cls: "sauce-cp-backing" });
    const cur = this.plugin.copilot?.getSettings();

    // Provider → Model (two-stage). Model options carry a status hint.
    this.providerSel = this.hiddenSelect(backing);
    for (const p of CHAT_PROVIDERS)
      this.option(this.providerSel, p.id, p.label);
    this.providerSel.value = (cur?.provider as ChatProvider) ?? "anthropic";
    this.providerSel.onchange = () => {
      void this.onProviderChange();
    };

    this.modelSel = this.hiddenSelect(backing);
    this.modelSel.onchange = () => {
      void this.onModelChange();
    };

    // Embeddings provider (RAG) — decoupled from the chat provider so users
    // can embed locally (LM Studio / Ollama) while chatting against a cloud
    // model. Populated from EMBED_PROVIDERS; switching it re-lists the
    // embedding models for the newly selected provider.
    this.embedProviderSel = this.hiddenSelect(backing);
    for (const p of EMBED_PROVIDERS) this.option(this.embedProviderSel, p, p);
    this.embedProviderSel.value = this.plugin.settings.features.rag.provider;
    this.embedProviderSel.onchange = () => {
      void this.onEmbedProviderChange();
    };

    // Embeddings model (RAG) — resolved from the selected embed provider.
    this.embedSel = this.hiddenSelect(backing);
    this.embedSel.onchange = () => {
      void this.onEmbedChange();
    };

    // --- Slim icon control panel: left-to-right config + action icons. ---
    const panel = bar.createDiv({ cls: "sauce-cp-panel" });

    const config = panel.createDiv({ cls: "sauce-cp-config" });
    this.providerIcon = this.panelIcon(config, "server", "Provider", (ev) =>
      this.providerDd?.toggle(ev.currentTarget as HTMLElement),
    );
    this.modelIcon = this.panelIcon(config, "cpu", "Model", (ev) =>
      this.modelDd?.toggle(ev.currentTarget as HTMLElement),
    );
    // Realtime model-load indicator (loading → ready/failed on switch).
    this.modelStatusEl = config.createSpan({ cls: "sauce-cp-model-status" });
    config.createSpan({ cls: "sauce-cp-divider" });
    this.embedProviderIcon = this.panelIcon(
      config,
      "database-zap",
      "Embeddings provider",
      (ev) => this.embedProviderDd?.toggle(ev.currentTarget as HTMLElement),
    );
    this.embedIcon = this.panelIcon(
      config,
      "scan-search",
      "Embedding model",
      (ev) => this.embedDd?.toggle(ev.currentTarget as HTMLElement),
    );

    const actions = panel.createDiv({ cls: "sauce-copilot-actions" });
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

    this.buildDropdowns();
    void this.refreshModelOptions();
    void this.refreshEmbedOptions();
  }

  /** A backing <select> that is kept in the DOM (state + onchange + help
   *  anchor) but visually hidden; the icon control panel drives it. */
  private hiddenSelect(parent: HTMLElement): HTMLSelectElement {
    return parent.createEl("select", { cls: "sauce-cp-select dropdown" });
  }

  /** A slim control-panel icon with a hover tooltip. */
  private panelIcon(
    parent: HTMLElement,
    icon: string,
    tip: string,
    onClick: (ev: MouseEvent) => void,
  ): HTMLButtonElement {
    const b = parent.createEl("button", {
      cls: "sauce-cp-icon sauce-cp-panel-icon clickable-icon",
    });
    setIcon(b, icon);
    b.setAttribute("aria-label", tip);
    b.title = tip;
    b.onclick = (ev) => onClick(ev);
    return b;
  }

  /** Build the four floating dropdowns. Each reads its options from the backing
   *  <select> and, on pick, sets that select's value + fires its onchange — so
   *  the existing handlers (onProviderChange/onModelChange/…) still drive all
   *  state, persistence, warmup, and re-listing. */
  private buildDropdowns(): void {
    const fromSelect = (sel: HTMLSelectElement): FloatingOption[] => {
      const out: FloatingOption[] = [];
      for (const o of Array.from(sel.options)) {
        let label = o.text;
        const opt: FloatingOption = { value: o.value, label };
        // Lift a leading "loaded" dot into a badge for a cleaner row.
        if (label.startsWith("●")) {
          opt.badge = "●";
          label = label.replace(/^●\s*/, "");
          opt.label = label;
        }
        // Split the first " · " hint (context/quant/"needs API key") into detail.
        // formatModelLabel pads the first separator ("  ·  "); trim both sides.
        const sep = label.indexOf("·");
        if (sep > 0) {
          opt.label = label.slice(0, sep).trim();
          opt.detail = label
            .slice(sep + 1)
            .replace(/^\s*·?\s*/, "")
            .trim();
        }
        if (o.disabled) opt.disabled = true;
        out.push(opt);
      }
      return out;
    };
    const pick = (sel: HTMLSelectElement) => (value: string) => {
      if (sel.value === value) return;
      sel.value = value;
      sel.onchange?.(new Event("change"));
    };

    this.providerDd = new FloatingDropdown({
      title: "Chat provider",
      getOptions: () => fromSelect(this.providerSel),
      getSelected: () => this.providerSel.value,
      onPick: pick(this.providerSel),
    });
    this.modelDd = new FloatingDropdown({
      title: "Chat model",
      getOptions: () => fromSelect(this.modelSel),
      getSelected: () => this.modelSel.value,
      onPick: pick(this.modelSel),
    });
    this.embedProviderDd = new FloatingDropdown({
      title: "Embeddings provider",
      getOptions: () => fromSelect(this.embedProviderSel),
      getSelected: () => this.embedProviderSel.value,
      onPick: pick(this.embedProviderSel),
    });
    this.embedDd = new FloatingDropdown({
      title: "Embedding model",
      getOptions: () => fromSelect(this.embedSel),
      getSelected: () => this.embedSel.value,
      onPick: pick(this.embedSel),
    });
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
        `${formatModelLabel(m)}${hint}`,
        m.id === cur?.model,
      );
    if (!models.some((m) => m.id === cur?.model)) {
      this.modelSel.value = models[0]!.id; // models.length > 0 confirmed by early-return above
      // Persist the auto-selected model so a fresh local-first install (empty
      // default model) has a valid model id without the user touching anything.
      if (cur && cur.model !== models[0]!.id) {
        this.plugin.settings.copilot.model = models[0]!.id;
        await this.plugin.saveSettings();
        this.plugin.copilot?.updateSettings?.({ model: models[0]!.id });
      }
    }
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
      this.option(this.embedSel, m.id, formatModelLabel(m), m.id === pc.model);
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
    // Realtime load indicator: local models JIT-load on first use, which can
    // take seconds. Warm it up now and show loading → ready/failed.
    void this.warmupActiveModel(model);
  }

  /** Show a small "loading → ready/failed" indicator while the model loads. */
  private async warmupActiveModel(model: string): Promise<void> {
    if (!this.modelStatusEl) return;
    const el = this.modelStatusEl;
    el.removeClass("is-ok", "is-error");
    el.addClass("is-loading");
    el.setText(`loading ${model.split("/").pop()}…`);
    const r = await this.plugin.copilot?.warmup();
    el.removeClass("is-loading");
    if (r?.ok) {
      el.addClass("is-ok");
      el.setText(`ready · ${(Math.round((r.ms / 1000) * 10) / 10).toString()}s`);
      window.setTimeout(() => {
        if (el.hasClass("is-ok")) el.setText("");
      }, 4000);
    } else {
      el.addClass("is-error");
      el.setText(`failed: ${(r?.error ?? "unreachable").slice(0, 60)}`);
    }
  }
  private async onEmbedProviderChange(): Promise<void> {
    const provider = this.embedProviderSel.value as EmbedProviderId;
    const rag = this.plugin.settings.features.rag;
    if (provider === rag.provider) return;
    rag.provider = provider;
    await this.plugin.saveSettings();
    // Re-list embedding models for the new provider, then re-sync the active
    // embedding config so the runtime picks up the switched provider/model.
    await this.refreshEmbedOptions();
    (
      this.plugin as unknown as { syncEmbeddingConfig?: () => void }
    ).syncEmbeddingConfig?.();
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

  // ---------- Footer: content-aware message bar ----------
  // The textarea auto-grows with content; attach / mic / send are tiny icons
  // embedded INSIDE the bar (no separate button row). Send is the primary
  // affordance and doubles as Stop while streaming.
  private buildInput(root: HTMLElement): void {
    const inputRow = root.createDiv({ cls: "sauce-copilot-input" });

    // Left-rail tools (attach, optional mic) sit flush inside the bar.
    const lead = inputRow.createDiv({ cls: "sauce-cp-bar-tools is-lead" });
    // S7: paperclip upload — audio → transcribe (inserts the transcript into
    // the composer), documents → RAG harvest. Uses a detached file input so no
    // inline style is needed to hide it (G-001).
    const attach = this.iconButton(
      lead,
      "paperclip",
      "Attach audio (transcribe) or a document (RAG)",
      () => {
        const fi = document.createElement("input");
        fi.type = "file";
        fi.accept = ".m4a,.mp3,.wav,.mp4,.ogg,.webm,.flac,.md,.txt,.pdf,.docx";
        fi.onchange = () => {
          const f = fi.files?.[0];
          if (f) void this.handleUpload(f);
        };
        fi.click();
      },
    );
    attach.addClass("sauce-cp-attach");
    const SR = getSpeechRecognition();
    if (SR) {
      this.micButton = this.iconButton(
        lead,
        "mic",
        "Dictate (Web Speech API)",
        () => this.toggleVoice(SR),
      );
      this.micButton.addClass("sauce-copilot-mic");
    }

    this.inputEl = inputRow.createEl("textarea", {
      cls: "sauce-copilot-textarea",
      attr: {
        placeholder: "Ask about your graph…  ( ⌘/Ctrl + Enter to send )",
        rows: "1",
      },
    });

    // Trailing send (primary; doubles as Stop while streaming).
    const tail = inputRow.createDiv({ cls: "sauce-cp-bar-tools is-tail" });
    const send = this.iconButton(
      tail,
      "send",
      "Send  ( ⌘/Ctrl + Enter )",
      () => this.onSendOrStop(),
    );
    send.addClass("sauce-cp-send");
    this.sendBtn = send;

    // Auto-grow: the bar scales vertically with content up to a CSS max-height.
    const autoGrow = () => {
      const el = this.inputEl;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    };
    this.registerDomEvent(this.inputEl, "input", autoGrow);
    this.registerDomEvent(this.inputEl, "keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        this.onSendOrStop();
      }
    });

    // S4: typing "/" opens the skill/command picker. Skills force a tool call
    // on the next send; command macros substitute their prompt text.
    this.slashSuggest = new SlashSuggest(this.inputEl, {
      getItems: () => {
        const skills: SlashItem[] = (this.plugin.skills?.enabled() ?? []).map(
          (s) => ({
            id: s.id,
            label: s.id,
            detail: s.description,
            kind: "skill",
          }),
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
    this.conversationId = newConversationId();
    this.turns = [];
    this.turnIndex = 0;
    this.sessionTokenIn = 0;
    this.sessionTokenOut = 0;
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
    const session: SauceBotSession = {
      id: this.sessionId,
      conversationId: this.conversationId,
      chatId: this.chatId,
      installId: this.plugin.settings.installId ?? "",
      agentId: this.plugin.currentAgentId(),
      createdTs: this.sessionCreatedTs,
      updatedTs: Date.now(),
      model: s?.model ?? "",
      provider: s?.provider ?? "",
      skillSet: [],
      messages: this.history,
      turns: this.turns,
      tokenIn: this.sessionTokenIn,
      tokenOut: this.sessionTokenOut,
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

    // Local-model tuning (LM Studio / Ollama cloud-parity). Auto-on for local
    // providers; full controls live in plugin Settings → Copilot.
    c.createEl("h4", { text: "Local model tuning" });
    const lt = (cfg as unknown as { localTuning?: Record<string, unknown> })
      .localTuning ?? {};
    (cfg as unknown as { localTuning: Record<string, unknown> }).localTuning = lt;
    new Setting(c)
      .setName("Prose tool prompting")
      .setDesc("Helps small models call tools reliably.")
      .addToggle((t) =>
        t.setValue(lt.toolPrompt !== false).onChange(async (v) => {
          lt.toolPrompt = v;
          await save();
        }),
      );
    new Setting(c)
      .setName("Repair malformed tool calls")
      .addToggle((t) =>
        t.setValue(lt.toolRepairReask !== false).onChange(async (v) => {
          lt.toolRepairReask = v;
          await save();
        }),
      );
    new Setting(c)
      .setName("Self-correct empty answers")
      .addToggle((t) =>
        t.setValue(lt.emptyAnswerRetry !== false).onChange(async (v) => {
          lt.emptyAnswerRetry = v;
          await save();
        }),
      );
    c.createEl("p", {
      cls: "sauce-help-body",
      text: "More tuning (history compaction budget, force on/off) in Settings → Copilot → Local model tuning.",
    });

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
        const res = ev.results[i]! as ArrayLike<{ transcript: string }> & {
          // i < results.length — bounds-checked
          isFinal?: boolean;
        };
        if (res.isFinal)
          finalText += res[0]!.transcript; // SpeechRecognition result always has ≥1 alternative
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
    // Tear down any open floating dropdowns (and their global listeners).
    this.providerDd?.close();
    this.modelDd?.close();
    this.embedProviderDd?.close();
    this.embedDd?.close();
    await this.persistCurrentSession();
  }

  // ---------- Ask ----------
  /** Send button doubles as a Stop control while a response is streaming. */
  private onSendOrStop(): void {
    if (this.streaming) {
      this.streamAbort = true;
      return;
    }
    void this.askNow();
  }

  private setStreaming(on: boolean): void {
    this.streaming = on;
    if (this.sendBtn) {
      setIcon(this.sendBtn, on ? "square" : "send");
      const tip = on ? "Stop" : "Send  ( ⌘/Ctrl + Enter )";
      this.sendBtn.setAttribute("aria-label", tip);
      this.sendBtn.title = tip;
      this.sendBtn.toggleClass("is-streaming", on);
    }
  }

  private humanStatus(
    state: "connecting" | "loading" | "retrying" | "ok",
    detail?: string,
  ): string {
    switch (state) {
      case "connecting":
        return `Connecting${detail ? ` to ${detail}` : ""}…`;
      case "loading":
        return `Loading model${detail ? ` ${detail}` : ""}… (first response can take a while)`;
      case "retrying":
        return `Connection issue — retrying${detail ? ` (${detail})` : ""}…`;
      default:
        return "";
    }
  }

  private async askNow(): Promise<void> {
    const copilot = this.plugin.copilot;
    if (!copilot) {
      new Notice("SauceBot not initialized");
      return;
    }
    if (this.streaming) {
      new Notice("SauceBot is still responding — press Stop first.");
      return;
    }
    const q = this.inputEl.value.trim();
    if (!q) return;
    // Warn once if the snowflake-matrix brain is still building — messages still
    // work, but grounding/token-efficiency improve once it's ready.
    if (!this.brainWarned && this.plugin.brainState === "building") {
      this.brainWarned = true;
      new Notice(
        "Sauce Brain is still forming — you can chat now, but answers will be sharper and cheaper once it's ready.",
      );
    }
    if (!this.firstUserMsg) this.firstUserMsg = q;
    this.inputEl.value = "";
    this.inputEl.style.height = "auto"; // collapse the auto-grown bar after send
    // Consume any armed slash-skill for this send, then reset the affordance.
    const forceSkill = this.pendingForceSkill ?? undefined;
    this.pendingForceSkill = null;
    this.inputEl.setAttribute(
      "placeholder",
      "Ask about your graph…  ( ⌘/Ctrl + Enter to send )",
    );
    this.suggestionsEl.hide();
    this.appendMessage("user", q);
    const a = this.appendAssistantMessage();
    // Persist the user turn to history BEFORE streaming so it is never lost on
    // an error or crash mid-response. Stamp a stable message id + timestamp.
    this.history.push({ role: "user", content: q, id: newMessageId(), ts: Date.now() });

    this.streamAbort = false;
    this.setStreaming(true);
    let text = "";
    let aborted = false;
    // Per-turn trace accumulation (model usage + timing for replay).
    const startedAt = Date.now();
    let usageIn = 0;
    let usageOut = 0;
    let toolCalls = 0;
    let doneReason = "end_turn";
    try {
      const activePath = this.plugin.app.workspace.getActiveFile()?.path;
      for await (const ev of copilot.ask(q, activePath, this.history.slice(0, -1), {
        ...(forceSkill !== undefined ? { forceSkill } : {}),
      })) {
        if (this.streamAbort) {
          aborted = true;
          break;
        }
        if (ev.type === "status") {
          a.setStatus(this.humanStatus(ev.state, ev.detail));
        } else if (ev.type === "reasoning") {
          a.appendReasoning(ev.delta);
        } else if (ev.type === "text") {
          a.setStatus(null); // first content clears the connecting/loading line
          if (!text) a.collapseReasoning(); // answer started → fold the thinking
          text += ev.delta;
          // Stream plain text for responsiveness; markdown render on `done`.
          a.body.setText(text);
          this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
        } else if (ev.type === "usage") {
          usageIn += ev.inputTokens;
          usageOut += ev.outputTokens;
        } else if (ev.type === "tool_use") {
          toolCalls += 1;
        } else if (ev.type === "done") {
          a.setStatus(null);
          doneReason = ev.reason;
          if (ev.reason === "error") {
            a.setError(ev.error ?? "unknown error");
          } else if (text) {
            await this.renderMarkdownInto(a.body, text);
            a.setCopySource(text); // raw markdown is the most paste-friendly form
          } else if (a.hasReasoning()) {
            // The model spent its whole budget reasoning and emitted no final
            // content. Don't blank out — the reasoning is already visible
            // (left expanded); flag that no clean answer was produced.
            a.setError(
              "No final answer was produced — the model's reasoning is shown above. Try again or raise the token limit.",
            );
          } else {
            a.setError("(no answer returned)");
          }
          this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      a.setStatus(null);
      a.setError(msg);
    } finally {
      this.setStreaming(false);
      if (aborted) {
        a.setStatus(null);
        a.body.setText(text ? text + "\n\n[stopped]" : "[stopped]");
      }
      // Record the assistant turn even when it errored/stopped, so the
      // conversation history (and persisted session) reflect what happened.
      const responseTs = Date.now();
      this.history.push({
        role: "assistant",
        content: text,
        id: newMessageId(),
        ts: responseTs,
      });
      // Stamp a full, replay-grade turn trace (ids at every layer + model usage
      // + fingerprints). Best-effort; fingerprinting is async.
      this.sessionTokenIn += usageIn;
      this.sessionTokenOut += usageOut;
      const s = this.plugin.copilot?.getSettings();
      const ctx = {
        conversationId: this.conversationId,
        chatId: this.chatId,
        installId: this.plugin.settings.installId ?? "",
        agentId: this.plugin.currentAgentId(),
        index: this.turnIndex++,
      };
      void buildTurnTrace(ctx, q, text, {
        provider: s?.provider ?? "",
        model: s?.model ?? "",
        inputTokens: usageIn,
        outputTokens: usageOut,
        latencyMs: responseTs - startedAt,
        reason: aborted ? "stopped" : doneReason,
        toolCalls,
      }).then((t) => {
        this.turns.push(t);
        void this.persistCurrentSession();
      });
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

  /** Assistant bubble with handles for the ephemeral status line, a collapsible
   *  reasoning block, the body, and an inline error. Kept in DOM order:
   *  label → status → reasoning → body → error. */
  private appendAssistantMessage(): {
    body: HTMLDivElement;
    setStatus: (txt: string | null) => void;
    appendReasoning: (delta: string) => void;
    collapseReasoning: () => void;
    hasReasoning: () => boolean;
    setError: (msg: string) => void;
    setCopySource: (text: string) => void;
  } {
    const wrap = this.transcriptEl.createDiv({
      cls: "sauce-copilot-msg sauce-copilot-assistant",
    });
    // Header row: role label + a copy button for the whole answer block.
    const head = wrap.createDiv({ cls: "sauce-copilot-msg-head" });
    head.createEl("strong", { text: "saucebot" });
    let copySource = "";
    const copyBtn = head.createEl("button", {
      cls: "sauce-copilot-copy clickable-icon",
    });
    setIcon(copyBtn, "copy");
    copyBtn.setAttribute("aria-label", "Copy answer");
    copyBtn.title = "Copy answer";
    copyBtn.hide(); // shown once there is content to copy
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(copySource);
        setIcon(copyBtn, "check");
        copyBtn.addClass("is-copied");
        window.setTimeout(() => {
          setIcon(copyBtn, "copy");
          copyBtn.removeClass("is-copied");
        }, 1200);
      } catch {
        new Notice("Couldn't copy to clipboard.");
      }
    };
    const body = wrap.createDiv({ cls: "sauce-copilot-body" });
    let statusEl: HTMLDivElement | null = null;
    let reasoningEl: HTMLDetailsElement | null = null;
    let reasoningSummary: HTMLElement | null = null;
    let reasoningBody: HTMLDivElement | null = null;
    let reasoningText = "";
    let errorEl: HTMLDivElement | null = null;
    return {
      body,
      setStatus: (txt) => {
        if (txt == null || txt === "") {
          statusEl?.remove();
          statusEl = null;
          return;
        }
        if (!statusEl) {
          statusEl = createDiv({ cls: "sauce-copilot-status" });
          wrap.insertBefore(statusEl, reasoningEl ?? body);
        }
        statusEl.setText(txt);
      },
      appendReasoning: (delta) => {
        if (!reasoningEl) {
          reasoningEl = createEl("details", { cls: "sauce-copilot-reasoning" });
          // Open WHILE streaming so the thinking is visible live; auto-collapsed
          // once the final answer starts (collapseReasoning).
          reasoningEl.open = true;
          reasoningSummary = reasoningEl.createEl("summary", {
            text: "Reasoning…",
          });
          reasoningBody = reasoningEl.createDiv({
            cls: "sauce-copilot-reasoning-body",
          });
          wrap.insertBefore(reasoningEl, body);
        }
        reasoningText += delta;
        reasoningBody!.setText(reasoningText);
        // Keep the streaming reasoning in view.
        this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
      },
      collapseReasoning: () => {
        if (reasoningEl) {
          reasoningEl.open = false;
          if (reasoningSummary) reasoningSummary.setText("Reasoning");
        }
      },
      hasReasoning: () => reasoningText.trim().length > 0,
      setError: (msg) => {
        if (!errorEl) errorEl = wrap.createDiv({ cls: "sauce-copilot-error" });
        errorEl.setText(`⚠ ${msg}`);
      },
      setCopySource: (text) => {
        copySource = text;
        if (text.trim()) copyBtn.show();
        else copyBtn.hide();
      },
    };
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
