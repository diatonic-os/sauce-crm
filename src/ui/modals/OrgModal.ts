import { App, Modal, Setting, Notice, TFile } from "obsidian";
import type SauceGraphPlugin from "../../main";
import { TemplateService } from "../../services/TemplateService";
import { WikilinkSuggest } from "./WikilinkSuggest";
import { wrapWikilink, parseWikilink } from "../../util/Wikilink";
import { slugify } from "../../util/Yaml";

export class OrgModal extends Modal {
  private fm: Record<string, any>;
  private name: string;
  private editingFile: TFile | null;

  constructor(
    public override app: App,
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

  override onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass("sauce-modal");
    contentEl.createEl("h2", {
      text: this.editingFile ? `Edit Org — ${this.name}` : "New Org",
    });

    new Setting(contentEl)
      .setName("Name")
      .addText((t) => t.setValue(this.name).onChange((v) => (this.name = v)));
    new Setting(contentEl)
      .setName("Industry")
      .addText((t) =>
        t
          .setValue(this.fm.industry ?? "")
          .onChange((v) => (this.fm.industry = v)),
      );
    new Setting(contentEl)
      .setName("Location")
      .addText((t) =>
        t
          .setValue(this.fm.location ?? "")
          .onChange((v) => (this.fm.location = v)),
      );
    new Setting(contentEl)
      .setName("Website")
      .addText((t) =>
        t
          .setValue(this.fm.website ?? "")
          .onChange((v) => (this.fm.website = v)),
      );

    new Setting(contentEl).setName("Status").addDropdown((d) => {
      for (const e of this.plugin.enums().status_org ?? []) d.addOption(e, e);
      d.setValue(this.fm.status ?? "active");
      d.onChange((v) => (this.fm.status = v));
    });

    new Setting(contentEl).setName("Parent org").addButton((b) =>
      b
        .setButtonText(this.fm.parent ?? "Pick parent (optional)")
        .onClick(() => {
          new WikilinkSuggest(
            this.app,
            [this.plugin.settings.paths.orgs],
            (_f, raw) => {
              const link = wrapWikilink(raw);
              if (parseWikilink(link) === this.name) {
                new Notice("Org cannot be its own parent");
                return;
              }
              this.fm.parent = link;
              b.setButtonText(link);
            },
          ).open();
        }),
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
    if (this.fm.parent && (await this.hasCycle(name, this.fm.parent))) {
      new Notice("Cyclic parent chain — refused");
      return;
    }
    const fm = TemplateService.orgFrontmatter({ ...this.fm });
    const v = this.plugin.contractValidator.validate(fm);
    if (!v.passed) {
      new Notice(
        "Contract violation: " +
          v.violations.map((x) => x.invariant).join(", "),
      );
      return;
    }
    if (this.editingFile) {
      if (this.editingFile.basename !== name) {
        await this.app.fileManager.renameFile(
          this.editingFile,
          `${this.plugin.settings.paths.orgs}/${name}.md`,
        );
      }
      await this.plugin.entityService.updateFrontmatter(
        this.editingFile,
        () => fm,
      );
    } else {
      await this.plugin.entityService.createEntity(
        this.plugin.settings.paths.orgs,
        name,
        fm,
      );
    }
    new Notice(`Saved ${name}`);
    this.close();
  }

  private async hasCycle(self: string, parentLink: string): Promise<boolean> {
    const visited = new Set<string>([self]);
    let cur = parseWikilink(parentLink);
    let depth = 0;
    while (cur && depth < 50) {
      if (visited.has(cur)) return true;
      visited.add(cur);
      const f = this.app.metadataCache.getFirstLinkpathDest(cur, "");
      if (!f) return false;
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      cur = fm?.parent ? parseWikilink(String(fm.parent)) : null;
      depth++;
    }
    return false;
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
