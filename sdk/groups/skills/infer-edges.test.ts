import { describe, it, expect } from 'vitest';
import { Vault, MetadataCache } from 'obsidian';
import { createNote } from '../tools/vault-create-note';
import { inferEdges } from './infer-edges';

const makeVault = (): Vault => new (Vault as unknown as { new (): Vault })();
const makeCache = (): MetadataCache => new (MetadataCache as unknown as { new (): MetadataCache })();
const setFm = (c: MetadataCache, p: string, fm: Record<string, unknown>) =>
  (c as unknown as { setFrontmatter(p: string, fm: Record<string, unknown>): void }).setFrontmatter(p, fm);

describe('skills/infer-edges', () => {
  it('derives knows + worked_with edges, parsing wikilink targets', async () => {
    const vault = makeVault();
    const cache = makeCache();
    const file = await createNote(vault, 'people/Frank.md', '');
    setFm(cache, 'people/Frank.md', {
      knows: ['[[Jane]]', '[[Bob|Bobby]]'],
      worked_with: ['[[Acme]]'],
    });
    expect(inferEdges(cache, file, 'Frank')).toEqual([
      { from: 'Frank', to: 'Jane', type: 'knows' },
      { from: 'Frank', to: 'Bob', type: 'knows' },
      { from: 'Frank', to: 'Acme', type: 'worked_with' },
    ]);
  });

  it('accepts a single scalar value and bare (non-wikilink) strings', async () => {
    const cache = makeCache();
    const file = await createNote(makeVault(), 'people/X.md', '');
    setFm(cache, 'people/X.md', { knows: 'Jane' });
    expect(inferEdges(cache, file, 'X')).toEqual([{ from: 'X', to: 'Jane', type: 'knows' }]);
  });

  it('returns no edges when fields are absent', async () => {
    const cache = makeCache();
    const file = await createNote(makeVault(), 'people/Empty.md', '');
    setFm(cache, 'people/Empty.md', { type: 'person' });
    expect(inferEdges(cache, file, 'Empty')).toEqual([]);
  });
});
