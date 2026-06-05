// SPEC §33 — Import flow. Pick adapter, optionally remap CSV fields, dry-run, commit.
import { App, Modal, Notice, Setting, normalizePath } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import {
  CsvImportAdapter,
  VcardImportAdapter,
  IcsImportAdapter,
  JsonImportAdapter,
  type IImportAdapter,
  type ImportedEntity,
} from "../../../importexport";

const ADAPTERS: Record<string, () => IImportAdapter> = {
  csv: () => new CsvImportAdapter(),
  vcard: () => new VcardImportAdapter(),
  ics: () => new IcsImportAdapter(),
  json: () => new JsonImportAdapter(),
};

export class ImportMappingModal extends Modal {
  private adapterId: keyof typeof ADAPTERS = "csv";
  private rawText = "";
  private mapping: Record<string, string> = {};
  private preview: ImportedEntity[] = [];

  constructor(
    app: App,
    public plugin: SauceGraphPlugin,
  ) {
    super(app);
  }

  override onOpen(): void {
    const c = this.contentEl;
    c.addClass("sauce-modal");
    c.createEl("h2", { text: "Import" });

    new Setting(c).setName("Format").addDropdown((d) => {
      for (const k of Object.keys(ADAPTERS)) d.addOption(k, k.toUpperCase());
      d.setValue(this.adapterId).onChange(
        (v) => (this.adapterId = v as keyof typeof ADAPTERS),
      );
    });

    new Setting(c)
      .setName("Paste content (or upload below)")
      .addTextArea((t) => {
        t.inputEl.rows = 8;
        t.onChange((v) => {
          this.rawText = v;
        });
      });

    const fileRow = c.createDiv({ cls: "sauce-import-file" });
    const fileInput = fileRow.createEl("input", {
      type: "file",
    }) as HTMLInputElement;
    fileInput.accept = ".csv,.vcf,.ics,.json,.txt";
    fileInput.onchange = async () => {
      const f = fileInput.files?.[0];
      if (!f) return;
      this.rawText = await f.text();
      // Try auto-detect adapter
      for (const [id, ctor] of Object.entries(ADAPTERS)) {
        const a = ctor();
        if (await a.detect(this.rawText)) {
          this.adapterId = id as keyof typeof ADAPTERS;
          new Notice(`Detected ${id.toUpperCase()}`);
          break;
        }
      }
    };

    new Setting(c)
      .setName("Field mapping (CSV only, JSON keys per column)")
      .addTextArea((t) => {
        t.inputEl.rows = 3;
        t.setPlaceholder(
          '{"Full Name":"name","Email":"email","Company":"company"}',
        );
        t.onChange((v) => {
          try {
            this.mapping = JSON.parse(v || "{}");
          } catch {
            /* keep prior */
          }
        });
      });

    const previewWrap = c.createDiv({ cls: "sauce-import-preview" });
    previewWrap.createEl("strong", { text: "Dry-run preview" });
    const previewBody = previewWrap.createEl("pre", {
      cls: "sauce-import-preview-body",
      text: "(click Preview)",
    });

    const btns = c.createDiv({ cls: "sauce-buttons" });
    btns.createEl("button", {
      text: "Preview",
      cls: "sauce-button sauce-button-secondary",
    }).onclick = async () => {
      try {
        const adapterCtor = ADAPTERS[this.adapterId];
        if (!adapterCtor) {
          previewBody.setText("unknown adapter");
          return;
        }
        const adapter = adapterCtor();
        this.preview = await adapter.parse(this.rawText, this.mapping);
        previewBody.setText(
          `${this.preview.length} entities\n` +
            this.preview
              .slice(0, 5)
              .map(
                (e, i) =>
                  `[${i}] ${e.type}: ${JSON.stringify(e.frontmatter).slice(0, 180)}`,
              )
              .join("\n"),
        );
      } catch (e: unknown) {
        previewBody.setText(
          `parse error: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    };
    btns.createEl("button", { text: "Import", cls: "sauce-button" }).onclick =
      () => void this.commit();
    btns.createEl("button", {
      text: "Cancel",
      cls: "sauce-button sauce-button-secondary",
    }).onclick = () => this.close();
  }

  private async commit(): Promise<void> {
    if (this.preview.length === 0) {
      const adapterCtor = ADAPTERS[this.adapterId];
      if (!adapterCtor) {
        new Notice("unknown adapter");
        return;
      }
      try {
        const adapter = adapterCtor();
        this.preview = await adapter.parse(this.rawText, this.mapping);
      } catch (e: unknown) {
        new Notice(
          `parse error: ${e instanceof Error ? e.message : String(e)}`,
        );
        return;
      }
    }
    const paths = this.plugin.settings.paths;
    let created = 0,
      skipped = 0;
    for (const e of this.preview) {
      const name = String(
        e.frontmatter.name ??
          e.frontmatter.title ??
          e.frontmatter.email ??
          "entity",
      ).trim();
      if (!name) {
        skipped++;
        continue;
      }
      const folder =
        e.type === "person"
          ? paths.people
          : e.type === "org"
            ? paths.orgs
            : paths.touches;
      const slug = name
        .replace(/[^A-Za-z0-9 _-]/g, "")
        .trim()
        .replace(/\s+/g, " ");
      if (!slug) {
        skipped++;
        continue;
      }
      const target = normalizePath(`${folder}/${slug}.md`);
      const existing = this.app.vault.getAbstractFileByPath(target);
      if (existing) {
        skipped++;
        continue;
      }
      await this.plugin.entityService.createEntity(
        folder,
        slug,
        e.frontmatter,
        e.body ?? "",
      );
      created++;
    }
    new Notice(`Imported: ${created} created, ${skipped} skipped`);
    this.close();
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
