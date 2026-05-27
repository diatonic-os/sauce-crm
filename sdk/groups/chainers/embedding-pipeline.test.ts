import { describe, it, expect } from 'vitest';
import { HashEmbedder } from '../tools/data/IEmbedder';
import { InMemoryVectorStore } from '../tools/data/IVectorStore';
import { runEmbeddingPipeline, queryEmbeddings } from './embedding-pipeline';

const docs = [
  { id: 'frank', text: 'Frank works in renewable energy and solar', metadata: { type: 'person' } },
  { id: 'acme', text: 'Acme Corp manufactures industrial widgets' },
];

describe('chainers/embedding-pipeline', () => {
  it('embeds and upserts all docs', async () => {
    const store = new InMemoryVectorStore();
    const res = await runEmbeddingPipeline(docs, new HashEmbedder(64), store);
    expect(res.embedded).toBe(2);
    expect(await store.size()).toBe(2);
  });

  it('is idempotent: re-running leaves the store size unchanged', async () => {
    const store = new InMemoryVectorStore();
    const embedder = new HashEmbedder(64);
    await runEmbeddingPipeline(docs, embedder, store);
    await runEmbeddingPipeline(docs, embedder, store);
    expect(await store.size()).toBe(2);
  });

  it('queryEmbeddings retrieves the most similar doc', async () => {
    const store = new InMemoryVectorStore();
    const embedder = new HashEmbedder(64);
    await runEmbeddingPipeline(docs, embedder, store);
    const hits = await queryEmbeddings('solar renewable energy', 1, embedder, store);
    const top = hits[0]!; // safe: queryEmbeddings with k=1 returns 1 hit given seeded store
    expect(top.id).toBe('frank');
  });

  it('empty docs is a no-op', async () => {
    const store = new InMemoryVectorStore();
    expect((await runEmbeddingPipeline([], new HashEmbedder(8), store)).embedded).toBe(0);
    expect(await store.size()).toBe(0);
  });
});
