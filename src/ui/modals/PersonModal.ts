import { App, Modal, Setting, Notice, TFile } from "obsidian";
import type SauceGraphPlugin from "../../main";
import { TemplateService } from "../../services/TemplateService";
import { WikilinkSuggest } from "./WikilinkSuggest";
import { wrapWikilink } from "../../util/Wikilink";
import { slugify, uniq } from "../../util/Yaml";

export class PersonModal extends Modal {
  private fm: Record<string, any>;
  private name: string;
  private editingFile: TFile | null;

  constructor(
    public app: App,
    public plugin: SauceGraphPlugin,
    existing: TFile | null = null,
  ) {
    super(app);
    this.editingFile = existing;
    const cur = existing
      ? (this.app.metadataCache.getFileCache(existing)?.frontmatter ?? {})
      : {};
    this.name = existing?.basename ?? "";
    this.fm = { ...cur };
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("sauce-modal");
    contentEl.createEl("h2", {
      text: this.editingFile ? `Edit Person — ${this.name}` : "New Person",
    });

    new Setting(contentEl).setName("Name").addText((t) =>
      t
        .setPlaceholder("Full name")
        .setValue(this.name)
        .onChange((v) => (this.name = v)),
    );

    new Setting(contentEl).setName("Primary type").addDropdown((d) => {
      for (const e of this.plugin.enums().primary_type_person ?? [])
        d.addOption(e, e);
      d.setValue(this.fm.primary_type ?? "");
      d.onChange((v) => (this.fm.primary_type = v));
    });

    new Setting(contentEl).setName("Roles (comma-separated)").addText((t) =>
      t.setValue((this.fm.roles ?? []).join(", ")).onChange(
        (v) =>
          (this.fm.roles = v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)),
      ),
    );

    new Setting(contentEl).setName("Closeness 1–5").addSlider((s) =>
      s
        .setLimits(1, 5, 1)
        .setValue(Number(this.fm.closeness ?? 3))
        .setDynamicTooltip()
        .onChange((v) => (this.fm.closeness = v)),
    );

    new Setting(contentEl).setName("Cadence").addDropdown((d) => {
      for (const e of this.plugin.enums().cadence ?? []) d.addOption(e, e);
      d.setValue(this.fm.cadence ?? "quarterly");
      d.onChange((v) => (this.fm.cadence = v));
    });

    new Setting(contentEl).setName("Company").addButton((b) =>
      b.setButtonText(this.fm.company ?? "Pick org").onClick(() => {
        new WikilinkSuggest(
          this.app,
          [this.plugin.settings.paths.orgs],
          (_f, raw) => {
            this.fm.company = wrapWikilink(raw);
            b.setButtonText(this.fm.company);
          },
        ).open();
      }),
    );

    for (const edge of ["knows", "worked_with", "intro_candidates"]) {
      new Setting(contentEl).setName(edge).addButton((b) =>
        b
          .setButtonText(`+ Add (${(this.fm[edge] ?? []).length})`)
          .onClick(() => {
            new WikilinkSuggest(
              this.app,
              [this.plugin.settings.paths.people],
              (_f, raw) => {
                this.fm[edge] = uniq([
                  ...(this.fm[edge] ?? []),
                  wrapWikilink(raw),
                ]);
                b.setButtonText(`+ Add (${this.fm[edge].length})`);
              },
            ).open();
          }),
      );
    }

    new Setting(contentEl)
      .setName("intro_opt_in")
      .addToggle((t) =>
        t
          .setValue(Boolean(this.fm.intro_opt_in ?? false))
          .onChange((v) => (this.fm.intro_opt_in = v)),
      );

    new Setting(contentEl).setName("Tags (comma-separated)").addText((t) =>
      t.setValue((this.fm.tags ?? []).join(", ")).onChange(
        (v) =>
          (this.fm.tags = v
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)),
      ),
    );

    const btns = contentEl.createDiv({ cls: "sauce-buttons" });
    btns.createEl("button", { text: "Save", cls: "sauce-button" }).onclick =
      () => this.save();
    btns.createEl("button", {
      text: "Cancel",
      cls: "sauce-button sauce-button-secondary",
    }).onclick = () => this.close();
  }

  async save(): Promise<void> {
    const name = slugify(this.name);
    if (!name) {
      new Notice("Name is required");
      return;
    }
    const fm = TemplateService.personFrontmatter({ ...this.fm });
    const validation = this.plugin.contractValidator.validate(fm);
    if (!validation.passed) {
      new Notice(
        "Contract violation:\n" +
          validation.violations.map((v) => `• ${v.invariant}`).join("\n"),
      );
      return;
    }
    if (this.editingFile && this.editingFile.basename !== name) {
      await this.app.fileManager.renameFile(
        this.editingFile,
        `${this.plugin.settings.paths.people}/${name}.md`,
      );
    }
    if (this.editingFile) {
      await this.plugin.entityService.updateFrontmatter(
        this.editingFile,
        () => fm,
      );
    } else {
      const file = await this.plugin.entityService.createEntity(
        this.plugin.settings.paths.people,
        name,
        fm,
      );
      this.plugin.edgeSync.scheduleReconcile(file);
    }
    new Notice(`Saved ${name}`);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
