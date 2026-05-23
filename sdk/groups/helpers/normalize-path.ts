// SDK helper — source: sdk/groups/helpers/normalize-path.md | api_version: 1.8.0 | gen_hash: hand-0005
//
// Vault-path helpers. Pure, mobile-safe (no FileSystemAdapter). Wraps Obsidian
// normalizePath; joinPath is the only sanctioned vault-path composer.

import { normalizePath as obsidianNormalizePath } from 'obsidian';

/** Canonical vault-path normalizer (delegates to Obsidian). */
export function normalizePath(p: string): string {
  return obsidianNormalizePath(p);
}

/** Join vault path segments with `/` (skipping blanks), then normalize. */
export function joinPath(...segments: string[]): string {
  const joined = segments.filter((s) => s && s.trim().length > 0).join('/');
  return normalizePath(joined);
}
