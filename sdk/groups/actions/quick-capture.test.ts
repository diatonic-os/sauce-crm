import { describe, it, expect, vi } from 'vitest';
import { Plugin, Vault, TFile } from 'obsidian';
import { quickCapture, registerQuickCapture } from './quick-capture';

const makeVault = (): Vault => new (Vault as unknown as { new (): Vault })();
const makePlugin = (): Plugin => new (Plugin as unknown as { new (): Plugin })();
// stub TFile carries `contents`; the real obsidian type does not.
const body = (f: TFile): string => (f as unknown as { contents: string }).contents;

describe('actions/quick-capture', () => {
  it('writes a note with a frontmatter block and body at the joined path', async () => {
    const vault = makeVault();
    const file = await quickCapture(vault, {
      folder: 'people/',
      title: 'Frank',
      body: 'met at conference',
      frontmatter: { type: 'warm-contact', tags: ['intro'] },
    });
    expect(file.path).toBe('people/Frank.md');
    expect(body(file)).toMatch(/^---\n/);
    expect(body(file)).toContain('type: warm-contact'); // caller overrides default
    expect(body(file)).toContain('met at conference');
  });

  it('applies the default type when none is given', async () => {
    const file = await quickCapture(makeVault(), { folder: 'inbox', title: 'x' });
    expect(body(file)).toContain('type: note');
  });

  it('registers the Quick capture command', () => {
    const plugin = makePlugin();
    const spy = vi.spyOn(plugin, 'addCommand');
    const run = vi.fn();
    const cmd = registerQuickCapture(plugin, run);
    expect(cmd.id).toBe('sauce-quick-capture');
    expect(spy).toHaveBeenCalled();
  });
});
