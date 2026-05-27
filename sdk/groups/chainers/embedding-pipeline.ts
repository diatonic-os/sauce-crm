// SDK chainer — source: sdk/groups/chainers/embedding-pipeline.md | api_version: 1.8.0 | gen_hash: hand-c001
//
// Deterministic realtime-embeddings pipeline composing IEmbedder + IVectorStore.

import { IEmbedder } from '../tools/data/IEmbedder';
import { IVectorStore, VectorHit } from '../tools/data/IVectorStore';

export interface EmbeddingDoc {
  id: string;
  text: string;
  metadata?: Record<string, unknown>;
}

export interface EmbeddingPipelineResult {
  embedded: number;
}

/** Embed all docs (one batch) and upsert each by id. Idempotent. */
export async function runEmbeddingPipeline(
  docs: EmbeddingDoc[],
  embedder: IEmbedder,
  store: IVectorStore,
): Promise<EmbeddingPipelineResult> {
  if (docs.length === 0) return { embedded: 0 };
  const vectors = await embedder.embed(docs.map((d) => d.text));
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i]!;     // safe: i < docs.length
    const vec = vectors[i]!;  // safe: embed returns one vector per input text
    await store.upsert(doc.id, vec, doc.metadata);
  }
  return { embedded: docs.length };
}

/** Embed a query string and return the store's top-k hits. */
export async function queryEmbeddings(
  query: string,
  k: number,
  embedder: IEmbedder,
  store: IVectorStore,
): Promise<VectorHit[]> {
  const [vector] = await embedder.embed([query]);
  return store.query(vector!, k); // safe: embed([query]) always returns exactly one vector
}
