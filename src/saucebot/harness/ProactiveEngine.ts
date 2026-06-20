// ─────────────────────────────────────────────────────────────────────────────
//  PROACTIVE ENGINE — surfaces next-steps + insights so the assistant always
//  leaves the user with something actionable.
//
//  Layer:  Pure utility; no Obsidian imports, no lancedb imports.
//  Inputs: ProactiveDeps (overdue follow-ups, suggested intros, open cells).
//  Output: { insights: Insight[], nextSteps: NextStep[] } — sorted, ranked,
//          ready to drive the assistant's proactive response surface.
//
//  Design:
//    • overdue[]           → "follow_up" insights, priority ∝ daysSince
//    • suggestedConnections[] → "intro" insights, priority fixed at mid-tier
//    • openCells[]         → nextSteps via nextStepEngine (Guidance module)
//    • ALL empty           → single "momentum" insight (encouraging capture)
//    • insights sorted descending by priority before return
// ─────────────────────────────────────────────────────────────────────────────

import { nextStepEngine, type NextStep } from "./Guidance";
import type { Cell } from "./L0Substrate";
import type { MapData } from "./EntityCard";

// ═══════════════════════════════════════════════════════════════════════════
//  PUBLIC TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A proactively surfaced insight for the user.
 *
 * - `follow_up` — a relationship touch is overdue; the user should reach out.
 * - `intro`     — two people in the graph should meet; the assistant can broker.
 * - `gap`       — something important is missing from the knowledge graph.
 * - `momentum`  — no urgent items; encourages the user to keep capturing notes.
 */
export interface Insight {
  kind: "follow_up" | "intro" | "gap" | "momentum";
  /** Human-readable sentence the assistant surfaces directly. */
  text: string;
  /** Entity ids/names this insight is about. */
  entities: string[];
  /** Relative urgency. Higher = surface sooner. Sorted desc before delivery. */
  priority: number;
}

/**
 * Injected dependency bag for {@link buildProactive}.
 * All fields are optional; callers supply only what is available.
 *
 * NOTE: `MapData` is accepted as a named type so callers can pass a full graph
 * without this module importing obsidian or lancedb. It is not used internally
 * at this layer — callers pre-project overdue/suggestedConnections externally.
 */
export interface ProactiveDeps {
  /** People whose last touch exceeds a staleness threshold. */
  overdue?: { person: string; daysSince: number }[];
  /** Pairs of people the assistant thinks should be introduced. */
  suggestedConnections?: { a: string; b: string; why: string }[];
  /** Open (non-resolved) cells from the L0 substrate. */
  openCells?: Cell[];
  /**
   * Optional full graph. Accepted for caller convenience (avoids an import
   * cycle for callers who hold MapData) but not used in this layer — callers
   * project overdue/suggestedConnections themselves.
   */
  mapData?: MapData;
}

// ═══════════════════════════════════════════════════════════════════════════
//  PRIORITY CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

/** Scale daysSince into a priority value. One "urgency point" per day. */
const FOLLOW_UP_SCALE = 1;

/**
 * Base priority for intro suggestions. Scaled slightly below an overdue
 * follow-up of ~7 days so a week-stale contact outranks a cold intro.
 */
const INTRO_BASE_PRIORITY = 5;

// ═══════════════════════════════════════════════════════════════════════════
//  buildProactive
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build the full proactive surface from the provided dependency bag.
 *
 * @param deps  Caller-supplied data: overdue contacts, suggested intros,
 *              and/or open L0 cells.
 * @returns     `insights` sorted by priority desc + `nextSteps` from cells.
 *
 * Guarantees:
 *  - At least one insight is returned when any input is non-empty.
 *  - Exactly one "momentum" insight is returned when ALL inputs are empty.
 *  - `nextSteps` are produced only from `openCells`; resolved cells are skipped.
 */
export function buildProactive(deps: ProactiveDeps): {
  insights: Insight[];
  nextSteps: NextStep[];
} {
  const insights: Insight[] = [];

  // ── follow_up insights from overdue contacts ──────────────────────────────
  for (const entry of deps.overdue ?? []) {
    insights.push({
      kind: "follow_up",
      text: `Follow up with ${entry.person} — it's been ${entry.daysSince} day${entry.daysSince === 1 ? "" : "s"} since your last touch.`,
      entities: [entry.person],
      priority: entry.daysSince * FOLLOW_UP_SCALE,
    });
  }

  // ── intro insights from suggested connections ─────────────────────────────
  for (const conn of deps.suggestedConnections ?? []) {
    insights.push({
      kind: "intro",
      text: `Introduce ${conn.a} and ${conn.b}: ${conn.why}.`,
      entities: [conn.a, conn.b],
      priority: INTRO_BASE_PRIORITY,
    });
  }

  // ── momentum fallback when nothing is actionable ──────────────────────────
  if (insights.length === 0) {
    insights.push({
      kind: "momentum",
      text: "You're all caught up — capture a note or log a touch to keep momentum.",
      entities: [],
      priority: 0,
    });
  }

  // ── sort insights descending by priority ──────────────────────────────────
  insights.sort((a, b) => b.priority - a.priority);

  // ── nextSteps from open cells via nextStepEngine ──────────────────────────
  const nextSteps: NextStep[] = nextStepEngine(deps.openCells ?? []);

  return { insights, nextSteps };
}

// ═══════════════════════════════════════════════════════════════════════════
//  topAsk
// ═══════════════════════════════════════════════════════════════════════════

/** Default ask when the insight list is empty. 14 words or fewer. */
const DEFAULT_ASK = "Log a touch or capture a note to stay connected.";

/**
 * Derive a single short sentence (≤ 14 words) telling the user the single
 * most valuable next action.
 *
 * Takes the text of the highest-priority insight as the ask sentence.
 * When the insights list is empty, returns a brief encouraging default.
 *
 * @param p.insights  Pre-sorted insight list (highest priority first).
 */
export function topAsk(p: { insights: Insight[] }): string {
  const top = p.insights[0];
  if (top === undefined) return DEFAULT_ASK;
  return top.text;
}
