import { App, Modal, Setting, Notice, TFile } from "obsidian";
import type SauceGraphPlugin from "../../main";
import { TemplateService } from "../../services/TemplateService";
import { WikilinkSuggest } from "./WikilinkSuggest";
import { wrapWikilink, parseWikilink } from "../../util/Wikilink";
import { todayIso } from "../../util/DateUtil";
import { slugify } from "../../util/Yaml";

export class AddendumModal extends Modal {
  private fm: Record<string, any> = { date: todayIso(), kind: "context" };
  private body = "";

  constructor(
    public app: App,
    public plugin: SauceGraphPlugin,
    target: TFile | null = null,
  ) {
    super(app);
    if (target) this.fm.addends = wrapWikilink(target.basename);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("sauce-modal");
    contentEl.createEl("h2", { text: "New Addendum" });

    new Setting(contentEl).setName("Addends (target)").addButton((b) =>
      b.setButtonText(this.fm.addends ?? "Pick target").onClick(() => {
        new WikilinkSuggest(this.app, [], (_f, raw) => {
          this.fm.addends = wrapWikilink(raw);
          b.setButtonText(this.fm.addends);
        }).open();
      }),
    );

    new Setting(contentEl).setName("Kind").addDropdown((d) => {
      for (const e of this.plugin.enums().kind_addendum ?? [])
        d.addOption(e, e);
      d.setValue(this.fm.kind);
      d.onChange((v) => (this.fm.kind = v));
    });

    new Setting(contentEl)
      .setName("Date")
      .addText((t) =>
        t.setValue(this.fm.date).onChange((v) => (this.fm.date = v)),
      );

    new Setting(contentEl)
      .setName("Body")
      .addTextArea((t) => t.onChange((v) => (this.body = v)));

    const btns = contentEl.createDiv({ cls: "sauce-buttons" });
    btns.createEl("button", {
      text: "Save (immutable)",
      cls: "sauce-button",
    }).onclick = () => this.save();
    btns.createEl("button", {
      text: "Cancel",
      cls: "sauce-button sauce-button-secondary",
    }).onclick = () => this.close();
  }

  async save(): Promise<void> {
    if (!this.fm.addends) {
      new Notice("Target is required");
      return;
    }
    const target = parseWikilink(this.fm.addends) ?? this.fm.addends;
    const slug = slugify(`${this.fm.date}-${target}-${this.fm.kind}`);
    const fm = TemplateService.addendumFrontmatter(this.fm);
    await this.plugin.entityService.createEntity(
      this.plugin.settings.paths.addenda,
      slug,
      fm,
      this.body,
    );
    new Notice("Addendum saved (immutable)");
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
