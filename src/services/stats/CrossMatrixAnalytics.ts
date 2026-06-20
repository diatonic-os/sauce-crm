// CrossMatrixAnalytics.ts — correlation matrix, org rollups, z-score outliers.
//
// Pure module: no Obsidian, no I/O. Consumes PersonStat[] + DealStat[] from
// RelationshipAnalytics and Statistics primitives.

import type { PersonStat, DealStat } from "../RelationshipAnalytics";
import { pearson, zscores } from "./Statistics";

// ---------------------------------------------------------------------------
// Public interfaces
// ---------------------------------------------------------------------------

export interface VariablePair {
  a: string;
  b: string;
  r: number;
  n: number;
  strength: string;
}

export interface OrgRollup {
  org: string;
  people: number;
  avgCloseness: number;
  totalTouches: number;
  openDeals: number;
  healthScore: number;
}

export interface Outlier {
  path: string;
  name: string;
  metric: string;
  z: number;
  note: string;
}

export interface CrossMatrixReport {
  variables: string[];
  matrix: (number | null)[][];
  topPairs: VariablePair[];
  orgRollups: OrgRollup[];
  outliers: Outlier[];
}

// ---------------------------------------------------------------------------
// Variables
// ---------------------------------------------------------------------------

const VARIABLES = [
  "closeness",
  "touchCount",
  "degree",
  "daysSinceTouch",
  "callShare",
] as const;

type Variable = (typeof VARIABLES)[number];

// ---------------------------------------------------------------------------
// Vector extraction helpers
// ---------------------------------------------------------------------------

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Days between two ISO date strings (nowIso - isoDay). Returns 0 if null. */
function daysSinceIso(isoDay: string | null, nowIso: string): number {
  if (!isoDay) return 0;
  const then = new Date(isoDay + "T00:00:00Z").getTime();
  const now = new Date(nowIso + "T00:00:00Z").getTime();
  if (Number.isNaN(then) || Number.isNaN(now)) return 0;
  return Math.max(0, Math.floor((now - then) / 86_400_000));
}

/** Fraction of touches that were via the "call" channel. 0 if no touches. */
function callShare(p: PersonStat): number {
  if (p.touchCount === 0) return 0;
  const calls = p.channelCounts["call"] ?? 0;
  return calls / p.touchCount;
}

function extractVector(people: PersonStat[], v: Variable, nowIso: string): number[] {
  switch (v) {
    case "closeness":
      return people.map((p) => p.closeness);
    case "touchCount":
      return people.map((p) => p.touchCount);
    case "degree":
      return people.map((p) => p.degree);
    case "daysSinceTouch":
      return people.map((p) => daysSinceIso(p.lastTouch, nowIso));
    case "callShare":
      return people.map((p) => callShare(p));
  }
}

// ---------------------------------------------------------------------------
// Correlation matrix
// ---------------------------------------------------------------------------

function buildMatrix(
  people: PersonStat[],
  nowIso: string,
): (number | null)[][] {
  const n = VARIABLES.length;
  const vectors = VARIABLES.map((v) => extractVector(people, v, nowIso));

  const matrix: (number | null)[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => {
      if (i === j) return 1;
      if (i > j) return null; // filled in by symmetry below
      return null;
    }),
  );

  for (let i = 0; i < n; i++) {
    matrix[i]![i] = 1;
    for (let j = i + 1; j < n; j++) {
      const r = pearson(vectors[i]!, vectors[j]!);
      matrix[i]![j] = r;
      matrix[j]![i] = r;
    }
  }

  return matrix;
}

// ---------------------------------------------------------------------------
// Top pairs
// ---------------------------------------------------------------------------

function buildTopPairs(
  matrix: (number | null)[][],
  n: number,
): VariablePair[] {
  const pairs: VariablePair[] = [];
  for (let i = 0; i < VARIABLES.length; i++) {
    for (let j = i + 1; j < VARIABLES.length; j++) {
      const r = matrix[i]![j];
      if (r == null) continue;
      const strength = strengthLabel(r, n);
      pairs.push({
        a: VARIABLES[i]!,
        b: VARIABLES[j]!,
        r,
        n,
        strength,
      });
    }
  }
  // Sort by |r| descending
  pairs.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
  return pairs;
}

/** Extract strength label from |r| thresholds. */
function strengthLabel(r: number, _n: number): string {
  const mag = Math.abs(r);
  if (mag < 0.1) return "negligible";
  if (mag < 0.3) return "weak";
  if (mag < 0.5) return "moderate";
  if (mag < 0.7) return "strong";
  return "very strong";
}

// ---------------------------------------------------------------------------
// Org rollups
// ---------------------------------------------------------------------------

function buildOrgRollups(
  people: PersonStat[],
  orgsByPerson: Map<string, string>,
  deals: DealStat[],
  nowIso: string,
): OrgRollup[] {
  // Group people by org
  const byOrg = new Map<string, PersonStat[]>();
  for (const p of people) {
    const org = orgsByPerson.get(p.path) ?? "Unknown";
    const bucket = byOrg.get(org) ?? [];
    bucket.push(p);
    byOrg.set(org, bucket);
  }

  // Count open deals per org (by person path membership)
  const personPathSet = new Set(people.map((p) => p.path));
  void personPathSet; // available for future org-level deal linking

  // Open deals we count globally; per-org we track them via orgsByPerson
  // (deal entities don't carry org — use deals count as a global signal scaled per org)
  const totalOpenDeals = deals.filter(
    (d) => !/won|lost|closed/.test(d.stage.toLowerCase()),
  ).length;

  // Max closeness for normalization (capped at 5 per spec)
  const maxCloseness = 5;

  const rollups: OrgRollup[] = [];
  for (const [org, members] of byOrg) {
    const avgCloseness =
      members.reduce((s, p) => s + p.closeness, 0) / members.length;
    const totalTouches = members.reduce((s, p) => s + p.touchCount, 0);
    // Apportion open deals proportionally by org size
    const openDeals = Math.round(
      (members.length / people.length) * totalOpenDeals,
    );

    // touchRecency: average daysSinceTouch across members (lower = better)
    const avgDays =
      members.reduce((s, p) => s + daysSinceIso(p.lastTouch, nowIso), 0) /
      members.length;
    // Recency norm: 1 = touched today, 0 = 365+ days ago
    const touchRecencyNorm = clamp01(1 - avgDays / 365);

    // healthScore = 0.4*norm(avgCloseness/5) + 0.3*touchRecency + 0.3*norm(openDeals)
    const closenessNorm = clamp01(avgCloseness / maxCloseness);
    // openDeals: higher is better (more pipeline); cap at 10 for norm
    const dealNorm = clamp01(openDeals / 10);
    const healthScore = clamp01(
      0.4 * closenessNorm + 0.3 * touchRecencyNorm + 0.3 * dealNorm,
    );

    rollups.push({
      org,
      people: members.length,
      avgCloseness,
      totalTouches,
      openDeals,
      healthScore,
    });
  }

  return rollups;
}

// ---------------------------------------------------------------------------
// Outliers
// ---------------------------------------------------------------------------

function buildOutliers(people: PersonStat[], nowIso: string): Outlier[] {
  if (people.length < 2) return [];

  const outliers: Outlier[] = [];

  for (const variable of VARIABLES) {
    const vec = extractVector(people, variable, nowIso);
    const zs = zscores(vec);

    for (let i = 0; i < people.length; i++) {
      const z = zs[i];
      const p = people[i];
      if (z == null || p == null) continue;
      if (Math.abs(z) < 2) continue;

      outliers.push({
        path: p.path,
        name: p.name,
        metric: variable,
        z,
        note: `${p.name} has a ${variable} z-score of ${z.toFixed(2)} (${Math.abs(z) >= 3 ? "extreme" : "notable"} outlier)`,
      });
    }
  }

  // Sort by |z| descending
  outliers.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
  return outliers;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Build the full cross-matrix report from PersonStat[], an org lookup map,
 * DealStat[], and a reference ISO date string (YYYY-MM-DD) for recency calcs.
 */
export function buildCrossMatrix(
  people: PersonStat[],
  orgsByPerson: Map<string, string>,
  deals: DealStat[],
  nowIso: string,
): CrossMatrixReport {
  const n = people.length;
  const matrix = buildMatrix(people, nowIso);
  const topPairs = buildTopPairs(matrix, n);
  const orgRollups = buildOrgRollups(people, orgsByPerson, deals, nowIso);
  const outliers = buildOutliers(people, nowIso);

  return {
    variables: [...VARIABLES],
    matrix,
    topPairs,
    orgRollups,
    outliers,
  };
}
