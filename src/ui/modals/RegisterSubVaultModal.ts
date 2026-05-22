import { App, Modal, Setting, Notice } from "obsidian";
import type SauceGraphPlugin from "../../main";
import { slugify } from "../../util/Yaml";

export class RegisterSubVaultModal extends Modal {
  private vault_id = "";
  private path = "";
  private role = "secondary";

  constructor(public app: App, public plugin: SauceGraphPlugin) { super(app); }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.addClass("sauce-modal");
    contentEl.createEl("h2", { text: "Register SubVault" });
    new Setting(contentEl).setName("Vault id (slug)").addText((t) => t.onChange((v) => (this.vault_id = slugify(v).toLowerCase().replace(/\s/g, "-"))));
    new Setting(contentEl).setName("Path (relative to ParentVault)").addText((t) => t.setValue("./").onChange((v) => (this.path = v)));
    new Setting(contentEl).setName("Role").addDropdown((d) => d.addOption("primary", "primary").addOption("secondary", "secondary").addOption("archive", "archive").setValue("secondary").onChange((v) => (this.role = v)));

    const btns = contentEl.createDiv({ cls: "sauce-buttons" });
    btns.createEl("button", { text: "Register", cls: "sauce-button" }).onclick = () => this.save();
    btns.createEl("button", { text: "Cancel", cls: "sauce-button sauce-button-secondary" }).onclick = () => this.close();
  }

  async save(): Promise<void> {
    if (!this.vault_id) { new Notice("vault_id required"); return; }
    const f = await this.plugin.registry.registerSubVault({ vault_id: this.vault_id, path: this.path, role: this.role });
    new Notice(`Registered ${this.vault_id} → ${f.path}`);
    this.close();
  }

  onClose(): void { this.contentEl.empty(); }
}
