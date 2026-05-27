import { App, Modal, Setting, Notice, TFile } from "obsidian";
import type SauceGraphPlugin from "../../main";
import { WikilinkSuggest } from "./WikilinkSuggest";
import { wrapWikilink } from "../../util/Wikilink";
import { uniq } from "../../util/Yaml";

const EDGE_TYPES = [
  "knows",
  "worked_with",
  "intro_candidates",
  "family_of",
  "intro_via",
  "parent",
];

export class RelationModal extends Modal {
  private srcFile: TFile | null = null;
  private edge = "knows";
  private target = "";

  constructor(
    public override app: App,
    public plugin: SauceGraphPlugin,
    srcFile: TFile | null = null,
  ) {
    super(app);
    this.srcFile = srcFile;
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("sauce-modal");
    contentEl.createEl("h2", { text: "New Relation" });

    new Setting(contentEl).setName("Source").addButton((b) =>
      b.setButtonText(this.srcFile?.basename ?? "Pick source").onClick(() =>
        new WikilinkSuggest(
          this.app,
          [],
          (f) => {
            if (f) {
              this.srcFile = f;
              b.setButtonText(f.basename);
            }
          },
          false,
        ).open(),
      ),
    );

    new Setting(contentEl).setName("Edge type").addDropdown((d) => {
      for (const e of EDGE_TYPES) d.addOption(e, e);
      d.setValue(this.edge);
      d.onChange((v) => (this.edge = v));
    });

    new Setting(contentEl).setName("Target").addButton((b) =>
      b.setButtonText("Pick target").onClick(() =>
        new WikilinkSuggest(this.app, [], (_f, raw) => {
          this.target = raw;
          b.setButtonText(raw);
        }).open(),
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
    if (!this.srcFile || !this.target) {
      new Notice("Source and target are required");
      return;
    }
    const link = wrapWikilink(this.target);
    await this.plugin.entityService.updateFrontmatter(this.srcFile, (fm) => {
      const cur = Array.isArray(fm[this.edge])
        ? fm[this.edge]
        : fm[this.edge]
          ? [fm[this.edge]]
          : [];
      const rule = this.plugin.edgeSync.rules[this.edge];
      if (rule?.scalar) fm[this.edge] = link;
      else fm[this.edge] = uniq([...cur, link]);
    });
    this.plugin.edgeSync.scheduleReconcile(this.srcFile);
    new Notice("Saved");
    this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
