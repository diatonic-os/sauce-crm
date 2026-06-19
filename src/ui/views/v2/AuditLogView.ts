// SPEC §18.5 — Audit log viewer. Reads from V2Runtime.auditLog (HMAC-chained append-only).
import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import { type ViewTypeId, asViewTypeId } from "@/types/brands";
import { SauceViewHelp } from "../../components/v2/SauceViewHelp";

export const VIEW_AUDIT_LOG: ViewTypeId = asViewTypeId("sauce-audit-log");

const PAGE_SIZE = 50;

export class AuditLogView extends ItemView {
  private page = 0;
  private help!: SauceViewHelp;

  constructor(
    leaf: WorkspaceLeaf,
    public plugin: SauceGraphPlugin,
  ) {
    super(leaf);
  }
  getViewType(): string {
    return VIEW_AUDIT_LOG;
  }
  getDisplayText(): string {
    return "Sauce: Audit Log";
  }
  override getIcon(): string {
    return "shield";
  }

  override async onOpen(): Promise<void> {
    await this.render();
  }

  override async onClose(): Promise<void> {
    /* no-op */
  }

  private async render(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("sauce-view");
    root.addClass("sauce-audit-log");
    this.help = new SauceViewHelp();
    this.help.mountHeader(root, {
      title: "Audit Log",
      icon: "shield",
      subtitle: "Tamper-evident log of every change",
    });

    const audit = this.plugin.v2?.auditLog ?? null;
    if (!audit) {
      root.createEl("p", {
        text: "Audit log not yet initialized (requires LanceDB backend).",
      });
      return;
    }

    const toolbar = root.createDiv({ cls: "sauce-audit-toolbar" });
    const refreshBtn = toolbar.createEl("button", {
      cls: "sauce-button",
      text: "Refresh",
    });
    refreshBtn.onclick = () => {
      void this.render();
    };
    this.help.register(
      refreshBtn,
      "Refresh",
      "Reload the audit log to show the most recent entries.",
    );

    const verifyBtn = toolbar.createEl("button", {
      cls: "sauce-button sauce-button-secondary",
      text: "Verify Chain",
    });
    this.help.register(
      verifyBtn,
      "Verify Chain",
      "Check that no audit entries have been altered or removed since they were written.",
    );
    verifyBtn.onclick = async () => {
      try {
        const fn = (
          audit as unknown as {
            verifyChain?: () => Promise<{
              ok: boolean;
              brokenAt: number | null;
            }>;
          }
        ).verifyChain;
        if (typeof fn !== "function") {
          new Notice("verify not yet implemented");
          return;
        }
        const result = await fn.call(audit);
        if (result.ok) {
          new Notice("Audit chain verified: OK");
        } else {
          new Notice(`Audit chain BROKEN at ts=${result.brokenAt}`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        new Notice(`Verify failed: ${msg}`);
        root.createDiv({ cls: "sauce-error", text: `Verify failed: ${msg}` });
      }
    };

    // The AuditLog class currently exposes only append() + verifyChain(); no read API.
    // Check for common read-method names defensively; if none, surface message.
    const candidate = audit as unknown as {
      recent?: (n: number) => Promise<unknown[]>;
      list?: (offset: number, limit: number) => Promise<unknown[]>;
      all?: () => Promise<unknown[]>;
    };
    const readFn = candidate.recent ?? candidate.list ?? candidate.all ?? null;

    if (!readFn) {
      root.createEl("p", {
        cls: "sauce-audit-note",
        text: "Audit log read API not yet implemented on AuditLog. Only append() + verifyChain() are available. Chain verification can still be run via the toolbar.",
      });
      return;
    }

    let rows: unknown[] = [];
    try {
      if (candidate.recent) {
        rows = await candidate.recent(PAGE_SIZE * (this.page + 1));
      } else if (candidate.list) {
        rows = await candidate.list(this.page * PAGE_SIZE, PAGE_SIZE);
      } else if (candidate.all) {
        rows = await candidate.all();
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      new Notice(`Audit query failed: ${msg}`);
      root.createDiv({
        cls: "sauce-error",
        text: `Audit query failed: ${msg}`,
      });
      return;
    }

    root.createEl("h3", { text: `Recent entries (${rows.length})` });
    const tbl = root.createEl("table", { cls: "sauce-audit-table" });
    const head = tbl.createEl("thead").createEl("tr");
    for (const h of [
      "ts",
      "op",
      "entityId",
      "agentId",
      "integration",
      "signature",
    ]) {
      head.createEl("th", { text: h });
    }
    const body = tbl.createEl("tbody");
    if (rows.length === 0) {
      const tr = body.createEl("tr");
      tr.createEl("td", { text: "(no audit entries)" });
      return;
    }
    for (const raw of rows) {
      const r = raw as {
        ts?: number;
        op?: string;
        entityId?: string | null;
        agentId?: string | null;
        integration?: string | null;
        signature?: string;
      };
      const tr = body.createEl("tr");
      tr.createEl("td", { text: r.ts ? new Date(r.ts).toLocaleString() : "" });
      tr.createEl("td", { text: r.op ?? "" });
      tr.createEl("td", { text: r.entityId ?? "" });
      tr.createEl("td", { text: r.agentId ?? "" });
      tr.createEl("td", { text: r.integration ?? "" });
      tr.createEl("td", { text: (r.signature ?? "").slice(0, 16) });
    }
  }
}
