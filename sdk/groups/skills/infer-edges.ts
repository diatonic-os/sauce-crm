// SDK skill — source: sdk/groups/skills/infer-edges.md | api_version: 1.8.0 | gen_hash: hand-s001
//
// Derive relationship edges from frontmatter. Composes metadata-read + wikilink.

import { MetadataCache, TFile } from 'obsidian';
import { readFrontmatter } from '../tools/metadata-read';
import { parseWikilink } from '../helpers/wikilink';

export type EdgeType = 'knows' | 'worked_with';

export interface Edge {
  from: string;
  to: string;
  type: EdgeType;
}

const EDGE_TYPES: readonly EdgeType[] = ['knows', 'worked_with'];

/** Emit knows/worked_with edges from `file`'s frontmatter, sourced at `subject`. */
export function inferEdges(cache: MetadataCache, file: TFile, subject: string): Edge[] {
  const fm = readFrontmatter(cache, file);
  const edges: Edge[] = [];
  for (const type of EDGE_TYPES) {
    const raw = fm[type];
    const items = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
    for (const item of items) {
      if (typeof item !== 'string') continue;
      const target = parseWikilink(item)?.target ?? item;
      if (target) edges.push({ from: subject, to: target, type });
    }
  }
  return edges;
}
