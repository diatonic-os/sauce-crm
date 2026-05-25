// Local LLM providers settings — the live, mounted replacement for the
// (unmounted) LocalLLMPage. Configures Ollama + LM Studio endpoints and default
// chat models with a live ProviderPicker (same catalog-driven dropdown used
// everywhere else). When the configured provider is the active copilot provider,
// edits flow straight into the runtime (baseUrl + model), so this is real
// config, not a parallel store.
import { Setting } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import { ProviderPicker } from "../../components/v2/ProviderPicker";
import type { ProviderId } from "../../../copilot/ModelCatalog";
import type { LocalProviderId } from "../../../settings/FeatureSettings";

const LOCAL: { id: LocalProviderId; label: string }[] = [
  { id: "ollama", label: "Ollama" },
  { id: "lmstudio", label: "LM Studio" },
];

/** When `id` is the active copilot provider, mirror its endpoint/model into the
 *  live copilot settings + runtime. */
function syncActiveProvider(
  plugin: SauceGraphPlugin,
  id: LocalProviderId,
): void {
  const cfg = plugin.settings.copilot as {
    provider?: string;
    baseUrl?: string;
    model?: string;
  };
  if (cfg.provider !== id) return;
  const lc = plugin.settings.features.localLLM[id];
  cfg.baseUrl = lc.endpoint || undefined;
  if (lc.model) cfg.model = lc.model;
  plugin.copilot?.updateSettings?.(plugin.settings.copilot);
}

export function renderLocalLLM(
  containerEl: HTMLElement,
  plugin: SauceGraphPlugin,
): void {
  const ll = plugin.settings.features.localLLM;

  containerEl.createEl("h3", {
    text: "Local LLM providers",
    cls: "sauce-settings-section-title",
  });
  containerEl.createDiv({ cls: "sauce-callout" }).createSpan({
    text: "Configure Ollama and LM Studio endpoints and default chat models. The model list loads live from each endpoint. When a provider is your active SauceBot provider, changes here apply to it immediately.",
  });

  for (const { id, label } of LOCAL) {
    const lc = ll[id];
    containerEl.createEl("h4", { text: label });

    new Setting(containerEl)
      .setName("Endpoint")
      .setDesc(
        id === "lmstudio"
          ? "OpenAI-compatible base, e.g. http://localhost:1234/v1"
          : "e.g. http://localhost:11434",
      )
      .addText((t) =>
        t.setValue(lc.endpoint).onChange(async (v) => {
          lc.endpoint = v;
          syncActiveProvider(plugin, id);
          await plugin.saveSettings();
        }),
      );

    // Live chat-model dropdown for this provider (Refresh shows reachability).
    const pickerHost = containerEl.createDiv({ cls: "sg-section-row" });
    new ProviderPicker({
      container: pickerHost,
      plugin,
      lockedProvider: id as ProviderId,
      kind: "chat",
      modelLabel: "Default model",
      initialModel: lc.model,
      endpoint: lc.endpoint,
      onChange: async ({ model }) => {
        lc.model = model;
        syncActiveProvider(plugin, id);
        await plugin.saveSettings();
      },
    }).render();
  }
}
