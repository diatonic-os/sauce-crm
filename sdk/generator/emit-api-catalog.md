---
group: generator
id: emit-api-catalog
summary: Pure emitter — ApiDescriptor[] → TS source for a typed Obsidian API catalog + symbol guard.
platform: universal
obsidian_api: none
api_version: "1.8.0"
inputs:
  emitApiCatalog: "(descriptors: ApiDescriptor[]) => string"
outputs: "TS source exporting `apiCatalog`, `ApiSymbol` type, and `hasApiSymbol()`"
side_effects: none
deterministic: true
depends_on: [generator/parse-api-doc, helpers/stable-sort]
---

# generator/emit-api-catalog

GENERATOR.md stage 4, reframed honestly. Rather than fabricate executable method
bodies from signature strings (fragile codegen), the generator emits a **data
catalog** of the parsed API surface. `tools/` members are thin hand-authored
wrappers (like helpers) that import from `obsidian`; a generation/check step
asserts each tool's declared `obsidian_api` exists in this catalog — that is the
"fail loudly if a contract references a symbol absent from the docs" rule.

## Contract
- Emit `export const apiCatalog = { "<symbol>": { kind, signature }, ... } as const;`
  sorted by symbol, deduped (first wins).
- Emit `export type ApiSymbol = keyof typeof apiCatalog;`
- Emit `export function hasApiSymbol(s: string): s is ApiSymbol` (runtime guard).
- GENERATED provenance header; pure; byte-identical for identical input.
