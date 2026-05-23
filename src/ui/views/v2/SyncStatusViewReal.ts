import { ItemView, type Plugin, WorkspaceLeaf } from "obsidian";

export const VIEW_SYNC_STATUS_REAL = "sauce-crm-sync-status";

export class SyncStatusViewReal extends ItemView {
  constructor(leaf: WorkspaceLeaf, _plugin: Plugin) {
    super(leaf);
  }
  getViewType(): string { return VIEW_SYNC_STATUS_REAL; }
  getDisplayText(): string { return "Sauce CRM — Sync Status"; }
  getIcon(): string { return "sync"; }
  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.createEl("h3", { text: "Sauce CRM Sync Status" });
    this.contentEl.createEl("p", { text: "Sync status — pending implementation." });
  }
  async onClose(): Promise<void> { /* nothing to clean up */ }
}
