// SPEC §31 — AI Inbox: surfaces proposed inferences from InferenceEngine
// for human review. Per-row accept/reject + bulk operations.

import { ItemView, WorkspaceLeaf, Notice } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import { InferenceEngine, type InferenceEntity } from "../../../inference";
import type { TouchRecord } from "../../../inference/EdgeInferrer";
import { wrapWikilink, parseWikilink } from "../../../util/Wikilink";
import { uniq } from "../../../util/Yaml";

export const VIEW_AI_INBOX = "sauce-ai-inbox";

interface Row {
  ix: number;
  proposal: InferenceEntity;
  el: HTMLDivElement;
}

// Parse "from--edgeType-->to" without regex.
function parseEdgeTarget(
  s: string,
): { from: string; edgeType: string; to: string } | null {
  const arrow = "-->";
  const arrowAt = s.indexOf(arrow);
  if (arrowAt < 0) return null;
  const left = s.slice(0, arrowAt);
  const to = s.slice(arrowAt + arrow.length);
  const dashDash = "--";
  const ddAt = left.indexOf(dashDash);
  if (ddAt < 0) return null;
  const from = left.slice(0, ddAt);
  const edgeType = left.slice(ddAt + dashDash.length);
  if (!from || !edgeType || !to) return null;
  return { from, edgeType, to };
}

export class AIInboxView extends ItemView {
  private engine = new InferenceEngine();
  private rows: Row[] = [];
  private selected = new Set<number>();

  constructor(
    leaf: WorkspaceLeaf,
    public plugin: SauceGraphPlugin,
  ) {
    super(leaf);
  }
  getViewType(): string {
    return VIEW_AI_INBOX;
  }
  getDisplayText(): string {
    return "Sauce: AI Inbox";
  }
  getIcon(): string {
    return "inbox";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("sauce-view");
    root.addClass("sauce-ai-inbox");
    root.createEl("h2", { text: "AI Inbox — Proposed Inferences" });

    const proposals = this.gatherProposals();
    root.createEl("p", {
      cls: "sauce-view-desc",
      text: `${proposals.length} proposals`,
    });

    const toolbar = root.createDiv({ cls: "sauce-inbox-toolbar" });
    const selectAll = toolbar.createEl("button", {
      cls: "sauce-button sauce-button-secondary",
      text: "Select all",
    });
    const acceptSel = toolbar.createEl("button", {
      cls: "sauce-button",
      text: "Accept selected",
    });
    const rejectSel = toolbar.createEl("button", {
      cls: "sauce-button sauce-button-secondary",
      text: "Reject selected",
    });

    const list = root.createDiv({ cls: "sauce-inbox-list" });

    proposals.sort((a, b) => b.confidence - a.confidence);
    this.rows = proposals.map((p, i) => ({
      ix: i,
      proposal: p,
      el: this.renderRow(list, i, p),
    }));

    selectAll.onclick = () => {
      const next = this.selected.size < this.rows.length;
      this.selected.clear();
      if (next) for (const r of this.rows) this.selected.add(r.ix);
      this.refreshSelection();
    };
    acceptSel.onclick = () => void this.bulk("accept");
    rejectSel.onclick = () => void this.bulk("reject");
  }

  async onClose(): Promise<void> {}

  private gatherProposals(): InferenceEntity[] {
    const touches: TouchRecord[] = this.plugin.entityService
      .allTouches()
      .map((t) => {
        const fm = t.frontmatter as any;
        const attendees: string[] = Array.isArray(fm.attendees)
          ? fm.attendees.map(
              (a: string) => parseWikilink(String(a)) ?? String(a),
            )
          : [];
        return {
          id: t.file.path,
          contactId: String(fm.contact ?? ""),
          date: String(fm.date ?? ""),
          attendees,
        };
      });
    const edgeProposals = this.engine.edgeProposals(touches);
    const mergeProposals = this.engine.mergeProposals(
      this.plugin.entityService.allPeople().map((p) => {
        const fm = p.frontmatter as any;
        const emails = fm.email ? [String(fm.email)] : [];
        const phones = fm.phone ? [String(fm.phone)] : [];
        return {
          id: p.file.basename,
          name: p.file.basename,
          emails,
          phones,
          type: "person" as const,
        };
      }),
    );
    return [...edgeProposals, ...mergeProposals];
  }

  private renderRow(
    list: HTMLDivElement,
    ix: number,
    p: InferenceEntity,
  ): HTMLDivElement {
    const row = list.createDiv({ cls: "sauce-inbox-row" });
    const cb = row.createEl("input", { type: "checkbox" }) as HTMLInputElement;
    cb.onchange = () => {
      cb.checked ? this.selected.add(ix) : this.selected.delete(ix);
    };

    const info = row.createDiv({ cls: "sauce-inbox-info" });
    info.createEl("div", {
      cls: "sauce-inbox-kind",
      text: `${p.inference_kind}  ·  ${(p.confidence * 100).toFixed(0)}%`,
    });
    info.createEl("div", { cls: "sauce-inbox-target", text: p.target });
    info.createEl("div", {
      cls: "sauce-inbox-value",
      text: JSON.stringify(p.proposed_value).slice(0, 200),
    });
    if (p.sources.length)
      info.createEl("div", {
        cls: "sauce-inbox-sources",
        text: `sources: ${p.sources.slice(0, 3).join(", ")}`,
      });

    const accept = row.createEl("button", {
      cls: "sauce-button",
      text: "Accept",
    });
    accept.onclick = () => void this.applyOne(p);
    const reject = row.createEl("button", {
      cls: "sauce-button sauce-button-secondary",
      text: "Reject",
    });
    reject.onclick = () => row.remove();

    return row;
  }

  private refreshSelection(): void {
    for (const r of this.rows) {
      const cb = r.el.querySelector(
        "input[type=checkbox]",
      ) as HTMLInputElement | null;
      if (cb) cb.checked = this.selected.has(r.ix);
    }
  }

  private async bulk(op: "accept" | "reject"): Promise<void> {
    let n = 0;
    for (const r of this.rows) {
      if (!this.selected.has(r.ix)) continue;
      if (op === "accept") await this.applyOne(r.proposal);
      r.el.remove();
      n++;
    }
    this.selected.clear();
    new Notice(`${op} ${n} proposal(s)`);
  }

  private async applyOne(p: InferenceEntity): Promise<void> {
    if (p.inference_kind === "edge") {
      const parsed = parseEdgeTarget(p.target);
      if (!parsed) return;
      const file = this.app.metadataCache.getFirstLinkpathDest(parsed.from, "");
      if (!file) return;
      const dst = wrapWikilink(parsed.to);
      await this.plugin.entityService.updateFrontmatter(file, (fm) => {
        const cur = Array.isArray(fm[parsed.edgeType])
          ? fm[parsed.edgeType]
          : fm[parsed.edgeType]
            ? [fm[parsed.edgeType]]
            : [];
        fm[parsed.edgeType] = uniq([...cur, dst]);
      });
      this.plugin.edgeSync.scheduleReconcile(file);
    } else if (p.inference_kind === "merge") {
      new Notice(
        `Merge proposed: ${p.target} → ${JSON.stringify(p.proposed_value)} (manual review required)`,
      );
    } else if (p.inference_kind === "attribute") {
      const file = this.app.metadataCache.getFirstLinkpathDest(p.target, "");
      if (!file) return;
      const val = p.proposed_value as { attribute: string; value: any };
      await this.plugin.entityService.updateFrontmatter(file, (fm) => {
        fm[val.attribute] = val.value;
      });
    }
  }
}
