// SDK helper — source: sdk/groups/helpers/frontmatter-merge.md | api_version: 1.8.0 | gen_hash: hand-0003
//
// Deterministic deep-merge of note frontmatter. Pure. See sdk/CONTRACT.md rule 2.

export type Frontmatter = Record<string, unknown>;

function isPlainObject(v: unknown): v is Frontmatter {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function unionArrays(a: readonly unknown[], b: readonly unknown[]): unknown[] {
  const seen = new Set<string>();
  const out: unknown[] = [];
  for (const v of [...a, ...b]) {
    const id = JSON.stringify(v);
    if (!seen.has(id)) {
      seen.add(id);
      out.push(v);
    }
  }
  return out;
}

/** Deterministically deep-merge `patch` over `base`; returns a new sorted-key record. */
export function mergeFrontmatter(base: Frontmatter, patch: Frontmatter): Frontmatter {
  const out: Frontmatter = {};
  const keys = Array.from(new Set([...Object.keys(base), ...Object.keys(patch)])).sort();
  for (const k of keys) {
    const bv = base[k];
    const pv = patch[k];
    if (!(k in patch)) {
      out[k] = bv;
    } else if (!(k in base)) {
      out[k] = pv;
    } else if (Array.isArray(bv) && Array.isArray(pv)) {
      out[k] = unionArrays(bv, pv);
    } else if (isPlainObject(bv) && isPlainObject(pv)) {
      out[k] = mergeFrontmatter(bv, pv);
    } else {
      out[k] = pv; // patch wins
    }
  }
  return out;
}
