// CON-OBS-INTEG-001 · T-A-05 — Integrations settings section with a 3-tab
// grouping: Services | Community Plugins | Core Plugins.
//
// Follows the live TS section pattern (A-002 amendment: settings render from
// TypeScript, there is no markdown settings renderer). The Community/Core tabs
// delegate to the T-A-04 pages keyed off the ObsidianPluginRegistry; the
// Services tab hosts the existing integration/service surface via an optional
// delegate. Tokenized `sauce-*` classes only (G-001); jsdom-testable DOM.

import type { ObsidianPluginRegistry } from "../../../integrations/obsidian/ObsidianPluginRegistry";
import type { PluginButtonEvent } from "../../../integrations/obsidian/IObsidianPluginIntegration";
import { renderCommunityPluginsPage } from "../integrations/CommunityPluginsPage";
import { renderCorePluginsPage } from "../integrations/CorePluginsPage";

/**
 * Minimal host the section reads from. The live plugin exposes the registry as
 * `obsidianPlugins`; `renderServices` lets the existing services surface plug
 * into the first tab without this file depending on the whole plugin;
 * `onPluginAction` makes the Install→Optimize card buttons actionable.
 */
export interface IntegrationsSectionHost {
  obsidianPlugins?: ObsidianPluginRegistry;
  renderServices?: (containerEl: HTMLElement) => void;
  onPluginAction?: (pluginId: string, event: PluginButtonEvent) => void;
}

type TabId = "services" | "community" | "core";
const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "services", label: "Services" },
  { id: "community", label: "Community Plugins" },
  { id: "core", label: "Core Plugins" },
];

export function renderIntegrationsSection(
  containerEl: HTMLElement,
  host: IntegrationsSectionHost,
): void {
  containerEl.replaceChildren();

  const strip = document.createElement("div");
  strip.className = "sauce-tab-strip";
  strip.setAttribute("role", "tablist");

  const body = document.createElement("div");
  body.className = "sauce-tab-content";
  body.setAttribute("role", "tabpanel");

  let active: TabId = "services";
  const tabButtons = new Map<TabId, HTMLButtonElement>();

  const renderBody = (): void => {
    body.replaceChildren();
    const registry = host.obsidianPlugins;
    // Wrap the host action so the cards re-render (reflecting new state) after
    // it completes, without losing the active sub-tab.
    const onAction = host.onPluginAction
      ? (pluginId: string, event: PluginButtonEvent) =>
          void Promise.resolve(host.onPluginAction!(pluginId, event)).then(() =>
            renderBody(),
          )
      : undefined;
    if (active === "community") {
      if (registry) renderCommunityPluginsPage(body, { registry, onAction });
      else emptyHint(body, "Plugin registry not initialized.");
    } else if (active === "core") {
      if (registry) renderCorePluginsPage(body, { registry, onAction });
      else emptyHint(body, "Plugin registry not initialized.");
    } else {
      if (host.renderServices) host.renderServices(body);
      else emptyHint(body, "Service integrations configured here.");
    }
  };

  const select = (id: TabId): void => {
    active = id;
    for (const [tid, btn] of tabButtons)
      btn.setAttribute("aria-selected", String(tid === id));
    renderBody();
  };

  for (const t of TABS) {
    const btn = document.createElement("button");
    btn.className = "sauce-tab";
    btn.textContent = t.label;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", String(t.id === active));
    btn.addEventListener("click", () => select(t.id));
    tabButtons.set(t.id, btn);
    strip.appendChild(btn);
  }

  containerEl.appendChild(strip);
  containerEl.appendChild(body);
  renderBody();
}

function emptyHint(containerEl: HTMLElement, text: string): void {
  const p = document.createElement("p");
  p.className = "setting-item-description";
  p.textContent = text;
  containerEl.appendChild(p);
}
