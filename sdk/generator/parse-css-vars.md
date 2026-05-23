---
group: generator
id: parse-css-vars
summary: Pure parser — one Obsidian CSS-variables .md doc → sorted token descriptors.
platform: universal
obsidian_api: none
api_version: "1.8.0"
inputs:
  parseCssVars: "(markdown: string) => CssToken[]"
outputs: "CssToken[] = { token, description, section }[] sorted by token"
side_effects: none
deterministic: true
depends_on: []
---

# generator/parse-css-vars

GENERATOR.md stage 2, as a pure function. The CSS-variables docs are tables of
`` | `--token` | description | `` rows under `###` sections. Note: these docs
carry **descriptions, not default values** — so the token map records
`description` (deviation from GENERATOR.md's `default`; we extract what the docs
actually provide rather than paraphrase). `components/` import tokens by name.

## Contract
- Extract every table row whose first cell is a backticked `--token`.
- `section` = the nearest preceding `##`/`###`/`####` heading (or `""`).
- `description` = the second cell, trimmed.
- Return sorted ascending by `token`; de-duplicated by token (first wins).
- Pure, deterministic.
