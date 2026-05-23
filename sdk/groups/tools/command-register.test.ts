import { describe, it, expect, vi } from 'vitest';
import { Plugin, Command } from 'obsidian';
import { registerCommand } from './command-register';
import { hasApiSymbol } from '../../generated/api-catalog';

const makePlugin = (): Plugin => new (Plugin as unknown as { new (): Plugin })();

describe('tools/command-register', () => {
  it('registers a command and returns it', () => {
    const plugin = makePlugin();
    const spy = vi.spyOn(plugin, 'addCommand');
    const cmd: Command = { id: 'sauce-quick-capture', name: 'Quick capture', callback: () => {} };
    const result = registerCommand(plugin, cmd);
    expect(spy).toHaveBeenCalledWith(cmd);
    expect(result.id).toBe('sauce-quick-capture');
  });

  it('catalog-validation gate: Plugin.addCommand exists', () => {
    expect(hasApiSymbol('Plugin.addCommand')).toBe(true);
  });
});
