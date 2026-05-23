---
group: helpers
id: wikilink
summary: Pure parse/format of Obsidian wikilinks with target, optional heading and alias.
platform: universal
obsidian_api: none
api_version: "1.8.0"
inputs:
  isWikilink: "(s: unknown) => boolean"
  parseWikilink: "(s: string) => WikilinkParts | null"
  formatWikilink: "(parts: WikilinkParts) => string"
outputs: "WikilinkParts = { target: string; heading?: string; alias?: string }"
side_effects: none
deterministic: true
depends_on: []
---

# helpers/wikilink

Canonical structured wikilink parsing/formatting: `[[target#heading|alias]]`.
Superset of the legacy `src/util/Wikilink.ts` (which will delegate here on
migration). Target semantics match the legacy util: text before `|`, trimmed.

## Contract
- `isWikilink(s)` — true iff `s` is a string of the exact form `[[...]]`.
- `parseWikilink(s)` — returns `{ target, heading?, alias? }` or `null`.
  - split on first `|` → left = link, right = alias (trimmed, omitted if empty);
  - split link on first `#` → target (trimmed) + heading (trimmed, omitted if empty).
- `formatWikilink(parts)` — inverse: `[[target(#heading)?(|alias)?]]`; empty
  `target` → `""`.
- Pure, deterministic; round-trips: `format(parse(x)) === x` for canonical input.
