// V2 copilot section. Uses ProviderPicker (auto model indexing) instead of
// free-text inputs so users pick from a live, per-provider catalog.
import { Platform, Setting } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import { ProviderPicker } from "../../components/v2/ProviderPicker";
import { InlineStatus } from "../../components/v2/InlineStatus";
import { testProviderConnection } from "../../../saucebot/testProviderConnection";
import {
  detectLmStudioEndpoint,
  scanLanForLmStudio,
} from "../../../saucebot/detectLmStudioEndpoint";
import type { ProviderId } from "../../../saucebot/ModelCatalog";
import { renderRagEmbeddings } from "./rag";
import { renderEnrichment } from "./enrichment";
import { renderDocuments } from "./documents";
import { renderPrompts } from "./prompts";
import { renderLocalLLM } from "./localllm";
import {
  isSauceDbEntitled,
  isLicenseFormatValid,
  type SauceDbConfig,
} from "../../../saucebot/SauceDb";

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
  // SauceBotSettings is typed but not all runtime-mutable fields are promoted;
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
    const isLocal =
      cfgStr("provider") === "ollama" || cfgStr("provider") === "lmstudio";
    if (!isLocal) {
      const keySetting = new Setting(credHost)
        .setName("API key")
        .setDesc(
          "Stored in your OS keychain (or the encrypted KeyVault) — never written to the plugin's data.json. Set keys for multiple providers via the onboarding wizard.",
        );
      // Passive vault-credential indicator: shows whether a key is actually
      // persisted in the encrypted store (KeyVault / OS keychain) for this
      // provider — distinct from a session-only in-memory key.
      const keyStatus = new InlineStatus(credHost);
      const refreshKeyStatus = async (): Promise<void> => {
        keyStatus.pending("Checking stored key…");
        if (await plugin.hasCopilotKey())
          keyStatus.success("Key stored in vault for this provider.");
        else
          keyStatus.error("No key stored in the vault for this provider yet.");
      };
      keySetting.addText((t) => {
        t.inputEl.type = "password";
        t.setValue(cfgStr("apiKey")).onChange(async (v) => {
          await plugin.storeCopilotKey(v);
          pushCopilotUpdate(plugin);
          void refreshKeyStatus();
        });
      });
      void refreshKeyStatus();
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
  // Local-model quality tuning (cloud-parity for LM Studio / Ollama).
  renderLocalTuning(containerEl, plugin);
  // Context distillation (TOON compaction).
  renderDistill(containerEl, plugin);
  // Sauce Brain dashboard folder.
  renderBrain(containerEl, plugin);
  // Brain tier + SauceDB (hosted LanceDB edge) upgrade.
  renderSauceDb(containerEl, plugin);
}

/** Brain tier — Free (local JSON brain) vs SauceDB (paid hosted LanceDB edge).
 *  The SauceDB tier mirrors this vault's brain (crystal digests + relationship
 *  matrix + embeddings) into Sauce's k8s/k3s edge for faster, higher-quality
 *  retrieval than a single machine. The license/endpoint/tenant unlock the
 *  hosted sync; the server is the real entitlement gate. */
function renderSauceDb(
  containerEl: HTMLElement,
  plugin: SauceGraphPlugin,
): void {
  containerEl.createEl("h3", {
    text: "Brain tier — SauceDB",
    cls: "sauce-settings-section-title",
  });
  const sdb = (plugin.settings.sauceDb ?? { tier: "local" }) as SauceDbConfig;
  plugin.settings.sauceDb = sdb;
  const save = async (): Promise<void> => {
    await plugin.saveSettings();
    plugin.sauceDb?.setConfig(plugin.settings.sauceDb!);
  };
  const entitled = isSauceDbEntitled(sdb);

  const status = containerEl.createDiv({ cls: "sauce-cp-suggestions" });
  status.createEl("p", {
    text: entitled
      ? "✓ SauceDB active — your brain syncs to the hosted LanceDB edge for faster, sharper retrieval."
      : "Free tier: your brain is built and stored locally. Upgrade to SauceDB to sync it to Sauce's hosted LanceDB edge (k8s/k3s) for speed + quality.",
  });
  if (!entitled) {
    const cta = status.createEl("a", {
      text: "Upgrade to SauceDB →",
      href: "https://www.saucetech.io/saucedb",
    });
    cta.setAttr("target", "_blank");
  }

  new Setting(containerEl)
    .setName("Tier")
    .setDesc(
      "Free = local brain. SauceDB = hosted LanceDB edge (requires a license).",
    )
    .addDropdown((dd) =>
      dd
        .addOption("local", "Free (local)")
        .addOption("saucedb", "SauceDB (hosted edge)")
        .setValue(sdb.tier)
        .onChange(async (v) => {
          sdb.tier = v === "saucedb" ? "saucedb" : "local";
          await save();
          // Endpoint/tenant/sync fields appear once entitled (reopen settings).
        }),
    );

  new Setting(containerEl)
    .setName("License key")
    .setDesc(
      sdb.license && !isLicenseFormatValid(sdb.license)
        ? "⚠ That key isn't a valid SauceDB license format (SAUCE-XXXX-XXXX-CC)."
        : "Your SauceDB license (SAUCE-XXXX-XXXX-CC). Get one from the upgrade page.",
    )
    .addText((t) => {
      t.inputEl.type = "password";
      t.setPlaceholder("SAUCE-XXXX-XXXX-CC")
        .setValue(sdb.license ?? "")
        .onChange(async (v) => {
          if (v.trim()) sdb.license = v.trim().toUpperCase();
          else delete sdb.license;
          await save();
        });
    });

  // Hosted config — only meaningful once entitled.
  if (entitled) {
    new Setting(containerEl)
      .setName("SauceDB endpoint")
      .setDesc("Your hosted SauceDB edge URL, e.g. https://brain.saucetech.io")
      .addText((t) =>
        t
          .setPlaceholder("https://brain.saucetech.io")
          .setValue(sdb.endpoint ?? "")
          .onChange(async (v) => {
            if (v.trim()) sdb.endpoint = v.trim();
            else delete sdb.endpoint;
            await save();
          }),
      );
    new Setting(containerEl)
      .setName("Tenant id")
      .setDesc("Isolates your brain data in the hosted store.")
      .addText((t) =>
        t
          .setPlaceholder("tenant-id")
          .setValue(sdb.tenantId ?? "")
          .onChange(async (v) => {
            if (v.trim()) sdb.tenantId = v.trim();
            else delete sdb.tenantId;
            await save();
          }),
      );
    new Setting(containerEl)
      .setName("Sync brain to SauceDB")
      .setDesc("Push the brain to your hosted edge after each build.")
      .addToggle((t) =>
        t.setValue(sdb.sync === true).onChange(async (v) => {
          sdb.sync = v;
          await save();
        }),
      );
  }
}

/** Local-model tuning — closes the local-vs-cloud quality gap for LM Studio /
 *  Ollama. Cloud providers ignore these; they auto-activate for local providers
 *  (or can be forced). See LocalTuningSettings in SauceBotRuntime. */
function renderLocalTuning(
  containerEl: HTMLElement,
  plugin: SauceGraphPlugin,
): void {
  containerEl.createEl("h3", {
    text: "Local model tuning",
    cls: "sauce-settings-section-title",
  });
  const cfg = plugin.settings.copilot as unknown as Record<string, unknown>;
  const lt = (
    cfg.localTuning && typeof cfg.localTuning === "object"
      ? cfg.localTuning
      : {}
  ) as Record<string, unknown>;
  cfg.localTuning = lt;
  const save = async (): Promise<void> => {
    await plugin.saveSettings();
    pushCopilotUpdate(plugin);
  };

  containerEl.createEl("p", {
    cls: "sauce-cp-suggestions",
    text: "Helps local models (LM Studio / Ollama) reach cloud-level multi-turn + tool quality: prose tool prompts, history compaction, malformed-tool-call repair, and self-correction. Auto-on for local providers; cloud providers are unaffected.",
  });

  new Setting(containerEl)
    .setName("Enable local tuning")
    .setDesc("Auto = on for local providers, off for cloud. Force on/off here.")
    .addDropdown((dd) =>
      dd
        .addOption("auto", "Auto (recommended)")
        .addOption("on", "Always on")
        .addOption("off", "Always off")
        .setValue(
          lt.enabled === true ? "on" : lt.enabled === false ? "off" : "auto",
        )
        .onChange(async (v) => {
          if (v === "on") lt.enabled = true;
          else if (v === "off") lt.enabled = false;
          else delete lt.enabled;
          await save();
        }),
    );

  new Setting(containerEl)
    .setName("Prose tool prompting")
    .setDesc(
      "Inject a plain-language tool schema + example so small models call tools reliably.",
    )
    .addToggle((t) =>
      t.setValue(lt.toolPrompt !== false).onChange(async (v) => {
        lt.toolPrompt = v;
        await save();
      }),
    );

  new Setting(containerEl)
    .setName("History compaction budget (tokens)")
    .setDesc(
      "Compact older turns once accumulated history exceeds this; the latest turn is kept verbatim.",
    )
    .addText((t) =>
      t
        .setPlaceholder("2000")
        .setValue(String((lt.historyTokenBudget as number) ?? 2000))
        .onChange(async (v) => {
          const n = parseInt(v, 10);
          lt.historyTokenBudget = Number.isFinite(n) && n > 0 ? n : 2000;
          await save();
        }),
    );

  new Setting(containerEl)
    .setName("Repair malformed tool calls")
    .setDesc(
      "Re-ask once to coax valid tool JSON when a local model emits a malformed call.",
    )
    .addToggle((t) =>
      t.setValue(lt.toolRepairReask !== false).onChange(async (v) => {
        lt.toolRepairReask = v;
        await save();
      }),
    );

  new Setting(containerEl)
    .setName("Self-correct empty answers")
    .setDesc("One compaction + retry when a turn ends empty or truncated.")
    .addToggle((t) =>
      t.setValue(lt.emptyAnswerRetry !== false).onChange(async (v) => {
        lt.emptyAnswerRetry = v;
        await save();
      }),
    );
}

/** Distillation — compact retrieved context to TOON before it is sent to the
 *  model. By default the chat model does the compaction; the provider/model can
 *  be overridden to any active provider, and a token gate controls when the
 *  (cost-incurring) LLM pass actually fires. */
function renderDistill(
  containerEl: HTMLElement,
  plugin: SauceGraphPlugin,
): void {
  containerEl.createEl("h3", {
    text: "Distillation (token compaction)",
    cls: "sauce-settings-section-title",
  });
  const cfg = plugin.settings.copilot as unknown as Record<string, unknown>;
  const distill = (
    cfg.distill && typeof cfg.distill === "object" ? cfg.distill : {}
  ) as Record<string, unknown>;
  cfg.distill = distill;
  const save = async (): Promise<void> => {
    await plugin.saveSettings();
    pushCopilotUpdate(plugin);
  };

  new Setting(containerEl)
    .setName("Enable distillation")
    .setDesc(
      "Compact retrieved context to TOON before sending. The LLM pass only runs when context exceeds the token gate, so small contexts cost nothing extra. Results are 100% cached.",
    )
    .addToggle((t) =>
      t.setValue(distill.enabled !== false).onChange(async (v) => {
        distill.enabled = v;
        await save();
      }),
    );

  new Setting(containerEl)
    .setName("Distillation provider")
    .setDesc(
      "Which provider compacts context. Default: the same model you chat with. Override to any other active provider.",
    )
    .addDropdown((dd) => {
      dd.addOption("", "Same as chat");
      for (const p of [
        "anthropic",
        "openai",
        "ollama",
        "lmstudio",
        "nim",
        "groq",
        "openrouter",
        "gemini",
      ])
        dd.addOption(p, p);
      dd.setValue(typeof distill.provider === "string" ? distill.provider : "");
      dd.onChange(async (v) => {
        if (v) distill.provider = v as ProviderId;
        else delete distill.provider;
        await save();
      });
    });

  new Setting(containerEl)
    .setName("Distillation model")
    .setDesc(
      "Specific model id, or blank to auto-select the best available (largest local model) — falling back to the chat model.",
    )
    .addText((t) =>
      t
        .setPlaceholder("(auto — best available)")
        .setValue(typeof distill.model === "string" ? distill.model : "")
        .onChange(async (v) => {
          if (v.trim()) distill.model = v.trim();
          else delete distill.model;
          await save();
        }),
    );

  new Setting(containerEl)
    .setName("Auto-select best local model")
    .setDesc(
      "When the model is blank and the distill provider is local, pick the largest non-embedding model automatically.",
    )
    .addToggle((t) =>
      t.setValue(distill.autoSelectLocal !== false).onChange(async (v) => {
        distill.autoSelectLocal = v;
        await save();
      }),
    );

  new Setting(containerEl)
    .setName("Token gate")
    .setDesc(
      "Run the LLM compaction pass only when the assembled context exceeds this estimated token count (lower = compact more aggressively).",
    )
    .addText((t) =>
      t
        .setPlaceholder("700")
        .setValue(String((distill.tokenGate as number) ?? 700))
        .onChange(async (v) => {
          const n = parseInt(v, 10);
          distill.tokenGate = Number.isFinite(n) && n > 0 ? n : 700;
          await save();
        }),
    );
}

/** Sauce Brain — the read-only dashboard view over standalone `*.html` builds.
 *  The live "Ask" inside a build is answered by the copilot runtime above, so
 *  the only knob here is which vault folder holds the builds. */
function renderBrain(containerEl: HTMLElement, plugin: SauceGraphPlugin): void {
  containerEl.createEl("h3", {
    text: "Sauce Brain",
    cls: "sauce-settings-section-title",
  });
  new Setting(containerEl)
    .setName("Brain folder")
    .setDesc(
      "Vault folder the Sauce Brain dashboard reads standalone *.html builds from. " +
        "The live Ask inside a build is answered by the SauceBot provider configured above.",
    )
    .addText((t) =>
      t
        .setPlaceholder("_brain")
        .setValue(plugin.settings.brainFolder ?? "_brain")
        .onChange(async (v) => {
          plugin.settings.brainFolder = v.trim() || "_brain";
          await plugin.saveSettings();
          plugin.copilot?.setBrainFolder(plugin.settings.brainFolder);
        }),
    );
}
