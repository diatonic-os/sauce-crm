---
group: helpers
id: normalize-path
summary: Wrap Obsidian normalizePath plus a deterministic POSIX joinPath for vault-relative paths.
platform: universal
obsidian_api: normalizePath
api_version: "1.8.0"
inputs:
  normalizePath: "(p: string) => string"
  joinPath: "(...segments: string[]) => string"
outputs: "canonical forward-slash vault-relative path"
side_effects: none
deterministic: true
depends_on: []
---

# helpers/normalize-path

Wraps Obsidian's `normalizePath` (the canonical vault-path normalizer) and adds
`joinPath`, the only sanctioned way to compose vault paths — no string `+`
concatenation (mirrors the global paths-lib `paths.join` discipline for the
vault domain). Vault paths are always forward-slash POSIX.

## Contract
- `normalizePath(p)` — delegate to Obsidian; backslash→`/`, collapse `//`, trim
  leading/trailing `/`.
- `joinPath(...segments)` — join non-empty segments with `/`, then normalize.
  Empty/blank segments are skipped. Result is normalized and deterministic.
- Pure; no I/O; universal platform (no `FileSystemAdapter`, mobile-safe).
