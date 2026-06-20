// @vitest-environment node
//
// RelationshipAnalytics — engine unit tests. The bulk exercises the PURE
// functions (no Obsidian) since all calculation logic lives there. One
// integration test wires EntityService through the obsidian stub to prove the
// normalization layer.

import { describe, expect, it } from "vitest";
import { App, TFile, TFolder } from "obsidian";
import { DEFAULT_PATHS, EntityService } from "../../src/services/EntityService";
import {
  RelationshipAnalytics,
  coerceIsoDay,
  daysSince,
  cadenceInterval,
  pearson,
  overdueReconnect,
  highValueLowTouch,
  pipelineAttention,
  cadenceVsClosenessCorrelation,
  interpretCorrelation,
  rankSuggestions,
  buildReport,
  type PersonStat,
  type DealStat,
} from "../../src/services/RelationshipAnalytics";

const NOW = new Date("2026-06-19T12:00:00Z");

function person(p: Partial<PersonStat> & { path: string }): PersonStat {
  return {
    name: p.name ?? p.path,
    closeness: p.closeness ?? 3,
    cadence: p.cadence ?? "quarterly",
    lastTouch: p.lastTouch ?? null,
    touchCount: p.touchCount ?? 0,
    ...p,
  };
}

function deal(d: Partial<DealStat> & { path: string }): DealStat {
  return {
    title: d.title ?? d.path,
    stage: d.stage ?? "prospect",
    value: d.value ?? null,
    lastActivity: d.lastActivity ?? null,
    ...d,
  };
}

// ---------------------------------------------------------------------------
// Date / math primitives
// ---------------------------------------------------------------------------

describe("date + math primitives", () => {
  it("coerceIsoDay normalizes Date objects and strings, rejects junk", () => {
    expect(coerceIsoDay(new Date("2026-05-01T00:00:00Z"))).toBe("2026-05-01");
    expect(coerceIsoDay("2026-05-01")).toBe("2026-05-01");
    expect(coerceIsoDay("2026-05-01T09:30:00")).toBe("2026-05-01");
    expect(coerceIsoDay(null)).toBeNull();
    expect(coerceIsoDay("not a date")).toBeNull();
    expect(coerceIsoDay(new Date("invalid"))).toBeNull();
  });

  it("daysSince counts whole days into the past", () => {
    expect(daysSince("2026-06-09", NOW)).toBe(10);
    expect(daysSince(null, NOW)).toBeNull();
  });

  it("cadenceInterval maps cadences with a quarterly default", () => {
    expect(cadenceInterval("monthly")).toBe(30);
    expect(cadenceInterval("bi-annual")).toBe(182);
    expect(cadenceInterval("unknown")).toBe(90);
  });

  it("pearson computes a perfect positive correlation", () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])).toBeCloseTo(1, 6);
  });

  it("pearson computes a perfect negative correlation", () => {
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])).toBeCloseTo(-1, 6);
  });

  it("pearson returns null for <2 points or zero variance", () => {
    expect(pearson([1], [2])).toBeNull();
    expect(pearson([5, 5, 5], [1, 2, 3])).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// overdueReconnect
// ---------------------------------------------------------------------------

describe("overdueReconnect", () => {
  it("flags people past their cadence interval, skips on-time ones", () => {
    const people = [
      // 100d since touch, quarterly (90d) => 10d overdue.
      person({
        path: "people/A.md",
        name: "A",
        closeness: 4,
        cadence: "quarterly",
        lastTouch: "2026-03-11",
      }),
      // 10d since touch, monthly (30d) => on time, skipped.
      person({
        path: "people/B.md",
        name: "B",
        closeness: 5,
        cadence: "monthly",
        lastTouch: "2026-06-09",
      }),
    ];
    const out = overdueReconnect(people, NOW);
    expect(out.map((s) => s.targetPath)).toEqual(["people/A.md"]);
    expect(out[0]!.kind).toBe("overdue-reconnect");
    expect(out[0]!.id).toBe("overdue-reconnect:people-A-md");
    expect(out[0]!.rationale).toContain("10d overdue");
  });

  it("ranks by closeness * daysOverdue", () => {
    const people = [
      // closeness 2, 100d overdue (quarterly, last touch 190d ago) => score 200
      person({
        path: "people/Far.md",
        closeness: 2,
        cadence: "quarterly",
        lastTouch: "2025-12-11",
      }),
      // closeness 5, 60d overdue (monthly, last touch 90d ago) => score 300
      person({
        path: "people/Close.md",
        closeness: 5,
        cadence: "monthly",
        lastTouch: "2026-03-21",
      }),
    ];
    const out = overdueReconnect(people, NOW);
    expect(out[0]!.targetPath).toBe("people/Close.md");
    expect(out[0]!.score).toBeGreaterThan(out[1]!.score);
  });

  it("treats a never-touched person as overdue against their cadence", () => {
    const out = overdueReconnect(
      [
        person({
          path: "people/New.md",
          closeness: 3,
          cadence: "monthly",
          lastTouch: null,
        }),
      ],
      NOW,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.rationale).toContain("no touch on record");
  });
});

// ---------------------------------------------------------------------------
// highValueLowTouch
// ---------------------------------------------------------------------------

describe("highValueLowTouch", () => {
  it("flags only high-closeness contacts with a large touch gap", () => {
    const people = [
      person({
        path: "people/Vip.md",
        name: "Vip",
        closeness: 5,
        lastTouch: "2026-01-01",
      }), // ~169d gap
      person({
        path: "people/Recent.md",
        closeness: 5,
        lastTouch: "2026-06-01",
      }), // 18d gap, skipped
      person({ path: "people/Low.md", closeness: 2, lastTouch: "2025-01-01" }), // low closeness, skipped
    ];
    const out = highValueLowTouch(people, NOW);
    expect(out.map((s) => s.targetPath)).toEqual(["people/Vip.md"]);
    expect(out[0]!.severity).toBe("critical"); // closeness 5
  });

  it("respects custom thresholds", () => {
    const people = [
      person({ path: "people/X.md", closeness: 4, lastTouch: "2026-06-01" }),
    ];
    expect(highValueLowTouch(people, NOW, { minGapDays: 10 })).toHaveLength(1);
    expect(highValueLowTouch(people, NOW, { minGapDays: 30 })).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// pipelineAttention
// ---------------------------------------------------------------------------

describe("pipelineAttention", () => {
  it("flags stalled deals and untouched deals, skips closed + fresh", () => {
    const deals = [
      deal({
        path: "pipeline/Stalled.md",
        title: "Stalled",
        stage: "negotiation",
        value: 50000,
        lastActivity: "2026-04-01",
      }), // ~79d stale
      deal({
        path: "pipeline/Fresh.md",
        stage: "proposal",
        lastActivity: "2026-06-10",
      }), // 9d, skipped
      deal({
        path: "pipeline/NoTouch.md",
        title: "NoTouch",
        stage: "prospect",
        value: 10000,
        lastActivity: null,
      }),
      deal({
        path: "pipeline/Won.md",
        stage: "closed-won",
        lastActivity: null,
      }), // closed, skipped
    ];
    const out = pipelineAttention(deals, NOW);
    const paths = out.map((s) => s.targetPath);
    expect(paths).toContain("pipeline/Stalled.md");
    expect(paths).toContain("pipeline/NoTouch.md");
    expect(paths).not.toContain("pipeline/Fresh.md");
    expect(paths).not.toContain("pipeline/Won.md");
    const stalled = out.find((s) => s.targetPath === "pipeline/Stalled.md")!;
    expect(stalled.kind).toBe("stalled-deal");
    expect(stalled.rationale).toContain("since last activity");
    const noTouch = out.find((s) => s.targetPath === "pipeline/NoTouch.md")!;
    expect(noTouch.kind).toBe("deal-no-touch");
  });

  it("escalates severity for very stale deals", () => {
    const out = pipelineAttention(
      [
        deal({
          path: "pipeline/Ancient.md",
          stage: "proposal",
          lastActivity: "2026-01-01",
        }),
      ], // ~169d > 90d
      NOW,
    );
    expect(out[0]!.severity).toBe("critical");
  });
});

// ---------------------------------------------------------------------------
// correlation
// ---------------------------------------------------------------------------

describe("cadenceVsClosenessCorrelation", () => {
  it("reports a positive correlation when close contacts are touched more", () => {
    const people = [
      person({ path: "a", closeness: 1, touchCount: 0 }),
      person({ path: "b", closeness: 2, touchCount: 1 }),
      person({ path: "c", closeness: 4, touchCount: 5 }),
      person({ path: "d", closeness: 5, touchCount: 9 }),
    ];
    const res = cadenceVsClosenessCorrelation(people);
    expect(res.n).toBe(4);
    expect(res.r).toBeGreaterThan(0.8);
    expect(res.interpretation.toLowerCase()).toContain("positive");
  });

  it("reports a negative correlation (coverage gap)", () => {
    const people = [
      person({ path: "a", closeness: 1, touchCount: 9 }),
      person({ path: "b", closeness: 5, touchCount: 0 }),
      person({ path: "c", closeness: 4, touchCount: 1 }),
    ];
    const res = cadenceVsClosenessCorrelation(people);
    expect(res.r).toBeLessThan(0);
    expect(res.interpretation.toLowerCase()).toContain("negative");
  });

  it("interpretCorrelation handles undefined / tiny samples gracefully", () => {
    expect(interpretCorrelation(null, 1)).toContain("Not enough");
    expect(interpretCorrelation(null, 5)).toContain("undefined");
  });
});

// ---------------------------------------------------------------------------
// ranking + report composition
// ---------------------------------------------------------------------------

describe("rankSuggestions + buildReport", () => {
  it("orders critical before warning regardless of raw score", () => {
    const warning = {
      id: "w",
      kind: "stalled-deal" as const,
      title: "w",
      rationale: "",
      severity: "warning" as const,
      targetPath: "w",
      score: 9999,
    };
    const critical = {
      id: "c",
      kind: "overdue-reconnect" as const,
      title: "c",
      rationale: "",
      severity: "critical" as const,
      targetPath: "c",
      score: 1,
    };
    const ranked = rankSuggestions([[warning], [critical]]);
    expect(ranked[0]!.id).toBe("c");
  });

  it("respects the limit", () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: `s${i}`,
      kind: "overdue-reconnect" as const,
      title: "",
      rationale: "",
      severity: "warning" as const,
      targetPath: `p${i}`,
      score: i,
    }));
    expect(rankSuggestions([many], 5)).toHaveLength(5);
  });

  it("buildReport composes suggestions + correlation", () => {
    const people = [
      person({
        path: "people/Vip.md",
        name: "Vip",
        closeness: 5,
        cadence: "monthly",
        lastTouch: "2026-01-01",
        touchCount: 8,
      }),
      person({
        path: "people/Quiet.md",
        name: "Quiet",
        closeness: 1,
        cadence: "ad-hoc",
        lastTouch: "2026-06-10",
        touchCount: 0,
      }),
    ];
    const deals = [
      deal({
        path: "pipeline/D.md",
        stage: "proposal",
        value: 20000,
        lastActivity: null,
      }),
    ];
    const report = buildReport(people, deals, NOW);
    expect(report.suggestions.length).toBeGreaterThan(0);
    expect(report.cadenceVsCloseness.n).toBe(2);
    expect(report.generatedAt).toBe(NOW.toISOString());
    // Vip should surface via both overdue + high-value-low-touch streams.
    expect(
      report.suggestions.some((s) => s.targetPath === "people/Vip.md"),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Service-layer integration through the obsidian stub
// ---------------------------------------------------------------------------

/** Create a markdown entity AND wire it into its folder's children chain so
 *  EntityService.listEntitiesIn (which walks TFolder.children) can find it. */
async function makeEntity(
  app: App,
  path: string,
  fm: Record<string, unknown>,
): Promise<void> {
  const file = await app.vault.create(
    path,
    `---\n${JSON.stringify(fm)}\n---\n`,
  );
  app.metadataCache.setFrontmatter(path, fm);
  // Walk path segments, ensuring each folder exists and chaining children.
  const segs = path.split("/");
  let prefix = "";
  let parent: TFolder | null = null;
  for (let i = 0; i < segs.length - 1; i++) {
    prefix = prefix ? `${prefix}/${segs[i]}` : segs[i]!;
    let folder = app.vault.getAbstractFileByPath(prefix) as TFolder | null;
    if (!(folder instanceof TFolder))
      folder = await app.vault.createFolder(prefix);
    if (parent && !parent.children.includes(folder))
      parent.children.push(folder);
    parent = folder;
  }
  if (parent && !parent.children.includes(file as unknown as TFile)) {
    parent.children.push(file as unknown as TFile);
  }
}

// ---------------------------------------------------------------------------
// Task 2.4 — channelCounts / outcomeCounts / degree on PersonStat
// ---------------------------------------------------------------------------

describe("PersonStat channel/outcome/degree fields (Task 2.4)", () => {
  it("tallies channelCounts per channel and outcomeCounts per tag", async () => {
    const app = new App();
    const entities = new EntityService(app, DEFAULT_PATHS);

    await makeEntity(app, "people/Carol.md", {
      type: "warm-contact",
      name: "Carol",
      closeness: 3,
      cadence: "quarterly",
    });
    // Two call touches + one email touch on Carol
    await makeEntity(app, "touches/t-c1.md", {
      type: "touch",
      contact: "[[Carol]]",
      date: "2026-05-01",
      channel: "call",
      outcome_tags: ["intro", "followup"],
    });
    await makeEntity(app, "touches/t-c2.md", {
      type: "touch",
      contact: "[[Carol]]",
      date: "2026-05-15",
      channel: "call",
      outcome_tags: ["followup"],
    });
    await makeEntity(app, "touches/t-c3.md", {
      type: "touch",
      contact: "[[Carol]]",
      date: "2026-06-01",
      channel: "email",
      outcome_tags: [],
    });

    const analytics = new RelationshipAnalytics(app, entities);
    const stats = analytics.peopleStats(NOW);
    const carol = stats.find((p) => p.path === "people/Carol.md")!;

    expect(carol.touchCount).toBe(3);
    expect(carol.channelCounts["call"]).toBe(2);
    expect(carol.channelCounts["email"]).toBe(1);
    expect(carol.outcomeCounts["followup"]).toBe(2);
    expect(carol.outcomeCounts["intro"]).toBe(1);
    // degree defaults to 0 when GraphAtlasService is not injected
    expect(carol.degree).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Task 2.5 — degree wiring via injected GraphAtlasService
// ---------------------------------------------------------------------------

describe("PersonStat degree (Task 2.5)", () => {
  it("populates degree from an injected GraphAtlasService snapshot", async () => {
    const app = new App();
    const entities = new EntityService(app, DEFAULT_PATHS);

    await makeEntity(app, "people/Diane.md", {
      type: "warm-contact",
      name: "Diane",
      closeness: 4,
      cadence: "monthly",
    });

    const analytics = new RelationshipAnalytics(app, entities);

    // Inject a minimal mock GraphAtlasService that reports degree=7 for Diane.
    analytics.graphAtlas = {
      snapshot: () => ({
        nodes: [{ path: "people/Diane.md", degree: 7 }],
        edges: [],
        nodeById: new Map(),
      }),
    } as unknown as import("../../src/services/GraphAtlasService").GraphAtlasService;

    const stats = analytics.peopleStats(NOW);
    const diane = stats.find((p) => p.path === "people/Diane.md")!;
    expect(diane).toBeDefined();
    expect(diane.degree).toBe(7);
  });

  it("defaults degree to 0 when no graphAtlas is set", async () => {
    const app = new App();
    const entities = new EntityService(app, DEFAULT_PATHS);
    await makeEntity(app, "people/Eve.md", {
      type: "warm-contact",
      name: "Eve",
      closeness: 3,
      cadence: "quarterly",
    });
    const analytics = new RelationshipAnalytics(app, entities);
    const stats = analytics.peopleStats(NOW);
    const eve = stats.find((p) => p.path === "people/Eve.md")!;
    expect(eve.degree).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Service-layer integration through the obsidian stub
// ---------------------------------------------------------------------------

describe("RelationshipAnalytics service (wired to EntityService)", () => {
  it("normalizes people/touches/deals and produces a real report", async () => {
    const app = new App();
    const entities = new EntityService(app, DEFAULT_PATHS);

    await makeEntity(app, "people/Alice.md", {
      type: "warm-contact",
      name: "Alice",
      closeness: 5,
      cadence: "monthly",
      last_touch: "2026-02-01", // ~138d ago, monthly => very overdue
    });
    await makeEntity(app, "people/Bob.md", {
      type: "warm-contact",
      name: "Bob",
      closeness: 2,
      cadence: "ad-hoc",
      last_touch: "2026-06-15",
    });
    // Two touches on Alice => touchCount 2 (frequency signal).
    await makeEntity(app, "touches/2026/06/t1.md", {
      type: "touch",
      contact: "[[Alice]]",
      date: "2026-02-01",
      channel: "call",
    });
    await makeEntity(app, "touches/2026/06/t2.md", {
      type: "touch",
      contact: "[[Alice]]",
      date: "2026-01-10",
      channel: "email",
    });
    await makeEntity(app, "pipeline/BigDeal.md", {
      type: "pipeline-deal",
      title: "Big Deal",
      stage: "negotiation",
      value: 75000,
      entity: "[[Alice]]",
    });

    const analytics = new RelationshipAnalytics(app, entities);

    const peopleStats = analytics.peopleStats(NOW);
    const alice = peopleStats.find((p) => p.path === "people/Alice.md")!;
    expect(alice.touchCount).toBe(2);
    expect(alice.lastTouch).toBe("2026-02-01");
    expect(alice.closeness).toBe(5);

    const dealStats = analytics.dealStats();
    const big = dealStats.find((d) => d.path === "pipeline/BigDeal.md")!;
    // Last activity resolves from Alice's most-recent touch (2026-02-01).
    expect(big.lastActivity).toBe("2026-02-01");
    expect(big.value).toBe(75000);

    const report = analytics.report(NOW);
    expect(report.suggestions.length).toBeGreaterThan(0);
    // Alice (overdue, high-value, cooling) must surface.
    expect(
      report.suggestions.some((s) => s.targetPath === "people/Alice.md"),
    ).toBe(true);
    // The stalled big deal must surface.
    expect(
      report.suggestions.some((s) => s.targetPath === "pipeline/BigDeal.md"),
    ).toBe(true);
    expect(report.cadenceVsCloseness.n).toBe(2);

    // fileForSuggestion round-trips a real TFile.
    const first = report.suggestions[0]!;
    expect(analytics.fileForSuggestion(first)).toBeInstanceOf(TFile);
  });
});
