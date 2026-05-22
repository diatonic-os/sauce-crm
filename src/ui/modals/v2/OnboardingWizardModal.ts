// V2-LANE-2 — Onboarding Wizard. Multi-step modal that walks the operator
// through vault role selection, scaffolding, copilot config, skill enable,
// and first-person creation. Safe: no dynamic regex, no exec, no ReDoS.

import { App, Modal, Notice, Setting } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import { TemplateService } from "../../../services/TemplateService";
import { ProviderPicker } from "../../components/v2/ProviderPicker";
import type { ProviderId } from "../../../copilot/ModelCatalog";

type VaultRole = "subvault" | "parent" | "both";
type Provider = "anthropic" | "openai" | "ollama";

const TOTAL_STEPS = 7;

export class OnboardingWizardModal extends Modal {
  private step = 0;
  private role: VaultRole = "subvault";

  // Step 3 results
  private initResult: { subCreated: number; subExisting: number; parentRan: boolean } | null = null;

  // Step 4 — copilot draft
  private cpProvider: Provider = "anthropic";
  private cpModel = "";
  private cpApiKey = "";
  private cpConfigured = false;

  // Step 5 — skills draft (id -> enabled)
  private skillEnabled = new Map<string, boolean>();
  private skillsConfigured = false;

  // Step 6 — first person
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
      case 1: this.renderRole(c); break;
      case 2: this.renderInitialize(c); break;
      case 3: this.renderCopilot(c); break;
      case 4: this.renderSkills(c); break;
      case 5: this.renderFirstPerson(c); break;
      case 6: this.renderDone(c); break;
      default: this.renderDone(c);
    }
  }

  // ---------- Step 1: Welcome ----------
  private renderWelcome(c: HTMLElement): void {
    c.createEl("h2", { text: "Welcome to Sauce Graph" });
    const ul = c.createEl("ul", { cls: "sauce-onboarding-bullets" });
    ul.createEl("li", { text: "Capture relationships, orgs, and touches as first-class entities in your vault." });
    ul.createEl("li", { text: "Federate sub-vaults under a parent vault for multi-context graph work." });
    ul.createEl("li", { text: "Augment with optional Copilot + Skills runtimes (anthropic / openai / ollama)." });

    const btns = c.createDiv({ cls: "sauce-buttons" });
    btns.createEl("button", { text: "Start", cls: "sauce-button" }).onclick = () => this.next();
    btns.createEl("button", { text: "Cancel", cls: "sauce-button sauce-button-secondary" }).onclick = () => this.close();
  }

  // ---------- Step 2: Vault role ----------
  private renderRole(c: HTMLElement): void {
    c.createEl("h2", { text: "Vault role" });
    c.createEl("p", { text: "How will this vault participate in the Sauce Graph federation?" });

    const wrap = c.createDiv({ cls: "sauce-onboarding-radio-group" });
    const opts: Array<{ id: VaultRole; label: string }> = [
      { id: "subvault", label: "This vault is a SubVault" },
      { id: "parent",   label: "This vault is the ParentVault" },
      { id: "both",     label: "Both (initialize parent + first subvault here)" },
    ];
    for (const opt of opts) {
      const row = wrap.createDiv({ cls: "sauce-onboarding-radio-row" });
      const input = row.createEl("input", { type: "radio" }) as HTMLInputElement;
      input.name = "sauce-onboarding-role";
      input.value = opt.id;
      input.checked = this.role === opt.id;
      input.addEventListener("change", () => { if (input.checked) this.role = opt.id; });
      const label = row.createEl("label", { text: " " + opt.label });
      label.prepend(input.cloneNode(true) as Node);
      // Replace the inserted clone with the live input so events still fire.
      row.empty();
      row.appendChild(input);
      row.appendChild(document.createTextNode(" " + opt.label));
    }

    const btns = c.createDiv({ cls: "sauce-buttons" });
    btns.createEl("button", { text: "Back", cls: "sauce-button sauce-button-secondary" }).onclick = () => this.back();
    btns.createEl("button", { text: "Next", cls: "sauce-button" }).onclick = () => this.next();
  }

  // ---------- Step 3: Initialize scaffolding ----------
  private renderInitialize(c: HTMLElement): void {
    c.createEl("h2", { text: "Initialize scaffolding" });
    c.createEl("p", { text: `Role: ${this.role}. Click Run Initialize to create folders, seed docs, and registries.` });

    const status = c.createEl("pre", { cls: "sauce-onboarding-status" });
    status.setText(this.initResult
      ? `Sub-bootstrap: ${this.initResult.subCreated} created, ${this.initResult.subExisting} existing\nParent-bootstrap: ${this.initResult.parentRan ? "ran" : "skipped"}`
      : "(not yet run)");

    const btns = c.createDiv({ cls: "sauce-buttons" });
    btns.createEl("button", { text: "Back", cls: "sauce-button sauce-button-secondary" }).onclick = () => this.back();
    const runBtn = btns.createEl("button", { text: "Run Initialize", cls: "sauce-button" });
    runBtn.onclick = async () => {
      try {
        let subCreated = 0, subExisting = 0, parentRan = false;
        if (this.role === "subvault" || this.role === "both") {
          const r = await this.plugin.bootstrap.ensure();
          subCreated = r.created.length;
          subExisting = r.existing.length;
        }
        if (this.role === "parent" || this.role === "both") {
          await this.plugin.parentBootstrap.ensure();
          parentRan = true;
        }
        this.initResult = { subCreated, subExisting, parentRan };
        new Notice(`Initialize complete: ${subCreated} created, ${subExisting} existing${parentRan ? ", parent ran" : ""}`);
        this.renderStep(this.step);
      } catch (e: any) {
        new Notice(`Initialize failed: ${e?.message ?? e}`);
      }
    };
    btns.createEl("button", { text: "Next", cls: "sauce-button" }).onclick = () => this.next();
  }

  // ---------- Step 4: Copilot ----------
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

  // ---------- Step 5: Skills ----------
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

  // ---------- Step 6: First person ----------
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

  // ---------- Step 7: Done ----------
  private renderDone(c: HTMLElement): void {
    c.createEl("h2", { text: "All set" });
    const ul = c.createEl("ul", { cls: "sauce-onboarding-summary" });
    ul.createEl("li", { text: `Vault role: ${this.role}` });
    if (this.initResult) {
      ul.createEl("li", { text: `Scaffolding: ${this.initResult.subCreated} folders created, ${this.initResult.subExisting} existing${this.initResult.parentRan ? "; parent vault initialized" : ""}` });
    } else {
      ul.createEl("li", { text: "Scaffolding: not run" });
    }
    ul.createEl("li", { text: `Copilot: ${this.cpConfigured ? `configured (${this.cpProvider})` : "skipped"}` });
    ul.createEl("li", { text: `Skills: ${this.skillsConfigured ? "saved" : "skipped"}` });
    ul.createEl("li", { text: `First person: ${this.personCreated ?? "skipped"}` });

    const btns = c.createDiv({ cls: "sauce-buttons" });
    btns.createEl("button", { text: "Back", cls: "sauce-button sauce-button-secondary" }).onclick = () => this.back();
    btns.createEl("button", { text: "Done", cls: "sauce-button" }).onclick = () => this.close();
  }
}
