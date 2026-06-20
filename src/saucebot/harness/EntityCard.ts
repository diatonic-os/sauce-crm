/**
 * EntityCard — pure data projection layer for the relationship visualization map.
 *
 * WHY THIS EXISTS:
 * Opening a person or org card in the UI needs a pre-aggregated snapshot:
 * their touches, the people they are connected to (directly or via shared
 * org touches), and the ideas attributed to them.  The connection matrix
 * backs the full graph view (every node + de-duplicated edges).
 *
 * DESIGN:
 * - Pure functions, zero external dependencies (no obsidian, no lancedb).
 * - All side-effecting capability is injected so tests can use plain fakes.
 * - Input types are self-contained; callers supply plain data bags.
 * - Satisfies exactOptionalPropertyTypes: optional fields are omitted on
 *   objects where they do not apply, never set to `undefined` explicitly.
 */

// ─── Input types ─────────────────────────────────────────────────────────────

/** A person node in the relationship graph. */
export interface PersonRef {
  id: string;
  name: string;
  /** The org this person belongs to (id reference). */
  org?: string;
  /** People this person explicitly knows (id references). */
  knows?: string[];
  /** People this person has worked with (id references). */
  workedWith?: string[];
}

/** An organisation node in the relationship graph. */
export interface OrgRef {
  id: string;
  name: string;
  /** Member person ids. */
  members?: string[];
}

/** A recorded interaction (touch) between a person and optionally an org. */
export interface TouchRef {
  id: string;
  /** Person id who is the primary contact for this touch. */
  person: string;
  /** Org id involved in this touch (if any). */
  org?: string;
  /** ISO-8601 date string. */
  date: string;
  summary?: string;
}

/** An idea or theme attributed to one or more entities. */
export interface IdeaRef {
  id: string;
  title: string;
  /** Entity ids (person or org) this idea is about. */
  about?: string[];
}

/** The full dataset from which cards and matrices are projected. */
export interface MapData {
  people: PersonRef[];
  orgs: OrgRef[];
  touches: TouchRef[];
  ideas: IdeaRef[];
}

// ─── Output types ─────────────────────────────────────────────────────────────

/**
 * Projected card for a single person or org.
 * Optional fields (`org`, `members`) are omitted rather than set to
 * `undefined` so the shape is exact-property-types–safe.
 */
export interface EntityCard {
  id: string;
  kind: "person" | "org";
  name: string;
  relatedPeople: string[];
  touches: TouchRef[];
  ideas: IdeaRef[];
  /** Set for person cards that have a known org affiliation. */
  org?: string;
  /** Set for org cards. */
  members?: string[];
}

/** A node in the connection matrix. */
export interface MatrixNode {
  id: string;
  kind: "person" | "org";
  name: string;
}

/** A directed edge in the connection matrix. */
export interface MatrixEdge {
  source: string;
  target: string;
  relation: "knows" | "worked_with" | "member_of" | "touched";
}

/** Full node + edge graph for the relationship visualization map. */
export interface ConnectionMatrix {
  nodes: MatrixNode[];
  edges: MatrixEdge[];
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/** Return a new array of unique strings preserving insertion order. */
function unique(ids: string[]): string[] {
  return [...new Set(ids)];
}

/**
 * Find all person ids that co-attended the same org via touches as `personId`,
 * i.e. there is at least one org for which both `personId` and the other
 * person have a touch record.
 */
function coAttendees(personId: string, touches: TouchRef[]): string[] {
  // Collect orgs that personId touched
  const myOrgs = new Set<string>();
  for (const t of touches) {
    if (t.person === personId && t.org !== undefined) {
      myOrgs.add(t.org);
    }
  }
  if (myOrgs.size === 0) return [];

  // Find other people whose touches share at least one of those orgs
  const peers: string[] = [];
  for (const t of touches) {
    if (t.person !== personId && t.org !== undefined && myOrgs.has(t.org)) {
      peers.push(t.person);
    }
  }
  return peers;
}

// ─── buildEntityCard ──────────────────────────────────────────────────────────

/**
 * Build a projected card for the given `id` (person or org).
 *
 * - **Person card**: `relatedPeople` = unique union of `knows` + `workedWith`
 *   + co-attendees of shared org touches, excluding the person themselves.
 *   `touches` = touches where `person === id`.
 *   `ideas` = ideas whose `about` array contains `id`.
 *   `org` = person's org affiliation (omitted if absent).
 *
 * - **Org card**: `relatedPeople` = members list.
 *   `touches` = touches where `org === id`.
 *   `ideas` = ideas whose `about` array contains `id`.
 *   `members` = org's member list (omitted if absent).
 *
 * Returns `null` if `id` is not found in either people or orgs.
 */
export function buildEntityCard(id: string, data: MapData): EntityCard | null {
  const { people, orgs, touches, ideas } = data;

  // ── Try person first ───────────────────────────────────────────────────────
  const person = people.find((p) => p.id === id);
  if (person !== undefined) {
    const directKnows = person.knows ?? [];
    const directWorked = person.workedWith ?? [];
    const peers = coAttendees(id, touches);

    const relatedPeople = unique(
      [...directKnows, ...directWorked, ...peers].filter((pid) => pid !== id)
    );

    const myTouches = touches.filter((t) => t.person === id);
    const myIdeas = ideas.filter(
      (i) => i.about !== undefined && i.about.includes(id)
    );

    const card: EntityCard = {
      id,
      kind: "person",
      name: person.name,
      relatedPeople,
      touches: myTouches,
      ideas: myIdeas,
    };
    // Omit `org` when undefined (exactOptionalPropertyTypes)
    if (person.org !== undefined) {
      card.org = person.org;
    }
    return card;
  }

  // ── Try org ───────────────────────────────────────────────────────────────
  const org = orgs.find((o) => o.id === id);
  if (org !== undefined) {
    const members = org.members ?? [];
    const orgTouches = touches.filter((t) => t.org === id);
    const orgIdeas = ideas.filter(
      (i) => i.about !== undefined && i.about.includes(id)
    );

    const card: EntityCard = {
      id,
      kind: "org",
      name: org.name,
      relatedPeople: [...members],
      touches: orgTouches,
      ideas: orgIdeas,
    };
    if (org.members !== undefined) {
      card.members = org.members;
    }
    return card;
  }

  return null;
}

// ─── buildConnectionMatrix ────────────────────────────────────────────────────

/**
 * Build a complete node + edge matrix for the relationship graph.
 *
 * **Nodes:** one per person + one per org.
 *
 * **Edges (deduplicated by source+target+relation):**
 * - `knows` — from each `person.knows` entry
 * - `worked_with` — from each `person.workedWith` entry
 * - `member_of` — person → org, derived from `org.members`
 * - `touched` — person → org, derived from touches that carry an `org` field
 */
export function buildConnectionMatrix(data: MapData): ConnectionMatrix {
  const { people, orgs, touches } = data;

  // ── Nodes ─────────────────────────────────────────────────────────────────
  const nodes: MatrixNode[] = [
    ...people.map(
      (p): MatrixNode => ({ id: p.id, kind: "person", name: p.name })
    ),
    ...orgs.map(
      (o): MatrixNode => ({ id: o.id, kind: "org", name: o.name })
    ),
  ];

  // ── Edges ─────────────────────────────────────────────────────────────────
  const seen = new Set<string>();
  const edges: MatrixEdge[] = [];

  function addEdge(edge: MatrixEdge): void {
    const key = `${edge.source}|${edge.target}|${edge.relation}`;
    if (!seen.has(key)) {
      seen.add(key);
      edges.push(edge);
    }
  }

  // knows + worked_with from people
  for (const p of people) {
    for (const target of p.knows ?? []) {
      addEdge({ source: p.id, target, relation: "knows" });
    }
    for (const target of p.workedWith ?? []) {
      addEdge({ source: p.id, target, relation: "worked_with" });
    }
  }

  // member_of: person → org, derived from org.members
  for (const o of orgs) {
    for (const memberId of o.members ?? []) {
      addEdge({ source: memberId, target: o.id, relation: "member_of" });
    }
  }

  // touched: person → org, from touches that specify an org
  for (const t of touches) {
    if (t.org !== undefined) {
      addEdge({ source: t.person, target: t.org, relation: "touched" });
    }
  }

  return { nodes, edges };
}
