import { ItemView, type Plugin, WorkspaceLeaf } from "obsidian";

export const VIEW_AUDIT_LOG_REAL = "sauce-crm-audit-log";

export class AuditLogViewReal extends ItemView {
  constructor(leaf: WorkspaceLeaf, _plugin: Plugin) {
    super(leaf);
  }
  getViewType(): string { return VIEW_AUDIT_LOG_REAL; }
  getDisplayText(): string { return "Sauce CRM — Audit Log"; }
  getIcon(): string { return "audit"; }
  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.createEl("h3", { text: "Sauce CRM Audit Log" });
    this.contentEl.createEl("p", { text: "Audit log — pending implementation." });
  }
  async onClose(): Promise<void> { /* nothing to clean up */ }
}
