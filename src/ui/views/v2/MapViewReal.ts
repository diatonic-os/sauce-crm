// Stub MapView — minimal ItemView so main.ts compiles. The full map
// implementation will land in a follow-up task; for now the view shows
// a placeholder message so operators can see the registration succeeded.

import { ItemView, type Plugin, WorkspaceLeaf } from "obsidian";

export const VIEW_MAP_REAL = "sauce-crm-map";

export class MapViewReal extends ItemView {
  constructor(leaf: WorkspaceLeaf, _plugin: Plugin) {
    super(leaf);
  }
  getViewType(): string {
    return VIEW_MAP_REAL;
  }
  getDisplayText(): string {
    return "Sauce CRM — Map";
  }
  getIcon(): string {
    return "map";
  }
  async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.createEl("h3", { text: "Sauce CRM Map" });
    this.contentEl.createEl("p", {
      text: "Map view — implementation pending.",
    });
  }
  async onClose(): Promise<void> {
    /* nothing to clean up */
  }
}
