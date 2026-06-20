// @vitest-environment node
//
// Task 2.3 — CrossMatrixAnalytics unit tests.

import { describe, expect, it } from "vitest";
import { buildCrossMatrix } from "@/services/stats/CrossMatrixAnalytics";
import type { PersonStat } from "@/services/RelationshipAnalytics";
import type { DealStat } from "@/services/RelationshipAnalytics";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

function makePerson(
  path: string,
  overrides: Partial<PersonStat> = {},
): PersonStat {
  return {
    path,
    name: path,
    closeness: 3,
    cadence: "quarterly",
    lastTouch: "2026-05-01",
    touchCount: 2,
    channelCounts: { call: 1, email: 1 },
    outcomeCounts: {},
    degree: 2,
    ...overrides,
  };
}

function makeDeal(path: string, overrides: Partial<DealStat> = {}): DealStat {
  return {
    path,
    title: path,
    stage: "prospect",
    value: null,
    lastActivity: null,
    ...overrides,
  };
}

// NOW reference date for "days since touch" calculations
const NOW_ISO = "2026-06-20";

// Build a small but varied dataset
function buildPeople(): PersonStat[] {
  return [
    makePerson("p/Alice.md", {
      closeness: 5,
      touchCount: 10,
      degree: 5,
      lastTouch: "2026-06-01", // 19d ago
      channelCounts: { call: 8, email: 2 },
    }),
    makePerson("p/Bob.md", {
      closeness: 3,
      touchCount: 4,
      degree: 3,
      lastTouch: "2026-05-31", // 20d ago
      channelCounts: { call: 2, email: 2 },
    }),
    makePerson("p/Carol.md", {
      closeness: 2,
      touchCount: 2,
      degree: 2,
      lastTouch: "2026-05-30", // 21d ago
      channelCounts: { email: 2 },
    }),
    makePerson("p/Dave.md", {
      closeness: 4,
      touchCount: 7,
      degree: 4,
      lastTouch: "2026-05-29", // 22d ago
      channelCounts: { call: 5, email: 2 },
    }),
    // Extra person to break the n=5 z-score ceiling of exactly 2.0
    makePerson("p/Eve.md", {
      closeness: 3,
      touchCount: 3,
      degree: 2,
      lastTouch: "2026-05-28", // 23d ago
      channelCounts: { call: 1, email: 2 },
    }),
    // Outlier: high closeness but very long gap (planted outlier for z-score test).
    // Clustered others: 19-23d ago. Outlier at ~780d → z comfortably above 2.
    makePerson("p/Outlier.md", {
      closeness: 5,
      touchCount: 1,
      degree: 1,
      lastTouch: "2024-05-01", // ~780d ago — extreme daysSinceTouch
      channelCounts: { call: 1 },
    }),
  ];
}

function buildDeals(): DealStat[] {
  return [
    makeDeal("d/D1.md", { stage: "prospect", value: 10000 }),
    makeDeal("d/D2.md", { stage: "negotiation", value: 50000 }),
  ];
}

function buildOrgMap(people: PersonStat[]): Map<string, string> {
  const m = new Map<string, string>();
  m.set("p/Alice.md", "Acme");
  m.set("p/Bob.md", "Acme");
  m.set("p/Carol.md", "Beta");
  m.set("p/Dave.md", "Beta");
  m.set("p/Eve.md", "Beta");
  m.set("p/Outlier.md", "Gamma");
  for (const p of people) {
    if (!m.has(p.path)) m.set(p.path, "Unknown");
  }
  return m;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("buildCrossMatrix", () => {
  const people = buildPeople();
  const deals = buildDeals();
  const orgsByPerson = buildOrgMap(people);
  const report = buildCrossMatrix(people, orgsByPerson, deals, NOW_ISO);

  it("variables list has exactly 5 entries", () => {
    expect(report.variables).toEqual([
      "closeness",
      "touchCount",
      "degree",
      "daysSinceTouch",
      "callShare",
    ]);
  });

  it("matrix is 5×5", () => {
    expect(report.matrix).toHaveLength(5);
    for (const row of report.matrix) {
      expect(row).toHaveLength(5);
    }
  });

  it("diagonal is all 1 (self-correlation)", () => {
    for (let i = 0; i < 5; i++) {
      expect(report.matrix[i]![i]).toBe(1);
    }
  });

  it("matrix is symmetric: matrix[i][j] === matrix[j][i]", () => {
    for (let i = 0; i < 5; i++) {
      for (let j = 0; j < 5; j++) {
        const a = report.matrix[i]![j];
        const b = report.matrix[j]![i];
        if (a == null && b == null) continue;
        expect(a).toBeCloseTo(b!, 10);
      }
    }
  });

  it("topPairs is sorted by |r| descending", () => {
    const pairs = report.topPairs;
    expect(pairs.length).toBeGreaterThan(0);
    for (let i = 1; i < pairs.length; i++) {
      expect(Math.abs(pairs[i - 1]!.r)).toBeGreaterThanOrEqual(
        Math.abs(pairs[i]!.r),
      );
    }
  });

  it("topPairs each have a strength label", () => {
    for (const pair of report.topPairs) {
      expect(typeof pair.strength).toBe("string");
      expect(pair.strength.length).toBeGreaterThan(0);
    }
  });

  it("orgRollups has one entry per distinct org", () => {
    const orgs = report.orgRollups.map((r) => r.org).sort();
    expect(orgs).toContain("Acme");
    expect(orgs).toContain("Beta");
    expect(orgs).toContain("Gamma");
  });

  it("orgRollup healthScore is in [0, 1]", () => {
    for (const rollup of report.orgRollups) {
      expect(rollup.healthScore).toBeGreaterThanOrEqual(0);
      expect(rollup.healthScore).toBeLessThanOrEqual(1);
    }
  });

  it("orgRollup Acme has 2 people and non-zero touches", () => {
    const acme = report.orgRollups.find((r) => r.org === "Acme")!;
    expect(acme.people).toBe(2);
    expect(acme.totalTouches).toBeGreaterThan(0);
  });

  it("outliers contains the planted Outlier (extreme daysSinceTouch z-score)", () => {
    const paths = report.outliers.map((o) => o.path);
    expect(paths).toContain("p/Outlier.md");
    const out = report.outliers.find((o) => o.path === "p/Outlier.md")!;
    expect(Math.abs(out.z)).toBeGreaterThanOrEqual(2);
  });

  it("outliers each have a note string", () => {
    for (const o of report.outliers) {
      expect(typeof o.note).toBe("string");
    }
  });
});

describe("buildCrossMatrix edge cases", () => {
  it("returns a valid (null-cell) report for a single person", () => {
    const p = [
      makePerson("p/Solo.md", { closeness: 3, touchCount: 1, degree: 0 }),
    ];
    const orgMap = new Map([["p/Solo.md", "Alone"]]);
    const report = buildCrossMatrix(p, orgMap, [], NOW_ISO);
    expect(report.variables).toHaveLength(5);
    // With n=1 pearson returns null — diagonal still 1, off-diag null
    expect(report.matrix[0]![0]).toBe(1);
    expect(report.orgRollups).toHaveLength(1);
    expect(report.orgRollups[0]!.healthScore).toBeGreaterThanOrEqual(0);
    expect(report.outliers).toHaveLength(0); // no z ≥ 2 with 1 sample
  });

  it("returns empty report for zero people", () => {
    const report = buildCrossMatrix([], new Map(), [], NOW_ISO);
    expect(report.matrix).toHaveLength(5);
    for (const row of report.matrix) {
      expect(row).toHaveLength(5);
    }
    expect(report.orgRollups).toHaveLength(0);
    expect(report.outliers).toHaveLength(0);
  });
});
