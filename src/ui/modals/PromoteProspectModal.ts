import { App, Modal, Setting, Notice, TFile } from "obsidian";
import type SauceGraphPlugin from "../../main";
import { uniq } from "../../util/Yaml";

export class PromoteProspectModal extends Modal {
  private file: TFile | null;
  private newPrimary = "warm-contact";

  constructor(
    public override app: App,
    public plugin: SauceGraphPlugin,
    file: TFile | null,
  ) {
    super(app);
    this.file = file;
  }

  override onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("sauce-modal");
    contentEl.createEl("h2", { text: "Promote Prospect" });
    if (!this.file) {
      contentEl.createEl("p", { text: "open a person file first" });
      return;
    }

    new Setting(contentEl).setName("New primary_type").addDropdown((d) => {
      for (const e of this.plugin.enums().primary_type_person ?? [])
        d.addOption(e, e);
      d.setValue(this.newPrimary);
      d.onChange((v) => (this.newPrimary = v));
    });

    const btns = contentEl.createDiv({ cls: "sauce-buttons" });
    btns.createEl("button", { text: "Promote", cls: "sauce-button" }).onclick =
      () => this.save();
    btns.createEl("button", {
      text: "Cancel",
      cls: "sauce-button sauce-button-secondary",
    }).onclick = () => this.close();
  }

  async save(): Promise<void> {
    if (!this.file) return;
    await this.plugin.entityService.updateFrontmatter(this.file, (fm) => {
      fm.primary_type = this.newPrimary;
      const cur: string[] = Array.isArray(fm.roles) ? fm.roles : [];
      fm.roles = uniq([
        this.newPrimary,
        ...cur.filter((r) => r !== "prospect"),
      ]);
    });
    new Notice("Promoted");
    this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
