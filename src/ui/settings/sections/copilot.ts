// V2 copilot section. Uses ProviderPicker (auto model indexing) instead of
// free-text inputs so users pick from a live, per-provider catalog.
import { Platform, Setting } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import { ProviderPicker } from "../../components/v2/ProviderPicker";
import { InlineStatus } from "../../components/v2/InlineStatus";
import { testProviderConnection } from "../../../copilot/testProviderConnection";
import {
  detectLmStudioEndpoint,
  scanLanForLmStudio,
} from "../../../copilot/detectLmStudioEndpoint";
import type { ProviderId } from "../../../copilot/ModelCatalog";
import { renderRagEmbeddings } from "./rag";
import { renderEnrichment } from "./enrichment";
import { renderDocuments } from "./documents";
import { renderPrompts } from "./prompts";
import { renderLocalLLM } from "./localllm";

function markAdvanced(set: Setting): Setting {
  set.settingEl.addClass("sg-advanced");
  return set;
}

function pushCopilotUpdate(plugin: SauceGraphPlugin): void {
  try {
    plugin.copilot?.updateSettings?.(plugin.settings.copilot);
  } catch {
    /* noop */
  }
}

export function renderCopilot(
  containerEl: HTMLElement,
  plugin: SauceGraphPlugin,
): void {
  plugin.logger?.debug?.("settings.section_render", { section: "copilot" });
  // Copilot v2 shipped in P9; render real settings.
  // CopilotSettings is typed but not all runtime-mutable fields are promoted;
  // the `cfg` bag is written back via plugin.saveSettings() so persistence is safe.
  const cfg = plugin.settings.copilot as unknown as Record<string, unknown>;
  /** Narrow a bag entry to string, or return `fallback`. */
  const cfgStr = (key: string, fallback = ""): string => {
    const v = cfg[key];
    return typeof v === "string" ? v : fallback;
  };
  /** Narrow a bag entry to string | undefined. */
  const cfgStrOpt = (key: string): string | undefined => {
    const v = cfg[key];
    return typeof v === "string" ? v : undefined;
  };
  if (!cfg) {
    const empty = containerEl.createDiv({ cls: "sg-empty-state" });
    empty.createEl("h4", { text: "SauceBot — coming soon" });
    empty.createEl("p", {
      text: "Choose your AI assistant. Free local models (Ollama / LM Studio) or cloud (Anthropic / OpenAI).",
    });
    empty.createEl("span", { cls: "sg-phase-pill", text: "Phase P9" });
    return;
  }

  containerEl.createEl("h3", {
    text: "Model",
    cls: "sauce-settings-section-title",
  });
  const intro = containerEl.createDiv({ cls: "sauce-callout" });
  intro.createSpan({
    text: "Pick a provider; the model list auto-populates from the provider's catalog (live for Ollama/LM Studio/NIM, curated for Anthropic/OpenAI). Hit Refresh after pulling a new model.",
  });

  // Forward declaration so the picker's provider-change can re-render the
  // credential field (API key ↔ Endpoint depending on the provider).
  let renderCred: () => void = () => {};

  const pickerHost = containerEl.createDiv({ cls: "sg-section-row" });
  const epOpt = cfgStrOpt("baseUrl");
  const keyOpt = cfgStrOpt("apiKey");
  new ProviderPicker({
    container: pickerHost,
    plugin,
    initialProvider: cfgStr("provider", "anthropic") as ProviderId,
    initialModel: cfgStr("model"),
    ...(epOpt !== undefined ? { endpoint: epOpt } : {}),
    ...(keyOpt !== undefined ? { apiKey: keyOpt } : {}),
    onChange: async ({ provider, model }) => {
      const providerChanged = provider !== cfgStr("provider");
      cfg.provider = provider;
      cfg.model = model;
      await plugin.saveSettings();
      pushCopilotUpdate(plugin);
      if (providerChanged) renderCred();
    },
  }).render();

  // Credential field swaps with the provider: local providers (Ollama / LM
  // Studio) show an Endpoint field — LM Studio autodetects it — while cloud
  // providers show an API key field.
  const credHost = containerEl.createDiv({ cls: "sg-section-row" });
  const runLmDetect = async (
    status: InlineStatus,
    epInput: HTMLInputElement | null,
  ): Promise<void> => {
    status.pending("Detecting LM Studio…");
    const r = await detectLmStudioEndpoint({ logger: plugin.logger ?? null });
    if (r.endpoint) {
      cfg.baseUrl = r.endpoint;
      await plugin.saveSettings();
      pushCopilotUpdate(plugin);
      if (epInput) epInput.value = r.endpoint;
      status.success(`Found LM Studio at ${r.endpoint} (${r.source})`);
    } else {
      status.error(
        "LM Studio not found on localhost or this host's LAN. Start its server (port 1234), paste the endpoint, or scan the LAN.",
      );
    }
  };
  const runLmScan = async (
    status: InlineStatus,
    epInput: HTMLInputElement | null,
    btn: HTMLButtonElement,
  ): Promise<void> => {
    if (!Platform.isDesktopApp) {
      status.error("LAN scan needs desktop Obsidian.");
      return;
    }
    btn.disabled = true;
    status.pending("Scanning LAN…");
    try {
      const r = await scanLanForLmStudio({
        onProgress: ({ scanned, total }) =>
          status.pending(`Scanning LAN… ${scanned}/${total}`),
      });
      if (r.endpoint) {
        cfg.baseUrl = r.endpoint;
        await plugin.saveSettings();
        pushCopilotUpdate(plugin);
        if (epInput) epInput.value = r.endpoint;
        status.success(`Found LM Studio at ${r.endpoint} (LAN scan)`);
      } else {
        status.error(
          `No LM Studio found across ${r.total} LAN host${r.total === 1 ? "" : "s"}. Start its server (port 1234) or paste the endpoint.`,
        );
      }
    } finally {
      btn.disabled = false;
    }
  };
  renderCred = () => {
    credHost.empty();
    const isLocal = cfgStr("provider") === "ollama" || cfgStr("provider") === "lmstudio";
    if (!isLocal) {
      new Setting(credHost)
        .setName("API key")
        .setDesc(
          "Stored locally. Set keys for multiple providers (encrypted) via the onboarding wizard's KeyVault step.",
        )
        .addText((t) => {
          t.inputEl.type = "password";
          t.setValue(cfgStr("apiKey")).onChange(async (v) => {
            cfg.apiKey = v;
            await plugin.saveSettings();
            pushCopilotUpdate(plugin);
          });
        });
      return;
    }
    let epInput: HTMLInputElement | null = null;
    new Setting(credHost)
      .setName("Endpoint")
      .setDesc(
        cfgStr("provider") === "lmstudio"
          ? "OpenAI-compatible base, e.g. http://127.0.0.1:1234 (autodetected)"
          : "e.g. http://localhost:11434",
      )
      .addText((t) => {
        epInput = t.inputEl;
        t.setValue(cfgStr("baseUrl")).onChange(async (v) => {
          cfg.baseUrl = v || undefined;
          await plugin.saveSettings();
          pushCopilotUpdate(plugin);
        });
      });
    if (cfgStr("provider") === "lmstudio") {
      const status = new InlineStatus(credHost);
      const row = credHost.createDiv({ cls: "sauce-button-row" });
      row.createEl("button", {
        text: "Detect endpoint",
        cls: "sauce-button sauce-button-secondary",
      }).onclick = () => void runLmDetect(status, epInput);
      const scanBtn = row.createEl("button", {
        text: "Scan my LAN",
        cls: "sauce-button sauce-button-secondary",
      });
      scanBtn.disabled = !Platform.isDesktopApp;
      scanBtn.onclick = () => void runLmScan(status, epInput, scanBtn);
      // Autodetect the moment LM Studio is selected with no endpoint set.
      if (!cfgStr("baseUrl")) void runLmDetect(status, epInput);
    }
  };
  renderCred();

  // Success/failure helper: verify the provider endpoint/key by listing models.
  const connRow = containerEl.createDiv({ cls: "sg-section-row" });
  const connStatus = new InlineStatus(connRow);
  new Setting(connRow)
    .setName("Connection")
    .setDesc("List models to verify the provider endpoint and key.")
    .addButton((b) =>
      b.setButtonText("Test connection").onClick(async () => {
        connStatus.pending("Testing…");
        const _ep = cfgStrOpt("baseUrl");
        const _key = cfgStrOpt("apiKey");
        const r = await testProviderConnection({
          provider: cfgStr("provider", "anthropic") as ProviderId,
          ...(_ep !== undefined ? { endpoint: _ep } : {}),
          ...(_key !== undefined ? { apiKey: _key } : {}),
          logger: plugin.logger ?? null,
        });
        if (r.ok) connStatus.success(r.detail);
        else connStatus.error(r.detail);
      }),
    );

  new Setting(containerEl)
    .setName("Temperature")
    .setDesc("Creativity vs precision. Lower = more deterministic.")
    .addSlider((s) =>
      s
        .setLimits(0, 1, 0.05)
        .setDynamicTooltip()
        .setValue(typeof cfg.temperature === "number" ? cfg.temperature : 0.3)
        .onChange(async (v) => {
          cfg.temperature = v;
          await plugin.saveSettings();
          pushCopilotUpdate(plugin);
        }),
    );

  new Setting(containerEl)
    .setName("Stream responses")
    .setDesc(
      "Show tokens as they arrive instead of waiting for the full reply.",
    )
    .addToggle((t) =>
      t.setValue(cfg.stream !== false).onChange(async (v) => {
        cfg.stream = v;
        await plugin.saveSettings();
        pushCopilotUpdate(plugin);
      }),
    );

  new Setting(containerEl)
    .setName("Context turns")
    .setDesc("How many prior conversation turns to include as context.")
    .addSlider((s) =>
      s
        .setLimits(0, 50, 1)
        .setDynamicTooltip()
        .setValue(typeof cfg.contextTurns === "number" ? cfg.contextTurns : 15)
        .onChange(async (v) => {
          cfg.contextTurns = v;
          await plugin.saveSettings();
          pushCopilotUpdate(plugin);
        }),
    );

  containerEl.createEl("h3", {
    text: "Advanced",
    cls: "sauce-settings-section-title",
  });

  markAdvanced(
    new Setting(containerEl)
      .setName("Max tokens")
      .setDesc("Maximum tokens per response.")
      .addSlider((s) =>
        s
          .setLimits(256, 8192, 128)
          .setDynamicTooltip()
          .setValue(typeof cfg.maxTokens === "number" ? cfg.maxTokens : 2048)
          .onChange(async (v) => {
            cfg.maxTokens = v;
            await plugin.saveSettings();
            pushCopilotUpdate(plugin);
          }),
      ),
  );

  markAdvanced(
    new Setting(containerEl)
      .setName("System prompt")
      .setDesc("Persistent instructions sent before every conversation.")
      .addTextArea((t) =>
        t.setValue(cfgStr("systemPrompt")).onChange(async (v) => {
          cfg.systemPrompt = v;
          await plugin.saveSettings();
          pushCopilotUpdate(plugin);
        }),
      ),
  );

  markAdvanced(
    new Setting(containerEl)
      .setName("Custom commands folder")
      .setDesc(
        "Vault folder holding custom command / prompt .md files (surfaced as slash commands).",
      )
      .addText((t) =>
        t
          .setPlaceholder("copilot/sauce-commands")
          .setValue(cfgStr("promptsFolder"))
          .onChange(async (v) => {
            cfg.promptsFolder = v || undefined;
            await plugin.saveSettings();
            pushCopilotUpdate(plugin);
          }),
      ),
  );

  markAdvanced(
    new Setting(containerEl)
      .setName("Base URL")
      .setDesc("Override endpoint for Ollama / LM Studio / proxy.")
      .addText((t) =>
        t.setValue(cfgStr("baseUrl")).onChange(async (v) => {
          cfg.baseUrl = v || undefined;
          await plugin.saveSettings();
          pushCopilotUpdate(plugin);
        }),
      ),
  );

  markAdvanced(
    new Setting(containerEl)
      .setName("Default autonomy")
      .setDesc("How much copilot may act without confirmation.")
      .addDropdown((d) =>
        d
          .addOption("manual", "Manual — always ask")
          .addOption("suggest", "Suggest — recommend, don't act")
          .addOption("assist", "Assist — act with confirmation")
          .addOption("auto", "Auto — act freely")
          .setValue(cfgStr("autonomy", "suggest"))
          .onChange(async (v) => {
            cfg.autonomy = v;
            await plugin.saveSettings();
            pushCopilotUpdate(plugin);
          }),
      ),
  );

  // Local LLM providers — live per-provider endpoint + model pickers.
  renderLocalLLM(containerEl, plugin);
  // RAG & embeddings (PLAN T3) — embedding provider parity + master toggle.
  renderRagEmbeddings(containerEl, plugin);
  // Auto-enrichment (PLAN T5).
  renderEnrichment(containerEl, plugin);
  // Document harvesting (PLAN T7).
  renderDocuments(containerEl, plugin);
  // Prompts & sessions (PLAN T6).
  renderPrompts(containerEl, plugin);
}
