import { describe, it, expect, vi } from 'vitest';
import { Plugin, Vault } from 'obsidian';
import { createNote } from '../tools/vault-create-note';
import { scheduleTouch, registerScheduleTouch } from './schedule-touch';
import { hasApiSymbol } from '../../generated/api-catalog';

const makeVault = (): Vault => new (Vault as unknown as { new (): Vault })();
const makePlugin = (): Plugin => new (Plugin as unknown as { new (): Plugin })();

describe('actions/schedule-touch', () => {
  it('sets next_touch in frontmatter', async () => {
    const vault = makeVault();
    const file = await createNote(vault, 'people/Frank.md', '---\ntype: person\n---\n');
    const out = await scheduleTouch(vault, file, 12);
    expect(out).toContain('next_touch: 12');
    expect(out).toContain('type: person');
  });

  it('registers the Schedule-touch command', () => {
    const plugin = makePlugin();
    const spy = vi.spyOn(plugin, 'addCommand');
    const cmd = registerScheduleTouch(plugin, () => {});
    expect(cmd.id).toBe('sauce-schedule-touch');
    expect(spy).toHaveBeenCalled();
  });

  it('catalog-validation gate: Plugin.addCommand exists', () => {
    expect(hasApiSymbol('Plugin.addCommand')).toBe(true);
  });
});
