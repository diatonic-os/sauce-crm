import { describe, it, expect } from 'vitest';
import { HashEmbedder } from './IEmbedder';

describe('tools/data/IEmbedder (HashEmbedder)', () => {
  it('produces one vector per text of the configured dimension', async () => {
    const e = new HashEmbedder(8);
    const out = await e.embed(['hello world', 'foo']);
    expect(out.length).toBe(2);
    expect(out[0]!.length).toBe(8); // safe: length asserted above
  });

  it('is deterministic: same text → identical vector', async () => {
    const e = new HashEmbedder(16);
    const [a] = await e.embed(['relationship graph']);
    const [b] = await e.embed(['relationship graph']);
    expect(a).toEqual(b);
  });

  it('non-empty text yields unit L2 norm; empty text yields a zero vector', async () => {
    const e = new HashEmbedder(32);
    const [vec, zero] = await e.embed(['hello', '']);
    const norm = Math.sqrt(vec!.reduce((s, x) => s + x * x, 0)); // safe: embed(['hello','']) returns 2 vectors
    expect(norm).toBeCloseTo(1);
    expect(zero!.every((x) => x === 0)).toBe(true); // safe: same embed call guarantees index 1
  });

  it('rejects invalid dimensions', () => {
    expect(() => new HashEmbedder(0)).toThrow(RangeError);
    expect(() => new HashEmbedder(1.5)).toThrow(RangeError);
  });
});
