import { describe, it, expect } from 'vitest';
import { Vault, MetadataCache } from 'obsidian';
import { createNote } from './vault-create-note';
import { readMetadata, readFrontmatter } from './metadata-read';
import { hasApiSymbol } from '../../generated/api-catalog';

const makeVault = (): Vault => new (Vault as unknown as { new (): Vault })();
const makeCache = (): MetadataCache => new (MetadataCache as unknown as { new (): MetadataCache })();

describe('tools/metadata-read', () => {
  it('reads frontmatter set in the cache', async () => {
    const vault = makeVault();
    const cache = makeCache();
    const file = await createNote(vault, 'people/Frank.md', '');
    (cache as unknown as { setFrontmatter(p: string, fm: Record<string, unknown>): void }).setFrontmatter(
      'people/Frank.md',
      { type: 'warm-contact', knows: ['Jane'] },
    );
    expect(readFrontmatter(cache, file)).toEqual({ type: 'warm-contact', knows: ['Jane'] });
    expect(readMetadata(cache, file)).not.toBeNull();
  });

  it('returns {} frontmatter when nothing is cached', async () => {
    const vault = makeVault();
    const file = await createNote(vault, 'empty.md', '');
    expect(readFrontmatter(makeCache(), file)).toEqual({});
  });

  it('catalog-validation gate: MetadataCache.getFileCache exists', () => {
    expect(hasApiSymbol('MetadataCache.getFileCache')).toBe(true);
  });
});
