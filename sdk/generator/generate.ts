// SDK generator — source: sdk/GENERATOR.md | api_version: 1.8.0 | gen_hash: hand-g006
//
// `sdk:gen` orchestrator (build-time). Wires loader -> emitters -> sdk/generated/*.
// Run via: esbuild sdk/generator/generate.ts --bundle --platform=node --format=esm | node --input-type=module
//
// SECURITY NOTE (CWE-22): build-time tool; output dir is a fixed constant under
// the project; docs root is dev-controlled (see load-docs.ts). nosemgrep markers
// document the trusted, contained path joins.

import * as fs from 'fs';
import * as path from 'path';
import { resolveDocsRoot, loadApiDescriptors, loadCssTokens } from './load-docs';
import { emitApiCatalog } from './emit-api-catalog';
import { emitCssTokens } from './emit-css-tokens';
import { parseMemberDoc, emitRegistry, MemberDescriptor } from './emit-registry';

/** Collect member-doc .md files under sdk/groups, sorted (deterministic). */
function walkGroupDocs(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const out: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
  for (const entry of entries) {
    const full = path.join(dir, entry.name); // nosemgrep -- entry from readdir of contained sdk/groups
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) out.push(...walkGroupDocs(full));
    else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function main(): void {
  const root = resolveDocsRoot();
  if (!root) {
    console.error('[sdk:gen] Obsidian docs not found. Set SAUCE_OBSIDIAN_DOCS or vendor reference/obsidian-developer-docs.');
    process.exit(1);
  }
  const outDir = path.resolve('sdk', 'generated'); // nosemgrep -- fixed constant output dir
  fs.mkdirSync(outDir, { recursive: true });

  const apiSrc = emitApiCatalog(loadApiDescriptors(root));
  const cssSrc = emitCssTokens(loadCssTokens(root));
  fs.writeFileSync(path.join(outDir, 'api-catalog.ts'), apiSrc); // nosemgrep -- fixed filename under outDir
  fs.writeFileSync(path.join(outDir, 'css-tokens.ts'), cssSrc); // nosemgrep -- fixed filename under outDir

  // Aggregate member contracts into REGISTRY.md (skips _index docs).
  const members: MemberDescriptor[] = [];
  for (const file of walkGroupDocs(path.resolve('sdk', 'groups'))) {
    const d = parseMemberDoc(fs.readFileSync(file, 'utf8'));
    if (d) members.push(d);
  }
  fs.writeFileSync(path.resolve('sdk', 'REGISTRY.md'), emitRegistry(members)); // nosemgrep -- fixed path

  const apiCount = (apiSrc.match(/^\s{2}"/gm) || []).length;
  const cssCount = (cssSrc.match(/^\s{2}"/gm) || []).length;
  console.log(
    `[sdk:gen] wrote api-catalog.ts (${apiCount} symbols) + css-tokens.ts (${cssCount} tokens) + REGISTRY.md (${members.length} members) from ${root}`,
  );
}

main();
