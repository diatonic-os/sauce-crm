// SDK helper — source: sdk/groups/helpers/wikilink.md | api_version: 1.8.0 | gen_hash: hand-0004
//
// Structured wikilink parse/format. Pure. Superset of src/util/Wikilink.ts.

export interface WikilinkParts {
  target: string;
  heading?: string;
  alias?: string;
}

const WIKILINK_RE = /^\[\[([^\]]+)\]\]$/;

/** True iff `s` is a string of the exact form `[[...]]`. */
export function isWikilink(s: unknown): boolean {
  return typeof s === 'string' && WIKILINK_RE.test(s);
}

/** Parse `[[target#heading|alias]]` into parts, or null if not a wikilink. */
export function parseWikilink(s: string): WikilinkParts | null {
  const m = s.match(WIKILINK_RE);
  if (!m) return null;
  const body = m[1]!; // safe: regex requires capture group when match succeeds
  const pipe = body.indexOf('|');
  const link = pipe >= 0 ? body.slice(0, pipe) : body;
  const aliasRaw = pipe >= 0 ? body.slice(pipe + 1).trim() : '';
  const hash = link.indexOf('#');
  const target = (hash >= 0 ? link.slice(0, hash) : link).trim();
  const headingRaw = hash >= 0 ? link.slice(hash + 1).trim() : '';
  const parts: WikilinkParts = { target };
  if (headingRaw) parts.heading = headingRaw;
  if (aliasRaw) parts.alias = aliasRaw;
  return parts;
}

/** Format parts back into a wikilink string; empty target → "". */
export function formatWikilink(parts: WikilinkParts): string {
  if (!parts.target) return '';
  let body = parts.target;
  if (parts.heading) body += `#${parts.heading}`;
  if (parts.alias) body += `|${parts.alias}`;
  return `[[${body}]]`;
}
