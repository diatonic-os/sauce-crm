// RelationshipAnalytics — net-new analytics engine for the Sauce CRM Dashboard.
//
// Two layers:
//   1. PURE functions (no Obsidian, no I/O): take plain arrays of normalized
//      records in, return deterministic results. Trivially unit-testable.
//   2. A thin service class (`RelationshipAnalytics`) that reads EntityService,
//      normalizes the domain entities into the pure-function input shapes, and
//      returns the same result types. The class holds NO calculation logic of
//      its own beyond normalization + wiring.
//
// All dates are normalized defensively: frontmatter dates may be JS Date
// objects (unquoted YAML) OR ISO strings. `coerceIsoDay` collapses both to a
// `YYYY-MM-DD` string (or null).

import type { App, TFile } from "obsidian";
import { Person } from "../domain/Person";
import { Touch } from "../domain/Touch";
import { PipelineDeal } from "../domain/PipelineDeal";
import type { EntityService } from "./EntityService";
import { basenameFromLink } from "../util/Wikilink";
import { pearson } from "./stats/Statistics";
export { pearson } from "./stats/Statistics";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type Severity = "critical" | "warning" | "info";

export type SuggestionKind =
  | "overdue-reconnect"
  | "high-value-low-touch"
  | "stalled-deal"
  | "deal-no-touch";

/** A single algorithmic, data-driven suggestion surfaced into the dashboard. */
export interface Suggestion {
  /** Stable, deterministic id (kind + slug of target path). */
  id: string;
  kind: SuggestionKind;
  /** Human-facing one-liner title. */
  title: string;
  /** One-line rationale that cites the actual numbers. */
  rationale: string;
  severity: Severity;
  /** Vault-relative note path so the UI can open the target. */
  targetPath: string;
  /** Numeric priority — higher is more urgent. Used for ranking. */
  score: number;
}

/** Pearson correlation result plus a plain-language read. */
export interface CorrelationResult {
  /** Number of (x, y) pairs the coefficient was computed over. */
  n: number;
  /** Pearson r in [-1, 1], or null when undefined (n < 2 or zero variance). */
  r: number | null;
  /** Plain-language interpretation, always populated. */
  interpretation: string;
}

/** The full analytics payload the dashboard renders. */
export interface AnalyticsReport {
  suggestions: Suggestion[];
  cadenceVsCloseness: CorrelationResult;
  generatedAt: string;
}

// Normalized, Obsidian-free input shapes for the pure layer. ----------------

export interface PersonStat {
  path: string;
  name: string;
  closeness: number; // 1–5
  cadence: string; // monthly | quarterly | bi-annual | ad-hoc
  /** ISO day of last touch, or null if never touched. */
  lastTouch: string | null;
  /** Count of touches attributed to this person (touch-frequency proxy). */
  touchCount: number;
  /** Touch counts keyed by channel (e.g. { call: 2, email: 1 }). */
  channelCounts: Record<string, number>;
  /** Touch counts keyed by each outcome tag (e.g. { intro: 1, followup: 2 }). */
  outcomeCounts: Record<string, number>;
  /** Graph degree (edge count) from GraphAtlasService; 0 when unavailable. */
  degree: number;
}

export interface DealStat {
  path: string;
  title: string;
  stage: string;
  value: number | null;
  /** ISO day of most recent related touch / activity, or null. */
  lastActivity: string | null;
}

// ---------------------------------------------------------------------------
// Date / math primitives (pure)
// ---------------------------------------------------------------------------

const ISO_RE = /^(\d{4}-\d{2}-\d{2})/;

/** Collapse a Date | string | unknown into a `YYYY-MM-DD` string or null. */
export function coerceIsoDay(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return v.toISOString().slice(0, 10);
  }
  if (typeof v === "string") {
    const m = v.match(ISO_RE);
    return m ? (m[1] ?? null) : null;
  }
  return null;
}

/** Whole days between an ISO day and `now` (positive => in the past). */
export function daysSince(isoDay: string | null, now: Date): number | null {
  if (!isoDay) return null;
  const then = new Date(isoDay + "T00:00:00Z").getTime();
  if (Number.isNaN(then)) return null;
  return Math.floor((now.getTime() - then) / 86_400_000);
}

/** Cadence -> implied max interval (days). Mirrors Person.isOverdue caps. */
export const CADENCE_DAYS: Record<string, number> = {
  monthly: 30,
  quarterly: 90,
  "bi-annual": 182,
  "ad-hoc": 365,
};

export function cadenceInterval(cadence: string): number {
  return CADENCE_DAYS[cadence] ?? 90;
}

// pearson is now the canonical implementation in ./stats/Statistics.
// It is imported above and re-exported so existing callers of
// `RelationshipAnalytics.pearson` keep working without changes.

function slugifyPath(path: string): string {
  return path.replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// ---------------------------------------------------------------------------
// Pure analytics functions
// ---------------------------------------------------------------------------

/**
 * Overdue-to-reconnect: people past their cadence-implied interval.
 * Priority score = closeness * daysOverdue (so a close contact 10 days late
 * outranks a distant one 100 days late only past the crossover point — exactly
 * the relationship-weighted urgency we want).
 */
export function overdueReconnect(
  people: PersonStat[],
  now: Date,
): Suggestion[] {
  const out: Suggestion[] = [];
  for (const p of people) {
    const interval = cadenceInterval(p.cadence);
    const days = daysSince(p.lastTouch, now);
    // Never touched => treat as maximally overdue against its cadence.
    const effectiveDays = days == null ? interval * 2 : days;
    const overdueBy = effectiveDays - interval;
    if (overdueBy <= 0) continue;
    const score = p.closeness * overdueBy;
    const lastTxt =
      p.lastTouch == null ? "no touch on record" : `last touch ${p.lastTouch}`;
    out.push({
      id: `overdue-reconnect:${slugifyPath(p.path)}`,
      kind: "overdue-reconnect",
      title: `Reconnect with ${p.name}`,
      rationale: `Closeness ${p.closeness}/5, ${p.cadence} cadence (${interval}d) — ${overdueBy}d overdue (${lastTxt}). Priority ${score}.`,
      severity: overdueBy > interval ? "critical" : "warning",
      targetPath: p.path,
      score,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * High-value / low-touch: high closeness (>=4) but a long gap since the last
 * touch — relationship-decay risk distinct from raw cadence overdue. Score is
 * closeness^2 * daysSinceTouch so the strongest ties dominate.
 */
export function highValueLowTouch(
  people: PersonStat[],
  now: Date,
  opts: { minCloseness?: number; minGapDays?: number } = {},
): Suggestion[] {
  const minCloseness = opts.minCloseness ?? 4;
  const minGapDays = opts.minGapDays ?? 60;
  const out: Suggestion[] = [];
  for (const p of people) {
    if (p.closeness < minCloseness) continue;
    const days = daysSince(p.lastTouch, now);
    const gap = days == null ? 9999 : days;
    if (gap < minGapDays) continue;
    const score = p.closeness * p.closeness * gap;
    const lastTxt =
      p.lastTouch == null ? "never touched" : `${gap}d since last touch`;
    out.push({
      id: `high-value-low-touch:${slugifyPath(p.path)}`,
      kind: "high-value-low-touch",
      title: `High-value tie cooling: ${p.name}`,
      rationale: `Closeness ${p.closeness}/5 but ${lastTxt} — decay risk on a top relationship.`,
      severity: p.closeness >= 5 ? "critical" : "warning",
      targetPath: p.path,
      score,
    });
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Pipeline attention. Two signals:
 *   - deal-no-touch: an active deal with no recent related activity.
 *   - stalled-deal:  an active deal whose last activity is older than the
 *     stall threshold (or has never had any), weighted by deal value.
 * Closed stages (won/lost/closed) are skipped.
 */
export function pipelineAttention(
  deals: DealStat[],
  now: Date,
  opts: { staleDays?: number } = {},
): Suggestion[] {
  const staleDays = opts.staleDays ?? 30;
  const out: Suggestion[] = [];
  for (const d of deals) {
    const stage = d.stage.toLowerCase();
    if (/won|lost|closed/.test(stage)) continue;
    const days = daysSince(d.lastActivity, now);
    const valueTxt =
      d.value != null ? `$${d.value.toLocaleString()} deal` : "deal";
    if (days == null) {
      // No activity on record at all.
      const score = (d.value ?? 1000) / 1000 + 10;
      out.push({
        id: `deal-no-touch:${slugifyPath(d.path)}`,
        kind: "deal-no-touch",
        title: `Pipeline deal untouched: ${d.title}`,
        rationale: `${valueTxt} at "${d.stage}" with no recorded activity — schedule a touch.`,
        severity: "warning",
        targetPath: d.path,
        score,
      });
      continue;
    }
    if (days > staleDays) {
      // Score blends staleness with value (value in $1k units, capped weight).
      const valueWeight = Math.min((d.value ?? 0) / 1000, 100);
      const score = days + valueWeight;
      out.push({
        id: `stalled-deal:${slugifyPath(d.path)}`,
        kind: "stalled-deal",
        title: `Stalled deal: ${d.title}`,
        rationale: `${valueTxt} at "${d.stage}" — ${days}d since last activity (>${staleDays}d stall).`,
        severity: days > staleDays * 3 ? "critical" : "warning",
        targetPath: d.path,
        score,
      });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/**
 * Touch-cadence vs closeness correlation: do you actually touch your close
 * contacts more? Pairs (closeness, touchCount) over all people and reports
 * Pearson r with a plain-language read.
 */
export function cadenceVsClosenessCorrelation(
  people: PersonStat[],
): CorrelationResult {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of people) {
    xs.push(p.closeness);
    ys.push(p.touchCount);
  }
  const r = pearson(xs, ys);
  return {
    n: xs.length,
    r,
    interpretation: interpretCorrelation(r, xs.length),
  };
}

export function interpretCorrelation(r: number | null, n: number): string {
  if (n < 2)
    return "Not enough people to correlate touch frequency with closeness yet.";
  if (r == null)
    return "No variation in closeness or touch counts — correlation undefined.";
  const mag = Math.abs(r);
  const strength =
    mag < 0.1
      ? "essentially no"
      : mag < 0.3
        ? "a weak"
        : mag < 0.5
          ? "a moderate"
          : mag < 0.7
            ? "a strong"
            : "a very strong";
  if (r >= 0.1) {
    return `r=${r.toFixed(2)} — ${strength} positive link: you do touch closer contacts more often.`;
  }
  if (r <= -0.1) {
    return `r=${r.toFixed(2)} — ${strength} negative link: you touch closer contacts LESS, a coverage gap.`;
  }
  return `r=${r.toFixed(2)} — ${strength} relationship: touch frequency is not tracking closeness.`;
}

/**
 * Rank + merge all suggestion streams into a single prioritized list.
 * Cross-stream ordering uses a severity tier first (critical > warning > info)
 * then the within-stream numeric score.
 */
export function rankSuggestions(
  streams: Suggestion[][],
  limit = 12,
): Suggestion[] {
  const sevRank: Record<Severity, number> = {
    critical: 2,
    warning: 1,
    info: 0,
  };
  const all = streams.flat();
  all.sort((a, b) => {
    const s = sevRank[b.severity] - sevRank[a.severity];
    if (s !== 0) return s;
    return b.score - a.score;
  });
  return all.slice(0, limit);
}

/** Compose the full report from normalized stats. Pure. */
export function buildReport(
  people: PersonStat[],
  deals: DealStat[],
  now: Date,
): AnalyticsReport {
  const suggestions = rankSuggestions([
    overdueReconnect(people, now),
    highValueLowTouch(people, now),
    pipelineAttention(deals, now),
  ]);
  return {
    suggestions,
    cadenceVsCloseness: cadenceVsClosenessCorrelation(people),
    generatedAt: now.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Service layer — wires EntityService into the pure functions.
// ---------------------------------------------------------------------------

export class RelationshipAnalytics {
  constructor(
    public app: App,
    public entities: EntityService,
  ) {}

  /** Normalize people + their touch counts into PersonStat[]. */
  peopleStats(now: Date = new Date()): PersonStat[] {
    void now;
    const people = this.entities
      .allPeople()
      .filter((e): e is Person => e instanceof Person);
    const touches = this.entities
      .allTouches()
      .filter((e): e is Touch => e instanceof Touch);

    // Touch-frequency, channel counts, and outcome counts by person basename.
    const touchCounts = new Map<string, number>();
    const channelCountsMap = new Map<string, Record<string, number>>();
    const outcomeCountsMap = new Map<string, Record<string, number>>();

    for (const t of touches) {
      if (!t.contact) continue;
      const base = basenameFromLink(t.contact);
      touchCounts.set(base, (touchCounts.get(base) ?? 0) + 1);

      // Channel tallying
      const channel = t.channel ?? "unknown";
      const chMap = channelCountsMap.get(base) ?? {};
      chMap[channel] = (chMap[channel] ?? 0) + 1;
      channelCountsMap.set(base, chMap);

      // Outcome-tag tallying (outcome_tags is string[])
      for (const tag of t.outcome_tags) {
        const ocMap = outcomeCountsMap.get(base) ?? {};
        ocMap[tag] = (ocMap[tag] ?? 0) + 1;
        outcomeCountsMap.set(base, ocMap);
      }
    }

    // Degree: try to get from GraphAtlasService snapshot; default 0 if unavailable.
    // We build the degree map lazily here to avoid throwing if the service errors.
    let degreeByPath = new Map<string, number>();
    try {
      // GraphAtlasService is not always injected — fall back gracefully.
      const atlas = (
        this as unknown as {
          graphAtlas?: {
            snapshot(): { nodes: Array<{ path: string; degree: number }> };
          };
        }
      ).graphAtlas;
      if (atlas) {
        const snap = atlas.snapshot();
        for (const node of snap.nodes) {
          degreeByPath.set(node.path, node.degree);
        }
      }
    } catch {
      // Unavailable; degree stays 0 for all people.
      degreeByPath = new Map();
    }

    return people.map((p) => {
      const name = String(p.frontmatter.name ?? p.file.basename);
      const base = p.file.basename;
      return {
        path: p.file.path,
        name,
        closeness: p.closeness,
        cadence: p.cadence,
        lastTouch: coerceIsoDay(p.last_touch),
        touchCount: touchCounts.get(base) ?? 0,
        channelCounts: channelCountsMap.get(base) ?? {},
        outcomeCounts: outcomeCountsMap.get(base) ?? {},
        degree: degreeByPath.get(p.file.path) ?? 0,
      };
    });
  }

  /** Normalize pipeline deals + their most-recent related touch into DealStat[]. */
  dealStats(): DealStat[] {
    const deals = this.entities
      .allPipelineDeals()
      .filter((e): e is PipelineDeal => e instanceof PipelineDeal);
    const touches = this.entities
      .allTouches()
      .filter((e): e is Touch => e instanceof Touch);

    // Most recent touch ISO day keyed by the touched entity's basename.
    const lastTouchByEntity = new Map<string, string>();
    for (const t of touches) {
      if (!t.contact) continue;
      const day = coerceIsoDay(t.frontmatter.date);
      if (!day) continue;
      const base = basenameFromLink(t.contact);
      const prev = lastTouchByEntity.get(base);
      if (!prev || day > prev) lastTouchByEntity.set(base, day);
    }

    return deals.map((d) => {
      // A deal links its counterparty via `entity` or `contact` frontmatter;
      // fall back to its own date frontmatter for last-activity recency.
      const entityRef =
        d.frontmatter.entity ?? d.frontmatter.contact ?? d.frontmatter.org;
      const linkedBase = entityRef ? basenameFromLink(String(entityRef)) : null;
      const linkedTouch = linkedBase
        ? (lastTouchByEntity.get(linkedBase) ?? null)
        : null;
      const ownDate =
        coerceIsoDay(d.frontmatter.last_activity) ??
        coerceIsoDay(d.frontmatter.date) ??
        coerceIsoDay(d.frontmatter.updated);
      // Most recent of linked-touch / own activity date.
      let lastActivity: string | null = null;
      for (const cand of [linkedTouch, ownDate]) {
        if (cand && (!lastActivity || cand > lastActivity)) lastActivity = cand;
      }
      return {
        path: d.file.path,
        title: d.title,
        stage: d.stage,
        value: d.value,
        lastActivity,
      };
    });
  }

  /** Full report wired from the live vault. */
  report(now: Date = new Date()): AnalyticsReport {
    return buildReport(this.peopleStats(now), this.dealStats(), now);
  }

  /** Resolve a suggestion's target to a TFile for UI linking. */
  fileForSuggestion(s: Suggestion): TFile | null {
    return this.entities.getFile(s.targetPath);
  }
}
