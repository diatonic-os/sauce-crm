/**
 * EnrichmentEngine — pure, dependency-free enrichment heuristic.
 *
 * WHY: replaces the external enrich_batch.py script that was writing vault
 * enrichment decisions from outside the plugin process. Bringing this logic
 * in-process (pure TypeScript, zero I/O) keeps the harness fully testable
 * and eliminates the external dependency entirely.
 *
 * DESIGN: all side effects are excluded by construction — no imports of
 * obsidian, lancedb, or any I/O layer. Input signals in, Verdict out.
 *
 * PRECEDENCE: exactly 7 ordered branches; first match wins. Branches are
 * numbered in comments to match the specification.
 */

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Raw signals for a single enrichment candidate.
 * All values must be supplied by the caller; none are optional to prevent
 * accidental omission from masking a branch condition.
 */
export interface CandidateSignals {
  /** Display name (used in reason strings for traceability). */
  name: string;
  /** Aggregate affinity score (0–10 typical range). */
  score: number;
  /** True when both sides have initiated contact. */
  hasBidirectionalActivity: boolean;
  /** Count of shared mutual connections. */
  mutualsCount: number;
  /** True when a non-compete clause is in effect for this candidate. */
  nonCompeteHit: boolean;
  /** True when the LinkedIn record is a generated stub, not a real profile. */
  isLinkedInMemberPlaceholder: boolean;
  /** True when phone-based identity was cross-confirmed via LinkedIn. */
  phoneLinkedinCrossConfirm: boolean;
}

/** Final enrichment verdict: what to do and how certain we are. */
export type Recommendation = "PROMOTE" | "REVIEW" | "REJECT";

/** Calibrated confidence tier for the recommendation. */
export type Confidence = "high" | "medium" | "low";

/** Full verdict emitted for one candidate. */
export interface Verdict {
  recommendation: Recommendation;
  confidence: Confidence;
  /** Human-readable strings explaining why this branch fired. */
  reasons: string[];
}

// ─── Core logic ───────────────────────────────────────────────────────────────

/**
 * Evaluate a single candidate against the enrichment heuristic.
 *
 * Precedence is strict: branches are evaluated top-to-bottom and the first
 * match terminates evaluation. No branch weights are blended.
 *
 * @param c - Fully-populated candidate signals.
 * @returns A Verdict with recommendation, confidence tier, and reason list.
 */
export function enrichCandidate(c: CandidateSignals): Verdict {
  // Branch 1 — REJECT / high
  // Non-compete clauses or LinkedIn placeholder stubs are disqualifying
  // regardless of any other positive signal.
  if (c.nonCompeteHit || c.isLinkedInMemberPlaceholder) {
    const reasons: string[] = [];
    if (c.nonCompeteHit) {
      reasons.push(`Non-compete hit detected for "${c.name}"; automatic disqualification.`);
    }
    if (c.isLinkedInMemberPlaceholder) {
      reasons.push(`LinkedIn record for "${c.name}" is a generated placeholder; real profile unconfirmed.`);
    }
    return { recommendation: "REJECT", confidence: "high", reasons };
  }

  // Branch 2 — PROMOTE / high
  // Strong network signal (bidirectional + shared mutuals) OR a high affinity
  // score both indicate a high-confidence promotion.
  if ((c.hasBidirectionalActivity && c.mutualsCount > 0) || c.score >= 6) {
    const reasons: string[] = [];
    if (c.hasBidirectionalActivity && c.mutualsCount > 0) {
      reasons.push(
        `Bidirectional activity confirmed with ${c.mutualsCount} mutual connection(s) for "${c.name}".`
      );
    }
    if (c.score >= 6) {
      reasons.push(`Affinity score ${c.score} meets or exceeds the high-confidence promote threshold (6).`);
    }
    return { recommendation: "PROMOTE", confidence: "high", reasons };
  }

  // Branch 3 — PROMOTE / medium
  // Score of 5 with confirmed bidirectional activity but no shared mutuals:
  // promising but network depth is thin.
  if (c.score === 5 && c.hasBidirectionalActivity && c.mutualsCount === 0) {
    return {
      recommendation: "PROMOTE",
      confidence: "medium",
      reasons: [
        `Score 5 with bidirectional activity but no shared mutuals for "${c.name}"; medium confidence promote.`,
      ],
    };
  }

  // Branch 4 — REVIEW / medium
  // Score of 4 is borderline. Score of 5 without bidirectional activity
  // suggests interest is one-sided; both warrant human review.
  if (c.score === 4 || (c.score === 5 && !c.hasBidirectionalActivity)) {
    const reasons: string[] = [];
    if (c.score === 4) {
      reasons.push(`Score ${c.score} for "${c.name}" is borderline; manual review recommended.`);
    }
    if (c.score === 5 && !c.hasBidirectionalActivity) {
      reasons.push(
        `Score 5 but no bidirectional activity for "${c.name}"; engagement may be one-sided.`
      );
    }
    return { recommendation: "REVIEW", confidence: "medium", reasons };
  }

  // Branch 5 — REVIEW / low
  // Score of 3 with cross-confirmed identity but no bidirectional activity:
  // identity is solid but engagement is weak; flag for low-priority review.
  if (c.score === 3 && c.phoneLinkedinCrossConfirm && !c.hasBidirectionalActivity) {
    return {
      recommendation: "REVIEW",
      confidence: "low",
      reasons: [
        `Score 3 with phone/LinkedIn cross-confirm but no bidirectional activity for "${c.name}"; low-priority review.`,
      ],
    };
  }

  // Branch 6 — REJECT / low
  // Very low score combined with no engagement signals and no shared network
  // indicates minimal investment potential.
  if (c.score <= 1 && !c.hasBidirectionalActivity && c.mutualsCount === 0) {
    return {
      recommendation: "REJECT",
      confidence: "low",
      reasons: [
        `Score ${c.score} with no bidirectional activity and no shared mutuals for "${c.name}"; insufficient signal to pursue.`,
      ],
    };
  }

  // Branch 7 — default REVIEW / low
  // No branch matched; the candidate occupies an ambiguous middle zone.
  // Surface for human inspection rather than making a confident call.
  return {
    recommendation: "REVIEW",
    confidence: "low",
    reasons: [
      `"${c.name}" did not match any decisive enrichment pattern (score=${c.score}, bidirectional=${c.hasBidirectionalActivity}, mutuals=${c.mutualsCount}); defaulting to low-confidence review.`,
    ],
  };
}

/**
 * Evaluate an array of candidates in order, returning one Verdict per entry.
 *
 * @param cands - Ordered list of candidate signals.
 * @returns Verdicts in the same order as the input array.
 */
export function enrichBatch(cands: CandidateSignals[]): Verdict[] {
  return cands.map(enrichCandidate);
}
