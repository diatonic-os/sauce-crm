import { describe, it, expect, vi, afterEach } from 'vitest';
import { Plugin } from 'obsidian';
import { registerInterval } from './interval-register';
import { hasApiSymbol } from '../../generated/api-catalog';

afterEach(() => {
  vi.useRealTimers();
});

// obsidian.Plugin is abstract in the real types; instantiate the concrete stub.
const makePlugin = (): Plugin => new (Plugin as unknown as { new (): Plugin })();

describe('tools/interval-register', () => {
  it('registers the interval with the plugin and fires the callback', () => {
    vi.useFakeTimers();
    const plugin = makePlugin();
    const spy = vi.spyOn(plugin, 'registerInterval');
    const cb = vi.fn();
    const id = registerInterval(plugin, cb, 1000);
    expect(spy).toHaveBeenCalledWith(id);
    vi.advanceTimersByTime(3000);
    expect(cb).toHaveBeenCalledTimes(3);
  });

  it('catalog-validation gate: Component.registerInterval exists in the catalog', () => {
    expect(hasApiSymbol('Component.registerInterval')).toBe(true);
  });
});
