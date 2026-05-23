// V2 copilot section. Uses ProviderPicker (auto model indexing) instead of
// free-text inputs so users pick from a live, per-provider catalog.
import { Setting } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import { ProviderPicker } from "../../components/v2/ProviderPicker";
import type { ProviderId } from "../../../copilot/ModelCatalog";
import { renderRagEmbeddings } from "./rag";
import { renderEnrichment } from "./enrichment";
import { renderDocuments } from "./documents";
import { renderPrompts } from "./prompts";

function markAdvanced(set: Setting): Setting {
  set.settingEl.addClass("sg-advanced");
  return set;
}

function pushCopilotUpdate(plugin: SauceGraphPlugin): void {
  try { plugin.copilot?.updateSettings?.(plugin.settings.copilot); } catch { /* noop */ }
}

export function renderCopilot(containerEl: HTMLElement, plugin: SauceGraphPlugin): void {
  plugin.logger?.debug?.("settings.section_render", { section: "copilot" });
  // Copilot v2 shipped in P9; render real settings.
  const cfg: any = plugin.settings.copilot as any;
  if (!cfg) {
    const empty = containerEl.createDiv({ cls: "sg-empty-state" });
    empty.createEl("h4", { text: "Copilot — coming soon" });
    empty.createEl("p", { text: "Choose your AI assistant. Free local models (Ollama / LM Studio) or cloud (Anthropic / OpenAI)." });
    empty.createEl("span", { cls: "sg-phase-pill", text: "Phase P9" });
    return;
  }

  containerEl.createEl("h3", { text: "Copilot" });
  containerEl.createEl("p", {
    cls: "setting-item-description",
    text: "Pick a provider; the model list auto-populates from the provider's catalog (live for Ollama/LM Studio/NIM, curated for Anthropic/OpenAI). Hit Refresh after pulling a new model.",
  });

  const pickerHost = containerEl.createDiv({ cls: "sg-section-row" });
  new ProviderPicker({
    container: pickerHost,
    plugin,
    initialProvider: (cfg.provider ?? "anthropic") as ProviderId,
    initialModel: cfg.model ?? "",
    endpoint: cfg.baseUrl,
    apiKey: cfg.apiKey,
    onChange: async ({ provider, model }) => {
      cfg.provider = provider;
      cfg.model = model;
      await plugin.saveSettings();
      pushCopilotUpdate(plugin);
    },
  }).render();

  new Setting(containerEl)
    .setName("API key")
    .setDesc("Stored locally. Will move to keyvault in P15.")
    .addText((t) => {
      t.inputEl.type = "password";
      t.setValue(cfg.apiKey ?? "").onChange(async (v) => {
        cfg.apiKey = v; await plugin.saveSettings(); pushCopilotUpdate(plugin);
      });
    });

  new Setting(containerEl)
    .setName("Temperature")
    .setDesc("Creativity vs precision. Lower = more deterministic.")
    .addSlider((s) => s
      .setLimits(0, 1, 0.05)
      .setDynamicTooltip()
      .setValue(typeof cfg.temperature === "number" ? cfg.temperature : 0.3)
      .onChange(async (v) => { cfg.temperature = v; await plugin.saveSettings(); pushCopilotUpdate(plugin); }));

  containerEl.createEl("h3", { text: "Advanced" });

  markAdvanced(new Setting(containerEl)
    .setName("Max tokens")
    .setDesc("Maximum tokens per response.")
    .addSlider((s) => s
      .setLimits(256, 8192, 128)
      .setDynamicTooltip()
      .setValue(typeof cfg.maxTokens === "number" ? cfg.maxTokens : 2048)
      .onChange(async (v) => { cfg.maxTokens = v; await plugin.saveSettings(); pushCopilotUpdate(plugin); })));

  markAdvanced(new Setting(containerEl)
    .setName("System prompt")
    .setDesc("Persistent instructions sent before every conversation.")
    .addTextArea((t) => t
      .setValue(cfg.systemPrompt ?? "")
      .onChange(async (v) => { cfg.systemPrompt = v; await plugin.saveSettings(); pushCopilotUpdate(plugin); })));

  markAdvanced(new Setting(containerEl)
    .setName("Base URL")
    .setDesc("Override endpoint for Ollama / LM Studio / proxy.")
    .addText((t) => t
      .setValue(cfg.baseUrl ?? "")
      .onChange(async (v) => { cfg.baseUrl = v || undefined; await plugin.saveSettings(); pushCopilotUpdate(plugin); })));

  markAdvanced(new Setting(containerEl)
    .setName("Default autonomy")
    .setDesc("How much copilot may act without confirmation.")
    .addDropdown((d) => d
      .addOption("manual", "Manual — always ask")
      .addOption("suggest", "Suggest — recommend, don't act")
      .addOption("assist", "Assist — act with confirmation")
      .addOption("auto", "Auto — act freely")
      .setValue(cfg.autonomy ?? "suggest")
      .onChange(async (v) => { cfg.autonomy = v; await plugin.saveSettings(); pushCopilotUpdate(plugin); })));

  // RAG & embeddings (PLAN T3) — embedding provider parity + master toggle.
  renderRagEmbeddings(containerEl, plugin);
  // Auto-enrichment (PLAN T5).
  renderEnrichment(containerEl, plugin);
  // Document harvesting (PLAN T7).
  renderDocuments(containerEl, plugin);
  // Prompts & sessions (PLAN T6).
  renderPrompts(containerEl, plugin);
}
