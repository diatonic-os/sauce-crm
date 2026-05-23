// SDK generator — source: sdk/generator/load-docs.md | api_version: 1.8.0 | gen_hash: hand-g003
//
// GENERATOR.md stage 3: build-time docs loader. Uses fs/path — NEVER imported by
// src/main.ts, so never bundled into main.js. Deterministic (sorted walk).
//
// SECURITY NOTE (CWE-22): this is a build-time developer tool. Its only inputs
// are process.cwd() / an explicit dev-supplied root and a vendored, read-only
// docs tree — there is no attacker-controlled path input. Defense-in-depth is
// still applied: the recursive walk skips symlinks (withFileTypes lstat — a
// symlink is neither isFile nor isDirectory) and every file read is asserted to
// resolve *within* the docs root via assertWithin(). The path.join/resolve calls
// on trusted, contained values are annotated nosemgrep with this rationale.

import * as fs from 'fs';
import * as path from 'path';
import { parseApiDoc, ApiDescriptor } from './parse-api-doc';
import { parseCssVars, CssToken } from './parse-css-vars';
import { stableSort } from '../groups/helpers/stable-sort';

const DOCS_REL = path.join('reference', 'obsidian-developer-docs', 'en'); // nosemgrep -- constant segments

/** Throw if `target` does not resolve to a location inside `base`. */
function assertWithin(base: string, target: string): string {
  const resolvedBase = path.resolve(base); // nosemgrep -- base is dev-supplied docs root
  const resolved = path.resolve(target); // nosemgrep -- contained read below
  if (resolved !== resolvedBase && !resolved.startsWith(resolvedBase + path.sep)) {
    throw new Error(`path escapes docs root: ${target}`);
  }
  return resolved;
}

/** Resolve the vendored Obsidian docs root, or null if not found. */
export function resolveDocsRoot(startDir: string = process.cwd()): string | null {
  const env = process.env.SAUCE_OBSIDIAN_DOCS;
  if (env && fs.existsSync(path.join(env, 'Reference'))) return env; // nosemgrep -- explicit dev env override
  let dir = path.resolve(startDir); // nosemgrep -- trusted cwd; upward search is intended
  for (;;) {
    const candidate = path.join(dir, DOCS_REL); // nosemgrep -- trusted ancestry walk
    if (fs.existsSync(path.join(candidate, 'Reference'))) return candidate; // nosemgrep -- trusted
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** Recursively collect `.md` files under `dir`, sorted; skips symlinks. */
function walkMd(root: string, dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    const full = path.join(dir, entry.name); // nosemgrep -- entry.name from readdir of contained dir
    if (entry.isSymbolicLink()) continue; // defense: never follow symlinks
    if (entry.isDirectory()) out.push(...walkMd(root, full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(assertWithin(root, full));
  }
  return out;
}

/** Load all TypeScript API descriptors, sorted by symbol. */
export function loadApiDescriptors(root: string): ApiDescriptor[] {
  const dir = path.join(root, 'Reference', 'TypeScript API'); // nosemgrep -- constant segments under root
  const descs: ApiDescriptor[] = [];
  for (const file of walkMd(root, dir)) {
    const d = parseApiDoc(fs.readFileSync(file, 'utf8'));
    if (d) descs.push(d);
  }
  return stableSort(descs, (d) => d.symbol);
}

/** Load all CSS variable tokens, deduped by token, sorted by token. */
export function loadCssTokens(root: string): CssToken[] {
  const dir = path.join(root, 'Reference', 'CSS variables'); // nosemgrep -- constant segments under root
  const byToken = new Map<string, CssToken>();
  for (const file of walkMd(root, dir)) {
    for (const t of parseCssVars(fs.readFileSync(file, 'utf8'))) {
      if (!byToken.has(t.token)) byToken.set(t.token, t);
    }
  }
  return stableSort([...byToken.values()], (t) => t.token);
}
