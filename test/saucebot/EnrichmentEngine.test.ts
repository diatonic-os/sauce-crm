/**
 * Tests for EnrichmentEngine — native enrichment heuristic replacing enrich_batch.py.
 *
 * WHY: the external Python script was the only thing writing vault enrichment
 * decisions; bringing the logic in-process (pure TS, no I/O) keeps the
 * harness fully testable and removes the external dependency.
 *
 * Coverage: all 7 precedence branches + one precedence-ordering case + batch.
 */

import { describe, it, expect } from "vitest";
import {
  enrichCandidate,
  enrichBatch,
  type CandidateSignals,
  type Verdict,
} from "../../src/saucebot/harness/EnrichmentEngine";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** Baseline "clean" candidate that matches NO early branches on its own. */
function base(overrides: Partial<CandidateSignals> = {}): CandidateSignals {
  return {
    name: "Test Candidate",
    score: 3,
    hasBidirectionalActivity: false,
    mutualsCount: 0,
    nonCompeteHit: false,
    isLinkedInMemberPlaceholder: false,
    phoneLinkedinCrossConfirm: false,
    ...overrides,
  };
}

// ─── Branch 1: REJECT / high ──────────────────────────────────────────────────

describe("Branch 1 — REJECT/high (nonCompete or placeholder)", () => {
  it("returns REJECT/high when nonCompeteHit is true", () => {
    const v: Verdict = enrichCandidate(base({ nonCompeteHit: true, score: 7 }));
    expect(v.recommendation).toBe("REJECT");
    expect(v.confidence).toBe("high");
    expect(v.reasons.length).toBeGreaterThan(0);
  });

  it("returns REJECT/high when isLinkedInMemberPlaceholder is true", () => {
    const v = enrichCandidate(
      base({ isLinkedInMemberPlaceholder: true, score: 8 })
    );
    expect(v.recommendation).toBe("REJECT");
    expect(v.confidence).toBe("high");
    expect(v.reasons.length).toBeGreaterThan(0);
  });

  it("nonCompete flag beats every other positive signal (precedence test)", () => {
    // score=6 would normally trigger PROMOTE/high in branch 2 — nonCompete must win
    const v = enrichCandidate(
      base({
        nonCompeteHit: true,
        score: 6,
        hasBidirectionalActivity: true,
        mutualsCount: 5,
      })
    );
    expect(v.recommendation).toBe("REJECT");
    expect(v.confidence).toBe("high");
  });
});

// ─── Branch 2: PROMOTE / high ─────────────────────────────────────────────────

describe("Branch 2 — PROMOTE/high (bidirectional+mutuals OR score>=6)", () => {
  it("returns PROMOTE/high when hasBidirectionalActivity and mutualsCount>0", () => {
    const v = enrichCandidate(
      base({ hasBidirectionalActivity: true, mutualsCount: 2, score: 2 })
    );
    expect(v.recommendation).toBe("PROMOTE");
    expect(v.confidence).toBe("high");
    expect(v.reasons.length).toBeGreaterThan(0);
  });

  it("returns PROMOTE/high when score>=6 (regardless of activity)", () => {
    const v = enrichCandidate(base({ score: 6 }));
    expect(v.recommendation).toBe("PROMOTE");
    expect(v.confidence).toBe("high");
    expect(v.reasons.length).toBeGreaterThan(0);
  });

  it("returns PROMOTE/high when score=10", () => {
    const v = enrichCandidate(base({ score: 10 }));
    expect(v.recommendation).toBe("PROMOTE");
    expect(v.confidence).toBe("high");
  });
});

// ─── Branch 3: PROMOTE / medium ───────────────────────────────────────────────

describe("Branch 3 — PROMOTE/medium (score=5, bidirectional, no mutuals)", () => {
  it("returns PROMOTE/medium for score=5 + bidirectional + mutualsCount=0", () => {
    const v = enrichCandidate(
      base({ score: 5, hasBidirectionalActivity: true, mutualsCount: 0 })
    );
    expect(v.recommendation).toBe("PROMOTE");
    expect(v.confidence).toBe("medium");
    expect(v.reasons.length).toBeGreaterThan(0);
  });
});

// ─── Branch 4: REVIEW / medium ────────────────────────────────────────────────

describe("Branch 4 — REVIEW/medium (score=4 OR score=5 without bidirectional)", () => {
  it("returns REVIEW/medium for score=4", () => {
    const v = enrichCandidate(base({ score: 4 }));
    expect(v.recommendation).toBe("REVIEW");
    expect(v.confidence).toBe("medium");
    expect(v.reasons.length).toBeGreaterThan(0);
  });

  it("returns REVIEW/medium for score=5 without bidirectional activity", () => {
    const v = enrichCandidate(
      base({ score: 5, hasBidirectionalActivity: false })
    );
    expect(v.recommendation).toBe("REVIEW");
    expect(v.confidence).toBe("medium");
    expect(v.reasons.length).toBeGreaterThan(0);
  });
});

// ─── Branch 5: REVIEW / low ───────────────────────────────────────────────────

describe("Branch 5 — REVIEW/low (score=3 + crossConfirm + no bidirectional)", () => {
  it("returns REVIEW/low for score=3, phoneLinkedinCrossConfirm, no bidirectional", () => {
    const v = enrichCandidate(
      base({ score: 3, phoneLinkedinCrossConfirm: true })
    );
    expect(v.recommendation).toBe("REVIEW");
    expect(v.confidence).toBe("low");
    expect(v.reasons.length).toBeGreaterThan(0);
  });
});

// ─── Branch 6: REJECT / low ───────────────────────────────────────────────────

describe("Branch 6 — REJECT/low (score<=1, no bidirectional, no mutuals)", () => {
  it("returns REJECT/low for score=1, no activity, no mutuals", () => {
    const v = enrichCandidate(base({ score: 1 }));
    expect(v.recommendation).toBe("REJECT");
    expect(v.confidence).toBe("low");
    expect(v.reasons.length).toBeGreaterThan(0);
  });

  it("returns REJECT/low for score=0", () => {
    const v = enrichCandidate(base({ score: 0 }));
    expect(v.recommendation).toBe("REJECT");
    expect(v.confidence).toBe("low");
  });
});

// ─── Branch 7: default REVIEW / low ──────────────────────────────────────────

describe("Branch 7 — default REVIEW/low (unmatched)", () => {
  it("falls through to default REVIEW/low for score=2, no flags", () => {
    // score=2 misses: branch1 (no nonCompete/placeholder), branch2 (score<6, no bidir+mutuals),
    // branch3 (score!=5), branch4 (score!=4,5), branch5 (score!=3),
    // branch6 (score>1) → default
    const v = enrichCandidate(base({ score: 2 }));
    expect(v.recommendation).toBe("REVIEW");
    expect(v.confidence).toBe("low");
    expect(v.reasons.length).toBeGreaterThan(0);
  });
});

// ─── Precedence ordering ──────────────────────────────────────────────────────

describe("Precedence — first-match wins across all branches", () => {
  it("placeholder flag (branch1) beats score>=6 (branch2)", () => {
    const v = enrichCandidate(
      base({ isLinkedInMemberPlaceholder: true, score: 9, mutualsCount: 10, hasBidirectionalActivity: true })
    );
    expect(v.recommendation).toBe("REJECT");
    expect(v.confidence).toBe("high");
  });
});

// ─── enrichBatch ──────────────────────────────────────────────────────────────

describe("enrichBatch", () => {
  it("maps enrichCandidate over an array and preserves order", () => {
    const cands: CandidateSignals[] = [
      base({ nonCompeteHit: true }),         // → REJECT/high
      base({ score: 6 }),                    // → PROMOTE/high
      base({ score: 5, hasBidirectionalActivity: true, mutualsCount: 0 }), // → PROMOTE/medium
    ];
    const results = enrichBatch(cands);
    expect(results).toHaveLength(3);
    expect(results[0]?.recommendation).toBe("REJECT");
    expect(results[1]?.recommendation).toBe("PROMOTE");
    expect(results[1]?.confidence).toBe("high");
    expect(results[2]?.recommendation).toBe("PROMOTE");
    expect(results[2]?.confidence).toBe("medium");
  });

  it("returns empty array for empty input", () => {
    expect(enrichBatch([])).toEqual([]);
  });
});
