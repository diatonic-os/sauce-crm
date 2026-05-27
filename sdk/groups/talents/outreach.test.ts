import { describe, it, expect } from 'vitest';
import { Vault, MetadataCache } from 'obsidian';
import { createNote } from '../tools/vault-create-note';
import { outreach, analyzeOutreach } from './outreach';

const makeVault = (): Vault => new (Vault as unknown as { new (): Vault })();
const makeCache = (): MetadataCache => new (MetadataCache as unknown as { new (): MetadataCache })();
const setFm = (c: MetadataCache, p: string, fm: Record<string, unknown>) =>
  (c as unknown as { setFrontmatter(p: string, fm: Record<string, unknown>): void }).setFrontmatter(p, fm);

describe('talents/outreach', () => {
  it('declares its bundled skills', () => {
    expect(outreach.id).toBe('outreach');
    expect(outreach.skills).toContain('intro-routing');
  });

  it('plans outreach as ranked intro edges', async () => {
    const cache = makeCache();
    const file = await createNote(makeVault(), 'people/Frank.md', '');
    setFm(cache, 'people/Frank.md', { knows: ['[[Jane]]'], worked_with: ['[[Acme]]'] });
    const plan = analyzeOutreach(cache, file, 'Frank');
    expect(plan.subject).toBe('Frank');
    const top = plan.ranked[0]!; // safe: test sets two edges so ranked has ≥1 entry
    expect(top.to).toBe('Acme'); // worked_with ranks first
  });
});
