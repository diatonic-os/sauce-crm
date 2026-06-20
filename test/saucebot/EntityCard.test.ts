/**
 * Tests for EntityCard — entity card projection and connection matrix builder.
 *
 * WHY: the relationship-visualization map needs a pure-data layer that
 * aggregates touches, related people, and ideas for any given person or org
 * card — and produces a node/edge matrix for the full graph view.
 */

import { describe, it, expect } from "vitest";
import {
  buildEntityCard,
  buildConnectionMatrix,
} from "../../src/saucebot/harness/EntityCard";
import type {
  PersonRef,
  OrgRef,
  TouchRef,
  IdeaRef,
  MapData,
  EntityCard,
  ConnectionMatrix,
} from "../../src/saucebot/harness/EntityCard";

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const people: PersonRef[] = [
  {
    id: "p1",
    name: "Alice",
    org: "o1",
    knows: ["p2"],
    workedWith: ["p3"],
  },
  {
    id: "p2",
    name: "Bob",
    org: "o1",
    knows: ["p1"],
  },
  {
    id: "p3",
    name: "Carol",
    org: "o2",
    workedWith: ["p1"],
  },
  {
    id: "p4",
    name: "Dave",
    // no org, no connections
  },
];

const orgs: OrgRef[] = [
  { id: "o1", name: "Acme Corp", members: ["p1", "p2"] },
  { id: "o2", name: "Beta LLC", members: ["p3"] },
];

const touches: TouchRef[] = [
  {
    id: "t1",
    person: "p1",
    org: "o1",
    date: "2024-01-10",
    summary: "Intro call",
  },
  {
    id: "t2",
    person: "p2",
    org: "o1",
    date: "2024-02-15",
    summary: "Follow-up",
  },
  {
    id: "t3",
    person: "p1",
    date: "2024-03-01",
    summary: "Coffee chat",
  },
  {
    id: "t4",
    person: "p3",
    org: "o2",
    date: "2024-03-20",
    summary: "Demo",
  },
];

const ideas: IdeaRef[] = [
  { id: "i1", title: "OSS strategy", about: ["p1", "o1"] },
  { id: "i2", title: "Product pivot", about: ["p2"] },
  { id: "i3", title: "Unrelated idea" },
];

const data: MapData = { people, orgs, touches, ideas };

// ─── buildEntityCard — person card ───────────────────────────────────────────

describe("buildEntityCard — person card for Alice (p1)", () => {
  let card: EntityCard | null;

  it("returns a non-null EntityCard for a known person id", () => {
    card = buildEntityCard("p1", data);
    expect(card).not.toBeNull();
  });

  it("has correct id, kind, name, and org", () => {
    card = buildEntityCard("p1", data);
    expect(card?.id).toBe("p1");
    expect(card?.kind).toBe("person");
    expect(card?.name).toBe("Alice");
    expect(card?.org).toBe("o1");
  });

  it("aggregates relatedPeople from knows + workedWith, excluding self", () => {
    card = buildEntityCard("p1", data);
    // Alice knows p2, workedWith p3 — both should appear, self excluded
    expect(card?.relatedPeople.sort()).toEqual(["p2", "p3"].sort());
  });

  it("includes co-attendees of shared touches in relatedPeople", () => {
    // p1 and p2 both have touches with org o1 (t1, t2)
    // co-attendee logic: if two people each have a touch on the same org,
    // they are considered co-attendees of that org's relationship
    // p2 is already in relatedPeople via knows, so ensure dedup
    card = buildEntityCard("p1", data);
    const related = card?.relatedPeople ?? [];
    // p2 has touch t2 on o1; p1 has touch t1 on o1 → co-attendees
    expect(related).toContain("p2");
    // no duplicate
    const count = related.filter((id) => id === "p2").length;
    expect(count).toBe(1);
  });

  it("lists all touches where person === id", () => {
    card = buildEntityCard("p1", data);
    const touchIds = (card?.touches ?? []).map((t) => t.id).sort();
    expect(touchIds).toEqual(["t1", "t3"].sort());
  });

  it("lists ideas whose about array includes id", () => {
    card = buildEntityCard("p1", data);
    const ideaIds = (card?.ideas ?? []).map((i) => i.id).sort();
    expect(ideaIds).toEqual(["i1"].sort());
  });

  it("does not include ideas not mentioning id", () => {
    card = buildEntityCard("p1", data);
    const ideaIds = (card?.ideas ?? []).map((i) => i.id);
    expect(ideaIds).not.toContain("i2");
    expect(ideaIds).not.toContain("i3");
  });
});

// ─── buildEntityCard — person with no connections ────────────────────────────

describe("buildEntityCard — person card for Dave (p4, no connections)", () => {
  it("returns card with empty relatedPeople, touches, ideas", () => {
    const card = buildEntityCard("p4", data);
    expect(card).not.toBeNull();
    expect(card?.relatedPeople).toEqual([]);
    expect(card?.touches).toEqual([]);
    expect(card?.ideas).toEqual([]);
    expect(card?.kind).toBe("person");
  });
});

// ─── buildEntityCard — org card ───────────────────────────────────────────────

describe("buildEntityCard — org card for Acme Corp (o1)", () => {
  let card: EntityCard | null;

  it("returns a non-null EntityCard for a known org id", () => {
    card = buildEntityCard("o1", data);
    expect(card).not.toBeNull();
  });

  it("has correct id, kind, name, and members", () => {
    card = buildEntityCard("o1", data);
    expect(card?.id).toBe("o1");
    expect(card?.kind).toBe("org");
    expect(card?.name).toBe("Acme Corp");
    expect(card?.members?.sort()).toEqual(["p1", "p2"].sort());
  });

  it("rolls up touches where org === id (direct org touches)", () => {
    card = buildEntityCard("o1", data);
    const touchIds = (card?.touches ?? []).map((t) => t.id).sort();
    // t1 (p1 + o1), t2 (p2 + o1) — both have org=o1
    expect(touchIds).toEqual(["t1", "t2"].sort());
  });

  it("does not include touches with no org or a different org", () => {
    card = buildEntityCard("o1", data);
    const touchIds = (card?.touches ?? []).map((t) => t.id);
    expect(touchIds).not.toContain("t3"); // p1 coffee chat, no org
    expect(touchIds).not.toContain("t4"); // p3 + o2
  });

  it("lists ideas whose about array includes the org id", () => {
    card = buildEntityCard("o1", data);
    const ideaIds = (card?.ideas ?? []).map((i) => i.id);
    expect(ideaIds).toContain("i1"); // about: [p1, o1]
    expect(ideaIds).not.toContain("i2");
    expect(ideaIds).not.toContain("i3");
  });

  it("relatedPeople equals members for an org", () => {
    card = buildEntityCard("o1", data);
    expect(card?.relatedPeople.sort()).toEqual((card?.members ?? []).slice().sort());
  });
});

// ─── buildEntityCard — null for unknown id ────────────────────────────────────

describe("buildEntityCard — returns null for unknown id", () => {
  it("returns null when id matches no person or org", () => {
    const card = buildEntityCard("DOES_NOT_EXIST", data);
    expect(card).toBeNull();
  });
});

// ─── buildConnectionMatrix ────────────────────────────────────────────────────

describe("buildConnectionMatrix — nodes", () => {
  let matrix: ConnectionMatrix;

  it("includes a node for every person", () => {
    matrix = buildConnectionMatrix(data);
    const ids = matrix.nodes.map((n) => n.id);
    expect(ids).toContain("p1");
    expect(ids).toContain("p2");
    expect(ids).toContain("p3");
    expect(ids).toContain("p4");
  });

  it("includes a node for every org", () => {
    matrix = buildConnectionMatrix(data);
    const ids = matrix.nodes.map((n) => n.id);
    expect(ids).toContain("o1");
    expect(ids).toContain("o2");
  });

  it("nodes carry correct kind and name", () => {
    matrix = buildConnectionMatrix(data);
    const alice = matrix.nodes.find((n) => n.id === "p1");
    expect(alice?.kind).toBe("person");
    expect(alice?.name).toBe("Alice");

    const acme = matrix.nodes.find((n) => n.id === "o1");
    expect(acme?.kind).toBe("org");
    expect(acme?.name).toBe("Acme Corp");
  });
});

describe("buildConnectionMatrix — edges", () => {
  let matrix: ConnectionMatrix;

  beforeAll(() => {
    matrix = buildConnectionMatrix(data);
  });

  it("includes 'knows' edges from person.knows", () => {
    // Alice knows Bob, Bob knows Alice
    const edge = matrix.edges.find(
      (e) => e.source === "p1" && e.target === "p2" && e.relation === "knows"
    );
    expect(edge).toBeDefined();
  });

  it("includes 'worked_with' edges from person.workedWith", () => {
    // Alice workedWith Carol, Carol workedWith Alice
    const edge = matrix.edges.find(
      (e) => e.source === "p1" && e.target === "p3" && e.relation === "worked_with"
    );
    expect(edge).toBeDefined();
  });

  it("includes 'member_of' edges from org.members (person -> org)", () => {
    const e1 = matrix.edges.find(
      (e) => e.source === "p1" && e.target === "o1" && e.relation === "member_of"
    );
    const e2 = matrix.edges.find(
      (e) => e.source === "p2" && e.target === "o1" && e.relation === "member_of"
    );
    expect(e1).toBeDefined();
    expect(e2).toBeDefined();
  });

  it("includes 'touched' edges from touches with org (person -> org)", () => {
    // t1: p1 -> o1, t2: p2 -> o1, t4: p3 -> o2
    const e1 = matrix.edges.find(
      (e) => e.source === "p1" && e.target === "o1" && e.relation === "touched"
    );
    const e2 = matrix.edges.find(
      (e) => e.source === "p3" && e.target === "o2" && e.relation === "touched"
    );
    expect(e1).toBeDefined();
    expect(e2).toBeDefined();
  });

  it("deduplicates edges (same source/target/relation appears once)", () => {
    // p1 -> o1 member_of (via o1.members) should appear exactly once
    const memberEdges = matrix.edges.filter(
      (e) => e.source === "p1" && e.target === "o1" && e.relation === "member_of"
    );
    expect(memberEdges.length).toBe(1);

    // p1 -> o1 touched (t1 only, not duplicated)
    const touchEdges = matrix.edges.filter(
      (e) => e.source === "p1" && e.target === "o1" && e.relation === "touched"
    );
    expect(touchEdges.length).toBe(1);
  });

  it("does not include 'touched' edge for touches without an org", () => {
    // t3: p1, no org — should produce no touched edge
    const badEdge = matrix.edges.find(
      (e) => e.source === "p1" && e.relation === "touched" && e.target === undefined
    );
    expect(badEdge).toBeUndefined();
  });
});

// ─── import { beforeAll } from "vitest" — add missing import ─────────────────
import { beforeAll } from "vitest";
