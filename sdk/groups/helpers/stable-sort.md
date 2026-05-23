---
group: helpers
id: stable-sort
summary: Deterministic stable sort by key — preserves input order for equal keys.
platform: universal
obsidian_api: none
api_version: "1.8.0"
inputs:
  stableSort: "<T>(items: readonly T[], key: (item: T) => string | number) => T[]"
outputs: "new sorted array; equal keys retain original relative order"
side_effects: none
deterministic: true
depends_on: []
---

# helpers/stable-sort

Enforces CONTRACT.md determinism rule 2 (stable iteration order). Every registry
(`REGISTRY.md`, group `_index` enumeration) and any user-facing list sorts
through this so output is byte-stable across runs and engines.

## Contract
- Returns a **new** array (no mutation of input).
- Sorts ascending by `key(item)`; numbers numerically, strings by code unit.
- Equal keys preserve original relative order (stable).
- Pure and deterministic; no wall-clock, no locale-dependent collation.
