---
group: helpers
summary: Pure utility functions — no I/O, fully deterministic, universal platform.
generated_from: Reference/TypeScript API (pure utilities)
---

# helpers/ — pure functions

No side effects, no platform gates, no wall-clock-for-logic. Every helper is
referentially transparent and unit-tested with table-driven cases.

## Seed members

| id | obsidian_api | deterministic |
|---|---|---|
| `normalize-path` | `normalizePath` | true |
| `parse-yaml` | `parseYaml` | true |
| `stringify-yaml` | `stringifyYaml` | true |
| `frontmatter-merge` | none (pure) | true |
| `wikilink` | none (pure) | true |
| `logical-clock` | none (pure) | true (monotonic counter, not wall-clock) |
| `stable-sort` | none (pure) | true |
| `arraybuffer-base64` | `arrayBufferToBase64` | true |
