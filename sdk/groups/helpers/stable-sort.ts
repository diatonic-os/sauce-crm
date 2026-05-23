// SDK helper — source: sdk/groups/helpers/stable-sort.md | api_version: 1.8.0 | gen_hash: hand-0002
//
// Deterministic stable sort by key. Pure. See sdk/CONTRACT.md determinism rule 2.

/**
 * Sort a copy of `items` ascending by `key`, preserving the original relative
 * order of elements with equal keys (stable). Numbers compare numerically;
 * strings compare by UTF-16 code unit (locale-independent, deterministic).
 */
export function stableSort<T>(items: readonly T[], key: (item: T) => string | number): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const ka = key(a.item);
      const kb = key(b.item);
      if (ka < kb) return -1;
      if (ka > kb) return 1;
      return a.index - b.index; // tie-break by original position → stable
    })
    .map(({ item }) => item);
}
