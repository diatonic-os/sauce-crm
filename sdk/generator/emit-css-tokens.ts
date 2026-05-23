// SDK generator — source: sdk/generator/emit-css-tokens.md | api_version: 1.8.0 | gen_hash: hand-g004
//
// GENERATOR.md stage 5: emit the components CSS token map. Pure (tokens -> source).

import { stableSort } from '../groups/helpers/stable-sort';
import { CssToken } from './parse-css-vars';

/** camelCase a `--kebab-token` into a TS-safe key (without the leading `--`). */
export function camelKey(token: string): string {
  return token.replace(/^--/, '').replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
}

/** Emit deterministic TS source for the components token map. */
export function emitCssTokens(tokens: CssToken[]): string {
  const seen = new Map<string, string>(); // camelKey -> var(--token)
  for (const t of tokens) {
    const key = camelKey(t.token);
    if (!seen.has(key)) seen.set(key, `var(${t.token})`);
  }
  const sorted = stableSort([...seen.entries()], (e) => e[0]);
  const body = sorted.map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)},`).join('\n');
  return [
    '// GENERATED — source: Reference/CSS variables/** | do not edit by hand.',
    '// Regenerate via `npm run sdk:gen`. components/ import tokens from here.',
    'export const cssTokens = {',
    body,
    '} as const;',
    '',
    'export type CssTokenKey = keyof typeof cssTokens;',
    '',
  ].join('\n');
}
