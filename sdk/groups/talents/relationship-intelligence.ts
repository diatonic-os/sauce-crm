// SDK talent — source: sdk/groups/talents/relationship-intelligence.md | api_version: 1.8.0 | gen_hash: hand-tal001
//
// Capability pack bundling relationship skills. Composes skills/infer-edges.

import { MetadataCache, TFile } from 'obsidian';
import { inferEdges, Edge } from '../skills/infer-edges';

export interface Talent {
  id: string;
  name: string;
  skills: readonly string[];
}

/** The relationship-intelligence talent: bundled skills a Copilot can invoke. */
export const relationshipIntelligence: Talent = {
  id: 'relationship-intelligence',
  name: 'Relationship Intelligence',
  skills: ['infer-edges'],
};

export interface RelationshipAnalysis {
  subject: string;
  edges: Edge[];
  degree: number;
}

/** Run the talent's analysis over a note: relationship edges + out-degree. */
export function analyzeRelationships(
  cache: MetadataCache,
  file: TFile,
  subject: string,
): RelationshipAnalysis {
  const edges = inferEdges(cache, file, subject);
  return { subject, edges, degree: edges.length };
}
