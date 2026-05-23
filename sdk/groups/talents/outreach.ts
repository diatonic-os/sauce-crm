// SDK talent — source: sdk/groups/talents/outreach.md | api_version: 1.8.0 | gen_hash: hand-tal002
//
// Outreach capability pack. Composes chainers/intro-routing.

import { MetadataCache, TFile } from 'obsidian';
import { routeIntro, ScoredEdge } from '../chainers/intro-routing';

export interface Talent {
  id: string;
  name: string;
  skills: readonly string[];
}

export const outreach: Talent = {
  id: 'outreach',
  name: 'Outreach',
  skills: ['intro-routing'],
};

export interface OutreachPlan {
  subject: string;
  ranked: ScoredEdge[];
}

/** Produce an outreach plan: scored, ranked introduction edges for the subject. */
export function analyzeOutreach(cache: MetadataCache, file: TFile, subject: string): OutreachPlan {
  return { subject, ranked: routeIntro(cache, file, subject) };
}
