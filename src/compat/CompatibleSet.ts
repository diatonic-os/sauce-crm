/**
 * Fântână/Minculete/Precup 2014 — compatible-set semantics.
 * Cms(A, B) = I ∪ X_{A/B} ∪ (X ∩ Y), where X/Y are characteristic sets of A and B.
 * For our purposes, characteristics are scalar/array fields named in config.
 */

export interface CompatibleSetResult {
  cms: string[];
  shared: string[];
  unique_a: string[];
  unique_b: string[];
  density: number; // |Cms| / |X ∪ Y|, normalized 0..1
  symmetric: boolean; // true iff X(A) and X(B) are the SAME set (no unique tokens)
}

export function computeCompatibleSet(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
  fields: string[],
): CompatibleSetResult {
  const xa = new Set<string>();
  const xb = new Set<string>();

  for (const f of fields) {
    for (const v of toTokenSet(a[f])) xa.add(`${f}:${v}`);
    for (const v of toTokenSet(b[f])) xb.add(`${f}:${v}`);
  }

  const shared = [...xa].filter((x) => xb.has(x));
  const unique_a = [...xa].filter((x) => !xb.has(x));
  const unique_b = [...xb].filter((x) => !xa.has(x));
  const unionSize = xa.size + unique_b.length;
  const cms = [...new Set([...shared, ...unique_a, ...unique_b])];
  const density = unionSize === 0 ? 0 : shared.length / unionSize;

  return {
    cms,
    shared,
    unique_a,
    unique_b,
    density,
    // True symmetry = the characteristic sets are equal (no unique tokens on
    // either side). The old `unique_a.length === unique_b.length` only compared
    // COUNTS, so two disjoint-but-equal-sized sets were wrongly flagged.
    symmetric: unique_a.length === 0 && unique_b.length === 0,
  };
}

function toTokenSet(v: unknown): string[] {
  if (v == null) return [];
  if (Array.isArray(v))
    return v.map((x) => String(x).toLowerCase()).filter(Boolean);
  return [String(v).toLowerCase()].filter(Boolean);
}
