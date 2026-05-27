import { describe, it, expect } from 'vitest';
import { Vault, MetadataCache } from 'obsidian';
import { createNote } from '../tools/vault-create-note';
import { routeIntro } from './intro-routing';

const makeVault = (): Vault => new (Vault as unknown as { new (): Vault })();
const makeCache = (): MetadataCache => new (MetadataCache as unknown as { new (): MetadataCache })();
const setFm = (c: MetadataCache, p: string, fm: Record<string, unknown>) =>
  (c as unknown as { setFrontmatter(p: string, fm: Record<string, unknown>): void }).setFrontmatter(p, fm);

describe('chainers/intro-routing', () => {
  it('ranks worked_with above knows, ties by target asc', async () => {
    const cache = makeCache();
    const file = await createNote(makeVault(), 'people/Frank.md', '');
    setFm(cache, 'people/Frank.md', { knows: ['[[Jane]]', '[[Amy]]'], worked_with: ['[[Acme]]'] });
    const ranked = routeIntro(cache, file, 'Frank');
    expect(ranked.map((e) => e.to)).toEqual(['Acme', 'Amy', 'Jane']); // Acme(2), then knows ties by to asc
    const top = ranked[0]!; // safe: toEqual above asserts 3-element array
    expect(top.score).toBe(2);
  });

  it('returns [] when no edges', async () => {
    const cache = makeCache();
    const file = await createNote(makeVault(), 'people/Empty.md', '');
    setFm(cache, 'people/Empty.md', { type: 'person' });
    expect(routeIntro(cache, file, 'Empty')).toEqual([]);
  });
});
