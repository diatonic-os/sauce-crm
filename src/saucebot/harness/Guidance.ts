// ─────────────────────────────────────────────────────────────────────────────
//  GUIDANCE — @L2_guidance layer of the SAUCEOM_HARNESS_DIRECTIVE
//
//  Per SAUCEOM_HARNESS_DIRECTIVE v0.1 @L2_guidance:
//    "guidance + next-step engine + confidence routing; provider-independent"
//    "resolved cells only in system prompt"
//    "surface gaps — never silently guess"
//
//  This module is PURE: no Obsidian imports, no lancedb imports.
//  All state flows through the Cell type from L0Substrate.
// ─────────────────────────────────────────────────────────────────────────────

import type { Cell } from "./L0Substrate";

// ═══════════════════════════════════════════════════════════════════════════
//  CONFIDENCE ROUTING
// ═══════════════════════════════════════════════════════════════════════════

/** Execution route determined by a confidence score. */
export type Route = "act" | "act_flag" | "ask";

/**
 * Route an action based on a normalized confidence score [0, 1].
 *
 * - conf >= 0.7 → "act"       (high confidence: proceed)
 * - conf >= 0.4 → "act_flag"  (medium confidence: act but surface uncertainty)
 * - else        → "ask"       (low confidence: surface to user before acting)
 */
export function confidenceRouting(conf: number): Route {
  if (conf >= 0.7) return "act";
  if (conf >= 0.4) return "act_flag";
  return "ask";
}

// ═══════════════════════════════════════════════════════════════════════════
//  NEXT-STEP ENGINE
// ═══════════════════════════════════════════════════════════════════════════

/** A ranked recommendation derived from an open (non-resolved) cell. */
export interface NextStep {
  /** The cell id this step addresses. */
  cellId: string;
  /** Concise imperative action the system should take. */
  suggestedNextAction: string;
  /** A question the user should surface to resolve ambiguity. */
  questionUserShouldAsk: string;
  /** Why resolving this cell matters right now. */
  whyThisMatters: string;
  /** Composite priority score (impact × staleness). Higher = more urgent. */
  score: number;
}

/** Impact weight by cell state. */
const IMPACT: Record<Cell["state"], number> = {
  contradicted: 3,
  resolving: 2,
  unresolved: 1,
  resolved: 0, // excluded
};

/**
 * Rank all OPEN cells (state: unresolved | resolving | contradicted) by
 * `score = impact × staleness`, where staleness = 1-based position in input
 * order (index + 1). Higher score = more urgent. Resolved cells are excluded.
 *
 * Generates concise, cell-id-referencing action/question/why strings for each
 * open cell so the caller can present a prioritised work queue.
 */
export function nextStepEngine(cells: Cell[]): NextStep[] {
  const scored: Array<{ cell: Cell; impact: number; staleness: number; score: number }> = [];

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    if (!cell) continue;
    const impact = IMPACT[cell.state];
    if (impact === 0) continue; // resolved — skip
    const staleness = i + 1;
    scored.push({ cell, impact, staleness, score: impact * staleness });
  }

  // Sort descending by score; ties broken by impact (higher = more urgent)
  scored.sort((a, b) => b.score - a.score || b.impact - a.impact);

  return scored.map(({ cell, score }) => {
    const id = cell.id;
    const stateLabel = cell.state;

    const suggestedNextAction =
      stateLabel === "contradicted"
        ? `Resolve contradiction in cell [${id}]: inspect conflicting candidates and collapse to a single value.`
        : stateLabel === "resolving"
        ? `Advance resolution of cell [${id}]: evaluate pending candidates and collapse or surface the discrepancy.`
        : `Gather evidence for cell [${id}]: propose at least one candidate so resolution can proceed.`;

    const questionUserShouldAsk =
      stateLabel === "contradicted"
        ? `Which candidate value for [${id}] is correct, and what evidence supports it?`
        : stateLabel === "resolving"
        ? `Are the current candidates for [${id}] sufficient to commit to a resolved value?`
        : `What information is needed to determine the value of [${id}]?`;

    const whyThisMatters =
      stateLabel === "contradicted"
        ? `Cell [${id}] holds conflicting values; downstream steps that depend on it cannot proceed safely until the contradiction is cleared.`
        : stateLabel === "resolving"
        ? `Cell [${id}] has partial candidates; leaving it unresolved may cause the harness to stall or produce a low-confidence output.`
        : `Cell [${id}] has no candidates yet; the harness cannot make progress on this dimension without at least one proposed value.`;

    return { cellId: id, suggestedNextAction, questionUserShouldAsk, whyThisMatters, score };
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  SYSTEM PROMPT ASSEMBLY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Build a system prompt ONLY from cells with `state === "resolved"`.
 *
 * Directive: "resolved cells only" — non-resolved cells must not influence
 * the model context; surfacing unresolved values would leak uncertainty into
 * the model's ground truth.
 *
 * Structure:
 *   [base]
 *   Known facts:
 *   - <cellId>: <resolvedValue>
 *   [constraints]
 */
export function assembleSystemPrompt(
  resolvedCells: Cell[],
  opts?: { base?: string; constraints?: string[] },
): string {
  const parts: string[] = [];

  if (opts?.base) {
    parts.push(opts.base);
  }

  const resolved = resolvedCells.filter((c) => c.state === "resolved");
  if (resolved.length > 0) {
    const lines = resolved.map((c) => `- ${c.id}: ${JSON.stringify(c.resolvedValue)}`);
    parts.push(`Known facts:\n${lines.join("\n")}`);
  }

  if (opts?.constraints && opts.constraints.length > 0) {
    parts.push(opts.constraints.join("\n"));
  }

  return parts.join("\n\n");
}

// ═══════════════════════════════════════════════════════════════════════════
//  READ BETWEEN LINES — gap detector
// ═══════════════════════════════════════════════════════════════════════════

/**
 * A gap detected in the input signal that must be surfaced to the user.
 * Never silently guessed — per the harness directive's honesty rule.
 */
export interface Gap {
  /** Human-readable description of why this gap was detected. */
  reason: string;
  /** What the caller should surface / ask / clarify. */
  surface: string;
}

/**
 * Inspect an input signal for ambiguity markers and emit a Gap for each
 * detected trigger. Three triggers are defined:
 *
 *   - `divergenceFlag`  — the model's output diverges from an expected
 *     trajectory; the intent may have been misread.
 *   - `logicalConf < 0.4` — below the ask threshold; the model does not
 *     have enough information to act.
 *   - `hedging` — the model's output contained hedging language; surface
 *     the uncertainty rather than proceeding.
 *
 * Returns an empty array when no triggers fire (clean input).
 */
export function readBetweenLines(input: {
  divergenceFlag?: boolean;
  logicalConf?: number;
  hedging?: boolean;
}): Gap[] {
  const gaps: Gap[] = [];

  if (input.divergenceFlag === true) {
    gaps.push({
      reason: "divergence detected: model output diverges from expected trajectory",
      surface:
        "Surface this divergence to the user — confirm whether the current direction matches their intent before continuing.",
    });
  }

  if (input.logicalConf !== undefined && input.logicalConf < 0.4) {
    gaps.push({
      reason: `logical confidence too low (${input.logicalConf.toFixed(2)} < 0.40): insufficient information to act`,
      surface:
        "Ask the user to provide clarifying information before the harness proceeds — do not guess.",
    });
  }

  if (input.hedging === true) {
    gaps.push({
      reason: "hedging detected in model output: uncertainty not yet resolved",
      surface:
        "Surface the hedged claim to the user and request confirmation or additional evidence before treating it as ground truth.",
    });
  }

  return gaps;
}
