---
group: components
id: crm-card
summary: Headless CRM card builder — every style bound to a generated CSS token (zero literals).
platform: [desktop, mobile]
obsidian_api: none
api_version: "1.8.0"
inputs:
  renderCrmCard: "(doc: Document, model: CrmCardModel) => HTMLElement"
outputs: "an HTMLElement styled only via cssTokens"
side_effects: [ui]
deterministic: true
depends_on: [generator/emit-css-tokens]
---

# components/crm-card

A component built headless (DOM builder) because the worktree predates the Svelte
toolchain; the Svelte wrapper lands when `esbuild-svelte` is wired, reusing this
same token contract. Proves CONTRACT.md's style rule: **every** inline style
value is a `var(--token)` from the generated `cssTokens` map — zero hardcoded
colors/sizes. Renders identically on desktop and mobile (theme vars resolve per
host).

## Contract
- `renderCrmCard(doc, { name, subtitle? })` returns a `<div.sauce-crm-card>` with
  a name row and optional subtitle row.
- Every assigned inline style is sourced from `cssTokens` (asserted in test:
  all values match `var(--…)`).
- Deterministic: same model ⇒ same DOM structure.
