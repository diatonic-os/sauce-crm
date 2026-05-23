import { describe, it, expect } from 'vitest';
import { InMemoryVectorStore } from './IVectorStore';

describe('tools/data/IVectorStore (InMemoryVectorStore)', () => {
  it('upserts and reports size', async () => {
    const s = new InMemoryVectorStore();
    await s.upsert('a', [1, 0]);
    await s.upsert('b', [0, 1]);
    expect(await s.size()).toBe(2);
    await s.upsert('a', [1, 1]); // replace
    expect(await s.size()).toBe(2);
  });

  it('queries by cosine similarity, ranked desc', async () => {
    const s = new InMemoryVectorStore();
    await s.upsert('x', [1, 0], { tag: 'x' });
    await s.upsert('y', [0, 1]);
    const hits = await s.query([1, 0], 2);
    expect(hits[0].id).toBe('x');
    expect(hits[0].score).toBeCloseTo(1);
    expect(hits[0].metadata).toEqual({ tag: 'x' });
    expect(hits[1].id).toBe('y');
    expect(hits[1].score).toBeCloseTo(0);
  });

  it('breaks score ties deterministically by id asc', async () => {
    const s = new InMemoryVectorStore();
    await s.upsert('b', [1, 0]);
    await s.upsert('a', [1, 0]); // identical vector → tie
    const hits = await s.query([1, 0], 2);
    expect(hits.map((h) => h.id)).toEqual(['a', 'b']);
  });

  it('scores zero vectors as 0 and respects k and remove', async () => {
    const s = new InMemoryVectorStore();
    await s.upsert('z', [0, 0]);
    await s.upsert('p', [1, 1]);
    expect((await s.query([1, 1], 1)).length).toBe(1);
    await s.remove('p');
    expect(await s.size()).toBe(1);
    expect((await s.query([1, 1], 5))[0].score).toBe(0); // only z left, zero vector
  });
});
