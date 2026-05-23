import { App, Modal, Setting, Notice, TFile } from "obsidian";
import type SauceGraphPlugin from "../../main";
import { TemplateService } from "../../services/TemplateService";
import { WikilinkSuggest } from "./WikilinkSuggest";
import { wrapWikilink, parseWikilink } from "../../util/Wikilink";
import {
  todayIso,
  maxDate,
  parseIsoSafe,
  touchFolderForDate,
} from "../../util/DateUtil";
import { slugify, uniq } from "../../util/Yaml";

export class TouchModal extends Modal {
  private fm: Record<string, any> = {};
  private follows: string[] = [];

  constructor(
    public app: App,
    public plugin: SauceGraphPlugin,
    prefill?: Record<string, any>,
  ) {
    super(app);
    this.fm.date = todayIso();
    this.fm.attendees = [];
    if (prefill) Object.assign(this.fm, prefill);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("sauce-modal");
    contentEl.createEl("h2", { text: "Log Touch" });

    new Setting(contentEl).setName("Contact").addButton((b) =>
      b.setButtonText(this.fm.contact ?? "Pick person").onClick(() => {
        new WikilinkSuggest(
          this.app,
          [this.plugin.settings.paths.people],
          (_f, raw) => {
            this.fm.contact = wrapWikilink(raw);
            this.fm.attendees = uniq([
              this.fm.contact,
              ...(this.fm.attendees ?? []),
            ]);
            b.setButtonText(this.fm.contact);
          },
          false,
        ).open();
      }),
    );

    new Setting(contentEl)
      .setName("Date (YYYY-MM-DD)")
      .addText((t) =>
        t.setValue(this.fm.date).onChange((v) => (this.fm.date = v)),
      );

    new Setting(contentEl).setName("Channel").addDropdown((d) => {
      for (const e of this.plugin.enums().channel ?? []) d.addOption(e, e);
      d.setValue("in-person");
      d.onChange((v) => (this.fm.channel = v));
    });

    new Setting(contentEl).setName("Playbook").addDropdown((d) => {
      for (const e of this.plugin.enums().playbook ?? [
        "ff-1",
        "ff-2",
        "ff-3",
        "ff-4",
        "ment-1",
        "ment-2",
        "ment-3",
        "ment-4",
        "",
      ])
        d.addOption(e, e || "(none)");
      d.setValue("");
      d.onChange((v) => (this.fm.playbook_used = v));
    });

    new Setting(contentEl)
      .setName("Outcome tags (comma-separated)")
      .addText((t) =>
        t.onChange(
          (v) =>
            (this.fm.outcome_tags = v
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean)),
        ),
      );

    new Setting(contentEl).setName("Additional attendees").addButton((b) =>
      b
        .setButtonText(`+ Add (${(this.fm.attendees ?? []).length})`)
        .onClick(() => {
          new WikilinkSuggest(
            this.app,
            [this.plugin.settings.paths.people],
            (_f, raw) => {
              this.fm.attendees = uniq([
                ...(this.fm.attendees ?? []),
                wrapWikilink(raw),
              ]);
              b.setButtonText(`+ Add (${this.fm.attendees.length})`);
            },
          ).open();
        }),
    );

    new Setting(contentEl)
      .setName("Follow-ups (one per line)")
      .addTextArea((t) =>
        t.onChange(
          (v) =>
            (this.follows = v
              .split("\n")
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
    if (!this.fm.contact) {
      new Notice("Contact is required");
      return;
    }
    const d = parseIsoSafe(this.fm.date);
    if (!d) {
      new Notice("Invalid date — use YYYY-MM-DD");
      return;
    }
    const folder = touchFolderForDate(d);
    await this.plugin.entityService.ensureFolder(folder);
    const contactName = parseWikilink(this.fm.contact) ?? this.fm.contact;
    const slug = slugify(
      `${this.fm.date}-${contactName}-${this.fm.channel ?? "touch"}`,
    );
    const fm = TemplateService.touchFrontmatter({ ...this.fm });
    const body = this.follows.length
      ? "\n\n## Follow-ups\n" + this.follows.map((f) => `- [ ] ${f}`).join("\n")
      : "";
    const file = await this.plugin.entityService.createEntity(
      folder,
      slug,
      fm,
      body,
    );

    // bump person's last_touch
    const personFile = this.app.metadataCache.getFirstLinkpathDest(
      contactName,
      file.path,
    );
    if (personFile instanceof TFile) {
      await this.plugin.entityService.updateFrontmatter(personFile, (pfm) => {
        pfm.last_touch = maxDate(pfm.last_touch ?? null, this.fm.date);
      });
    }
    new Notice(`Logged touch with ${contactName}`);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
