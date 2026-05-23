// SDK generator — source: sdk/generator/parse-css-vars.md | api_version: 1.8.0 | gen_hash: hand-g002
//
// GENERATOR.md stage 2: parse one CSS-variables doc into sorted token descriptors.
// Pure (string -> tokens); deterministic.

import { stableSort } from '../groups/helpers/stable-sort';

export interface CssToken {
  token: string;
  description: string;
  section: string;
}

const HEADING_RE = /^#{2,4}\s+(.+?)\s*$/;
const ROW_RE = /^\|\s*`(--[a-zA-Z0-9-]+)`\s*\|\s*(.*?)\s*\|/;

/** Parse a CSS-variables doc into token descriptors, sorted by token, deduped. */
export function parseCssVars(markdown: string): CssToken[] {
  const lines = markdown.split('\n');
  let section = '';
  const byToken = new Map<string, CssToken>();
  for (const line of lines) {
    const h = line.match(HEADING_RE);
    if (h) {
      section = h[1].trim();
      continue;
    }
    const r = line.match(ROW_RE);
    if (r) {
      const token = r[1];
      if (!byToken.has(token)) {
        byToken.set(token, { token, description: r[2].trim(), section });
      }
    }
  }
  return stableSort([...byToken.values()], (t) => t.token);
}
