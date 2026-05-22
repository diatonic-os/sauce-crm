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

export class CopilotChatView extends ItemView {
  private history: ChatMessage[] = [];
  private inputEl!: HTMLTextAreaElement;
  private transcriptEl!: HTMLDivElement;
  private statusEl!: HTMLSpanElement;

  constructor(leaf: WorkspaceLeaf, public plugin: SauceGraphPlugin) { super(leaf); }

  getViewType(): string { return VIEW_COPILOT_CHAT; }
  getDisplayText(): string { return "Sauce: Copilot"; }
  getIcon(): string { return "message-circle"; }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty(); root.addClass("sauce-view"); root.addClass("sauce-copilot");
    root.createEl("h2", { text: "Sauce Copilot" });

    const header = root.createDiv({ cls: "sauce-copilot-header" });
    this.statusEl = header.createEl("span", { cls: "sauce-copilot-status sauce-clickable", text: this.statusLine() });
    this.statusEl.title = "Click to switch provider / model";
    this.statusEl.onclick = () => this.openPicker();
    const reload = header.createEl("button", { cls: "sauce-button sauce-button-secondary", text: "New session" });
    reload.onclick = () => { this.history = []; this.transcriptEl.empty(); this.statusEl.setText(this.statusLine()); };

    this.transcriptEl = root.createDiv({ cls: "sauce-copilot-transcript" });
    const inputRow = root.createDiv({ cls: "sauce-copilot-input" });
    this.inputEl = inputRow.createEl("textarea", { cls: "sauce-copilot-textarea", attr: { placeholder: "Ask about your graph…  (Cmd+Enter)" } });
    const send = inputRow.createEl("button", { cls: "sauce-button", text: "Ask" });
    const ask = () => void this.askNow();
    send.onclick = ask;
    this.inputEl.addEventListener("keydown", (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") { e.preventDefault(); ask(); }
    });
  }

  async onClose(): Promise<void> { /* noop */ }

  private openPicker(): void {
    const cur = this.plugin.copilot?.getSettings();
    const modal = new Modal(this.plugin.app);
    modal.titleEl.setText("Switch model");
    const host = modal.contentEl.createDiv();
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
    if (!s.apiKey && s.provider !== "ollama") return `${s.provider}:${s.model}  ·  no API key set (Settings → Copilot)`;
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
