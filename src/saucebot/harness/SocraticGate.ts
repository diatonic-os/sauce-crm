/**
 * SocraticGate — detects when answering a query requires a risky assumption
 * and surfaces ONE sharp clarifying question before proceeding.
 *
 * WHY THIS EXISTS:
 * Ambiguous queries (unresolved pronouns, vague scope, underspecified action
 * verbs) cause the bot to silently bake in wrong assumptions — wrong contact,
 * wrong time-range, wrong org — producing confidently incorrect actions.
 * A gate that asks first is cheaper than a retraction later.
 *
 * DESIGN:
 * - Pure heuristic core with zero external dependencies (no obsidian, no
 *   lancedb, no LLM call at import time).
 * - Optional injected AI classifier for higher-fidelity detection; on throw
 *   the gate falls back silently to the heuristic so the bot stays available.
 * - Up to 2 generated questions, each ≤12 words, focused on the ambiguity.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

/** Result of gate assessment. */
export interface AssumptionVerdict {
  /** True when the query should pause for clarification before answering. */
  needsClarification: boolean;
  /** Short clarifying questions (≤2, ≤12 words each). Empty when clear. */
  questions: string[];
  /** Confidence in the verdict itself. */
  confidence: "low" | "medium" | "high";
  /** Optional human-readable reason for logging/debugging. */
  reason?: string;
}

/** Input to the gate. */
export interface GateInput {
  /** The raw user query. */
  query: string;
  /**
   * Optional prior-context summary injected by the caller (e.g. the current
   * conversation thread or last-touched node blurb). Used to resolve pronouns
   * that would otherwise trigger clarification.
   */
  contextSummary?: string;
}

/**
 * Optional AI classifier interface. Receives a GateInput and must resolve to
 * an AssumptionVerdict. Any throw causes the gate to fall back to the heuristic.
 */
export type Classifier = (input: GateInput) => Promise<AssumptionVerdict>;

// ─── Heuristic signals ────────────────────────────────────────────────────────

/** Third-person singular/plural pronouns that require a named referent. */
const AMBIGUOUS_PRONOUNS = /\b(him|her|them|it|that|this|he|she|they)\b/i;

/** Vague scope quantifiers without a named group following immediately. */
const VAGUE_SCOPE = /\b(everyone|all|recently|soon|sometime|whenever|anyone|somebody|someone)\b/i;

/** Action verbs that are underspecified without a named person or org. */
const UNDERSPECIFIED_VERBS =
  /\b(connect|follow\s+up|reach\s+out|ping|touch\s+base|check\s+in)\b/i;

/**
 * Pattern that detects a named entity in the query text:
 * - Obsidian wiki-link [[Name]] format
 * - Capitalised two-word name (e.g. "Jane Doe")
 * - Organisation-style proper noun (e.g. "Acme Corp")
 */
const NAMED_ENTITY =
  /\[\[.+?\]\]|[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+|[A-Z][A-Za-z]+\s+(?:Corp|Inc|LLC|Ltd|Co\b)/;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function hasNamedEntity(text: string): boolean {
  return NAMED_ENTITY.test(text);
}

function combinedText(input: GateInput): string {
  return input.contextSummary
    ? `${input.query} ${input.contextSummary}`
    : input.query;
}

// ─── Heuristic core ───────────────────────────────────────────────────────────

/**
 * Pure heuristic assessment — no async, no LLM, no imports beyond this file.
 *
 * Flags clarification when:
 * 1. Query contains an unresolved pronoun AND no named entity appears in query
 *    or contextSummary.
 * 2. Query contains a vague scope quantifier (everyone/all/recently/soon)
 *    without a named referent in scope.
 * 3. Query uses an underspecified relationship-action verb (connect, follow up,
 *    reach out, …) without a named person or org.
 *
 * Generates up to 2 focused questions (≤12 words each).
 */
export function heuristicAssess(input: GateInput): AssumptionVerdict {
  const query = input.query;
  const combined = combinedText(input);
  const entityInScope = hasNamedEntity(combined);

  const questions: string[] = [];
  const reasons: string[] = [];

  // Signal 1 — unresolved pronoun
  if (AMBIGUOUS_PRONOUNS.test(query) && !entityInScope) {
    reasons.push("unresolved pronoun");
    const match = AMBIGUOUS_PRONOUNS.exec(query);
    const pronoun = match ? match[0] : "them";
    questions.push(`Who or what does "${pronoun}" refer to?`);
  }

  // Signal 2 — vague scope (only add a question if we haven't already used up
  // our 2-question budget from signal 1)
  if (VAGUE_SCOPE.test(query) && !entityInScope && questions.length < 2) {
    reasons.push("vague scope");
    const match = VAGUE_SCOPE.exec(query);
    const term = match ? match[0] : "this";
    questions.push(`What specific ${term === "recently" || term === "soon" ? "time range" : "group"} do you mean?`);
  }

  // Signal 3 — underspecified action verb without a named person/org anywhere
  // in the combined text (avoid double-flagging if we already have 2 questions)
  if (
    UNDERSPECIFIED_VERBS.test(query) &&
    !entityInScope &&
    questions.length < 2
  ) {
    reasons.push("underspecified action verb without named target");
    if (questions.length === 0) {
      questions.push("Who specifically should I contact?");
    }
  }

  if (questions.length > 0) {
    return {
      needsClarification: true,
      questions,
      confidence: "medium",
      reason: reasons.join("; "),
    };
  }

  return {
    needsClarification: false,
    questions: [],
    confidence: "high",
  };
}

// ─── Public gate entry-point ──────────────────────────────────────────────────

/**
 * Assess whether a query requires clarification before the bot should answer.
 *
 * When a `classifier` is provided it is called first; if it throws for any
 * reason (network failure, rate-limit, timeout) the gate silently falls back
 * to `heuristicAssess` so the bot remains available.
 *
 * When no classifier is provided, `heuristicAssess` is used directly.
 *
 * @param input   The user query and optional context summary.
 * @param classifier Optional AI classifier for higher-fidelity detection.
 */
export async function assessAssumptions(
  input: GateInput,
  classifier?: Classifier,
): Promise<AssumptionVerdict> {
  if (classifier !== undefined) {
    try {
      return await classifier(input);
    } catch {
      // Classifier unavailable — degrade gracefully to heuristic.
      return heuristicAssess(input);
    }
  }
  return heuristicAssess(input);
}
