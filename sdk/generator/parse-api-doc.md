---
group: generator
id: parse-api-doc
summary: Pure parser — one Obsidian TypeScript API .md doc → normalized descriptor.
platform: universal
obsidian_api: none
api_version: "1.8.0"
inputs:
  parseApiDoc: "(markdown: string) => ApiDescriptor | null"
outputs: "ApiDescriptor = { symbol, kind, signature }"
side_effects: none
deterministic: true
depends_on: []
---

# generator/parse-api-doc

GENERATOR.md stage 1, factored as a pure function so it is unit-testable without
the filesystem. Parses the API-Documenter markdown shape:

- frontmatter `aliases: "Symbol"` → `symbol`
- `## Symbol() method|function|...` heading → `kind`
- `**Signature:**` + ` ```typescript ` block → `signature`

## Contract
- Returns `null` if no `aliases` frontmatter (not an API symbol doc).
- `kind` ∈ function|method|property|class|interface|enum|variable|type|unknown.
- `signature` is the trimmed contents of the first typescript block after
  `**Signature:**`, or `""` if absent.
- Pure, deterministic, whitespace-tolerant.
