// Provider + model dropdown pair, populated from ModelCatalog. Replaces the
// free-text "Model" input that used to live in every copilot-touching GUI
// surface (settings sections/copilot, LocalLLMPage, OnboardingWizard,
// CopilotChatView). Emits telemetry on every change so we can see which
// provider+model pairs users actually pick.

import type SauceGraphPlugin from "../../../main";
import {
  ModelCatalog,
  sharedModelCatalog,
  type CatalogContext,
  type CatalogModel,
  type ProviderId,
} from "../../../copilot/ModelCatalog";

export interface ProviderPickerOptions {
  /** Container DOM to render into (caller owns the parent). */
  container: HTMLElement;
  /** Initial provider id; "anthropic" if unset. */
  initialProvider?: ProviderId;
  /** Initial model id; left blank if the catalog list hasn't loaded. */
  initialModel?: string;
  /** Endpoint hint per provider (used for Ollama/LMStudio/NIM list calls). */
  endpoint?: string;
  /** API key hint (optional; used for catalog calls on auth-walled providers). */
  apiKey?: string;
  /** Fired when either the provider or the model changes. */
  onChange: (next: { provider: ProviderId; model: string }) => void;
  /** Plugin handle for telemetry + endpoint resolution from settings. */
  plugin: SauceGraphPlugin;
  /** Optional override for testing. */
  catalog?: ModelCatalog;
  /** When set, the provider dropdown is omitted — only the model list renders.
   * Used by surfaces that are provider-scoped (e.g. LocalLLMPage's Ollama
   * section, where switching to Anthropic would be incoherent). */
  lockedProvider?: ProviderId;
  /** "chat" (default) or "embedding" — selects which catalog list to show. */
  kind?: "chat" | "embedding";
  /** Override the model dropdown label (e.g. "Embedding model"). */
  modelLabel?: string;
}

const PROVIDERS: { id: ProviderId; label: string }[] = [
  { id: "anthropic", label: "Anthropic (cloud)" },
  { id: "openai", label: "OpenAI (cloud)" },
  { id: "nim", label: "NVIDIA NIM (cloud)" },
  { id: "ollama", label: "Ollama (local)" },
  { id: "lmstudio", label: "LM Studio (local)" },
];

export class ProviderPicker {
  private provider: ProviderId;
  private model: string;
  private modelSelectEl!: HTMLSelectElement;
  private statusEl!: HTMLSpanElement;
  private readonly catalog: ModelCatalog;

  constructor(private readonly opts: ProviderPickerOptions) {
    this.provider = opts.lockedProvider ?? opts.initialProvider ?? "anthropic";
    this.model = opts.initialModel ?? "";
    this.catalog =
      opts.catalog ?? sharedModelCatalog(opts.plugin.logger ?? null);
  }

  render(): void {
    const c = this.opts.container;
    c.empty();
    c.addClass("sg-provider-picker");

    // Provider dropdown — omitted when locked to a single provider.
    if (!this.opts.lockedProvider) {
      const providerRow = c.createDiv({ cls: "sg-pp-row" });
      providerRow.createEl("label", { text: "Provider" });
      const providerSelect = providerRow.createEl("select");
      for (const p of PROVIDERS) {
        const opt = providerSelect.createEl("option", { text: p.label });
        opt.value = p.id;
        if (p.id === this.provider) opt.selected = true;
      }
      providerSelect.addEventListener("change", () => {
        this.provider = providerSelect.value as ProviderId;
        this.fire();
        void this.refreshModelList();
      });
    }

    // Model dropdown
    const modelRow = c.createDiv({ cls: "sg-pp-row" });
    modelRow.createEl("label", { text: this.opts.modelLabel ?? "Model" });
    this.modelSelectEl = modelRow.createEl("select");
    this.modelSelectEl.addEventListener("change", () => {
      this.model = this.modelSelectEl.value;
      this.fire();
    });

    // Refresh button + status line
    const ctrls = c.createDiv({ cls: "sg-pp-controls" });
    const refresh = ctrls.createEl("button", { text: "Refresh" });
    refresh.addEventListener("click", () => {
      this.catalog.invalidate(this.contextForCatalog());
      void this.refreshModelList();
    });
    this.statusEl = ctrls.createEl("span", { cls: "sg-pp-status" });

    void this.refreshModelList();
  }

  private fire(): void {
    this.opts.onChange({ provider: this.provider, model: this.model });
    this.opts.plugin.logger?.event?.("ui.provider_picker.change", {
      provider: this.provider,
      model: this.model,
    });
  }

  private contextForCatalog(): CatalogContext {
    return {
      provider: this.provider,
      endpoint: this.opts.endpoint ?? this.endpointFromSettings(),
      apiKey: this.opts.apiKey ?? this.apiKeyFromSettings(),
      kind: this.opts.kind,
      logger: this.opts.plugin.logger ?? null,
    };
  }

  private endpointFromSettings(): string | undefined {
    const cp = this.opts.plugin.settings.copilot as
      | { baseUrl?: string }
      | undefined;
    return cp?.baseUrl;
  }

  private apiKeyFromSettings(): string | undefined {
    const cp = this.opts.plugin.settings.copilot as
      | { apiKey?: string }
      | undefined;
    return cp?.apiKey;
  }

  private async refreshModelList(): Promise<void> {
    this.statusEl.textContent = "loading…";
    let models: CatalogModel[] = [];
    try {
      models = await this.catalog.list(this.contextForCatalog());
    } catch (e) {
      this.statusEl.textContent = `error: ${e instanceof Error ? e.message : String(e)}`;
      this.populateModels([]);
      return;
    }
    this.statusEl.textContent = `${models.length} model${models.length === 1 ? "" : "s"}`;
    this.populateModels(models);
  }

  private populateModels(models: CatalogModel[]): void {
    const sel = this.modelSelectEl;
    sel.empty();
    if (models.length === 0) {
      const blank = sel.createEl("option", { text: "— no models found —" });
      blank.value = "";
      return;
    }
    let matched = false;
    for (const m of models) {
      const opt = sel.createEl("option", { text: m.label });
      opt.value = m.id;
      if (m.id === this.model) {
        opt.selected = true;
        matched = true;
      }
    }
    if (!matched) {
      // Pre-select the first option and propagate so the consumer's settings
      // never end up with an empty model id while a non-empty list is visible.
      this.model = models[0].id;
      sel.value = this.model;
      this.fire();
    }
  }
}
