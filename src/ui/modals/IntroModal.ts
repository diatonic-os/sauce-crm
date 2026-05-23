import { App, Modal, Setting, Notice } from "obsidian";
import type SauceGraphPlugin from "../../main";
import { WikilinkSuggest } from "./WikilinkSuggest";
import { wrapWikilink, parseWikilink } from "../../util/Wikilink";
import { scoreIntro } from "../../compat/IntroScorer";
import { uniq } from "../../util/Yaml";

export class IntroModal extends Modal {
  private a: string | null = null;
  private b: string | null = null;
  private result: HTMLElement | null = null;

  constructor(
    public app: App,
    public plugin: SauceGraphPlugin,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("sauce-modal");
    contentEl.createEl("h2", { text: "Propose Intro" });

    const aRow = new Setting(contentEl).setName("Person A").addButton((b) =>
      b.setButtonText("Pick A").onClick(() =>
        new WikilinkSuggest(
          this.app,
          [this.plugin.settings.paths.people],
          (_f, raw) => {
            this.a = raw;
            b.setButtonText(raw);
            this.recompute();
          },
          false,
        ).open(),
      ),
    );
    void aRow;

    new Setting(contentEl).setName("Person B").addButton((b) =>
      b.setButtonText("Pick B").onClick(() =>
        new WikilinkSuggest(
          this.app,
          [this.plugin.settings.paths.people],
          (_f, raw) => {
            this.b = raw;
            b.setButtonText(raw);
            this.recompute();
          },
          false,
        ).open(),
      ),
    );

    this.result = contentEl.createDiv({ cls: "sauce-intro-result" });

    const btns = contentEl.createDiv({ cls: "sauce-buttons" });
    btns.createEl("button", { text: "Promote", cls: "sauce-button" }).onclick =
      () => this.promote();
    btns.createEl("button", {
      text: "Cancel",
      cls: "sauce-button sauce-button-secondary",
    }).onclick = () => this.close();
  }

  private recompute(): void {
    if (!this.a || !this.b || !this.result) return;
    const aFile = this.app.metadataCache.getFirstLinkpathDest(this.a, "");
    const bFile = this.app.metadataCache.getFirstLinkpathDest(this.b, "");
    if (!aFile || !bFile) {
      this.result.setText("could not resolve both people");
      return;
    }
    const aFm = this.app.metadataCache.getFileCache(aFile)?.frontmatter ?? {};
    const bFm = this.app.metadataCache.getFileCache(bFile)?.frontmatter ?? {};
    const cfg = this.plugin.settings.compat_config;
    const r = scoreIntro(aFm, bFm, cfg.fields, cfg.rho_adm);
    this.result.empty();
    this.result.createEl("p", {
      text: `Density: ${(r.score * 100).toFixed(1)}%`,
    });
    this.result.createEl("p", {
      text: r.passes_threshold
        ? "✓ Clears ρ_adm threshold"
        : `Below threshold — missing: ${r.missing_for_threshold.join(", ")}`,
    });
  }

  private async promote(): Promise<void> {
    if (!this.a || !this.b) {
      new Notice("Pick both A and B");
      return;
    }
    const aFile = this.app.metadataCache.getFirstLinkpathDest(this.a, "");
    if (!aFile) {
      new Notice("could not resolve A");
      return;
    }
    await this.plugin.entityService.updateFrontmatter(aFile, (fm) => {
      const cur = Array.isArray(fm.intro_candidates) ? fm.intro_candidates : [];
      fm.intro_candidates = uniq([...cur, wrapWikilink(this.b!)]);
    });
    void parseWikilink;
    new Notice(`Promoted ${this.b} as intro candidate for ${this.a}`);
    this.close();
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
