/**
 * Minimal YAML serializer for frontmatter writeback. We avoid a full YAML
 * dependency: Obsidian's processFrontMatter mutates a JS object and writes
 * it back, so we only need to slugify keys and quote strings safely.
 */
export function slugify(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9-_ ]+/g, "")
    .trim()
    .replace(/\s+/g, " ");
}

export function asArray<T = any>(v: any): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

export function uniq<T>(xs: T[]): T[] {
  const seen = new Set<T>();
  return xs.filter((x) => (seen.has(x) ? false : (seen.add(x), true)));
}
