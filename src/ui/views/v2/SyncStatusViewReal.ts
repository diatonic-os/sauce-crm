import { ItemView, type Plugin, WorkspaceLeaf } from "obsidian";
import { type ViewTypeId, asViewTypeId } from "@/types/brands";
import { SauceViewHelp } from "../../components/v2/SauceViewHelp";

export const VIEW_SYNC_STATUS_REAL: ViewTypeId = asViewTypeId(
  "sauce-crm-sync-status",
);

export class SyncStatusViewReal extends ItemView {
  private help!: SauceViewHelp;
  constructor(leaf: WorkspaceLeaf, _plugin: Plugin) {
    super(leaf);
  }
  getViewType(): string {
    return VIEW_SYNC_STATUS_REAL;
  }
  getDisplayText(): string {
    return "Sauce CRM — Sync Status";
  }
  override getIcon(): string {
    return "sync";
  }
  override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.help = new SauceViewHelp();
    this.help.mountHeader(this.contentEl, {
      title: "Sync Status",
      icon: "sync",
      subtitle: "Track CRM sync progress and state",
    });
    this.contentEl.createEl("h3", { text: "Sauce CRM Sync Status" });
    this.contentEl.createEl("p", {
      text: "Sync status — pending implementation.",
    });
  }
  override async onClose(): Promise<void> {
    /* nothing to clean up */
  }
}
