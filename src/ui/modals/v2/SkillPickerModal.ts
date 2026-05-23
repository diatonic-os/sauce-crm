// SPEC §20.3/20.4 — Skill fuzzy picker → arg modal → execute. Honors per-skill autonomy.
import { App, FuzzySuggestModal, Modal, Setting, Notice } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import type { Skill } from "../../../skills";

export class SkillPickerModal extends FuzzySuggestModal<Skill> {
  constructor(
    app: App,
    private plugin: SauceGraphPlugin,
  ) {
    super(app);
    this.setPlaceholder("Pick a skill to run…");
  }

  getItems(): Skill[] {
    return this.plugin.skills?.enabled() ?? [];
  }

  getItemText(item: Skill): string {
    return `${item.id}  —  ${item.description}`;
  }

  onChooseItem(item: Skill): void {
    new SkillArgsModal(this.app, this.plugin, item).open();
  }
}

class SkillArgsModal extends Modal {
  private values: Record<string, unknown> = {};

  constructor(
    app: App,
    private plugin: SauceGraphPlugin,
    private skill: Skill,
  ) {
    super(app);
  }

  onOpen(): void {
    const c = this.contentEl;
    c.addClass("sauce-modal");
    c.createEl("h2", { text: `Run skill — ${this.skill.id}` });
    if (this.skill.description)
      c.createEl("p", {
        text: this.skill.description,
        cls: "sauce-skill-desc",
      });

    for (const input of this.skill.contract.inputs) {
      const setting = new Setting(c)
        .setName(`${input.name}${input.required ? " *" : ""}`)
        .setDesc(
          `${input.type}${input.description ? "  — " + input.description : ""}`,
        );
      if (input.type === "boolean") {
        setting.addToggle((t) =>
          t
            .setValue(Boolean(input.default ?? false))
            .onChange((v) => (this.values[input.name] = v)),
        );
      } else if (input.type === "number") {
        setting.addText((t) =>
          t
            .setValue(String(input.default ?? ""))
            .onChange((v) => (this.values[input.name] = Number(v))),
        );
      } else if (input.type === "array") {
        setting.addText((t) =>
          t.setPlaceholder("comma,separated").onChange(
            (v) =>
              (this.values[input.name] = v
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)),
          ),
        );
      } else if (input.type === "object") {
        setting.addTextArea((t) =>
          t.setPlaceholder("JSON").onChange((v) => {
            try {
              this.values[input.name] = JSON.parse(v);
            } catch {
              /* keep raw on parse fail */ this.values[input.name] = v;
            }
          }),
        );
      } else {
        setting.addText((t) =>
          t
            .setValue(String(input.default ?? ""))
            .onChange((v) => (this.values[input.name] = v)),
        );
      }
    }

    const autonomy =
      this.plugin.skills?.registry.getSettings(this.skill.id).autonomy ??
      "propose";
    c.createEl("p", {
      cls: "sauce-skill-autonomy",
      text: `Autonomy: ${autonomy}`,
    });

    const btns = c.createDiv({ cls: "sauce-buttons" });
    btns.createEl("button", { text: "Run", cls: "sauce-button" }).onclick =
      () => this.run();
    btns.createEl("button", {
      text: "Cancel",
      cls: "sauce-button sauce-button-secondary",
    }).onclick = () => this.close();
  }

  private async run(): Promise<void> {
    if (!this.plugin.skills) {
      new Notice("Skills runtime not initialized");
      return;
    }
    new Notice(`Running ${this.skill.id}…`);
    const r = await this.plugin.skills.run(this.skill.id, this.values);
    if (r.ok) {
      const ml = r.mutated.length ? `\nMutated: ${r.mutated.join(", ")}` : "";
      new Notice(`${this.skill.id} ✓${ml}`);
      const out = this.contentEl.createEl("pre", { cls: "sauce-skill-output" });
      out.setText(JSON.stringify(r.payload, null, 2).slice(0, 4000));
    } else {
      new Notice(`${this.skill.id} ✗ ${r.reason}`);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
