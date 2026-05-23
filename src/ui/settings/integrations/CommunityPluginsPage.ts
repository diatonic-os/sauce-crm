// CON-OBS-INTEG-001 · T-A-04 — Community Plugins settings page.
//
// Renders one card per community-class adapter in the ObsidianPluginRegistry.
// The action button's label comes from BUTTON_LABELS (S-button-labels) keyed off
// the plugin's current PluginStateMachine state; clicking dispatches the state's
// primary event back through `ctx.onAction`.
//
// Standard DOM APIs (not Obsidian's createDiv augmentation) so the page is
// unit-testable under jsdom. Styling is tokenized `sauce-*` classes only — no
// inline styles (G-001). React was dropped per CONFLICT-1 ("match codebase");
// the existing UI surface is plain-TS / Svelte.

import type { ObsidianPluginRegistry } from "../../../integrations/obsidian/ObsidianPluginRegistry";
import type {
  IObsidianPluginIntegration,
  PluginButtonState,
  PluginButtonEvent,
} from "../../../integrations/obsidian/IObsidianPluginIntegration";
import { BUTTON_LABELS } from "../../../integrations/obsidian/PluginStateMachine";

export interface PluginCardContext {
  registry: ObsidianPluginRegistry;
  /** Invoked when a card's primary button is clicked (state's primary event). */
  onAction?: (pluginId: string, event: PluginButtonEvent) => void;
}

/** The button event a given button state triggers, or null when the button is inert. */
export function primaryEventFor(
  state: PluginButtonState,
): PluginButtonEvent | null {
  switch (state) {
    case "NOT_INSTALLED":
      return "install";
    case "OPTIMIZABLE":
      return "optimize";
    case "OUTDATED":
      return "updateAndOptimize";
    case "DISABLED":
      return "userEnable";
    case "ERROR":
      return "retry";
    // INSTALLED (detecting), INSTALLING, OPTIMIZING, OPTIMIZED, INCOMPATIBLE → inert
    default:
      return null;
  }
}

/** Build one plugin card into `grid` and return it. Shared by both pages. */
export function renderPluginCard(
  grid: HTMLElement,
  adapter: IObsidianPluginIntegration,
  ctx: PluginCardContext,
): HTMLElement {
  const state = ctx.registry.stateMachine.get(adapter.pluginId);

  const card = document.createElement("div");
  card.className = "sauce-card";

  const head = document.createElement("div");
  head.className = "sauce-card-head";
  const title = document.createElement("h4");
  title.className = "sauce-card-title";
  title.textContent = adapter.label || adapter.pluginId;
  const badge = document.createElement("span");
  badge.className = "sauce-badge sauce-badge--muted";
  badge.textContent = state;
  head.appendChild(title);
  head.appendChild(badge);

  const foot = document.createElement("div");
  foot.className = "sauce-card-foot";
  const btn = document.createElement("button");
  btn.className = "sauce-btn sauce-btn--primary";
  btn.textContent = BUTTON_LABELS[state];
  const event = primaryEventFor(state);
  btn.disabled = event === null;
  if (event) {
    btn.addEventListener("click", () =>
      ctx.onAction?.(adapter.pluginId, event),
    );
  }
  foot.appendChild(btn);

  card.appendChild(head);
  card.appendChild(foot);
  grid.appendChild(card);
  return card;
}

/** Render the Community Plugins page: cards for every community-class adapter. */
export function renderCommunityPluginsPage(
  containerEl: HTMLElement,
  ctx: PluginCardContext,
): void {
  containerEl.replaceChildren();
  const grid = document.createElement("div");
  grid.className = "sauce-card-grid";
  for (const adapter of ctx.registry.list()) {
    if (adapter.pluginClass === "community")
      renderPluginCard(grid, adapter, ctx);
  }
  containerEl.appendChild(grid);
}
