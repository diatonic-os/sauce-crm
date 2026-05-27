// CON-OBS-INTEG-001 — "Plugins" settings tab: surfaces the Install→Optimize
// cards (T-A-04/T-A-05) keyed off the live ObsidianPluginRegistry, with the
// existing integrations/services surface on the first sub-tab.

import type SauceGraphPlugin from "../../../main";
import type { PluginButtonEvent } from "../../../integrations/obsidian/IObsidianPluginIntegration";
import { renderIntegrationsSection } from "./IntegrationsSection";
import { renderIntegrations } from "./integrations";

export function renderPlugins(
  containerEl: HTMLElement,
  plugin: SauceGraphPlugin,
): void {
  const registry = plugin.obsidianPlugins ?? undefined;

  const onPluginAction = async (
    pluginId: string,
    event: PluginButtonEvent,
  ): Promise<void> => {
    if (!registry) return;
    const adapter = registry.get(pluginId);
    if (!adapter) return;
    // Optimistic transition; refresh() below corrects to detected truth.
    registry.stateMachine.dispatch(pluginId, event);
    try {
      if (event === "optimize" || event === "updateAndOptimize") {
        const res = await adapter.optimize();
        registry.stateMachine.dispatch(pluginId, res.ok ? "applied" : "error");
      }
    } catch {
      registry.stateMachine.dispatch(pluginId, "error");
    }
    // Re-detect so the card reflects reality (e.g. OPTIMIZED after optimize).
    await registry.refresh();
  };

  renderIntegrationsSection(containerEl, {
    ...(registry ? { obsidianPlugins: registry } : {}),
    renderServices: (el) => renderIntegrations(el, plugin),
    onPluginAction,
  });

  // Populate initial card state from a live detect pass (best-effort).
  void registry?.refresh();
}
