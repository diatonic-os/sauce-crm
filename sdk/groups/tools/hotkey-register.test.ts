import { describe, it, expect, vi } from 'vitest';
import { Scope, KeymapEventHandler } from 'obsidian';
import { registerHotkey } from './hotkey-register';
import { hasApiSymbol } from '../../generated/api-catalog';

describe('tools/hotkey-register', () => {
  it('registers with modifiers + key and the listener invokes the callback', () => {
    const handler = {} as KeymapEventHandler;
    let captured: (() => boolean | void) | undefined;
    const scope = {
      register: (mods: unknown, key: unknown, fn: () => boolean | void) => {
        captured = fn;
        expect(mods).toEqual(['Mod']);
        expect(key).toBe('k');
        return handler;
      },
    } as unknown as Scope;
    const cb = vi.fn();
    const result = registerHotkey(scope, ['Mod'], 'k', cb);
    expect(result).toBe(handler);
    expect(captured?.()).toBe(false); // prevents default
    expect(cb).toHaveBeenCalledOnce();
  });

  it('catalog-validation gate: Scope.register exists', () => {
    expect(hasApiSymbol('Scope.register')).toBe(true);
  });
});
