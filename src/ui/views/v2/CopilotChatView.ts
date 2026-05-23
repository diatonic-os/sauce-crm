// Working chat surface for the Sauce Copilot. Wraps the V2 CopilotRuntime
// (provider + RAG + tool-use) in a real Obsidian ItemView. The sibling-agent's
// `CopilotView` stub on V2ViewBase remains alongside for the host-agnostic
// settings preview; this file is what `sauce:open-copilot` mounts.

import { ItemView, Modal, WorkspaceLeaf, Notice } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import type { ChatMessage } from "../../../copilot/ICopilotProvider";
import { ProviderPicker } from "../../components/v2/ProviderPicker";
import type { ProviderId } from "../../../copilot/ModelCatalog";

export const VIEW_COPILOT_CHAT = "sauce-copilot-chat";

// Web Speech API surface — present in Electron (Chromium) so this works
// on Obsidian desktop. We type-narrow loosely because lib.dom.d.ts in
// some TS versions lacks SpeechRecognition. Mobile is not supported per
// manifest.json isDesktopOnly: true.
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string }>>; resultIndex: number }) => void) | null;
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
  private statusEl!: HTMLSpanElement;
  private micButton: HTMLButtonElement | null = null;
  private recognition: SpeechRecognitionLike | null = null;
  private isListening = false;

  constructor(leaf: WorkspaceLeaf, public plugin: SauceGraphPlugin) { super(leaf); }

  getViewType(): string { return VIEW_COPILOT_CHAT; }
  getDisplayText(): string { return "Sauce: Copilot"; }
  getIcon(): string { return "message-circle"; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty(); root.addClass("sauce-view"); root.addClass("sauce-copilot");

    // Toolbar (card): title + live status pill on the left, actions on the right.
    const bar = root.createDiv({ cls: "sauce-copilot-bar" });
    const titleWrap = bar.createDiv({ cls: "sauce-copilot-titlewrap" });
    titleWrap.createEl("h2", { cls: "sauce-copilot-title", text: "Sauce Copilot" });
    this.statusEl = titleWrap.createEl("span", { cls: "sauce-copilot-status sauce-clickable", text: this.statusLine() });
    this.statusEl.title = "Click to switch provider / model";
    this.statusEl.onclick = () => this.openPicker();

    const actions = bar.createDiv({ cls: "sauce-copilot-actions" });
    const modelBtn = actions.createEl("button", { cls: "sauce-button", text: "⇆ Model" });
    modelBtn.title = "Switch provider / model (live catalog)";
    modelBtn.onclick = () => this.openPicker();
    const settingsBtn = actions.createEl("button", { cls: "sauce-button sauce-button-secondary", text: "Settings" });
    settingsBtn.title = "Open Copilot settings — API keys, providers, RAG";
    settingsBtn.onclick = () => this.openSettings();
    const reload = actions.createEl("button", { cls: "sauce-button sauce-button-secondary", text: "New session" });
    reload.title = "Clear the transcript and start fresh";
    reload.onclick = () => { this.history = []; this.transcriptEl.empty(); this.statusEl.setText(this.statusLine()); };

    this.transcriptEl = root.createDiv({ cls: "sauce-copilot-transcript" });
    const inputRow = root.createDiv({ cls: "sauce-copilot-input" });
    this.inputEl = inputRow.createEl("textarea", { cls: "sauce-copilot-textarea", attr: { placeholder: "Ask about your graph…  (Cmd+Enter)" } });

    // Mic button — Web Speech API. Visible only when the browser/Electron
    // build exposes a recognizer; on unsupported builds we omit the button
    // entirely so the operator isn't teased with dead UI.
    const SR = getSpeechRecognition();
    if (SR) {
      this.micButton = inputRow.createEl("button", {
        cls: "sauce-button sauce-button-secondary sauce-copilot-mic",
        text: "🎙",
      });
      this.micButton.title = "Click to dictate (Web Speech API). Click again to stop.";
      this.micButton.onclick = () => this.toggleVoice(SR);
    }

    const send = inputRow.createEl("button", { cls: "sauce-button", text: "Ask" });
    const ask = () => void this.askNow();
    send.onclick = ask;
    this.inputEl.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); ask(); }
    });
  }

  private toggleVoice(SR: SpeechRecognitionCtor): void {
    if (this.isListening && this.recognition) {
      try { this.recognition.stop(); } catch { /* ignore */ }
      return;
    }
    const rec = new SR();
    rec.lang = navigator.language || "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    // Track interim text so partial results don't pile up in the textarea.
    let baseValue = this.inputEl.value;
    if (baseValue && !baseValue.endsWith(" ")) baseValue += " ";
    rec.onresult = (ev) => {
      let finalText = "";
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const res = ev.results[i] as ArrayLike<{ transcript: string }> & { isFinal?: boolean };
        const t = res[0].transcript;
        if (res.isFinal) finalText += t;
        else interim += t;
      }
      if (finalText) {
        baseValue += finalText;
      }
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
      this.micButton.setText("⏹");
      this.micButton.addClass("is-listening");
    }
    try { rec.start(); }
    catch (e) { new Notice(`Could not start dictation: ${(e as Error).message}`); this.stopRecognition(); }
  }

  private stopRecognition(): void {
    this.isListening = false;
    this.recognition = null;
    if (this.micButton) {
      this.micButton.setText("🎙");
      this.micButton.removeClass("is-listening");
    }
  }

  async onClose(): Promise<void> {
    // Stop any in-flight recognition so the mic indicator clears.
    if (this.recognition) {
      try { this.recognition.stop(); } catch { /* ignore */ }
      this.recognition = null;
    }
    this.isListening = false;
  }

  /** Deep-link to the plugin's settings tab (Copilot) so the "no API key"
   *  hint is actionable. Falls back to a Notice if the private API shifts. */
  private openSettings(): void {
    const setting = (this.plugin.app as unknown as {
      setting?: { open?: () => void; openTabById?: (id: string) => void };
    }).setting;
    try {
      setting?.open?.();
      setting?.openTabById?.(this.plugin.manifest.id);
    } catch {
      new Notice("Open Settings → Sauce CRM → Copilot");
    }
  }

  private openPicker(): void {
    const cur = this.plugin.copilot?.getSettings();
    const modal = new Modal(this.plugin.app);
    modal.modalEl.addClass("sauce-modal");
    modal.titleEl.setText("Switch model");
    const host = modal.contentEl.createDiv({ cls: "sauce-section" });
    new ProviderPicker({
      container: host,
      plugin: this.plugin,
      initialProvider: (cur?.provider ?? "anthropic") as ProviderId,
      initialModel: cur?.model ?? "",
      apiKey: cur?.apiKey,
      onChange: async ({ provider, model }) => {
        if (!cur) return;
        this.plugin.settings.copilot.provider = provider as typeof this.plugin.settings.copilot.provider;
        this.plugin.settings.copilot.model = model;
        await this.plugin.saveSettings();
        this.plugin.copilot?.updateSettings?.(this.plugin.settings.copilot);
        this.statusEl.setText(this.statusLine());
      },
    }).render();
    modal.open();
  }

  private statusLine(): string {
    const s = this.plugin.copilot?.getSettings();
    if (!s) return "copilot uninitialized";
    // Local providers (Ollama / LM Studio) don't need an API key — they
    // hit a localhost HTTP endpoint. Only flag missing key for cloud.
    const isLocal = s.provider === "ollama" || s.provider === "lmstudio";
    if (!s.apiKey && !isLocal) return `${s.provider}:${s.model}  ·  no API key set (Settings → Copilot)`;
    return `${s.provider}:${s.model}  ·  ready`;
  }

  private async askNow(): Promise<void> {
    const copilot = this.plugin.copilot;
    if (!copilot) { new Notice("Copilot not initialized"); return; }
    const q = this.inputEl.value.trim();
    if (!q) return;
    this.inputEl.value = "";
    this.appendMessage("user", q);
    const assistantEl = this.appendMessage("assistant", "");
    let text = "";
    try {
      const activePath = this.plugin.app.workspace.getActiveFile()?.path;
      for await (const ev of copilot.ask(q, activePath, this.history)) {
        if (ev.type === "text") {
          text += ev.delta;
          assistantEl.setText(text);
          this.transcriptEl.scrollTop = this.transcriptEl.scrollHeight;
        } else if (ev.type === "done") {
          if (ev.reason === "error") assistantEl.setText(text + `\n\n[error: ${ev.error ?? "unknown"}]`);
        } else if (ev.type === "usage") {
          this.statusEl.setText(`${this.statusLine()}  ·  ${ev.inputTokens}→${ev.outputTokens} tok`);
        }
      }
      this.history.push({ role: "user", content: q });
      this.history.push({ role: "assistant", content: text });
    } catch (e: any) {
      assistantEl.setText(`[error: ${e?.message ?? String(e)}]`);
    }
  }

  private appendMessage(role: "user" | "assistant", text: string): HTMLDivElement {
    const wrap = this.transcriptEl.createDiv({ cls: `sauce-copilot-msg sauce-copilot-${role}` });
    wrap.createEl("strong", { text: role === "user" ? "you" : "copilot" });
    return wrap.createDiv({ cls: "sauce-copilot-body", text });
  }
}
