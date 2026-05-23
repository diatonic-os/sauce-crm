import { describe, it, expect } from 'vitest';
import { emitApiCatalog } from './emit-api-catalog';
import type { ApiDescriptor } from './parse-api-doc';

const d = (symbol: string, kind: ApiDescriptor['kind'] = 'function', signature = 'sig'): ApiDescriptor => ({
  symbol,
  kind,
  signature,
});

describe('generator/emit-api-catalog', () => {
  it('emits a catalog sorted by symbol with kind + signature', () => {
    const src = emitApiCatalog([d('requestUrl'), d('Vault.create', 'method', 'create(...)')]);
    expect(src).toContain('"Vault.create": { kind: "method", signature: "create(...)" }');
    expect(src).toContain('"requestUrl": { kind: "function", signature: "sig" }');
    expect(src.indexOf('Vault.create')).toBeLessThan(src.indexOf('requestUrl')); // sorted
  });

  it('emits the ApiSymbol type and hasApiSymbol guard', () => {
    const src = emitApiCatalog([d('x')]);
    expect(src).toContain('export type ApiSymbol = keyof typeof apiCatalog;');
    expect(src).toContain('export function hasApiSymbol(s: string): s is ApiSymbol');
  });

  it('dedupes by symbol (first wins)', () => {
    const src = emitApiCatalog([d('dup', 'function', 'A'), d('dup', 'method', 'B')]);
    expect(src.match(/"dup":/g)!.length).toBe(1);
    expect(src).toContain('signature: "A"');
  });

  it('is deterministic', () => {
    const arr = [d('b'), d('a')];
    expect(emitApiCatalog(arr)).toBe(emitApiCatalog(arr));
  });
});
