// V2-LANE-2 — Onboarding Wizard. Multi-step modal that walks the operator
// through vault scaffolding, the encrypted KeyVault, multi-provider AI setup
// (keys + endpoints + connection tests), skill enable, and first-person
// creation. Safe: no dynamic regex, no exec, no ReDoS.
//
// The plugin works standalone — no parent vault required. Federation (parent /
// sub-vaults) is intentionally NOT part of onboarding; it's an opt-in function
// available later via the "Register SubVault" command.
//
// Key handling (honest about the current runtime): API keys are stored
// encrypted in the KeyVault under `copilot:<provider>:api-key`. Because the
// Copilot runtime still reads `settings.copilot.apiKey` (P15 "swap to KeyVault
// lookup" is not yet wired), the *active* provider's key is additionally
// mirrored into plugin settings so chat works immediately. Non-active keys live
// encrypted in the vault, ready for activation or the P15 runtime swap.

import { App, Modal, Notice, Platform, Setting } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import { TemplateService } from "../../../services/TemplateService";
import { ProviderPicker } from "../../components/v2/ProviderPicker";
import { InlineStatus } from "../../components/v2/InlineStatus";
import { testProviderConnection } from "../../../saucebot/testProviderConnection";
import {
  detectLmStudioEndpoint,
  scanLanForLmStudio,
} from "../../../saucebot/detectLmStudioEndpoint";
import type { ProviderId } from "../../../saucebot/ModelCatalog";
import type { LocalProviderId } from "../../../settings/FeatureSettings";

// The wizard configures the four providers the Copilot runtime supports as an
// active chat provider (SauceBotSettings.provider). NIM is catalog-listable but
// not a valid active copilot provider, so it's intentionally excluded here.
type SauceBotProvider = "anthropic" | "openai" | "ollama" | "lmstudio";

interface WizProvider {
  id: SauceBotProvider;
  label: string;
  local: boolean;
}

const WIZ_PROVIDERS: WizProvider[] = [
  { id: "anthropic", label: "Anthropic (cloud)", local: false },
  { id: "openai", label: "OpenAI (cloud)", local: false },
  { id: "ollama", label: "Ollama (local)", local: true },
  { id: "lmstudio", label: "LM Studio (local)", local: true },
];

const TOTAL_STEPS = 7;

export class OnboardingWizardModal extends Modal {
  private step = 0;

  // Step 1 — standard vault scaffolding (no federation role).
  private initResult: { created: number; existing: number } | null = null;

  // Step 2 — KeyVault.
  private vaultPassword = "";
  private vaultSkipped = false;

  // Step 3 — providers: transient key drafts (endpoints/models persist to
  // settings directly). Tracks which providers the user saved a key for.
  private keyDraft = new Map<SauceBotProvider, string>();
  private keySaved = new Set<SauceBotProvider>();
  private activeProvider: SauceBotProvider = "anthropic";
  private activeModel = "";
  private providersConfigured = false;
  private lmDetectRan = false;

  // Step 4 — skills draft (id -> enabled)
  private skillEnabled = new Map<string, boolean>();
  private skillsConfigured = false;

  // Step 5 — first person
  private personName = "";
  private personEmail = "";
  private personPrimaryType = "";
  private personCreated: string | null = null;

  constructor(
    app: App,
    public plugin: SauceGraphPlugin,
  ) {
    super(app);
    const cur = this.plugin.settings.copilot;
    if (cur) {
      const p = cur.provider as SauceBotProvider;
      if (WIZ_PROVIDERS.some((w) => w.id === p)) this.activeProvider = p;
      this.activeModel = cur.model ?? "";
    }
    if (this.plugin.skills) {
      for (const s of this.plugin.skills.list()) {
        this.skillEnabled.set(
          s.id,
          this.plugin.skills.registry.getSettings(s.id).enabled !== false,
        );
      }
    }
  }

  override onOpen(): void {
    this.modalEl.addClass("sauce-modal");
    this.contentEl.addClass("sauce-onboarding-wizard");
    this.renderStep(this.step);
  }

  override onClose(): void {
    this.contentEl.empty();
  }

  private next(): void {
    this.step = Math.min(this.step + 1, TOTAL_STEPS - 1);
    this.renderStep(this.step);
  }
  private back(): void {
    this.step = Math.max(this.step - 1, 0);
    this.renderStep(this.step);
  }

  // ---------- Vault helpers ----------
  private vaultAvailable(): boolean {
    return !!this.plugin.keyVault;
  }
  private vaultUnlocked(): boolean {
    const kv = this.plugin.keyVault;
    return !!kv && !kv.isLocked();
  }
  private vaultServiceFor(p: SauceBotProvider): string {
    return `copilot:${p}:api-key`;
  }

  /** Persist a provider key: vault (if unlocked) + mirror the active provider's
   *  key into settings so the runtime can use it today. */
  private async storeProviderKey(
    p: SauceBotProvider,
    key: string,
  ): Promise<void> {
    if (this.vaultUnlocked()) {
      await this.plugin.keyVault!.put(this.vaultServiceFor(p), key);
    }
    if (p === this.activeProvider) {
      this.plugin.settings.copilot.apiKey = key;
      await this.plugin.saveSettings();
    }
    this.keySaved.add(p);
  }

  private localCfg(p: LocalProviderId) {
    return this.plugin.settings.features.localLLM[p];
  }

  private endpointFor(p: SauceBotProvider): string | undefined {
    return p === "ollama" || p === "lmstudio"
      ? this.localCfg(p).endpoint
      : undefined;
  }

  /** Mirror the active local provider's endpoint/model into copilot settings +
   *  runtime, matching the Local LLM settings section's behavior. */
  private syncActive(): void {
    const cfg = this.plugin.settings.copilot;
    cfg.provider = this.activeProvider;
    if (this.activeProvider === "ollama" || this.activeProvider === "lmstudio") {
      const lc = this.localCfg(this.activeProvider);
      if (lc.endpoint) cfg.baseUrl = lc.endpoint; else delete cfg.baseUrl;
      if (lc.model) cfg.model = lc.model;
    } else {
      delete cfg.baseUrl;
    }
    if (this.activeModel) cfg.model = this.activeModel;
    this.plugin.copilot?.updateSettings?.(cfg);
  }

  private renderStep(idx: number): void {
    const c = this.contentEl;
    c.empty();
    c.createEl("div", {
      cls: "sauce-onboarding-step-indicator",
      text: `Step ${idx + 1} of ${TOTAL_STEPS}`,
    });
    switch (idx) {
      case 0:
        this.renderWelcome(c);
        break;
      case 1:
        this.renderInitialize(c);
        break;
      case 2:
        this.renderSecureKeys(c);
        break;
      case 3:
        this.renderProviders(c);
        break;
      case 4:
        this.renderSkills(c);
        break;
      case 5:
        this.renderFirstPerson(c);
        break;
      case 6:
        this.renderDone(c);
        break;
      default:
        this.renderDone(c);
    }
  }

  // ---------- Step 1: Welcome ----------
  private renderWelcome(c: HTMLElement): void {
    c.createEl("h2", { text: "Welcome to Sauce Graph" });
    const ul = c.createEl("ul", { cls: "sauce-onboarding-bullets" });
    ul.createEl("li", {
      text: "Capture relationships, orgs, and touches as first-class entities in your vault.",
    });
    ul.createEl("li", {
      text: "Works standalone — no parent vault needed. Federate with other vaults later via the “Register SubVault” command if you want.",
    });
    ul.createEl("li", {
      text: "Add one or more AI providers (Anthropic / OpenAI / Ollama / LM Studio) with keys stored in an encrypted local KeyVault.",
    });

    const btns = c.createDiv({ cls: "sauce-buttons" });
    btns.createEl("button", { text: "Start", cls: "sauce-button" }).onclick =
      () => this.next();
    btns.createEl("button", {
      text: "Cancel",
      cls: "sauce-button sauce-button-secondary",
    }).onclick = () => this.close();
  }

  // ---------- Step 2: Initialize scaffolding ----------
  private renderInitialize(c: HTMLElement): void {
    c.createEl("h2", { text: "Initialize your vault" });
    c.createEl("p", {
      text: "Create the folders, seed docs, and registries this vault needs. Safe to re-run — existing files are left untouched.",
    });

    const status = new InlineStatus(c);
    if (this.initResult) {
      status.success(
        `${this.initResult.created} created, ${this.initResult.existing} existing`,
      );
    }

    const btns = c.createDiv({ cls: "sauce-buttons" });
    btns.createEl("button", {
      text: "Back",
      cls: "sauce-button sauce-button-secondary",
    }).onclick = () => this.back();
    const runBtn = btns.createEl("button", {
      text: "Run Initialize",
      cls: "sauce-button",
    });
    runBtn.onclick = async () => {
      status.pending("Initializing…");
      try {
        const r = await this.plugin.bootstrap.ensure();
        this.initResult = {
          created: r.created.length,
          existing: r.existing.length,
        };
        status.success(
          `${this.initResult.created} created, ${this.initResult.existing} existing`,
        );
      } catch (e: unknown) {
        status.error(`Initialize failed: ${this.msg(e)}`);
      }
    };
    btns.createEl("button", { text: "Next", cls: "sauce-button" }).onclick =
      () => this.next();
  }

  // ---------- Step 3: Secure keys (KeyVault) ----------
  private renderSecureKeys(c: HTMLElement): void {
    c.createEl("h2", { text: "Secure your API keys" });
    c.createEl("p", {
      text: "Sauce Graph can store API keys in an encrypted local KeyVault (Argon2id + AES-256-GCM). Set a master password to unlock it — required only if you want multiple providers' keys stored encrypted. You can skip and keep your active provider's key in plugin settings instead.",
    });

    const status = new InlineStatus(c);

    if (!this.vaultAvailable()) {
      status.error(
        "KeyVault unavailable (LanceDB backend not initialized). You can skip — keys will be stored in plugin settings.",
      );
      this.renderStepButtons(c, {
        onSkip: () => {
          this.vaultSkipped = true;
          this.next();
        },
        skipLabel: "Skip (use settings)",
      });
      return;
    }

    if (this.vaultUnlocked()) {
      status.success("Vault unlocked — provider keys will be encrypted.");
    } else {
      new Setting(c)
        .setName("Master password")
        .setDesc(
          "First time sets the password; later unlocks with the same one.",
        )
        .addText((t) => {
          t.inputEl.type = "password";
          t.setPlaceholder("master password").onChange((v) => {
            this.vaultPassword = v;
          });
        });
      new Setting(c).addButton((b) =>
        b
          .setButtonText("Unlock / Create vault")
          .setCta()
          .onClick(async () => {
            if (!this.vaultPassword) {
              status.error("Enter a master password first.");
              return;
            }
            status.pending("Unlocking…");
            try {
              await this.plugin.keyVault!.unlock(this.vaultPassword);
              this.vaultSkipped = false;
              status.success("Vault unlocked — provider keys will be encrypted.");
              this.renderStep(this.step);
            } catch (e: unknown) {
              status.error(`Unlock failed: ${this.msg(e)}`);
            }
          }),
      );
    }

    this.renderStepButtons(c, {
      onSkip: () => {
        this.vaultSkipped = true;
        this.next();
      },
      onNext: () => this.next(),
      skipLabel: "Skip (use settings)",
    });
  }

  // ---------- Step 4: AI Providers (multi-provider + test) ----------
  private renderProviders(c: HTMLElement): void {
    c.createEl("h2", { text: "Configure AI providers" });
    c.createEl("p", {
      text: "Add keys and endpoints for one or more providers. Keys are stored encrypted in the KeyVault when unlocked; your active provider's key is also kept in settings so chat works immediately.",
    });

    // Active provider + model.
    const activeSection = c.createDiv({ cls: "sauce-onboarding-active" });
    activeSection.createEl("h3", { text: "Active chat provider" });
    new Setting(activeSection).setName("Provider").addDropdown((d) => {
      for (const p of WIZ_PROVIDERS) d.addOption(p.id, p.label);
      d.setValue(this.activeProvider);
      d.onChange((v) => {
        this.activeProvider = v as SauceBotProvider;
        this.syncActive();
        this.renderStep(this.step);
      });
    });

    const pickerHost = activeSection.createDiv({ cls: "sauce-onboarding-picker" });
    const _ep362 = this.endpointFor(this.activeProvider);
    new ProviderPicker({
      container: pickerHost,
      plugin: this.plugin,
      lockedProvider: this.activeProvider as ProviderId,
      initialModel: this.activeModel,
      ...(_ep362 !== undefined ? { endpoint: _ep362 } : {}),
      apiKey: this.keyDraft.get(this.activeProvider) ?? "",
      onChange: ({ model }) => {
        this.activeModel = model;
        this.syncActive();
        void this.plugin.saveSettings();
      },
    }).render();

    // Per-provider key + endpoint cards.
    c.createEl("h3", { text: "Provider keys & endpoints" });
    if (!this.vaultUnlocked() && !this.vaultSkipped) {
      c.createEl("p", {
        cls: "sauce-field-help",
        text: "Vault is locked — only the active provider's key can be saved (to settings). Go back to unlock the vault to store keys for multiple providers.",
      });
    }
    for (const p of WIZ_PROVIDERS) this.renderProviderCard(c, p);

    this.renderStepButtons(c, {
      onSkip: () => this.next(),
      onSave: async () => {
        try {
          this.syncActive();
          await this.plugin.saveSettings();
          this.providersConfigured = true;
          new Notice("AI providers configured");
          this.next();
        } catch (e: unknown) {
          new Notice(`Save failed: ${this.msg(e)}`);
        }
      },
      saveLabel: "Save & Next",
    });
  }

  private renderProviderCard(c: HTMLElement, p: WizProvider): void {
    const card = c.createDiv({ cls: "sauce-onboarding-provider-card" });
    const head = card.createDiv({ cls: "sauce-card-head" });
    head.createEl("h4", { text: p.label, cls: "sauce-card-title" });
    if (p.id === this.activeProvider)
      head.createEl("span", { cls: "sg-pill sg-pill-info", text: "active" });
    if (this.keySaved.has(p.id))
      head.createEl("span", { cls: "sg-pill sg-pill-success", text: "saved" });

    const canStore = this.vaultUnlocked() || p.id === this.activeProvider;

    // Local providers lead with the Endpoint field (no API key needed by
    // default). LM Studio additionally autodetects its endpoint.
    let endpointInput: HTMLInputElement | null = null;
    if (p.local) {
      new Setting(card)
        .setName("Endpoint")
        .setDesc(
          p.id === "lmstudio"
            ? "OpenAI-compatible base, e.g. http://127.0.0.1:1234 (autodetected)"
            : "e.g. http://localhost:11434",
        )
        .addText((t) => {
          endpointInput = t.inputEl;
          t.setValue(this.endpointFor(p.id) ?? "").onChange(async (v) => {
            this.localCfg(p.id as LocalProviderId).endpoint = v;
            if (p.id === this.activeProvider) this.syncActive();
            await this.plugin.saveSettings();
          });
        });
    }

    new Setting(card)
      .setName(p.local ? "API key (optional)" : "API key")
      .addText((t) => {
        t.inputEl.type = "password";
        t.setPlaceholder(p.local ? "leave blank if no auth" : "sk-…")
          .setValue(this.keyDraft.get(p.id) ?? "")
          .onChange((v) => this.keyDraft.set(p.id, v));
        t.inputEl.disabled = !canStore;
      });

    const status = new InlineStatus(card);
    const btns = card.createDiv({ cls: "sauce-button-row" });

    if (p.id === "lmstudio") {
      const detectBtn = btns.createEl("button", {
        text: "Detect endpoint",
        cls: "sauce-button sauce-button-secondary",
      });
      detectBtn.onclick = () => void this.runLmDetect(status, endpointInput);
      const scanBtn = btns.createEl("button", {
        text: "Scan my LAN",
        cls: "sauce-button sauce-button-secondary",
      });
      scanBtn.disabled = !Platform.isDesktopApp;
      scanBtn.onclick = () => void this.runLmScan(status, endpointInput, scanBtn);
      // Run quick (localhost + host-IP) detect once when the step first opens
      // so the endpoint is pre-filled; the LAN sweep stays manual.
      if (!this.lmDetectRan) {
        this.lmDetectRan = true;
        void this.runLmDetect(status, endpointInput);
      }
    }

    const saveTest = btns.createEl("button", {
      text: "Save & test",
      cls: "sauce-button",
    });
    saveTest.disabled = !canStore;
    saveTest.onclick = async () => {
      status.pending("Saving & testing…");
      try {
        const key = this.keyDraft.get(p.id) ?? "";
        if (key) await this.storeProviderKey(p.id, key);
        const _ep478 = this.endpointFor(p.id);
        const _key478 = key || undefined;
        const r = await testProviderConnection({
          provider: p.id as ProviderId,
          ...(_ep478 !== undefined ? { endpoint: _ep478 } : {}),
          ...(_key478 !== undefined ? { apiKey: _key478 } : {}),
          logger: this.plugin.logger ?? null,
        });
        if (r.ok) status.success(r.detail);
        else status.error(r.detail);
      } catch (e: unknown) {
        status.error(this.msg(e));
      }
    };
  }

  /** Autodetect LM Studio (localhost → host LAN) and fill the endpoint field. */
  private async runLmDetect(
    status: InlineStatus,
    endpointInput: HTMLInputElement | null,
  ): Promise<void> {
    status.pending("Detecting LM Studio…");
    const r = await detectLmStudioEndpoint({ logger: this.plugin.logger ?? null });
    if (r.endpoint) {
      this.localCfg("lmstudio").endpoint = r.endpoint;
      if (this.activeProvider === "lmstudio") this.syncActive();
      await this.plugin.saveSettings();
      if (endpointInput) endpointInput.value = r.endpoint;
      status.success(`Found LM Studio at ${r.endpoint} (${r.source})`);
    } else {
      status.error(
        "LM Studio not found on localhost or this host's LAN. Start its server (Developer ▸ Start Server, port 1234), paste the endpoint above, or scan the LAN.",
      );
    }
  }

  /** Sweep the host's LAN /24(s) for LM Studio on another machine. */
  private async runLmScan(
    status: InlineStatus,
    endpointInput: HTMLInputElement | null,
    btn: HTMLButtonElement,
  ): Promise<void> {
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
        this.localCfg("lmstudio").endpoint = r.endpoint;
        if (this.activeProvider === "lmstudio") this.syncActive();
        await this.plugin.saveSettings();
        if (endpointInput) endpointInput.value = r.endpoint;
        status.success(`Found LM Studio at ${r.endpoint} (LAN scan)`);
      } else {
        status.error(
          `No LM Studio found across ${r.total} LAN host${r.total === 1 ? "" : "s"}. Start its server (port 1234) or paste the endpoint above.`,
        );
      }
    } finally {
      btn.disabled = false;
    }
  }

  // ---------- Step 5: Skills ----------
  private renderSkills(c: HTMLElement): void {
    c.createEl("h2", { text: "Enable Skills (optional)" });
    const skills = this.plugin.skills?.list() ?? [];
    if (!this.plugin.skills) {
      c.createEl("p", { text: "Skills runtime not initialized — skipping." });
    } else if (skills.length === 0) {
      c.createEl("p", { text: "No skills registered." });
    } else {
      c.createEl("p", {
        text: `${skills.length} skills available. Toggle to enable/disable.`,
      });
      const list = c.createDiv({ cls: "sauce-onboarding-skill-list" });
      for (const s of skills) {
        const row = list.createDiv({ cls: "sauce-onboarding-skill-row" });
        const cb = row.createEl("input", {
          type: "checkbox",
        }) as HTMLInputElement;
        cb.checked = this.skillEnabled.get(s.id) !== false;
        cb.addEventListener("change", () => {
          this.skillEnabled.set(s.id, cb.checked);
        });
        row.createEl("span", { text: " " + s.id });
      }
    }

    const status = new InlineStatus(c);
    if (this.skillsConfigured) status.success("Skill settings saved.");

    this.renderStepButtons(c, {
      onSkip: () => this.next(),
      onSave: async () => {
        try {
          if (this.plugin.skills) {
            for (const [id, enabled] of this.skillEnabled) {
              this.plugin.skills.registry.setSettings(id, { enabled });
            }
            if (this.plugin.copilot) {
              this.plugin.skills.bindToCopilot(this.plugin.copilot.toolUse);
            }
          }
          this.skillsConfigured = true;
          new Notice("Skill settings saved");
          this.next();
        } catch (e: unknown) {
          new Notice(`Skill save failed: ${this.msg(e)}`);
        }
      },
      saveLabel: "Save & Next",
    });
  }

  // ---------- Step 6: First person ----------
  private renderFirstPerson(c: HTMLElement): void {
    c.createEl("h2", { text: "Create your first Person (optional)" });
    c.createEl("p", {
      text: "Seed the graph with one contact. You can skip and add people later.",
    });

    new Setting(c).setName("Name").addText((t) =>
      t
        .setPlaceholder("Full name")
        .setValue(this.personName)
        .onChange((v) => {
          this.personName = v;
        }),
    );
    new Setting(c).setName("Email").addText((t) =>
      t
        .setPlaceholder("name@example.com")
        .setValue(this.personEmail)
        .onChange((v) => {
          this.personEmail = v;
        }),
    );
    new Setting(c).setName("Primary type").addDropdown((d) => {
      const enums = this.plugin.enums().primary_type_person ?? [];
      d.addOption("", "(choose…)");
      for (const e of enums) d.addOption(e, e);
      d.setValue(this.personPrimaryType);
      d.onChange((v) => {
        this.personPrimaryType = v;
      });
    });

    const status = new InlineStatus(c);
    if (this.personCreated) status.success(`Created: ${this.personCreated}`);

    this.renderStepButtons(c, {
      onSkip: () => this.next(),
      onSave: async () => {
        const name = this.personName.trim();
        if (!name) {
          status.error("Name is required");
          return;
        }
        try {
          const fm = TemplateService.personFrontmatter({
            primary_type: this.personPrimaryType || undefined,
            email: this.personEmail || undefined,
          });
          const peoplePath = this.plugin.settings.paths.people;
          const file = await this.plugin.entityService.createEntity(
            peoplePath,
            name,
            fm,
          );
          this.personCreated = file?.path ?? `${peoplePath}/${name}.md`;
          new Notice(`Created ${name}`);
          this.next();
        } catch (e: unknown) {
          status.error(`Create failed: ${this.msg(e)}`);
        }
      },
      saveLabel: "Create & Next",
    });
  }

  // ---------- Step 7: Done / Review ----------
  private renderDone(c: HTMLElement): void {
    c.createEl("h2", { text: "Review & finish" });
    const ul = c.createEl("ul", { cls: "sauce-onboarding-summary" });
    this.summaryItem(
      ul,
      this.initResult ? "success" : "neutral",
      this.initResult
        ? `Vault initialized: ${this.initResult.created} created, ${this.initResult.existing} existing`
        : "Vault: not initialized",
    );
    this.summaryItem(
      ul,
      this.vaultUnlocked() ? "success" : "warning",
      this.vaultUnlocked()
        ? "KeyVault: unlocked (keys encrypted)"
        : "KeyVault: not unlocked (keys in settings)",
    );
    const savedList = [...this.keySaved];
    this.summaryItem(
      ul,
      savedList.length ? "success" : "neutral",
      savedList.length
        ? `Provider keys saved: ${savedList.join(", ")}`
        : "Provider keys: none saved",
    );
    this.summaryItem(
      ul,
      this.providersConfigured ? "success" : "neutral",
      `Active provider: ${this.activeProvider}${this.activeModel ? ` · ${this.activeModel}` : ""}`,
    );
    this.summaryItem(
      ul,
      this.skillsConfigured ? "success" : "neutral",
      `Skills: ${this.skillsConfigured ? "saved" : "skipped"}`,
    );
    this.summaryItem(
      ul,
      this.personCreated ? "success" : "neutral",
      `First person: ${this.personCreated ?? "skipped"}`,
    );

    c.createEl("p", {
      cls: "sauce-field-help",
      text: "Tip: change any of this later in Settings → AI / Plugins, and use “Register SubVault” to federate this vault.",
    });

    const btns = c.createDiv({ cls: "sauce-buttons" });
    btns.createEl("button", {
      text: "Back",
      cls: "sauce-button sauce-button-secondary",
    }).onclick = () => this.back();
    btns.createEl("button", { text: "Done", cls: "sauce-button" }).onclick =
      () => this.close();
  }

  // ---------- Shared button row + helpers ----------
  private renderStepButtons(
    c: HTMLElement,
    opts: {
      onSave?: () => void | Promise<void>;
      onSkip?: () => void;
      onNext?: () => void;
      saveLabel?: string;
      skipLabel?: string;
    },
  ): void {
    const btns = c.createDiv({ cls: "sauce-buttons" });
    btns.createEl("button", {
      text: "Back",
      cls: "sauce-button sauce-button-secondary",
    }).onclick = () => this.back();
    if (opts.onSkip)
      btns.createEl("button", {
        text: opts.skipLabel ?? "Skip",
        cls: "sauce-button sauce-button-secondary",
      }).onclick = () => opts.onSkip!();
    if (opts.onNext)
      btns.createEl("button", { text: "Next", cls: "sauce-button" }).onclick =
        () => opts.onNext!();
    if (opts.onSave)
      btns.createEl("button", {
        text: opts.saveLabel ?? "Save & Next",
        cls: "sauce-button",
      }).onclick = () => void opts.onSave!();
  }

  private summaryItem(
    ul: HTMLElement,
    kind: "success" | "warning" | "neutral",
    text: string,
  ): void {
    const li = ul.createEl("li");
    li.createEl("span", { cls: `sg-pill sg-pill-${kind}`, text: kind === "success" ? "✓" : kind === "warning" ? "!" : "·" });
    li.createEl("span", { text: " " + text });
  }

  private msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}
