// SPEC §34 — Sync status. Wraps Scheduler.all() + a local subscription to ChangeFeed.
import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import type { Change } from "../../../sync";
import { type ViewTypeId, asViewTypeId } from "@/types/brands";
import { SauceViewHelp } from "../../components/v2/SauceViewHelp";

export const VIEW_SYNC_STATUS: ViewTypeId = asViewTypeId("sauce-sync-status");

const RING_MAX = 100;

export class SyncStatusView extends ItemView {
  private refreshTimer: number | null = null;
  private ring: Change[] = [];
  private unsubscribe: (() => void) | null = null;
  private help!: SauceViewHelp;

  constructor(
    leaf: WorkspaceLeaf,
    public plugin: SauceGraphPlugin,
  ) {
    super(leaf);
  }
  getViewType(): string {
    return VIEW_SYNC_STATUS;
  }
  getDisplayText(): string {
    return "Sauce: Sync Status";
  }
  override getIcon(): string {
    return "refresh-cw";
  }

  override async onOpen(): Promise<void> {
    const engine = this.plugin.v2?.sync ?? null;
    if (engine) {
      this.unsubscribe = engine.changes.subscribe((c) => {
        this.ring.push(c);
        if (this.ring.length > RING_MAX) this.ring.shift();
      });
    }
    this.render();
    this.refreshTimer = this.registerInterval(
      window.setInterval(() => this.render(), 4000),
    );
  }

  override async onClose(): Promise<void> {
    if (this.refreshTimer) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  private render(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("sauce-view");
    root.addClass("sauce-sync-status");
    this.help = new SauceViewHelp();
    this.help.mountHeader(root, {
      title: "Sync Status",
      icon: "refresh-cw",
      subtitle: "Monitor sync jobs and recent changes",
    });

    const engine = this.plugin.v2?.sync ?? null;
    if (!engine) {
      root.createEl("p", { text: "Sync engine not initialized." });
      return;
    }

    const toolbar = root.createDiv({ cls: "sauce-sync-toolbar" });
    const startBtn = toolbar.createEl("button", {
      cls: "sauce-button",
      text: "Start",
    });
    startBtn.onclick = () => {
      engine.start();
      new Notice("Sync engine started");
    };
    const stopBtn = toolbar.createEl("button", {
      cls: "sauce-button sauce-button-secondary",
      text: "Stop",
    });
    stopBtn.onclick = () => {
      engine.stop();
      new Notice("Sync engine stopped");
    };
    const syncAllBtn = toolbar.createEl("button", {
      cls: "sauce-button sauce-button-secondary",
      text: "Sync All Now",
    });
    syncAllBtn.onclick = async () => {
      if (!this.plugin.integrations) return;
      const r = await this.plugin.integrations.syncAll();
      new Notice(`Manual sync: ${r.reduce((s, x) => s + x.pulled, 0)} pulled`);
    };
    this.help.register(
      startBtn,
      "Start",
      "Turns on the background sync engine so your accounts stay up to date automatically.",
    );
    this.help.register(
      stopBtn,
      "Stop",
      "Pauses the background sync engine so nothing syncs until you start it again.",
    );
    this.help.register(
      syncAllBtn,
      "Sync All Now",
      "Immediately pulls the latest data from every connected account once.",
    );

    root.createEl("h3", { text: "Jobs" });
    const tbl = root.createEl("table", { cls: "sauce-sync-jobs" });
    const head = tbl.createEl("thead").createEl("tr");
    for (const h of [
      "job",
      "frequency",
      "next-run",
      "running",
      "failures",
      "last-error",
    ])
      head.createEl("th", { text: h });
    const body = tbl.createEl("tbody");
    const all = engine.scheduler.all();
    if (all.length === 0) {
      const tr = body.createEl("tr");
      tr.createEl("td", { text: "(no jobs registered)" });
    }
    for (const { job, state } of all) {
      const tr = body.createEl("tr");
      tr.createEl("td", { text: job.id });
      tr.createEl("td", { text: job.frequency });
      tr.createEl("td", {
        text: state.nextRun
          ? new Date(state.nextRun).toLocaleTimeString()
          : "—",
      });
      tr.createEl("td", { text: state.running ? "yes" : "no" });
      tr.createEl("td", { text: String(state.failures) });
      tr.createEl("td", { text: state.lastError ?? "" });
    }

    root.createEl("h3", {
      text: `Recent changes (ring buffer, ${this.ring.length})`,
    });
    const ul = root.createEl("ul", { cls: "sauce-sync-changes" });
    for (const c of this.ring.slice(-25).reverse()) {
      ul.createEl("li", {
        text: `${new Date(c.ts).toLocaleTimeString()}  ${c.kind}  ${c.integration ?? ""}/${c.resource ?? ""}  ${c.entityId}`,
      });
    }
  }
}
