// CMP-21 — ConfirmModal
// Confirmation dialog with optional destructive styling and optional
// type-to-confirm gate. Standard Obsidian Modal subclass.

import { App, Modal } from "obsidian";

export interface ConfirmModalInput {
  title: string;
  body: string;
  confirmLabel?: string;
  destructive?: boolean;
  requireTypeWord?: string;
  onConfirm: () => void | Promise<void>;
}

export class ConfirmModal extends Modal {
  private input: ConfirmModalInput;

  constructor(app: App, input: ConfirmModalInput) {
    super(app);
    this.input = input;
  }

  override onOpen(): void {
    const { contentEl, titleEl } = this;
    const {
      title,
      body,
      confirmLabel = "Confirm",
      destructive = false,
      requireTypeWord,
      onConfirm,
    } = this.input;

    titleEl.setText(title);
    contentEl.empty();
    contentEl.addClass("sg-confirm-modal");
    if (destructive) contentEl.addClass("sg-confirm-modal-destructive");

    contentEl.createEl("p", { cls: "sg-confirm-body", text: body });

    let typeInput: HTMLInputElement | null = null;
    if (requireTypeWord) {
      const wrap = contentEl.createDiv({ cls: "sg-confirm-type-wrap" });
      wrap.createEl("label", {
        cls: "sg-confirm-type-label",
        text: `Type ${requireTypeWord} to confirm:`,
      });
      typeInput = wrap.createEl("input", { cls: "sg-confirm-type-input" });
      typeInput.type = "text";
      typeInput.setAttribute(
        "aria-label",
        `Type ${requireTypeWord} to confirm`,
      );
    }

    const actions = contentEl.createDiv({ cls: "sg-confirm-actions" });

    const cancel = actions.createEl("button", {
      cls: "sg-confirm-cancel",
      text: "Cancel",
    });
    cancel.onclick = () => this.close();

    const confirm = actions.createEl("button", {
      cls: destructive
        ? "sg-confirm-action mod-warning"
        : "sg-confirm-action mod-cta",
      text: confirmLabel,
    });

    const updateConfirmEnabled = () => {
      if (!requireTypeWord) {
        confirm.disabled = false;
        return;
      }
      const v = typeInput?.value ?? "";
      confirm.disabled = v !== requireTypeWord;
    };
    updateConfirmEnabled();

    if (typeInput) {
      typeInput.addEventListener("input", updateConfirmEnabled);
    }

    confirm.onclick = async () => {
      if (confirm.disabled) return;
      confirm.disabled = true;
      try {
        await onConfirm();
      } finally {
        this.close();
      }
    };
  }

  override onClose(): void {
    this.contentEl.empty();
  }
}
