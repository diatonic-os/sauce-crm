---
group: components
id: setting-row
summary: Headless setting-row builder — label + optional description, styled only via cssTokens.
platform: [desktop, mobile]
obsidian_api: none
api_version: "1.8.0"
deterministic: true
depends_on: [generator/emit-css-tokens]
---

# components/setting-row

Headless setting row (Svelte wrapper lands when the toolchain does). Label +
optional description, every style value a `var(--token)` from the generated
`cssTokens` map (zero literals per CONTRACT.md).

## Contract
- `renderSettingRow(doc, { label, description? })` → `<div.sauce-setting-row>`
  with a label row and optional description row.
- Every inline style value is sourced from `cssTokens` (zero-literals gate).
