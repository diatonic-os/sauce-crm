---
group: tools
id: data-ivectorstore
summary: Vector-store seam — desktop native vs mobile WASM/remote, plus an in-memory reference.
platform: [desktop, mobile]
obsidian_api: none
api_version: "1.8.0"
inputs:
  IVectorStore: "interface { upsert; query; remove; size }"
  InMemoryVectorStore: "reference impl (mobile-fallback baseline + test double)"
outputs: "VectorHit[] on query"
side_effects: [vault.write]
deterministic: true
depends_on: [helpers/stable-sort]
---

# tools/data/IVectorStore

The seam from `MOBILE-FORK.md`. One interface, runtime-selected by
`tools/platform-detect`: desktop binds a `NativeVectorStore` (LanceDB / sqlite-vec,
gated `require` behind `isDesktopApp()`); mobile binds a WASM/remote store with
`CapacitorAdapter` storage. `InMemoryVectorStore` is the deterministic reference
(cosine similarity) used as the mobile-fallback baseline and in tests — it
imports nothing native, so it is mobile-safe by construction.

## Contract
- `upsert(id, vector, metadata?)` — insert/replace by id.
- `query(vector, k)` — top-`k` `VectorHit[]` sorted by score desc, ties by id asc
  (deterministic via `helpers/stable-sort`).
- `remove(id)`, `size()`.
- Cosine similarity; zero-vector scores 0; no wall-clock; deterministic.
