---
group: helpers
id: frontmatter-merge
summary: Deterministic deep-merge of two frontmatter records with array union and stable key order.
platform: universal
obsidian_api: none
api_version: "1.8.0"
inputs:
  mergeFrontmatter: "(base: Frontmatter, patch: Frontmatter) => Frontmatter"
outputs: "new merged record; keys sorted; arrays unioned first-seen; objects deep-merged"
side_effects: none
deterministic: true
depends_on: []
---

# helpers/frontmatter-merge

Pure deterministic merge of YAML frontmatter, used when capturing/updating notes
(`quick-capture`, `auto-touch-pipeline`). Determinism (CONTRACT.md rule 2): output
key order is stable (sorted), so re-merging unchanged inputs is a no-op diff.

## Contract
- Returns a **new** record; inputs are not mutated.
- Scalar/`patch` value overrides `base` for the same key.
- Two arrays → union preserving first-seen order, de-duplicated by JSON identity.
- Two plain objects → recursive merge by the same rules.
- Output object keys are sorted ascending (stable diffs).
- `Frontmatter = Record<string, unknown>`.
