// CON-OBS-INTEG-001 · T-A-04 — Core Plugins settings page.
//
// Same card surface as CommunityPluginsPage, filtered to core-class adapters
// (CW-* wrappers). Reuses the shared renderPluginCard so the two pages cannot
// drift. Tokenized classes only (G-001).

import type { PluginCardContext } from "./CommunityPluginsPage";
import { renderPluginCard } from "./CommunityPluginsPage";

/** Render the Core Plugins page: cards for every core-class adapter. */
export function renderCorePluginsPage(
  containerEl: HTMLElement,
  ctx: PluginCardContext,
): void {
  containerEl.replaceChildren();
  const grid = document.createElement("div");
  grid.className = "sauce-card-grid";
  for (const adapter of ctx.registry.list()) {
    if (adapter.pluginClass === "core") renderPluginCard(grid, adapter, ctx);
  }
  containerEl.appendChild(grid);
}
