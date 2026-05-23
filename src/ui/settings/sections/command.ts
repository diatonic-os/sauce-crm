// Command settings tab — the slash-command table (Name | In menu | Slash cmd |
// Actions), modeling the Copilot command registry. Toggles persist immediately;
// add / edit / duplicate / delete mutate plugin.settings.copilot.slashCommands.
import { Modal, Setting, setIcon, Notice } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import { defaultSlashCommands, type SlashCommand } from "../../../copilot/SlashCommands";

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "cmd";
}

class SlashCommandModal extends Modal {
  constructor(
    app: SauceGraphPlugin["app"],
    private cmd: SlashCommand,
    private onSave: (c: SlashCommand) => void,
  ) {
    super(app);
  }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.createEl("h3", { text: this.cmd.name ? "Edit command" : "New command" });
    let name = this.cmd.name;
    let prompt = this.cmd.prompt;
    new Setting(contentEl).setName("Name").addText((t) => t.setValue(name).onChange((v) => (name = v)));
    new Setting(contentEl)
      .setName("Prompt")
      .setDesc("Use {} where the selected text / active note should be inserted.")
      .addTextArea((t) => {
        t.setValue(prompt).onChange((v) => (prompt = v));
        t.inputEl.rows = 6;
        t.inputEl.addClass("sauce-cmd-prompt");
      });
    new Setting(contentEl).addButton((b) =>
      b
        .setButtonText("Save")
        .setCta()
        .onClick(() => {
          if (!name.trim()) {
            new Notice("Command name is required.");
            return;
          }
          this.onSave({ ...this.cmd, name: name.trim(), prompt });
          this.close();
        }),
    );
  }
  onClose(): void {
    this.contentEl.empty();
  }
}

export function renderCommand(containerEl: HTMLElement, plugin: SauceGraphPlugin): void {
  plugin.logger?.debug?.("settings.section_render", { section: "command" });
  const cop = plugin.settings.copilot;
  if (!cop.slashCommands) cop.slashCommands = defaultSlashCommands();
  const cmds = cop.slashCommands;
  const save = () => plugin.saveSettings();
  const rerender = () => {
    containerEl.empty();
    renderCommand(containerEl, plugin);
  };

  containerEl.createEl("h3", { text: "Commands", cls: "sauce-settings-section-title" });
  const callout = containerEl.createDiv({ cls: "sauce-callout" });
  callout.createSpan({
    text: "Commands power /slash actions and the editor right-click menu. Toggle where each appears, edit the prompt, or add your own. {} is replaced with the selected text.",
  });

  const actions = containerEl.createDiv({ cls: "sauce-hero-row sauce-row-end" });
  const genBtn = actions.createEl("button", { text: "Generate defaults", cls: "sauce-btn sauce-btn--secondary" });
  genBtn.onclick = async () => {
    cop.slashCommands = defaultSlashCommands();
    await save();
    rerender();
  };
  const addBtn = actions.createEl("button", { text: "＋ Add command", cls: "sauce-btn sauce-btn--primary" });
  addBtn.onclick = () =>
    new SlashCommandModal(plugin.app, { id: "", name: "", prompt: "{}", inMenu: true, slashCmd: true }, async (c) => {
      c.id = slug(c.name);
      cmds.push(c);
      await save();
      rerender();
    }).open();

  const table = containerEl.createEl("table", { cls: "sauce-settings-table" });
  const headRow = table.createEl("thead").createEl("tr");
  headRow.createEl("th", { text: "Name" });
  headRow.createEl("th", { text: "In menu", cls: "col-center" });
  headRow.createEl("th", { text: "Slash cmd", cls: "col-center" });
  headRow.createEl("th", { text: "Actions", cls: "col-center" });
  const body = table.createEl("tbody");

  cmds.forEach((cmd, i) => {
    const tr = body.createEl("tr");
    tr.createEl("td", { text: cmd.name });

    const menuCell = tr.createEl("td", { cls: "col-center" });
    const menuBox = menuCell.createEl("input", { type: "checkbox" });
    menuBox.checked = cmd.inMenu;
    menuBox.onchange = async () => {
      cmd.inMenu = menuBox.checked;
      await save();
    };

    const slashCell = tr.createEl("td", { cls: "col-center" });
    const slashBox = slashCell.createEl("input", { type: "checkbox" });
    slashBox.checked = cmd.slashCmd;
    slashBox.onchange = async () => {
      cmd.slashCmd = slashBox.checked;
      await save();
    };

    const actCell = tr.createEl("td", { cls: "col-center" });
    const iconBtn = (icon: string, label: string, fn: () => void): void => {
      const b = actCell.createEl("button", { cls: "sauce-icon-btn", attr: { "aria-label": label, title: label } });
      setIcon(b, icon);
      b.onclick = fn;
    };
    iconBtn("pencil", "Edit", () =>
      new SlashCommandModal(plugin.app, { ...cmd }, async (c) => {
        cmds[i] = { ...c, id: cmd.id };
        await save();
        rerender();
      }).open(),
    );
    iconBtn("copy", "Duplicate", async () => {
      cmds.splice(i + 1, 0, { ...cmd, id: slug(`${cmd.name}-copy`), name: `${cmd.name} (copy)` });
      await save();
      rerender();
    });
    iconBtn("trash", "Delete", async () => {
      cmds.splice(i, 1);
      await save();
      rerender();
    });
  });
}
