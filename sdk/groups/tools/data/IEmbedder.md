---
group: tools
id: data-iembedder
summary: Embedding seam — desktop local/remote vs mobile remote, plus a deterministic hash reference.
platform: [desktop, mobile]
obsidian_api: none
api_version: "1.8.0"
inputs:
  IEmbedder: "interface { dimensions; embed(texts) }"
  HashEmbedder: "deterministic offline reference (FNV-1a, L2-normalized)"
outputs: "number[][] (one vector per input text)"
side_effects: none
deterministic: true
depends_on: []
---

# tools/data/IEmbedder

The embedding seam from `MOBILE-FORK.md`. Runtime-selected: desktop may use a
local model (LM Studio/Ollama) or remote; mobile uses a remote provider via
`tools/requesturl-fetch` (no local model runtime on iOS). `HashEmbedder` is the
deterministic, network-free reference — a hashed bag-of-words, L2-normalized so
it composes with `IVectorStore` cosine. Used for tests and as a degraded offline
fallback. Mobile-safe by construction (no native imports).

## Contract
- `dimensions` — fixed output dimensionality.
- `embed(texts)` — one `number[]` per text, each length `dimensions`.
- `HashEmbedder` is pure/deterministic: same text ⇒ same vector; empty text ⇒
  zero vector; non-empty ⇒ unit L2 norm.
