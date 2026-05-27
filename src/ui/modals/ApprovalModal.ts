// ApprovalModal — the four-button UI the ApprovalGate prompts with when
// no sticky decision exists for the requested action class.

import { Modal, type App } from "obsidian";
import type {
  ApprovalRequest,
  ApprovalUI,
  ApprovalVerdict,
} from "../../contract/ApprovalGate";

const RISK_COLOR: Record<"low" | "medium" | "high", string> = {
  low: "ok",
  medium: "warn",
  high: "error",
};

export class ApprovalModalUI implements ApprovalUI {
  constructor(private readonly app: App) {}

  prompt(req: ApprovalRequest): Promise<ApprovalVerdict> {
    return new Promise<ApprovalVerdict>((resolve) => {
      new ApprovalModal(this.app, req, resolve).open();
    });
  }
}

class ApprovalModal extends Modal {
  constructor(
    app: App,
    private readonly req: ApprovalRequest,
    private readonly resolve: (v: ApprovalVerdict) => void,
  ) {
    super(app);
  }

  private decided = false;

  override onOpen(): void {
    this.modalEl.addClass("sauce-modal");
    this.titleEl.setText("Sauce CRM — Action Approval");
    const c = this.contentEl;
    c.empty();

    const head = c.createDiv({ cls: "sauce-section" });
    const row = head.createDiv({ cls: "sauce-section-header" });
    row.createEl("h3", { text: this.req.actionClass });
    if (this.req.risk) {
      const badge = row.createSpan({
        cls: `sauce-badge sauce-badge--${RISK_COLOR[this.req.risk]}`,
        text: `${this.req.risk} risk`,
      });
      badge.setAttr("aria-label", `risk: ${this.req.risk}`);
    }
    head.createEl("p", { text: this.req.summary });
    if (this.req.details) {
      const pre = head.createEl("pre", {
        attr: {
          style: "max-height: 200px; overflow: auto; font-size: 0.85em;",
        },
      });
      pre.setText(this.req.details);
    }

    const footer = c.createDiv({ cls: "sauce-modal-footer sauce-button-row" });
    const mkBtn = (
      label: string,
      cls: string,
      verdict: ApprovalVerdict,
    ): void => {
      const btn = footer.createEl("button", { cls, text: label });
      btn.onclick = () => this.decide(verdict);
    };
    mkBtn("Approve once", "sauce-button", "approve-once");
    mkBtn("Approve always", "sauce-button", "approve-always");
    mkBtn("Deny once", "sauce-button-secondary", "deny-once");
    mkBtn("Deny always", "sauce-button-danger", "deny-always");
  }

  private decide(v: ApprovalVerdict): void {
    if (this.decided) return;
    this.decided = true;
    this.resolve(v);
    this.close();
  }

  override onClose(): void {
    if (!this.decided) {
      // X-out counts as deny-once — refuse the action, ask again later.
      this.resolve("deny-once");
    }
    this.contentEl.empty();
  }
}
