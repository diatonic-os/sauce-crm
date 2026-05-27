import { App, Modal, Setting, Notice } from "obsidian";
import type SauceGraphPlugin from "../../main";

export class TagModal extends Modal {
  private op: "rename" | "merge" | "delete" = "rename";
  private from = "";
  private to = "";

  constructor(
    public override app: App,
    public plugin: SauceGraphPlugin,
    defaultOp: "rename" | "merge" | "delete" = "rename",
  ) {
    super(app);
    this.op = defaultOp;
  }

  override onOpen(): void {
    const { contentEl } = this;
    this.modalEl.addClass("sauce-modal");
    contentEl.createEl("h2", { text: `Tag ${this.op}` });

    new Setting(contentEl).setName("Operation").addDropdown((d) => {
      d.addOption("rename", "rename")
        .addOption("merge", "merge")
        .addOption("delete", "delete");
      d.setValue(this.op);
      d.onChange((v) => (this.op = v as "rename" | "merge" | "delete"));
    });
    new Setting(contentEl)
      .setName("From")
      .addText((t) => t.onChange((v) => (this.from = v.replace(/^#/, ""))));
    if (this.op !== "delete") {
      new Setting(contentEl)
        .setName("To")
        .addText((t) => t.onChange((v) => (this.to = v.replace(/^#/, ""))));
    }

    const btns = contentEl.createDiv({ cls: "sauce-buttons" });
    btns.createEl("button", { text: "Run", cls: "sauce-button" }).onclick =
      () => this.run();
    btns.createEl("button", {
      text: "Cancel",
      cls: "sauce-button sauce-button-secondary",
    }).onclick = () => this.close();
  }

  async run(): Promise<void> {
    if (!this.from) {
      new Notice("From tag required");
      return;
    }
    let n = 0;
    for (const f of this.app.vault.getMarkdownFiles()) {
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter;
      if (!fm) continue;
      const tags = Array.isArray(fm.tags) ? fm.tags : [];
      if (!tags.includes(this.from)) continue;
      await this.app.fileManager.processFrontMatter(f, (pfm) => {
        const cur: string[] = Array.isArray(pfm.tags) ? pfm.tags : [];
        const next = cur.filter((t: string) => t !== this.from);
        if (this.op !== "delete" && this.to && !next.includes(this.to))
          next.push(this.to);
        pfm.tags = next;
      });
      n++;
    }
    new Notice(`${this.op} applied to ${n} files`);
    // emit addendum
    const slug = `${new Date().toISOString().slice(0, 10)}-tag-${this.op}-${this.from}`;
    await this.plugin.entityService.createEntity(
      this.plugin.settings.paths.addenda,
      slug,
      {
        type: "addendum",
        contract: "core",
        subtype_of: "Entity",
        addends: "[[CLAUDE]]",
        date: new Date().toISOString().slice(0, 10),
        kind: "context",
        mutable: [],
        tags: ["addendum", "tag-op"],
      },
      `Tag ${this.op}: ${this.from}${this.to ? ` → ${this.to}` : ""} across ${n} files.`,
    );
    this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
