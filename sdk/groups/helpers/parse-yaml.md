---
group: helpers
id: parse-yaml
summary: Wrap Obsidian parseYaml/stringifyYaml for frontmatter round-tripping.
platform: universal
obsidian_api: parseYaml
api_version: "1.8.0"
inputs:
  parseYaml: "<T = unknown>(src: string) => T"
  stringifyYaml: "(value: unknown) => string"
outputs: "parsed object / YAML string"
side_effects: none
deterministic: true
depends_on: []
---

# helpers/parse-yaml

Wraps Obsidian's `parseYaml` and `stringifyYaml` (the engine Obsidian itself
uses for frontmatter), so the SDK parses/serializes YAML identically to the host
— no second YAML dialect. Pairs with `frontmatter-merge` for note read/modify.

## Contract
- `parseYaml<T>(src)` — delegate to Obsidian; returns the parsed value typed as `T`.
- `stringifyYaml(value)` — delegate to Obsidian; returns YAML text.
- Pure relative to the host parser; universal platform; no I/O.
- Test stub backs these with `js-yaml` (the same library Obsidian uses).
