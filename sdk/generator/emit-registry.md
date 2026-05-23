---
group: generator
id: emit-registry
summary: Parse member-doc frontmatter and emit the aggregated REGISTRY.md catalog.
platform: universal
obsidian_api: none
api_version: "1.8.0"
inputs:
  parseMemberDoc: "(markdown: string) => MemberDescriptor | null"
  emitRegistry: "(members: MemberDescriptor[]) => string"
outputs: "MemberDescriptor | null / REGISTRY.md markdown"
side_effects: none
deterministic: true
depends_on: [helpers/stable-sort]
---

# generator/emit-registry

GENERATOR.md stage 6. Aggregates every member `.md` into the one MCP-esque
catalog (`sdk/REGISTRY.md`). Frontmatter is parsed with a small regex extractor
rather than `helpers/parse-yaml`, because the generator bundle must not import
`obsidian` (it runs under node, where `obsidian` is unresolvable).

## Contract
- `parseMemberDoc(markdown)` reads the leading `---` frontmatter; returns
  `{ group, id, summary, platform }` only when **both** `group` and `id` exist
  (so `_index.md`, which has `group` but no `id`, is skipped → `null`).
- `emitRegistry(members)` renders a markdown catalog, sorted by group then id,
  one section per group with an id/platform/summary table. Deterministic.
