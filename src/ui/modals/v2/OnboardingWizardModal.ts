// V2-LANE-2 — Onboarding Wizard. Multi-step modal that walks the operator
// through vault scaffolding, copilot config, skill enable, and first-person
// creation. Safe: no dynamic regex, no exec, no ReDoS.
//
// The plugin works standalone — no parent vault required. Federation (parent /
// sub-vaults) is intentionally NOT part of onboarding; it's an opt-in function
// available later via the "Register SubVault" command.

import { App, Modal, Notice, Setting } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import { TemplateService } from "../../../services/TemplateService";
import { ProviderPicker } from "../../components/v2/ProviderPicker";
import type { ProviderId } from "../../../copilot/ModelCatalog";

type Provider = "anthropic" | "openai" | "ollama";

const TOTAL_STEPS = 6;

export class OnboardingWizardModal extends Modal {
  private step = 0;

  // Step 2 results — standard vault scaffolding (no federation role).
  private initResult: { created: number; existing: number } | null = null;

  // Step 3 — copilot draft
  private cpProvider: Provider = "anthropic";
  private cpModel = "";
  private cpApiKey = "";
  private cpConfigured = false;

  // Step 4 — skills draft (id -> enabled)
  private skillEnabled = new Map<string, boolean>();
  private skillsConfigured = false;

  // Step 5 — first person
  private personName = "";
  private personEmail = "";
  private personPrimaryType = "";
  private personCreated: string | null = null;

  constructor(app: App, public plugin: SauceGraphPlugin) {
    super(app);
    // Seed copilot draft from current settings if present.
    const cur = this.plugin.settings.copilot;
    if (cur) {
      this.cpProvider = (cur.provider as Provider) ?? "anthropic";
      this.cpModel = cur.model ?? "";
      this.cpApiKey = cur.apiKey ?? "";
    }
    // Seed skill draft from current registry settings if runtime exists.
    if (this.plugin.skills) {
      for (const s of this.plugin.skills.list()) {
        this.skillEnabled.set(s.id, this.plugin.skills.registry.getSettings(s.id).enabled !== false);
      }
    }
  }

  onOpen(): void {
    this.contentEl.addClass("sauce-modal");
    this.contentEl.addClass("sauce-onboarding-wizard");
    this.renderStep(this.step);
  }

  onClose(): void { this.contentEl.empty(); }

  private next(): void { this.step = Math.min(this.step + 1, TOTAL_STEPS - 1); this.renderStep(this.step); }
  private back(): void { this.step = Math.max(this.step - 1, 0); this.renderStep(this.step); }

  private renderStep(idx: number): void {
    const c = this.contentEl;
    c.empty();
    c.createEl("div", { cls: "sauce-onboarding-step-indicator", text: `Step ${idx + 1} of ${TOTAL_STEPS}` });
    switch (idx) {
      case 0: this.renderWelcome(c); break;
      case 1: this.renderInitialize(c); break;
      case 2: this.renderCopilot(c); break;
      case 3: this.renderSkills(c); break;
      case 4: this.renderFirstPerson(c); break;
      case 5: this.renderDone(c); break;
      default: this.renderDone(c);
    }
  }

  // ---------- Step 1: Welcome ----------
  private renderWelcome(c: HTMLElement): void {
    c.createEl("h2", { text: "Welcome to Sauce Graph" });
    const ul = c.createEl("ul", { cls: "sauce-onboarding-bullets" });
    ul.createEl("li", { text: "Capture relationships, orgs, and touches as first-class entities in your vault." });
    ul.createEl("li", { text: "Works standalone — no parent vault needed. Federate with other vaults later via the “Register SubVault” command if you want." });
    ul.createEl("li", { text: "Augment with optional Copilot + Skills runtimes (anthropic / openai / ollama / LM Studio)." });

    const btns = c.createDiv({ cls: "sauce-buttons" });
    btns.createEl("button", { text: "Start", cls: "sauce-button" }).onclick = () => this.next();
    btns.createEl("button", { text: "Cancel", cls: "sauce-button sauce-button-secondary" }).onclick = () => this.close();
  }

  // ---------- Step 2: Initialize scaffolding ----------
  private renderInitialize(c: HTMLElement): void {
    c.createEl("h2", { text: "Initialize your vault" });
    c.createEl("p", { text: "Create the folders, seed docs, and registries this vault needs. Safe to re-run — existing files are left untouched." });

    const status = c.createEl("pre", { cls: "sauce-onboarding-status" });
    status.setText(this.initResult
      ? `Folders: ${this.initResult.created} created, ${this.initResult.existing} existing`
      : "(not yet run)");

    const btns = c.createDiv({ cls: "sauce-buttons" });
    btns.createEl("button", { text: "Back", cls: "sauce-button sauce-button-secondary" }).onclick = () => this.back();
    const runBtn = btns.createEl("button", { text: "Run Initialize", cls: "sauce-button" });
    runBtn.onclick = async () => {
      try {
        const r = await this.plugin.bootstrap.ensure();
        this.initResult = { created: r.created.length, existing: r.existing.length };
        new Notice(`Initialize complete: ${this.initResult.created} created, ${this.initResult.existing} existing`);
        this.renderStep(this.step);
      } catch (e: any) {
        new Notice(`Initialize failed: ${e?.message ?? e}`);
      }
    };
    btns.createEl("button", { text: "Next", cls: "sauce-button" }).onclick = () => this.next();
  }

  // ---------- Step 3: Copilot ----------
  private renderCopilot(c: HTMLElement): void {
    c.createEl("h2", { text: "Configure Copilot (optional)" });
    c.createEl("p", { text: "Pick a provider and paste an API key. You can change this later in plugin settings." });

    const pickerHost = c.createDiv({ cls: "sauce-onboarding-picker" });
    // ProviderPicker replaces the previous free-text Model input so users
    // pick from a live, per-provider catalog instead of guessing ids.
    new ProviderPicker({
      container: pickerHost,
      plugin: this.plugin,
      initialProvider: this.cpProvider as ProviderId,
      initialModel: this.cpModel,
      apiKey: this.cpApiKey,
      onChange: ({ provider, model }) => {
        this.cpProvider = provider as Provider;
        this.cpModel = model;
      },
    }).render();

    new Setting(c).setName("API key").addText((t) => {
      t.setPlaceholder("sk-…").setValue(this.cpApiKey).onChange((v) => { this.cpApiKey = v; });
      try { (t.inputEl as HTMLInputElement).type = "password"; } catch { /* ignore */ }
    });

    if (this.cpConfigured) c.createEl("p", { cls: "sauce-onboarding-status", text: "Copilot settings saved." });

    const btns = c.createDiv({ cls: "sauce-buttons" });
    btns.createEl("button", { text: "Back", cls: "sauce-button sauce-button-secondary" }).onclick = () => this.back();
    btns.createEl("button", { text: "Skip", cls: "sauce-button sauce-button-secondary" }).onclick = () => this.next();
    btns.createEl("button", { text: "Save & Next", cls: "sauce-button" }).onclick = async () => {
      try {
        this.plugin.settings.copilot.provider = this.cpProvider;
        if (this.cpModel) this.plugin.settings.copilot.model = this.cpModel;
        this.plugin.settings.copilot.apiKey = this.cpApiKey;
        await this.plugin.saveSettings();
        this.plugin.copilot?.updateSettings({
          provider: this.cpProvider,
          model: this.plugin.settings.copilot.model,
          apiKey: this.cpApiKey,
        });
        this.cpConfigured = true;
        new Notice("Copilot configured");
        this.next();
      } catch (e: any) {
        new Notice(`Copilot save failed: ${e?.message ?? e}`);
      }
    };
  }

  // ---------- Step 4: Skills ----------
  private renderSkills(c: HTMLElement): void {
    c.createEl("h2", { text: "Enable Skills (optional)" });
    const skills = this.plugin.skills?.list() ?? [];
    if (!this.plugin.skills) {
      c.createEl("p", { text: "Skills runtime not initialized — skipping." });
    } else if (skills.length === 0) {
      c.createEl("p", { text: "No skills registered." });
    } else {
      c.createEl("p", { text: `${skills.length} skills available. Toggle to enable/disable.` });
      const list = c.createDiv({ cls: "sauce-onboarding-skill-list" });
      for (const s of skills) {
        const row = list.createDiv({ cls: "sauce-onboarding-skill-row" });
        const cb = row.createEl("input", { type: "checkbox" }) as HTMLInputElement;
        cb.checked = this.skillEnabled.get(s.id) !== false;
        cb.addEventListener("change", () => { this.skillEnabled.set(s.id, cb.checked); });
        row.appendChild(document.createTextNode(" " + s.id));
      }
    }

    if (this.skillsConfigured) c.createEl("p", { cls: "sauce-onboarding-status", text: "Skill settings saved." });

    const btns = c.createDiv({ cls: "sauce-buttons" });
    btns.createEl("button", { text: "Back", cls: "sauce-button sauce-button-secondary" }).onclick = () => this.back();
    btns.createEl("button", { text: "Skip", cls: "sauce-button sauce-button-secondary" }).onclick = () => this.next();
    btns.createEl("button", { text: "Save & Next", cls: "sauce-button" }).onclick = async () => {
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
      } catch (e: any) {
        new Notice(`Skill save failed: ${e?.message ?? e}`);
      }
    };
  }

  // ---------- Step 5: First person ----------
  private renderFirstPerson(c: HTMLElement): void {
    c.createEl("h2", { text: "Create your first Person (optional)" });
    c.createEl("p", { text: "Seed the graph with one contact. You can skip and add people later." });

    new Setting(c).setName("Name").addText((t) => t
      .setPlaceholder("Full name")
      .setValue(this.personName)
      .onChange((v) => { this.personName = v; }));

    new Setting(c).setName("Email").addText((t) => t
      .setPlaceholder("name@example.com")
      .setValue(this.personEmail)
      .onChange((v) => { this.personEmail = v; }));

    new Setting(c).setName("Primary type").addDropdown((d) => {
      const enums = this.plugin.enums().primary_type_person ?? [];
      d.addOption("", "(choose…)");
      for (const e of enums) d.addOption(e, e);
      d.setValue(this.personPrimaryType);
      d.onChange((v) => { this.personPrimaryType = v; });
    });

    if (this.personCreated) c.createEl("p", { cls: "sauce-onboarding-status", text: `Created: ${this.personCreated}` });

    const btns = c.createDiv({ cls: "sauce-buttons" });
    btns.createEl("button", { text: "Back", cls: "sauce-button sauce-button-secondary" }).onclick = () => this.back();
    btns.createEl("button", { text: "Skip", cls: "sauce-button sauce-button-secondary" }).onclick = () => this.next();
    btns.createEl("button", { text: "Create & Next", cls: "sauce-button" }).onclick = async () => {
      try {
        const name = this.personName.trim();
        if (!name) { new Notice("Name is required"); return; }
        const fm = TemplateService.personFrontmatter({
          primary_type: this.personPrimaryType || undefined,
          email: this.personEmail || undefined,
        });
        const peoplePath = this.plugin.settings.paths.people;
        const file = await this.plugin.entityService.createEntity(peoplePath, name, fm);
        this.personCreated = file?.path ?? `${peoplePath}/${name}.md`;
        new Notice(`Created ${name}`);
        this.next();
      } catch (e: any) {
        new Notice(`Create failed: ${e?.message ?? e}`);
      }
    };
  }

  // ---------- Step 6: Done ----------
  private renderDone(c: HTMLElement): void {
    c.createEl("h2", { text: "All set" });
    const ul = c.createEl("ul", { cls: "sauce-onboarding-summary" });
    ul.createEl("li", { text: this.initResult
      ? `Vault initialized: ${this.initResult.created} folders created, ${this.initResult.existing} existing`
      : "Vault: not initialized" });
    ul.createEl("li", { text: `Copilot: ${this.cpConfigured ? `configured (${this.cpProvider})` : "skipped"}` });
    ul.createEl("li", { text: `Skills: ${this.skillsConfigured ? "saved" : "skipped"}` });
    ul.createEl("li", { text: `First person: ${this.personCreated ?? "skipped"}` });
    ul.createEl("li", { text: "Tip: use the “Register SubVault” command to federate this vault later." });

    const btns = c.createDiv({ cls: "sauce-buttons" });
    btns.createEl("button", { text: "Back", cls: "sauce-button sauce-button-secondary" }).onclick = () => this.back();
    btns.createEl("button", { text: "Done", cls: "sauce-button" }).onclick = () => this.close();
  }
}
