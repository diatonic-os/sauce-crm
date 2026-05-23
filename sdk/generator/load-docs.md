---
group: generator
id: load-docs
summary: Build-time loader — resolve docs root and load sorted API descriptors + CSS tokens.
platform: desktop
obsidian_api: none
api_version: "1.8.0"
inputs:
  resolveDocsRoot: "(startDir?: string) => string | null"
  loadApiDescriptors: "(root: string) => ApiDescriptor[]"
  loadCssTokens: "(root: string) => CssToken[]"
outputs: "sorted descriptor / token arrays"
side_effects: [fs.read]
deterministic: true
depends_on: [generator/parse-api-doc, generator/parse-css-vars, helpers/stable-sort]
---

# generator/load-docs

GENERATOR.md stage 3. **Build-time only** — uses `fs`/`path`, never imported by
`src/main.ts`, so it is never bundled into `main.js` (no mobile constraint).

## Contract
- `resolveDocsRoot(startDir?)` — return `$SAUCE_OBSIDIAN_DOCS` if set+exists,
  else walk up from `startDir` (default cwd) to find
  `reference/obsidian-developer-docs/en` (verified by a `Reference/` child).
  Returns `null` if not found.
- `loadApiDescriptors(root)` — walk `Reference/TypeScript API/**/*.md`, parse via
  `parse-api-doc`, drop nulls, return sorted by `symbol`.
- `loadCssTokens(root)` — walk `Reference/CSS variables/**/*.md`, parse via
  `parse-css-vars`, dedupe by token (first wins, walk is sorted), return sorted.
- Directory walk is sorted (deterministic across filesystems).
