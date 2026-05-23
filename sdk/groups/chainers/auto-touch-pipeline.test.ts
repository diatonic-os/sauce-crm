import { describe, it, expect } from 'vitest';
import { Vault } from 'obsidian';
import { createNote } from '../tools/vault-create-note';
import { applyTouch } from './auto-touch-pipeline';

const makeVault = (): Vault => new (Vault as unknown as { new (): Vault })();

describe('chainers/auto-touch-pipeline', () => {
  it('records the first touch into frontmatter, preserving the body', async () => {
    const vault = makeVault();
    const file = await createNote(vault, 'people/Frank.md', '---\ntype: person\n---\n\nbody text');
    const out = await applyTouch(vault, file, { tick: 5, channel: 'email' });
    expect(out).toContain('last_touch: 5');
    expect(out).toContain('touch_count: 1');
    expect(out).toContain('last_channel: email');
    expect(out).toContain('type: person');
    expect(out).toContain('body text');
  });

  it('is idempotent: re-applying tick <= last is a no-op', async () => {
    const vault = makeVault();
    const file = await createNote(vault, 'people/X.md', '---\ntype: person\n---\n');
    await applyTouch(vault, file, { tick: 5, channel: 'email' });
    const again = await applyTouch(vault, file, { tick: 5, channel: 'email' });
    expect(again).toContain('touch_count: 1'); // not incremented
  });

  it('increments on a newer tick', async () => {
    const vault = makeVault();
    const file = await createNote(vault, 'people/Y.md', '---\ntype: person\n---\n');
    await applyTouch(vault, file, { tick: 5, channel: 'email' });
    const out = await applyTouch(vault, file, { tick: 8, channel: 'call' });
    expect(out).toContain('touch_count: 2');
    expect(out).toContain('last_touch: 8');
  });
});
