// SDK tool — source: sdk/groups/tools/data/IEmbedder.md | api_version: 1.8.0 | gen_hash: hand-t008
//
// Embedding seam (MOBILE-FORK.md) + deterministic offline hash reference.
// No native/network imports → mobile-safe by construction.

export interface IEmbedder {
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}

/** FNV-1a 32-bit hash → unsigned int. Deterministic. */
function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic hashed bag-of-words embedder (offline reference / test double). */
export class HashEmbedder implements IEmbedder {
  constructor(public readonly dimensions = 64) {
    if (!Number.isInteger(dimensions) || dimensions <= 0) {
      throw new RangeError(`dimensions must be a positive integer, got ${dimensions}`);
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }

  private embedOne(text: string): number[] {
    const v = new Array<number>(this.dimensions).fill(0);
    for (const tok of text.toLowerCase().split(/\W+/).filter(Boolean)) {
      const i = fnv1a(tok) % this.dimensions;
      v[i] = (v[i] ?? 0) + 1;
    }
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    return norm === 0 ? v : v.map((x) => x / norm);
  }
}
