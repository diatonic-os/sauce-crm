// SDK generator — source: sdk/generator/emit-api-catalog.md | api_version: 1.8.0 | gen_hash: hand-g005
//
// GENERATOR.md stage 4: emit a typed API catalog (data) from parsed descriptors.
// Pure (descriptors -> source). tools/ wrappers validate against this catalog.

import { stableSort } from '../groups/helpers/stable-sort';
import { ApiDescriptor } from './parse-api-doc';

/** Emit deterministic TS source for the Obsidian API catalog + symbol guard. */
export function emitApiCatalog(descriptors: ApiDescriptor[]): string {
  const bySymbol = new Map<string, ApiDescriptor>();
  for (const d of descriptors) {
    if (!bySymbol.has(d.symbol)) bySymbol.set(d.symbol, d);
  }
  const sorted = stableSort([...bySymbol.values()], (d) => d.symbol);
  const entries = sorted
    .map(
      (d) =>
        `  ${JSON.stringify(d.symbol)}: { kind: ${JSON.stringify(d.kind)}, signature: ${JSON.stringify(
          d.signature,
        )} },`,
    )
    .join('\n');
  return [
    '// GENERATED — source: Reference/TypeScript API/** | do not edit by hand.',
    '// Regenerate via `npm run sdk:gen`. tools/ wrappers validate against this catalog.',
    'export const apiCatalog = {',
    entries,
    '} as const;',
    '',
    'export type ApiSymbol = keyof typeof apiCatalog;',
    '',
    'export function hasApiSymbol(s: string): s is ApiSymbol {',
    '  return Object.prototype.hasOwnProperty.call(apiCatalog, s);',
    '}',
    '',
  ].join('\n');
}
