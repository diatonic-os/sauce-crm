/**
 * Tests for DailyContext — daily digest rollup from the relationship graph.
 *
 * WHY: the SauceBot needs a "what matters today" snapshot — touches logged
 * today, overdue follow-ups, stale relationships, and suggested connections
 * between same-org people who have never been directly linked. All of this
 * must be derivable purely from MapData with no side effects.
 */

import { describe, it, expect } from "vitest";
import { buildDailyDigest } from "../../src/saucebot/harness/DailyContext";
import type { DailyDigest, DailyOpts } from "../../src/saucebot/harness/DailyContext";
import type { MapData, PersonRef, OrgRef, TouchRef, IdeaRef } from "../../src/saucebot/harness/EntityCard";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const TODAY = "2024-06-15";

/**
 * Convenience: build a MapData with sane defaults.
 */
function makeData(
  people: PersonRef[],
  orgs: OrgRef[],
  touches: TouchRef[],
  ideas: IdeaRef[] = []
): MapData {
  return { people, orgs, touches, ideas };
}

// ─── touchesToday ─────────────────────────────────────────────────────────────

describe("buildDailyDigest — touchesToday", () => {
  it("returns touches whose date matches today exactly", () => {
    const touches: TouchRef[] = [
      { id: "t1", person: "p1", date: TODAY, summary: "Meeting A" },
      { id: "t2", person: "p2", date: "2024-06-14", summary: "Yesterday" },
      { id: "t3", person: "p1", date: TODAY },
    ];
    const data = makeData(
      [{ id: "p1", name: "Alice" }, { id: "p2", name: "Bob" }],
      [],
      touches
    );
    const digest = buildDailyDigest(data, { today: TODAY });
    expect(digest.touchesToday.map((t) => t.id).sort()).toEqual(["t1", "t3"].sort());
  });

  it("returns empty array when no touches match today", () => {
    const touches: TouchRef[] = [
      { id: "t1", person: "p1", date: "2024-01-01" },
    ];
    const data = makeData([{ id: "p1", name: "Alice" }], [], touches);
    const digest = buildDailyDigest(data, { today: TODAY });
    expect(digest.touchesToday).toEqual([]);
  });

  it("returns all touches when all match today", () => {
    const touches: TouchRef[] = [
      { id: "t1", person: "p1", date: TODAY },
      { id: "t2", person: "p2", date: TODAY },
    ];
    const data = makeData(
      [{ id: "p1", name: "Alice" }, { id: "p2", name: "Bob" }],
      [],
      touches
    );
    const digest = buildDailyDigest(data, { today: TODAY });
    expect(digest.touchesToday).toHaveLength(2);
  });
});

// ─── overdueFollowUps ─────────────────────────────────────────────────────────

describe("buildDailyDigest — overdueFollowUps", () => {
  it("flags person whose most-recent touch is older than cadenceDays", () => {
    // cadenceDays default = 30; p1's latest touch is 45 days before TODAY
    const touches: TouchRef[] = [
      { id: "t1", person: "p1", date: "2024-05-01" }, // 45 days before TODAY
    ];
    const data = makeData([{ id: "p1", name: "Alice" }], [], touches);
    const digest = buildDailyDigest(data, { today: TODAY });
    expect(digest.overdueFollowUps).toHaveLength(1);
    expect(digest.overdueFollowUps[0]?.person).toBe("Alice");
  });

  it("does NOT flag person whose most-recent touch is within cadenceDays", () => {
    // 10 days before TODAY — within default 30-day cadence
    const touches: TouchRef[] = [
      { id: "t1", person: "p1", date: "2024-06-05" },
    ];
    const data = makeData([{ id: "p1", name: "Alice" }], [], touches);
    const digest = buildDailyDigest(data, { today: TODAY });
    expect(digest.overdueFollowUps).toHaveLength(0);
  });

  it("uses the most-recent touch per person, not the oldest", () => {
    // p1 has an old touch AND a recent touch; recent touch should clear cadence
    const touches: TouchRef[] = [
      { id: "t1", person: "p1", date: "2024-01-01" }, // very old
      { id: "t2", person: "p1", date: "2024-06-10" }, // 5 days ago
    ];
    const data = makeData([{ id: "p1", name: "Alice" }], [], touches);
    const digest = buildDailyDigest(data, { today: TODAY });
    expect(digest.overdueFollowUps).toHaveLength(0);
  });

  it("computes daysSince correctly", () => {
    // p1 last touched 40 days before TODAY
    const touches: TouchRef[] = [
      { id: "t1", person: "p1", date: "2024-05-06" }, // 40 days before 2024-06-15
    ];
    const data = makeData([{ id: "p1", name: "Alice" }], [], touches);
    const digest = buildDailyDigest(data, { today: TODAY });
    expect(digest.overdueFollowUps[0]?.daysSince).toBe(40);
  });

  it("sorts overdueFollowUps descending by daysSince", () => {
    const touches: TouchRef[] = [
      { id: "t1", person: "p1", date: "2024-04-01" }, // ~75 days
      { id: "t2", person: "p2", date: "2024-05-01" }, // ~45 days
    ];
    const data = makeData(
      [{ id: "p1", name: "Alice" }, { id: "p2", name: "Bob" }],
      [],
      touches
    );
    const digest = buildDailyDigest(data, { today: TODAY });
    expect(digest.overdueFollowUps).toHaveLength(2);
    const [first, second] = digest.overdueFollowUps;
    expect((first?.daysSince ?? 0) >= (second?.daysSince ?? 0)).toBe(true);
  });

  it("respects a custom cadenceDays option", () => {
    // With cadenceDays=60, a 45-day-old touch should NOT be overdue
    const touches: TouchRef[] = [
      { id: "t1", person: "p1", date: "2024-05-01" }, // 45 days before TODAY
    ];
    const data = makeData([{ id: "p1", name: "Alice" }], [], touches);
    const digest = buildDailyDigest(data, { today: TODAY, cadenceDays: 60 });
    expect(digest.overdueFollowUps).toHaveLength(0);
  });

  it("reports lastTouch as the ISO date string of the most-recent touch", () => {
    const touches: TouchRef[] = [
      { id: "t1", person: "p1", date: "2024-05-01" },
    ];
    const data = makeData([{ id: "p1", name: "Alice" }], [], touches);
    const digest = buildDailyDigest(data, { today: TODAY });
    expect(digest.overdueFollowUps[0]?.lastTouch).toBe("2024-05-01");
  });

  it("excludes people with no touch records from overdueFollowUps", () => {
    // p1 has no touches — no touch record means no follow-up to flag
    const data = makeData([{ id: "p1", name: "Alice" }], [], []);
    const digest = buildDailyDigest(data, { today: TODAY });
    expect(digest.overdueFollowUps).toHaveLength(0);
  });
});

// ─── staleRelationships ───────────────────────────────────────────────────────

describe("buildDailyDigest — staleRelationships", () => {
  it("includes person name when most-recent touch is older than staleDays", () => {
    // staleDays default = 90; 120 days old → stale
    const touches: TouchRef[] = [
      { id: "t1", person: "p1", date: "2024-02-16" }, // 120 days before TODAY
    ];
    const data = makeData([{ id: "p1", name: "Alice" }], [], touches);
    const digest = buildDailyDigest(data, { today: TODAY });
    expect(digest.staleRelationships).toContain("Alice");
  });

  it("does NOT include person when most-recent touch is within staleDays", () => {
    // 45 days old — within 90-day stale threshold
    const touches: TouchRef[] = [
      { id: "t1", person: "p1", date: "2024-05-01" },
    ];
    const data = makeData([{ id: "p1", name: "Alice" }], [], touches);
    const digest = buildDailyDigest(data, { today: TODAY });
    expect(digest.staleRelationships).not.toContain("Alice");
  });

  it("respects a custom staleDays option", () => {
    // With staleDays=30, a 45-day-old touch IS stale
    const touches: TouchRef[] = [
      { id: "t1", person: "p1", date: "2024-05-01" },
    ];
    const data = makeData([{ id: "p1", name: "Alice" }], [], touches);
    const digest = buildDailyDigest(data, { today: TODAY, staleDays: 30 });
    expect(digest.staleRelationships).toContain("Alice");
  });

  it("excludes people with no touch records from staleRelationships", () => {
    const data = makeData([{ id: "p1", name: "Alice" }], [], []);
    const digest = buildDailyDigest(data, { today: TODAY });
    expect(digest.staleRelationships).not.toContain("Alice");
  });

  it("returns names only (strings), not ids", () => {
    const touches: TouchRef[] = [
      { id: "t1", person: "p1", date: "2024-02-01" },
    ];
    const data = makeData([{ id: "p1", name: "Alice" }], [], touches);
    const digest = buildDailyDigest(data, { today: TODAY });
    expect(digest.staleRelationships).not.toContain("p1");
    expect(digest.staleRelationships).toContain("Alice");
  });
});

// ─── suggestedConnections ─────────────────────────────────────────────────────

describe("buildDailyDigest — suggestedConnections", () => {
  it("suggests pairs sharing an org with no direct knows/workedWith edge", () => {
    // p1 and p2 are both in o1, but have NO direct edge between them
    const people: PersonRef[] = [
      { id: "p1", name: "Alice", org: "o1" },
      { id: "p2", name: "Bob", org: "o1" },
    ];
    const orgs: OrgRef[] = [{ id: "o1", name: "Acme Corp", members: ["p1", "p2"] }];
    const data = makeData(people, orgs, []);
    const digest = buildDailyDigest(data, { today: TODAY });
    expect(digest.suggestedConnections).toHaveLength(1);
    const conn = digest.suggestedConnections[0];
    expect([conn?.a, conn?.b].sort()).toEqual(["Alice", "Bob"].sort());
    expect(conn?.why).toBe("Both at Acme Corp");
  });

  it("excludes pair if one person knows the other (knows edge)", () => {
    const people: PersonRef[] = [
      { id: "p1", name: "Alice", org: "o1", knows: ["p2"] },
      { id: "p2", name: "Bob", org: "o1" },
    ];
    const orgs: OrgRef[] = [{ id: "o1", name: "Acme Corp", members: ["p1", "p2"] }];
    const data = makeData(people, orgs, []);
    const digest = buildDailyDigest(data, { today: TODAY });
    expect(digest.suggestedConnections).toHaveLength(0);
  });

  it("excludes pair if one person workedWith the other", () => {
    const people: PersonRef[] = [
      { id: "p1", name: "Alice", org: "o1", workedWith: ["p2"] },
      { id: "p2", name: "Bob", org: "o1" },
    ];
    const orgs: OrgRef[] = [{ id: "o1", name: "Acme Corp", members: ["p1", "p2"] }];
    const data = makeData(people, orgs, []);
    const digest = buildDailyDigest(data, { today: TODAY });
    expect(digest.suggestedConnections).toHaveLength(0);
  });

  it("excludes pair if the reverse edge exists (B workedWith A)", () => {
    const people: PersonRef[] = [
      { id: "p1", name: "Alice", org: "o1" },
      { id: "p2", name: "Bob", org: "o1", workedWith: ["p1"] },
    ];
    const orgs: OrgRef[] = [{ id: "o1", name: "Acme Corp", members: ["p1", "p2"] }];
    const data = makeData(people, orgs, []);
    const digest = buildDailyDigest(data, { today: TODAY });
    expect(digest.suggestedConnections).toHaveLength(0);
  });

  it("does not suggest cross-org pairs", () => {
    const people: PersonRef[] = [
      { id: "p1", name: "Alice", org: "o1" },
      { id: "p2", name: "Bob", org: "o2" },
    ];
    const orgs: OrgRef[] = [
      { id: "o1", name: "Acme Corp", members: ["p1"] },
      { id: "o2", name: "Beta LLC", members: ["p2"] },
    ];
    const data = makeData(people, orgs, []);
    const digest = buildDailyDigest(data, { today: TODAY });
    expect(digest.suggestedConnections).toHaveLength(0);
  });

  it("can suggest multiple pairs across multiple orgs", () => {
    const people: PersonRef[] = [
      { id: "p1", name: "Alice", org: "o1" },
      { id: "p2", name: "Bob", org: "o1" },
      { id: "p3", name: "Carol", org: "o2" },
      { id: "p4", name: "Dave", org: "o2" },
    ];
    const orgs: OrgRef[] = [
      { id: "o1", name: "Acme Corp", members: ["p1", "p2"] },
      { id: "o2", name: "Beta LLC", members: ["p3", "p4"] },
    ];
    const data = makeData(people, orgs, []);
    const digest = buildDailyDigest(data, { today: TODAY });
    expect(digest.suggestedConnections).toHaveLength(2);
  });

  it("caps results at max 10 pairs", () => {
    // 6 people in one org → C(6,2)=15 pairs → capped at 10
    const people: PersonRef[] = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i + 1}`,
      name: `Person${i + 1}`,
      org: "o1",
    }));
    const orgs: OrgRef[] = [
      { id: "o1", name: "BigCo", members: people.map((p) => p.id) },
    ];
    const data = makeData(people, orgs, []);
    const digest = buildDailyDigest(data, { today: TODAY });
    expect(digest.suggestedConnections.length).toBeLessThanOrEqual(10);
  });

  it("does not emit duplicate pairs (A,B and B,A as separate entries)", () => {
    const people: PersonRef[] = [
      { id: "p1", name: "Alice", org: "o1" },
      { id: "p2", name: "Bob", org: "o1" },
    ];
    const orgs: OrgRef[] = [{ id: "o1", name: "Acme Corp", members: ["p1", "p2"] }];
    const data = makeData(people, orgs, []);
    const digest = buildDailyDigest(data, { today: TODAY });
    expect(digest.suggestedConnections).toHaveLength(1);
  });
});

// ─── empty data safety ────────────────────────────────────────────────────────

describe("buildDailyDigest — empty data safe", () => {
  it("returns a valid digest with all empty arrays when data is empty", () => {
    const data: MapData = { people: [], orgs: [], touches: [], ideas: [] };
    const digest = buildDailyDigest(data, { today: TODAY });
    expect(digest.touchesToday).toEqual([]);
    expect(digest.overdueFollowUps).toEqual([]);
    expect(digest.staleRelationships).toEqual([]);
    expect(digest.suggestedConnections).toEqual([]);
    expect(digest.date).toBe(TODAY);
  });

  it("returns today's date in the digest regardless of data", () => {
    const data: MapData = { people: [], orgs: [], touches: [], ideas: [] };
    const digest = buildDailyDigest(data, { today: "2024-12-31" });
    expect(digest.date).toBe("2024-12-31");
  });
});

// ─── invalid date guard ───────────────────────────────────────────────────────

describe("buildDailyDigest — guards against invalid date strings", () => {
  it("ignores touch records with unparseable date strings", () => {
    const touches: TouchRef[] = [
      { id: "t1", person: "p1", date: "not-a-date" },
      { id: "t2", person: "p1", date: TODAY },
    ];
    const data = makeData([{ id: "p1", name: "Alice" }], [], touches);
    const digest = buildDailyDigest(data, { today: TODAY });
    // Only t2 should be in touchesToday; t1 should not crash anything
    expect(digest.touchesToday.map((t) => t.id)).toEqual(["t2"]);
  });
});
