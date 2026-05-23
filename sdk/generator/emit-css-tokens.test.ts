import { describe, it, expect } from 'vitest';
import { emitCssTokens, camelKey } from './emit-css-tokens';
import type { CssToken } from './parse-css-vars';

const tok = (token: string): CssToken => ({ token, description: '', section: '' });

describe('generator/emit-css-tokens', () => {
  it('camelCases tokens', () => {
    expect(camelKey('--metadata-background')).toBe('metadataBackground');
    expect(camelKey('--text-normal')).toBe('textNormal');
  });

  it('emits a token map with var() values, sorted by key', () => {
    const src = emitCssTokens([tok('--text-normal'), tok('--metadata-background')]);
    expect(src).toContain('"metadataBackground": "var(--metadata-background)"');
    expect(src).toContain('"textNormal": "var(--text-normal)"');
    // metadataBackground sorts before textNormal
    expect(src.indexOf('metadataBackground')).toBeLessThan(src.indexOf('textNormal'));
    expect(src).toContain('export const cssTokens =');
    expect(src).toContain('export type CssTokenKey =');
  });

  it('dedupes by camel key', () => {
    const src = emitCssTokens([tok('--x-y'), tok('--x-y')]);
    expect(src.match(/"xY":/g)!.length).toBe(1);
  });

  it('is deterministic', () => {
    const tokens = [tok('--b'), tok('--a')];
    expect(emitCssTokens(tokens)).toBe(emitCssTokens(tokens));
  });
});
