---
group: chainers
id: embedding-pipeline
summary: Deterministic pipeline — embed docs and upsert into the vector store; query by text.
platform: [desktop, mobile]
obsidian_api: none
api_version: "1.8.0"
inputs:
  runEmbeddingPipeline: "(docs: EmbeddingDoc[], embedder: IEmbedder, store: IVectorStore) => Promise<{ embedded: number }>"
  queryEmbeddings: "(query: string, k: number, embedder: IEmbedder, store: IVectorStore) => Promise<VectorHit[]>"
outputs: "{ embedded } / VectorHit[]"
side_effects: [vault.write]
deterministic: true
depends_on: [tools/data-iembedder, tools/data-ivectorstore]
---

# chainers/embedding-pipeline

The realtime-embeddings flow. Stages: texts → `IEmbedder.embed` →
`IVectorStore.upsert` (by id). Idempotent — re-running with unchanged docs
leaves the store identical (upsert replaces by id). Platform-agnostic: it only
touches the seams, so the same pipeline runs on desktop (native store/local
embedder) and iOS (WASM store / remote embedder).

## Contract
- `runEmbeddingPipeline(docs, embedder, store)` embeds all texts in one batch
  (stable order), upserts each by `id`, returns `{ embedded: docs.length }`.
- Empty `docs` ⇒ `{ embedded: 0 }`, no store mutation.
- `queryEmbeddings(query, k, embedder, store)` embeds the query and returns the
  store's top-`k` hits.
- Deterministic; bounded; idempotent (CONTRACT.md chainers determinism rule).
