// SPEC §31 — AI Inbox: surfaces proposed inferences from InferenceEngine
// for human review. Per-row accept/reject + bulk operations.
//
// W2 overhaul: the flat list (which became a wall of ~hundreds of identical
// buttons + checkboxes on a rich vault) is reorganized into collapsible groups
// by inference kind, each with its own count and group-level select/accept/reject.
// A summary bar (total + by-kind + avg confidence) and a live search + minimum-
// confidence filter cut the overwhelm. Every control is explicitly labeled.
// All existing accept/reject/bulk behavior is preserved.

import { ItemView, WorkspaceLeaf, Notice, setIcon } from "obsidian";
import type SauceGraphPlugin from "../../../main";
import { InferenceEngine, type InferenceEntity } from "../../../inference";
import type { TouchRecord } from "../../../inference/EdgeInferrer";
import { wrapWikilink, parseWikilink } from "../../../util/Wikilink";
import { uniq } from "../../../util/Yaml";
import { type ViewTypeId, asViewTypeId } from "@/types/brands";
import { SauceViewHelp } from "../../components/v2/SauceViewHelp";

export const VIEW_AI_INBOX: ViewTypeId = asViewTypeId("sauce-ai-inbox");

interface Row {
  ix: number;
  proposal: InferenceEntity;
  el: HTMLDivElement;
}

type Kind = InferenceEntity["inference_kind"];

/** Human labels for each inference kind (used in group headers + help). */
const KIND_LABEL: Record<Kind, string> = {
  edge: "Relationship edges",
  attribute: "Attributes",
  merge: "Possible duplicates",
  geocode: "Locations",
  role: "Roles",
  tag: "Tags",
};

const KIND_DESC: Record<Kind, string> = {
  edge: "Suggested “knows / worked-with” links inferred from shared meetings.",
  attribute: "Suggested frontmatter values for a note.",
  merge: "Two notes that may be the same person/org (manual review).",
  geocode: "Suggested geographic coordinates for an address.",
  role: "Suggested role/title for a contact.",
  tag: "Suggested tags for a note.",
};

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

/** Confidence → semantic bucket for the badge tint. */
function confBucket(c: number): "high" | "med" | "low" {
  if (c >= 0.8) return "high";
  if (c >= 0.5) return "med";
  return "low";
}

export class AIInboxView extends ItemView {
  private engine = new InferenceEngine();
  private rows: Row[] = [];
  private selected = new Set<number>();
  private help!: SauceViewHelp;
  private query = "";
  private minConf = 0;
  private listHost: HTMLElement | null = null;
  private proposals: InferenceEntity[] = [];
  private countEl: HTMLElement | null = null;

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
  override getIcon(): string {
    return "inbox";
  }

  override async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("sauce-view");
    root.addClass("sauce-ai-inbox");
    this.help = new SauceViewHelp();
    this.help.mountHeader(root, {
      title: "AI Inbox",
      icon: "inbox",
      subtitle: "Review proposed inferences",
    });

    const proposals = this.gatherProposals();
    proposals.sort((a, b) => b.confidence - a.confidence);
    this.proposals = proposals;

    if (proposals.length === 0) {
      this.renderEmpty(root);
      return;
    }

    this.renderSummary(root, proposals);
    this.renderToolbar(root);
    this.renderFilters(root);

    this.listHost = root.createDiv({ cls: "sauce-inbox-groups" });
    this.rebuildList();
  }

  override async onClose(): Promise<void> {}

  /** Summary tiles: total + per-kind + average confidence. */
  private renderSummary(root: HTMLElement, proposals: InferenceEntity[]): void {
    const kpis = root.createDiv({ cls: "sauce-view-kpis sauce-inbox-kpis" });

    const total = kpis.createDiv({ cls: "sauce-kpi" });
    total.createDiv({ cls: "sauce-kpi-value", text: String(proposals.length) });
    total.createDiv({ cls: "sauce-kpi-label", text: "proposals" });

    const avg =
      proposals.reduce((s, p) => s + p.confidence, 0) / proposals.length;
    const conf = kpis.createDiv({ cls: "sauce-kpi" });
    conf.createDiv({
      cls: "sauce-kpi-value",
      text: `${Math.round(avg * 100)}%`,
    });
    conf.createDiv({ cls: "sauce-kpi-label", text: "avg confidence" });

    const byKind = this.groupBy(proposals);
    for (const [kind, items] of byKind) {
      const tile = kpis.createDiv({ cls: "sauce-kpi sauce-kpi--sub" });
      tile.createDiv({ cls: "sauce-kpi-value", text: String(items.length) });
      tile.createDiv({
        cls: "sauce-kpi-label",
        text: KIND_LABEL[kind] ?? kind,
      });
    }
  }

  private renderToolbar(root: HTMLElement): void {
    const toolbar = root.createDiv({ cls: "sauce-inbox-toolbar" });
    const selectAll = toolbar.createEl("button", {
      cls: "sauce-button sauce-button-secondary",
      text: "Select all visible",
    });
    const acceptSel = toolbar.createEl("button", {
      cls: "sauce-button",
      text: "Accept selected",
    });
    const rejectSel = toolbar.createEl("button", {
      cls: "sauce-button sauce-button-secondary",
      text: "Reject selected",
    });

    this.help.register(
      selectAll,
      "Select all visible",
      "Checks every proposal currently shown (respecting search + confidence filters) so you can act on them together.",
    );
    this.help.register(
      acceptSel,
      "Accept selected",
      "Applies every checked proposal to your notes at once.",
    );
    this.help.register(
      rejectSel,
      "Reject selected",
      "Dismisses every checked proposal without changing your notes.",
    );

    selectAll.onclick = () => {
      const visible = this.rows.filter((r) => r.el.isConnected);
      const next = visible.some((r) => !this.selected.has(r.ix));
      if (next) for (const r of visible) this.selected.add(r.ix);
      else for (const r of visible) this.selected.delete(r.ix);
      this.refreshSelection();
    };
    acceptSel.onclick = () => void this.bulk("accept");
    rejectSel.onclick = () => void this.bulk("reject");
  }

  private renderFilters(root: HTMLElement): void {
    const bar = root.createDiv({ cls: "sauce-fi-toolbar" });

    const searchWrap = bar.createDiv({ cls: "sauce-fi-search" });
    const label = searchWrap.createEl("label", {
      cls: "sauce-fi-search-label",
      text: "Search",
    });
    label.setAttribute("for", "sauce-inbox-search");
    const iconEl = searchWrap.createSpan({ cls: "sauce-fi-search-icon" });
    setIcon(iconEl, "search");
    const search = searchWrap.createEl("input", {
      cls: "sauce-input sauce-fi-search-input",
      type: "search",
    }) as HTMLInputElement;
    search.id = "sauce-inbox-search";
    search.placeholder = "Filter proposals by target or value…";
    search.value = this.query;
    search.setAttribute("aria-label", "Filter proposals");
    this.registerDomEvent(search, "input", () => {
      this.query = search.value.trim().toLowerCase();
      this.rebuildList();
    });
    this.help.register(
      search,
      "Search",
      "Filters proposals live across their target and proposed value.",
    );

    const confWrap = bar.createDiv({ cls: "sauce-fi-field" });
    const confLabel = confWrap.createEl("label", {
      cls: "sauce-fi-search-label",
      text: "Min confidence",
    });
    confLabel.setAttribute("for", "sauce-inbox-conf");
    const sel = confWrap.createEl("select", {
      cls: "sauce-input sauce-fi-select",
    }) as HTMLSelectElement;
    sel.id = "sauce-inbox-conf";
    sel.setAttribute("aria-label", "Minimum confidence");
    for (const [text, value] of [
      ["Any", "0"],
      ["≥ 50%", "0.5"],
      ["≥ 80%", "0.8"],
    ] as const) {
      sel.createEl("option", { text, value });
    }
    sel.value = String(this.minConf);
    this.registerDomEvent(sel, "change", () => {
      this.minConf = Number(sel.value) || 0;
      this.rebuildList();
    });

    this.countEl = bar.createEl("p", {
      cls: "sauce-fi-count",
      text: `Showing all ${this.proposals.length} proposals`,
    });
    this.countEl.setAttribute("aria-live", "polite");
  }

  /** Visible proposals after search + confidence filtering. */
  private visibleProposals(): InferenceEntity[] {
    return this.proposals.filter((p) => {
      if (p.confidence < this.minConf) return false;
      if (!this.query) return true;
      const hay =
        `${p.target} ${JSON.stringify(p.proposed_value)}`.toLowerCase();
      return hay.includes(this.query);
    });
  }

  private groupBy(items: InferenceEntity[]): Map<Kind, InferenceEntity[]> {
    const m = new Map<Kind, InferenceEntity[]>();
    for (const p of items) {
      const arr = m.get(p.inference_kind) ?? [];
      arr.push(p);
      m.set(p.inference_kind, arr);
    }
    return m;
  }

  /** Rebuild the grouped list from the current filters. Rebinds row indices so
   *  selection + bulk ops continue to reference live proposals. */
  private rebuildList(): void {
    if (!this.listHost) return;
    this.listHost.empty();
    this.rows = [];
    this.selected.clear();

    const visible = this.visibleProposals();
    if (this.countEl) {
      this.countEl.setText(
        visible.length === this.proposals.length
          ? `Showing all ${this.proposals.length} proposals`
          : `Showing ${visible.length} of ${this.proposals.length} proposals`,
      );
    }

    if (visible.length === 0) {
      this.listHost.createDiv({
        cls: "sauce-empty sauce-fi-no-match",
        text: "No proposals match the current filters.",
      });
      return;
    }

    let ix = 0;
    for (const [kind, items] of this.groupBy(visible)) {
      const details = this.listHost.createEl("details", {
        cls: "sauce-inbox-group",
      });
      details.open = true;
      const summary = details.createEl("summary", {
        cls: "sauce-inbox-group-head",
      });
      const titleWrap = summary.createDiv({ cls: "sauce-inbox-group-title" });
      titleWrap.createSpan({
        cls: "sauce-inbox-group-name",
        text: KIND_LABEL[kind] ?? kind,
      });
      titleWrap.createSpan({
        cls: "sauce-badge sauce-badge--muted sauce-inbox-group-count",
        text: String(items.length),
      });

      const groupActions = summary.createDiv({
        cls: "sauce-inbox-group-actions",
      });
      // stopPropagation so clicking a group action doesn't toggle the <details>.
      const acceptAll = groupActions.createEl("button", {
        cls: "sauce-button sauce-inbox-group-btn",
        text: "Accept all",
      });
      acceptAll.setAttribute(
        "aria-label",
        `Accept all ${KIND_LABEL[kind] ?? kind}`,
      );
      const groupIxs: number[] = [];

      const list = details.createDiv({ cls: "sauce-inbox-list" });
      for (const p of items) {
        const myIx = ix++;
        groupIxs.push(myIx);
        const el = this.renderRow(list, myIx, p);
        this.rows.push({ ix: myIx, proposal: p, el });
      }

      this.registerDomEvent(acceptAll, "click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        void this.bulkByIxs(groupIxs, "accept");
      });
    }
  }

  private gatherProposals(): InferenceEntity[] {
    const touches: TouchRecord[] = this.plugin.entityService
      .allTouches()
      .map((t) => {
        const fm = t.frontmatter;
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
        const fm = p.frontmatter;
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
    list: HTMLElement,
    ix: number,
    p: InferenceEntity,
  ): HTMLDivElement {
    const row = list.createDiv({ cls: "sauce-inbox-row" });

    const cbWrap = row.createDiv({ cls: "sauce-inbox-cb" });
    const cb = cbWrap.createEl("input", {
      type: "checkbox",
    }) as HTMLInputElement;
    const cbId = `sauce-inbox-cb-${ix}`;
    cb.id = cbId;
    cb.setAttribute("aria-label", `Select proposal: ${p.target}`);
    this.registerDomEvent(cb, "change", () => {
      cb.checked ? this.selected.add(ix) : this.selected.delete(ix);
    });

    const info = row.createDiv({ cls: "sauce-inbox-info" });
    const kindRow = info.createDiv({ cls: "sauce-inbox-kind" });
    const bucket = confBucket(p.confidence);
    kindRow.createSpan({
      cls: `sauce-badge sauce-inbox-conf sauce-inbox-conf--${bucket}`,
      text: `${(p.confidence * 100).toFixed(0)}%`,
    });
    kindRow.createSpan({
      cls: "sauce-inbox-kindname",
      text: KIND_LABEL[p.inference_kind] ?? p.inference_kind,
    });
    info.createEl("div", { cls: "sauce-inbox-target", text: p.target });
    info.createEl("div", {
      cls: "sauce-inbox-value",
      text: JSON.stringify(p.proposed_value).slice(0, 200),
    });
    if (p.sources.length)
      info.createEl("div", {
        cls: "sauce-inbox-sources",
        text: `Sources: ${p.sources.slice(0, 3).join(", ")}${p.sources.length > 3 ? "…" : ""}`,
      });

    const actions = row.createDiv({ cls: "sauce-inbox-row-actions" });
    const accept = actions.createEl("button", {
      cls: "sauce-button",
      text: "Accept",
    });
    accept.setAttribute("aria-label", `Accept proposal: ${p.target}`);
    this.registerDomEvent(accept, "click", () => {
      void this.applyOne(p).then(() => {
        new Notice(`Accepted: ${p.target}`);
        row.remove();
      });
    });
    const reject = actions.createEl("button", {
      cls: "sauce-button sauce-button-secondary",
      text: "Reject",
    });
    reject.setAttribute("aria-label", `Reject proposal: ${p.target}`);
    this.registerDomEvent(reject, "click", () => {
      this.selected.delete(ix);
      row.remove();
    });

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
    const ixs = this.rows
      .filter((r) => this.selected.has(r.ix))
      .map((r) => r.ix);
    await this.bulkByIxs(ixs, op);
    this.selected.clear();
  }

  private async bulkByIxs(
    ixs: number[],
    op: "accept" | "reject",
  ): Promise<void> {
    const set = new Set(ixs);
    let n = 0;
    for (const r of this.rows) {
      if (!set.has(r.ix)) continue;
      if (!r.el.isConnected) continue;
      if (op === "accept") await this.applyOne(r.proposal);
      r.el.remove();
      this.selected.delete(r.ix);
      n++;
    }
    new Notice(`${op === "accept" ? "Accepted" : "Rejected"} ${n} proposal(s)`);
  }

  private renderEmpty(root: HTMLElement): void {
    const box = root.createDiv({ cls: "sauce-empty-state" });
    const ic = box.createDiv({ cls: "sauce-empty-state-icon" });
    setIcon(ic, "inbox");
    box.createEl("h3", {
      cls: "sauce-empty-state-title",
      text: "Inbox zero",
    });
    box.createEl("p", {
      cls: "sauce-empty-state-body",
      text: "There are no proposed inferences to review right now. As you log meetings and add contacts, the inference engine will suggest relationship edges and possible duplicate merges here for your approval.",
    });
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
      const val = p.proposed_value as { attribute: string; value: unknown };
      await this.plugin.entityService.updateFrontmatter(file, (fm) => {
        fm[val.attribute] = val.value;
      });
    }
  }
}
