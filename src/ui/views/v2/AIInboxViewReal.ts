import { ItemView, type Plugin, WorkspaceLeaf } from "obsidian";

export const VIEW_AI_INBOX_REAL = "sauce-crm-ai-inbox";

export class AIInboxViewReal extends ItemView {
  constructor(leaf: WorkspaceLeaf, _plugin: Plugin) {
    super(leaf);
  }
  getViewType(): string {
    return VIEW_AI_INBOX_REAL;
  }
  getDisplayText(): string {
    return "Sauce CRM — AI Inbox";
  }
  getIcon(): string {
    return "ai-inbox";
  }
  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.createEl("h3", { text: "Sauce CRM AI Inbox" });
    this.contentEl.createEl("p", {
      text: "AI inbox — incoming suggestions appear here.",
    });
  }
  async onClose(): Promise<void> {
    /* nothing to clean up */
  }
}
