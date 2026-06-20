/**
 * DailyContext — pure rollup of "what matters today" from the relationship graph.
 *
 * WHY THIS EXISTS:
 * SauceBot needs a single-call snapshot of relationship health for the current
 * day: touches logged today, follow-ups that have gone cold, relationships at
 * risk of going stale, and introductions worth making between same-org peers
 * who have never been directly linked.
 *
 * DESIGN:
 * - Pure functions — zero external dependencies (no obsidian, no lancedb).
 * - All date arithmetic uses Date.parse on ISO strings; invalid dates are
 *   silently skipped rather than thrown so a single bad record cannot crash
 *   the digest.
 * - Satisfies exactOptionalPropertyTypes and noUncheckedIndexedAccess:
 *   optional fields are omitted or guarded everywhere.
 */

import type { MapData, PersonRef, TouchRef } from "./EntityCard";

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * The daily digest: a snapshot of relationship activity and health for a
 * single calendar date.
 */
export interface DailyDigest {
  /** The date this digest was built for (ISO-8601). */
  date: string;
  /** All touch records whose `date` field matches `opts.today` exactly. */
  touchesToday: TouchRef[];
  /**
   * People whose most-recent touch is older than `cadenceDays`.
   * Sorted descending by `daysSince` (most overdue first).
   */
  overdueFollowUps: { person: string; lastTouch: string; daysSince: number }[];
  /**
   * Names of people whose most-recent touch is older than `staleDays`.
   * Empty when a person has no touch records at all.
   */
  staleRelationships: string[];
  /**
   * Pairs of people sharing the same org but with no direct knows/workedWith
   * edge in either direction. Max 10 pairs.
   */
  suggestedConnections: { a: string; b: string; why: string }[];
}

/**
 * Options controlling thresholds used when computing the digest.
 *
 * Note: optional fields are declared as `?: T` (not `T | undefined`) so the
 * caller may simply omit them; `undefined` is never passed explicitly.
 */
export interface DailyOpts {
  /** ISO-8601 date string for "today" (e.g. "2024-06-15"). */
  today: string;
  /**
   * Number of days after which a relationship is considered overdue for a
   * follow-up. Defaults to 30.
   */
  cadenceDays?: number;
  /**
   * Number of days after which a relationship is considered stale.
   * Defaults to 90.
   */
  staleDays?: number;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Parse an ISO date string and return a `Date`, or `null` if the string is
 * not a valid date. Guards against `NaN` from `Date.parse`.
 */
function parseDate(iso: string): Date | null {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/**
 * Return the number of whole calendar days between `earlier` and `later`.
 * Always returns a non-negative integer.
 */
function daysBetween(earlier: Date, later: Date): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.floor((later.getTime() - earlier.getTime()) / msPerDay);
}

/**
 * Build a map from person id → most-recent valid touch date for all touches
 * in the dataset. Ignores touch records whose `date` field does not parse.
 */
function buildLatestTouchMap(
  touches: TouchRef[]
): Map<string, { date: Date; iso: string }> {
  const map = new Map<string, { date: Date; iso: string }>();
  for (const t of touches) {
    const d = parseDate(t.date);
    if (d === null) continue;
    const existing = map.get(t.person);
    if (existing === undefined || d > existing.date) {
      map.set(t.person, { date: d, iso: t.date });
    }
  }
  return map;
}

/**
 * Return the set of all person ids that are directly connected to `person`
 * via a `knows` or `workedWith` edge (in either direction).
 */
function directlyConnected(person: PersonRef, allPeople: PersonRef[]): Set<string> {
  const connected = new Set<string>();

  // Outbound edges from this person
  for (const id of person.knows ?? []) connected.add(id);
  for (const id of person.workedWith ?? []) connected.add(id);

  // Inbound edges (other people pointing to this person)
  for (const p of allPeople) {
    if (p.id === person.id) continue;
    if ((p.knows ?? []).includes(person.id)) connected.add(p.id);
    if ((p.workedWith ?? []).includes(person.id)) connected.add(p.id);
  }

  return connected;
}

// ─── buildDailyDigest ─────────────────────────────────────────────────────────

/**
 * Build a `DailyDigest` from `data` using the supplied `opts`.
 *
 * - **touchesToday** — touches where `date === opts.today` (exact string match
 *   after validity guard).
 * - **overdueFollowUps** — people whose most-recent touch is strictly older
 *   than `cadenceDays` (default 30); sorted descending by `daysSince`.
 * - **staleRelationships** — names of people whose most-recent touch is
 *   strictly older than `staleDays` (default 90); people with no touches are
 *   excluded.
 * - **suggestedConnections** — unordered pairs (a, b) sharing the same org
 *   via `person.org` with no direct knows/workedWith edge in either direction;
 *   capped at 10; `why = "Both at <org name>"`.
 */
export function buildDailyDigest(data: MapData, opts: DailyOpts): DailyDigest {
  const { people, orgs, touches } = data;
  const cadenceDays = opts.cadenceDays ?? 30;
  const staleDays = opts.staleDays ?? 90;

  const todayDate = parseDate(opts.today);

  // ── touchesToday ──────────────────────────────────────────────────────────
  const touchesToday: TouchRef[] = [];
  for (const t of touches) {
    const d = parseDate(t.date);
    if (d === null) continue;
    if (t.date === opts.today) touchesToday.push(t);
  }

  // ── latest touch per person ───────────────────────────────────────────────
  const latestTouchMap = buildLatestTouchMap(touches);

  // ── overdueFollowUps + staleRelationships ─────────────────────────────────
  const overdueFollowUps: { person: string; lastTouch: string; daysSince: number }[] =
    [];
  const staleRelationships: string[] = [];

  if (todayDate !== null) {
    for (const person of people) {
      const latest = latestTouchMap.get(person.id);
      if (latest === undefined) continue; // no touches → skip both

      const days = daysBetween(latest.date, todayDate);

      if (days > cadenceDays) {
        overdueFollowUps.push({
          person: person.name,
          lastTouch: latest.iso,
          daysSince: days,
        });
      }

      if (days > staleDays) {
        staleRelationships.push(person.name);
      }
    }
  }

  // Sort overdue descending by daysSince (most overdue first)
  overdueFollowUps.sort((a, b) => b.daysSince - a.daysSince);

  // ── suggestedConnections ──────────────────────────────────────────────────
  // Build an org-name lookup
  const orgNameMap = new Map<string, string>();
  for (const o of orgs) orgNameMap.set(o.id, o.name);

  // Group people by their `org` id
  const peopleByOrg = new Map<string, PersonRef[]>();
  for (const p of people) {
    if (p.org === undefined) continue;
    const group = peopleByOrg.get(p.org);
    if (group !== undefined) {
      group.push(p);
    } else {
      peopleByOrg.set(p.org, [p]);
    }
  }

  const suggestedConnections: { a: string; b: string; why: string }[] = [];

  for (const [orgId, members] of peopleByOrg) {
    if (members.length < 2) continue;
    const orgName = orgNameMap.get(orgId) ?? orgId;

    for (let i = 0; i < members.length && suggestedConnections.length < 10; i++) {
      const pA = members[i];
      if (pA === undefined) continue;

      const connectedToA = directlyConnected(pA, people);

      for (let j = i + 1; j < members.length && suggestedConnections.length < 10; j++) {
        const pB = members[j];
        if (pB === undefined) continue;

        // Skip if any direct edge exists in either direction
        if (connectedToA.has(pB.id)) continue;

        suggestedConnections.push({
          a: pA.name,
          b: pB.name,
          why: `Both at ${orgName}`,
        });
      }
    }
  }

  return {
    date: opts.today,
    touchesToday,
    overdueFollowUps,
    staleRelationships,
    suggestedConnections,
  };
}
