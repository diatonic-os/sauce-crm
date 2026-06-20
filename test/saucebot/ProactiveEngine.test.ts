// ─────────────────────────────────────────────────────────────────────────────
//  Tests for ProactiveEngine — proactive next-steps + insight surfacing
// ─────────────────────────────────────────────────────────────────────────────
import { describe, expect, it } from "vitest";
import {
  buildProactive,
  topAsk,
  type Insight,
  type ProactiveDeps,
} from "../../src/saucebot/harness/ProactiveEngine";
import type { Cell } from "../../src/saucebot/harness/L0Substrate";

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeCell(id: string, state: Cell["state"]): Cell {
  return { id, state, candidates: [], provenance: [] };
}

// ─── buildProactive — overdue follow-ups ──────────────────────────────────────

describe("buildProactive — overdue follow-ups → follow_up insights", () => {
  it("converts each overdue entry into a follow_up insight", () => {
    const deps: ProactiveDeps = {
      overdue: [
        { person: "alice", daysSince: 14 },
        { person: "bob", daysSince: 7 },
      ],
    };
    const { insights } = buildProactive(deps);
    const followUps = insights.filter((i) => i.kind === "follow_up");
    expect(followUps.length).toBe(2);
  });

  it("follow_up insight mentions the person's name in entities", () => {
    const deps: ProactiveDeps = {
      overdue: [{ person: "charlie", daysSince: 30 }],
    };
    const { insights } = buildProactive(deps);
    const fu = insights.find((i) => i.kind === "follow_up");
    expect(fu).toBeDefined();
    expect(fu!.entities).toContain("charlie");
  });

  it("priority scales with daysSince (more days = higher priority)", () => {
    const deps: ProactiveDeps = {
      overdue: [
        { person: "short", daysSince: 3 },
        { person: "long", daysSince: 60 },
      ],
    };
    const { insights } = buildProactive(deps);
    const shortFU = insights.find((i) => i.entities.includes("short"));
    const longFU = insights.find((i) => i.entities.includes("long"));
    expect(shortFU).toBeDefined();
    expect(longFU).toBeDefined();
    expect(longFU!.priority).toBeGreaterThan(shortFU!.priority);
  });

  it("follow_up insight has non-empty text", () => {
    const deps: ProactiveDeps = {
      overdue: [{ person: "diana", daysSince: 10 }],
    };
    const { insights } = buildProactive(deps);
    const fu = insights.find((i) => i.kind === "follow_up");
    expect(fu!.text.length).toBeGreaterThan(0);
  });
});

// ─── buildProactive — suggested connections ───────────────────────────────────

describe("buildProactive — suggestedConnections → intro insights", () => {
  it("converts each suggestion into an intro insight", () => {
    const deps: ProactiveDeps = {
      suggestedConnections: [
        { a: "alice", b: "bob", why: "both work in fintech" },
        { a: "carol", b: "dave", why: "both interested in AI" },
      ],
    };
    const { insights } = buildProactive(deps);
    const intros = insights.filter((i) => i.kind === "intro");
    expect(intros.length).toBe(2);
  });

  it("intro insight includes both person names in entities", () => {
    const deps: ProactiveDeps = {
      suggestedConnections: [{ a: "eve", b: "frank", why: "shared interest" }],
    };
    const { insights } = buildProactive(deps);
    const intro = insights.find((i) => i.kind === "intro");
    expect(intro).toBeDefined();
    expect(intro!.entities).toContain("eve");
    expect(intro!.entities).toContain("frank");
  });

  it("intro insight text references the 'why'", () => {
    const deps: ProactiveDeps = {
      suggestedConnections: [{ a: "grace", b: "henry", why: "shared passion for jazz" }],
    };
    const { insights } = buildProactive(deps);
    const intro = insights.find((i) => i.kind === "intro");
    expect(intro!.text).toContain("shared passion for jazz");
  });
});

// ─── buildProactive — openCells → nextSteps ──────────────────────────────────

describe("buildProactive — openCells → nextSteps via nextStepEngine", () => {
  it("derives nextSteps from open cells", () => {
    const deps: ProactiveDeps = {
      openCells: [
        makeCell("cell-alpha", "unresolved"),
        makeCell("cell-beta", "contradicted"),
      ],
    };
    const { nextSteps } = buildProactive(deps);
    expect(nextSteps.length).toBe(2);
    const ids = nextSteps.map((s) => s.cellId);
    expect(ids).toContain("cell-alpha");
    expect(ids).toContain("cell-beta");
  });

  it("excludes resolved cells from nextSteps", () => {
    const deps: ProactiveDeps = {
      openCells: [
        makeCell("cell-done", "resolved"),
        makeCell("cell-open", "unresolved"),
      ],
    };
    const { nextSteps } = buildProactive(deps);
    const ids = nextSteps.map((s) => s.cellId);
    expect(ids).not.toContain("cell-done");
    expect(ids).toContain("cell-open");
  });

  it("nextSteps are empty when no openCells provided", () => {
    const deps: ProactiveDeps = {
      overdue: [{ person: "ivan", daysSince: 5 }],
    };
    const { nextSteps } = buildProactive(deps);
    expect(nextSteps).toEqual([]);
  });
});

// ─── buildProactive — insight sorting ────────────────────────────────────────

describe("buildProactive — insights sorted by priority desc", () => {
  it("higher-priority insights appear first", () => {
    const deps: ProactiveDeps = {
      overdue: [
        { person: "low", daysSince: 1 },
        { person: "high", daysSince: 100 },
      ],
      suggestedConnections: [{ a: "x", b: "y", why: "why" }],
    };
    const { insights } = buildProactive(deps);
    for (let i = 0; i < insights.length - 1; i++) {
      expect(insights[i]!.priority).toBeGreaterThanOrEqual(insights[i + 1]!.priority);
    }
  });
});

// ─── buildProactive — empty → momentum fallback ───────────────────────────────

describe("buildProactive — empty inputs → momentum insight", () => {
  it("returns exactly one momentum insight when all inputs are empty", () => {
    const deps: ProactiveDeps = {};
    const { insights } = buildProactive(deps);
    expect(insights.length).toBe(1);
    expect(insights[0]!.kind).toBe("momentum");
  });

  it("momentum insight has non-empty text", () => {
    const { insights } = buildProactive({});
    expect(insights[0]!.text.length).toBeGreaterThan(0);
  });

  it("returns at least one insight when any input is non-empty", () => {
    expect(buildProactive({ overdue: [{ person: "p", daysSince: 1 }] }).insights.length).toBeGreaterThan(0);
    expect(buildProactive({ suggestedConnections: [{ a: "a", b: "b", why: "w" }] }).insights.length).toBeGreaterThan(0);
    expect(buildProactive({ openCells: [makeCell("c", "unresolved")] }).insights.length).toBeGreaterThan(0);
  });
});

// ─── topAsk ───────────────────────────────────────────────────────────────────

describe("topAsk", () => {
  it("returns the top insight's text as the ask sentence", () => {
    const insights: Insight[] = [
      { kind: "follow_up", text: "Reach out to alice soon.", entities: ["alice"], priority: 10 },
      { kind: "intro", text: "Introduce bob and carol.", entities: ["bob", "carol"], priority: 5 },
    ];
    const ask = topAsk({ insights });
    expect(ask).toBe("Reach out to alice soon.");
  });

  it("returns an encouraging default when insights list is empty", () => {
    const ask = topAsk({ insights: [] });
    expect(ask.length).toBeGreaterThan(0);
    expect(ask.split(" ").length).toBeLessThanOrEqual(14);
  });

  it("returned string is 14 words or fewer", () => {
    const insights: Insight[] = [
      { kind: "momentum", text: "Great work — keep capturing notes!", entities: [], priority: 1 },
    ];
    const ask = topAsk({ insights });
    expect(ask.split(" ").length).toBeLessThanOrEqual(14);
  });

  it("uses the first (highest priority) insight when multiple exist", () => {
    const insights: Insight[] = [
      { kind: "gap", text: "Fill in missing org for dave.", entities: ["dave"], priority: 20 },
      { kind: "follow_up", text: "Follow up with eve.", entities: ["eve"], priority: 3 },
    ];
    const ask = topAsk({ insights });
    expect(ask).toBe("Fill in missing org for dave.");
  });
});
