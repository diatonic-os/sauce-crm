// ─────────────────────────────────────────────────────────────────────────────
//  Tests for L2_guidance — Guidance, NextStep engine, confidence routing
// ─────────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from "vitest";
import {
  confidenceRouting,
  nextStepEngine,
  assembleSystemPrompt,
  readBetweenLines,
  type Route,
  type NextStep,
  type Gap,
} from "../../src/saucebot/harness/Guidance";
import type { Cell } from "../../src/saucebot/harness/L0Substrate";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeCell(
  id: string,
  state: Cell["state"],
  resolvedValue?: unknown,
): Cell {
  return {
    id,
    state,
    candidates: [],
    provenance: [],
    ...(resolvedValue !== undefined ? { resolvedValue } : {}),
  };
}

// ─── confidenceRouting ────────────────────────────────────────────────────────

describe("confidenceRouting", () => {
  it("returns 'act' for conf >= 0.7", () => {
    expect(confidenceRouting(0.8)).toBe<Route>("act");
    expect(confidenceRouting(0.7)).toBe<Route>("act");
    expect(confidenceRouting(1.0)).toBe<Route>("act");
  });

  it("returns 'act_flag' for conf >= 0.4 and < 0.7", () => {
    expect(confidenceRouting(0.5)).toBe<Route>("act_flag");
    expect(confidenceRouting(0.4)).toBe<Route>("act_flag");
    expect(confidenceRouting(0.69)).toBe<Route>("act_flag");
  });

  it("returns 'ask' for conf < 0.4", () => {
    expect(confidenceRouting(0.2)).toBe<Route>("ask");
    expect(confidenceRouting(0.0)).toBe<Route>("ask");
    expect(confidenceRouting(0.39)).toBe<Route>("ask");
  });
});

// ─── nextStepEngine ───────────────────────────────────────────────────────────

describe("nextStepEngine", () => {
  it("excludes resolved cells from output", () => {
    const cells: Cell[] = [
      makeCell("cell-resolved", "resolved", "some value"),
      makeCell("cell-open", "unresolved"),
    ];
    const steps = nextStepEngine(cells);
    const ids = steps.map((s) => s.cellId);
    expect(ids).not.toContain("cell-resolved");
    expect(ids).toContain("cell-open");
  });

  it("ranks contradicted cells above unresolved", () => {
    const cells: Cell[] = [
      makeCell("cell-unresolved", "unresolved"),
      makeCell("cell-contradicted", "contradicted"),
    ];
    const steps = nextStepEngine(cells);
    expect(steps.length).toBe(2);
    // contradicted has higher impact (3 vs 1) and appears first
    expect(steps[0]?.cellId).toBe("cell-contradicted");
    expect(steps[1]?.cellId).toBe("cell-unresolved");
  });

  it("ranks resolving above unresolved (impact 2 vs 1)", () => {
    const cells: Cell[] = [
      makeCell("cell-unresolved", "unresolved"),
      makeCell("cell-resolving", "resolving"),
    ];
    const steps = nextStepEngine(cells);
    expect(steps[0]?.cellId).toBe("cell-resolving");
    expect(steps[1]?.cellId).toBe("cell-unresolved");
  });

  it("scores = impact * staleness (1-based position in input order)", () => {
    // Two unresolved: first at index 0 (staleness=1), second at index 1 (staleness=2)
    // Both impact=1. Score: cell-a = 1*1=1, cell-b = 1*2=2 → cell-b ranks higher
    const cells: Cell[] = [
      makeCell("cell-a", "unresolved"),
      makeCell("cell-b", "unresolved"),
    ];
    const steps = nextStepEngine(cells);
    expect(steps[0]?.cellId).toBe("cell-b");
    expect(steps[0]?.score).toBe(2);
    expect(steps[1]?.cellId).toBe("cell-a");
    expect(steps[1]?.score).toBe(1);
  });

  it("each NextStep has non-empty action/question/why strings referencing cellId", () => {
    const cells: Cell[] = [makeCell("cell-xyz", "unresolved")];
    const steps = nextStepEngine(cells);
    expect(steps.length).toBe(1);
    const s = steps[0]!;
    expect(s.cellId).toBe("cell-xyz");
    expect(s.suggestedNextAction.length).toBeGreaterThan(0);
    expect(s.questionUserShouldAsk.length).toBeGreaterThan(0);
    expect(s.whyThisMatters.length).toBeGreaterThan(0);
    // strings should reference the cell id
    const combined = s.suggestedNextAction + s.questionUserShouldAsk + s.whyThisMatters;
    expect(combined).toContain("cell-xyz");
  });

  it("returns empty array when all cells are resolved", () => {
    const cells: Cell[] = [makeCell("r1", "resolved", 42)];
    expect(nextStepEngine(cells)).toEqual([]);
  });
});

// ─── assembleSystemPrompt ─────────────────────────────────────────────────────

describe("assembleSystemPrompt", () => {
  it("includes resolved cell values in Known facts section", () => {
    const cells: Cell[] = [
      makeCell("cell-fact", "resolved", "Paris is the capital"),
    ];
    const prompt = assembleSystemPrompt(cells);
    expect(prompt).toContain("Known facts");
    expect(prompt).toContain("Paris is the capital");
  });

  it("omits unresolved cells entirely", () => {
    const cells: Cell[] = [
      makeCell("cell-resolved", "resolved", "known thing"),
      makeCell("cell-unresolved", "unresolved"),
      makeCell("cell-resolving", "resolving"),
      makeCell("cell-contradicted", "contradicted"),
    ];
    const prompt = assembleSystemPrompt(cells);
    expect(prompt).toContain("known thing");
    // Non-resolved cell ids must not appear
    expect(prompt).not.toContain("cell-unresolved");
    expect(prompt).not.toContain("cell-resolving");
    expect(prompt).not.toContain("cell-contradicted");
  });

  it("prepends base string when provided", () => {
    const cells: Cell[] = [];
    const prompt = assembleSystemPrompt(cells, { base: "You are a helpful assistant." });
    expect(prompt).toContain("You are a helpful assistant.");
  });

  it("appends constraints when provided", () => {
    const cells: Cell[] = [];
    const prompt = assembleSystemPrompt(cells, {
      constraints: ["Be concise.", "Do not speculate."],
    });
    expect(prompt).toContain("Be concise.");
    expect(prompt).toContain("Do not speculate.");
  });

  it("produces valid prompt with all options combined", () => {
    const cells: Cell[] = [
      makeCell("cell-a", "resolved", "value-a"),
      makeCell("cell-b", "unresolved"),
    ];
    const prompt = assembleSystemPrompt(cells, {
      base: "Base instruction.",
      constraints: ["Constraint one."],
    });
    expect(prompt).toContain("Base instruction.");
    expect(prompt).toContain("value-a");
    expect(prompt).toContain("Constraint one.");
    expect(prompt).not.toContain("cell-b");
  });
});

// ─── readBetweenLines ─────────────────────────────────────────────────────────

describe("readBetweenLines", () => {
  it("returns empty array when no triggers are present", () => {
    const gaps = readBetweenLines({ divergenceFlag: false, logicalConf: 0.9, hedging: false });
    expect(gaps).toEqual([]);
  });

  it("emits a gap when divergenceFlag is true", () => {
    const gaps = readBetweenLines({ divergenceFlag: true });
    expect(gaps.length).toBeGreaterThan(0);
    const gap = gaps.find((g) => g.reason.toLowerCase().includes("diverge") || g.surface.length > 0);
    expect(gap).toBeDefined();
  });

  it("emits a gap when logicalConf < 0.4", () => {
    const gaps = readBetweenLines({ logicalConf: 0.2 });
    expect(gaps.length).toBeGreaterThan(0);
  });

  it("emits a gap when hedging is true", () => {
    const gaps = readBetweenLines({ hedging: true });
    expect(gaps.length).toBeGreaterThan(0);
  });

  it("emits multiple gaps when multiple triggers fire", () => {
    const gaps = readBetweenLines({ divergenceFlag: true, logicalConf: 0.1, hedging: true });
    expect(gaps.length).toBeGreaterThanOrEqual(3);
  });

  it("each gap has non-empty reason and surface", () => {
    const gaps = readBetweenLines({ divergenceFlag: true, logicalConf: 0.1, hedging: true });
    for (const g of gaps) {
      expect(g.reason.length).toBeGreaterThan(0);
      expect(g.surface.length).toBeGreaterThan(0);
    }
  });

  it("omitted fields do not trigger gaps", () => {
    // Only divergenceFlag supplied
    const gaps = readBetweenLines({ divergenceFlag: false });
    expect(gaps).toEqual([]);
  });
});
