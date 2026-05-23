// SDK chainer — source: sdk/groups/chainers/intro-routing.md | api_version: 1.8.0 | gen_hash: hand-c004
//
// Score and rank a contact's edges for introduction routing.

import { MetadataCache, TFile } from 'obsidian';
import { inferEdges, Edge, EdgeType } from '../skills/infer-edges';
import { stableSort } from '../helpers/stable-sort';

const WEIGHT: Record<EdgeType, number> = { worked_with: 2, knows: 1 };

export interface ScoredEdge extends Edge {
  score: number;
}

/** Rank a subject's edges for intro routing: score desc, ties by `to` asc. */
export function routeIntro(cache: MetadataCache, file: TFile, subject: string): ScoredEdge[] {
  const scored: ScoredEdge[] = inferEdges(cache, file, subject).map((e) => ({
    ...e,
    score: WEIGHT[e.type] ?? 0,
  }));
  const byTo = stableSort(scored, (e) => e.to);
  return stableSort(byTo, (e) => -e.score);
}
