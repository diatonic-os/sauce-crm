---
group: skills
id: infer-edges
summary: Derive relationship edges (knows / worked_with) from a note's frontmatter.
platform: [desktop, mobile]
obsidian_api: none
api_version: "1.8.0"
inputs:
  inferEdges: "(cache: MetadataCache, file: TFile, subject: string) => Edge[]"
outputs: "Edge[] = { from, to, type }[]"
side_effects: none
deterministic: true
depends_on: [tools/metadata-read, helpers/wikilink]
---

# skills/infer-edges

Reads `knows[]` / `worked_with[]` from frontmatter (`metadata-read`), parses each
wikilink target (`wikilink`), and emits typed edges from the subject. Feeds
`chainers/intro-routing` and the relationship graph. Pure given the cache state.

## Contract
- For each of `knows`, `worked_with`: accept an array or a single value; for each
  string item, resolve a wikilink target (or use the raw string if not a link).
- Emit `{ from: subject, to: target, type }` per resolved target.
- Missing/empty fields ⇒ no edges. Deterministic ordering (knows before
  worked_with, input order within each).
