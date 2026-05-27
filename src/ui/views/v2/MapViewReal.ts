// Stub MapView — minimal ItemView so main.ts compiles. The full map
// implementation will land in a follow-up task; for now the view shows
// a placeholder message so operators can see the registration succeeded.

import { ItemView, type Plugin, WorkspaceLeaf } from "obsidian";
import { type ViewTypeId, asViewTypeId } from "@/types/brands";

export const VIEW_MAP_REAL: ViewTypeId = asViewTypeId("sauce-crm-map");

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
  override getIcon(): string {
    return "map";
  }
  override async onOpen(): Promise<void> {
    this.contentEl.empty();
    this.contentEl.createEl("h3", { text: "Sauce CRM Map" });
    this.contentEl.createEl("p", {
      text: "Map view — implementation pending.",
    });
  }
  override async onClose(): Promise<void> {
    /* nothing to clean up */
  }
}
