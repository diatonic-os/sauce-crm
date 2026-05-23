import { describe, it, expect } from 'vitest';
import { Vault, MetadataCache } from 'obsidian';
import { createNote } from '../tools/vault-create-note';
import { relationshipIntelligence, analyzeRelationships } from './relationship-intelligence';

const makeVault = (): Vault => new (Vault as unknown as { new (): Vault })();
const makeCache = (): MetadataCache => new (MetadataCache as unknown as { new (): MetadataCache })();
const setFm = (c: MetadataCache, p: string, fm: Record<string, unknown>) =>
  (c as unknown as { setFrontmatter(p: string, fm: Record<string, unknown>): void }).setFrontmatter(p, fm);

describe('talents/relationship-intelligence', () => {
  it('declares its bundled skills', () => {
    expect(relationshipIntelligence.id).toBe('relationship-intelligence');
    expect(relationshipIntelligence.skills).toContain('infer-edges');
  });

  it('analyzes a note into edges + degree', async () => {
    const cache = makeCache();
    const file = await createNote(makeVault(), 'people/Frank.md', '');
    setFm(cache, 'people/Frank.md', { knows: ['[[Jane]]', '[[Bob]]'] });
    const analysis = analyzeRelationships(cache, file, 'Frank');
    expect(analysis.subject).toBe('Frank');
    expect(analysis.degree).toBe(2);
    expect(analysis.edges.map((e) => e.to)).toEqual(['Jane', 'Bob']);
  });
});
