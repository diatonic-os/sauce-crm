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

  const apiCount = (apiSrc.match(/^\s{2}"/gm) || []).length;
  const cssCount = (cssSrc.match(/^\s{2}"/gm) || []).length;
  console.log(`[sdk:gen] wrote api-catalog.ts (${apiCount} symbols) + css-tokens.ts (${cssCount} tokens) from ${root}`);
}

main();
