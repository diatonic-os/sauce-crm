import { describe, it, expect, vi } from 'vitest';
import { Plugin } from 'obsidian';
import { registerOpenInbox } from './open-crm-inbox';
import { hasApiSymbol } from '../../generated/api-catalog';

const makePlugin = (): Plugin => new (Plugin as unknown as { new (): Plugin })();

describe('actions/open-crm-inbox', () => {
  it('registers the Open-CRM-inbox command and invokes run', () => {
    const plugin = makePlugin();
    const spy = vi.spyOn(plugin, 'addCommand');
    const run = vi.fn();
    const cmd = registerOpenInbox(plugin, run);
    expect(cmd.id).toBe('sauce-open-inbox');
    expect(spy).toHaveBeenCalled();
    cmd.callback?.();
    expect(run).toHaveBeenCalledOnce();
  });

  it('catalog-validation gate: Plugin.addCommand exists', () => {
    expect(hasApiSymbol('Plugin.addCommand')).toBe(true);
  });
});
