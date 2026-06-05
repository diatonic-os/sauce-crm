// SEC-05 — Master-password manager. Wires the real KeyVault change/reset/lock
// flows that the Settings → Security "Manage…" button used to only stub with a
// Notice. Three actions:
//   • Change   — verify old password, re-encrypt all secrets under a new one.
//   • Lock     — drop the in-memory master key (re-unlock required).
//   • Reset    — DESTRUCTIVE: wipe the encrypted store + sentinel. Requires the
//                operator to type RESET to confirm; all stored secrets are lost.
//
// Safe: no dynamic regex, no exec. All crypto is delegated to KeyVault, which
// uses PBKDF2-SHA256 (600k iterations) + AES-256-GCM.

import { App, Modal, Notice, Setting } from "obsidian";
import { InlineStatus } from "../../components/v2/InlineStatus";
import type { KeyVault } from "../../../security/KeyVault";

export class MasterPasswordModal extends Modal {
  // Change-password drafts.
  private oldPw = "";
  private newPw = "";
  private newPwConfirm = "";
  // Reset confirmation input.
  private resetConfirm = "";

  constructor(
    app: App,
    private readonly keyVault: KeyVault,
    /** Re-render the host settings page after a state change (lock/reset). */
    private readonly onChanged?: () => void,
  ) {
    super(app);
  }

  override onOpen(): void {
    this.modalEl.addClass("sauce-modal");
    this.contentEl.addClass("sauce-master-password-modal");
    void this.render();
  }

  override onClose(): void {
    this.contentEl.empty();
    // Best-effort scrub of drafted secrets from memory.
    this.oldPw = this.newPw = this.newPwConfirm = this.resetConfirm = "";
  }

  private async render(): Promise<void> {
    const c = this.contentEl;
    c.empty();
    c.createEl("h2", { text: "Master password" });

    const locked = this.keyVault.isLocked();
    const hasVault = await this.keyVault.hasVault();

    if (!hasVault) {
      c.createEl("p", {
        text: "No vault has been provisioned yet. Set a master password from the onboarding wizard or when first saving an encrypted secret.",
      });
      this.closeRow(c);
      return;
    }

    c.createEl("p", {
      cls: "sauce-field-help",
      text: locked
        ? "Vault is locked. Unlock it first to change the password; you can still reset it below."
        : "Vault is unlocked.",
    });

    // ---- Change password ----
    c.createEl("h3", { text: "Change password" });
    c.createEl("p", {
      cls: "sauce-field-help",
      text: "Re-encrypts every stored secret under a new master password. Requires your current password.",
    });
    const changeStatus = new InlineStatus(c);

    new Setting(c).setName("Current password").addText((t) => {
      t.inputEl.type = "password";
      t.setPlaceholder("current master password").onChange((v) => {
        this.oldPw = v;
      });
    });
    new Setting(c).setName("New password").addText((t) => {
      t.inputEl.type = "password";
      t.setPlaceholder("new master password").onChange((v) => {
        this.newPw = v;
      });
    });
    new Setting(c).setName("Confirm new password").addText((t) => {
      t.inputEl.type = "password";
      t.setPlaceholder("re-enter new password").onChange((v) => {
        this.newPwConfirm = v;
      });
    });
    new Setting(c).addButton((b) =>
      b
        .setButtonText("Change password")
        .setCta()
        .onClick(async () => {
          if (!this.oldPw) {
            changeStatus.error("Enter your current password.");
            return;
          }
          if (!this.newPw) {
            changeStatus.error("Enter a new password.");
            return;
          }
          if (this.newPw !== this.newPwConfirm) {
            changeStatus.error("New passwords do not match.");
            return;
          }
          if (this.newPw === this.oldPw) {
            changeStatus.error(
              "New password must differ from the current one.",
            );
            return;
          }
          changeStatus.pending("Re-encrypting secrets…");
          try {
            await this.keyVault.changeMasterPassword(this.oldPw, this.newPw);
            changeStatus.success("Master password changed.");
            new Notice("Master password changed.");
            this.oldPw = this.newPw = this.newPwConfirm = "";
            this.onChanged?.();
            void this.render();
          } catch (e: unknown) {
            changeStatus.error(this.msg(e));
          }
        }),
    );

    // ---- Lock ----
    if (!locked) {
      c.createEl("h3", { text: "Lock vault" });
      new Setting(c)
        .setName("Lock now")
        .setDesc(
          "Drops the in-memory key. You'll need to unlock again to use secrets.",
        )
        .addButton((b) =>
          b.setButtonText("Lock").onClick(() => {
            this.keyVault.lock();
            new Notice("Vault locked.");
            this.onChanged?.();
            void this.render();
          }),
        );
    }

    // ---- Reset (destructive) ----
    c.createEl("h3", { text: "Reset vault", cls: "sg-danger-heading" });
    const warn = c.createEl("p", { cls: "sauce-security-notice" });
    warn.textContent =
      "DANGER: Resetting wipes the encrypted store and the master-password sentinel. " +
      "ALL stored secrets (API keys, app passwords) are permanently lost and cannot be recovered. " +
      "A fresh master password can be set afterward. Type RESET to confirm.";
    const resetStatus = new InlineStatus(c);
    new Setting(c).setName('Type "RESET" to confirm').addText((t) => {
      t.setPlaceholder("RESET").onChange((v) => {
        this.resetConfirm = v;
      });
    });
    new Setting(c).addButton((b) => {
      b.setButtonText("Reset vault (destroy all secrets)")
        .setWarning()
        .onClick(async () => {
          if (this.resetConfirm !== "RESET") {
            resetStatus.error("You must type RESET exactly to confirm.");
            return;
          }
          resetStatus.pending("Wiping vault…");
          try {
            await this.keyVault.resetVault();
            resetStatus.success("Vault reset. All secrets were destroyed.");
            new Notice("Vault reset — all stored secrets destroyed.");
            this.resetConfirm = "";
            this.onChanged?.();
            void this.render();
          } catch (e: unknown) {
            resetStatus.error(this.msg(e));
          }
        });
    });

    this.closeRow(c);
  }

  private closeRow(c: HTMLElement): void {
    const btns = c.createDiv({ cls: "sauce-buttons" });
    btns.createEl("button", {
      text: "Close",
      cls: "sauce-button sauce-button-secondary",
    }).onclick = () => this.close();
  }

  private msg(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
  }
}
