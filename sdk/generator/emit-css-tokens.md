---
group: generator
id: emit-css-tokens
summary: Pure emitter — CssToken[] → deterministic TS source for the components token map.
platform: universal
obsidian_api: none
api_version: "1.8.0"
inputs:
  emitCssTokens: "(tokens: CssToken[]) => string"
outputs: "TS source exporting `cssTokens` (camelKey -> var(--token)) + CssTokenKey type"
side_effects: none
deterministic: true
depends_on: [generator/parse-css-vars, helpers/stable-sort]
---

# generator/emit-css-tokens

GENERATOR.md stage 5. Pure: tokens → `sdk/generated/css-tokens.ts` source. Keys
are camelCase of the token (minus `--`); values are `var(--token)` so a Svelte
component writes `style.background = cssTokens.metadataBackground` and never a
literal — enforcing CONTRACT.md's "tokens only, zero hardcoded styles".

## Contract
- Key = camelCase(token without leading `--`); value = `var(<token>)`.
- Deduped by camel key (first wins); output sorted ascending by key.
- Includes a GENERATED provenance header and a `CssTokenKey` union type.
- Pure and deterministic: same tokens ⇒ byte-identical source.
