// Deterministic brain index primitives — the tokenize → lexicon → taxonomy →
// path-matrix layer beneath the crystal digests. All pure + serializable so the
// full build is reproducible and unit-testable; BrainBuilder orchestrates them
// over the vault and persists the result under _brain/.

/** A tiny English stoplist — enough to keep the lexicon signal-bearing without
 *  dragging in a dependency. Domain terms (names, orgs, jargon) survive. */
const STOPWORDS = new Set(
  (
    "a an and are as at be by for from has have he in is it its of on or that " +
    "the to was were will with this these those they them his her our your my " +
    "not but if then else when which who whom whose how what why we you i do " +
    "does did done can could should would may might must shall into out up down " +
    "over under again further once here there all any both each few more most " +
    "other some such no nor only own same so than too very s t just"
  ).split(" "),
);

/** Split text into normalized word tokens: lowercased, ≥3 chars, non-stopword,
 *  alphanumeric (keeps hyphen-internal words via the split). Deterministic. */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9'-]{1,}/g) ?? []).filter(
    (t) => t.length >= 3 && !STOPWORDS.has(t),
  );
}

export interface LexiconEntry {
  freq: number;
  docs: number;
}

/** Accumulates term frequency + document frequency across the vault. */
export class Lexicon {
  private terms = new Map<string, { freq: number; docs: number }>();

  /** Add one document's tokens. docCount increments once per distinct term. */
  addDocument(tokens: string[]): void {
    const seen = new Set<string>();
    for (const t of tokens) {
      const e = this.terms.get(t) ?? { freq: 0, docs: 0 };
      e.freq += 1;
      if (!seen.has(t)) {
        e.docs += 1;
        seen.add(t);
      }
      this.terms.set(t, e);
    }
  }

  get size(): number {
    return this.terms.size;
  }

  /** Top-N terms by frequency (then alphabetical), for the persisted lexicon. */
  top(n: number): Array<{ term: string; freq: number; docs: number }> {
    return [...this.terms.entries()]
      .map(([term, e]) => ({ term, freq: e.freq, docs: e.docs }))
      .sort((a, b) => b.freq - a.freq || a.term.localeCompare(b.term))
      .slice(0, n);
  }

  toJSON(topN = 2000): string {
    return JSON.stringify({ version: 1, terms: this.top(topN) });
  }
}

export interface TaxonomyCounts {
  folders: Record<string, number>;
  types: Record<string, number>;
  frontmatterKeys: Record<string, number>;
  tags: Record<string, number>;
}

/** Accumulates the vault's structural taxonomy: folders, entity types,
 *  frontmatter keys, and tags — each with occurrence counts. */
export class Taxonomy {
  private folders = new Map<string, number>();
  private types = new Map<string, number>();
  private keys = new Map<string, number>();
  private tags = new Map<string, number>();

  private static bump(m: Map<string, number>, k: string): void {
    if (!k) return;
    m.set(k, (m.get(k) ?? 0) + 1);
  }

  addDocument(
    path: string,
    frontmatter: Record<string, unknown>,
    tags: string[],
  ): void {
    const folder = path.includes("/")
      ? path.slice(0, path.indexOf("/"))
      : "(root)";
    Taxonomy.bump(this.folders, folder);
    const type = frontmatter.type ?? frontmatter.primary_type;
    if (type != null) Taxonomy.bump(this.types, String(type));
    for (const k of Object.keys(frontmatter)) Taxonomy.bump(this.keys, k);
    for (const t of tags) Taxonomy.bump(this.tags, t.replace(/^#/, ""));
  }

  private static obj(m: Map<string, number>): Record<string, number> {
    return Object.fromEntries(
      [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
    );
  }

  counts(): TaxonomyCounts {
    return {
      folders: Taxonomy.obj(this.folders),
      types: Taxonomy.obj(this.types),
      frontmatterKeys: Taxonomy.obj(this.keys),
      tags: Taxonomy.obj(this.tags),
    };
  }

  toJSON(): string {
    return JSON.stringify({ version: 1, ...this.counts() });
  }
}

export interface PathRecord {
  type: string | null;
  title: string;
  mtime: number;
  /** Outgoing wikilink targets (resolved to vault paths where possible). */
  links: string[];
  /** Incoming links — the symmetric counterpart of `links`. Filled by
   *  resolveLinkSymmetry so the lattice is reciprocal: A.links⊇[B] ⇔ B.linkedBy⊇[A]. */
  linkedBy: string[];
  tags: string[];
}

/** Extract `[[wikilink]]` targets (sans alias/heading) from a body. */
export function extractLinks(body: string): string[] {
  return [
    ...new Set(
      (body.match(/\[\[([^\]|#]+)/g) ?? []).map((l) => l.slice(2).trim()),
    ),
  ];
}

/** Build a compact path-index record for one note. Deterministic. */
export function pathRecord(
  frontmatter: Record<string, unknown>,
  body: string,
  mtime: number,
  tags: string[],
): PathRecord {
  const type = frontmatter.type ?? frontmatter.primary_type ?? null;
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const title =
    (typeof frontmatter.title === "string" && frontmatter.title) ||
    (typeof frontmatter.name === "string" && frontmatter.name) ||
    heading ||
    "";
  return {
    type: type == null ? null : String(type),
    title,
    mtime,
    links: extractLinks(body),
    linkedBy: [],
    tags: tags.map((t) => t.replace(/^#/, "")),
  };
}

/** A note's basename without extension (e.g. "people/Alice.md" → "alice"),
 *  used to resolve a wikilink name to a vault path. */
function basenameKey(path: string): string {
  const base = path.split("/").pop() ?? path;
  return base.replace(/\.md$/i, "").toLowerCase();
}

/**
 * Make the link lattice reciprocal (perfect symmetry): for every resolvable
 * out-link A→B, add the backlink B←A. Wikilink names are resolved to paths by
 * basename; unresolved names are kept as-is on `links` but produce no backlink.
 * Mutates the records in place. Idempotent — clears prior `linkedBy` first.
 */
export function resolveLinkSymmetry(records: Map<string, PathRecord>): void {
  const byBasename = new Map<string, string>();
  for (const path of records.keys()) byBasename.set(basenameKey(path), path);
  for (const rec of records.values()) rec.linkedBy = [];
  for (const [path, rec] of records) {
    const resolved = new Set<string>();
    for (const link of rec.links) {
      // Resolve a link that is already a vault path directly (keeps the pass
      // idempotent — a prior run normalizes names to paths), else by basename.
      const target = records.has(link)
        ? link
        : byBasename.get(link.toLowerCase());
      if (target && target !== path) {
        resolved.add(target);
        const t = records.get(target)!;
        if (!t.linkedBy.includes(path)) t.linkedBy.push(path);
      }
    }
    // Normalize out-links to resolved paths where possible (kept unique).
    rec.links = [
      ...new Set(rec.links.map((l) => byBasename.get(l.toLowerCase()) ?? l)),
    ];
    void resolved;
  }
}

export interface FolderNode {
  folder: string;
  files: number;
  types: Record<string, number>;
  topTerms: string[];
  subfolders: FolderNode[];
}

/**
 * Fractal self-similarity: aggregate the same crystallization at folder level,
 * recursively, so the brain has the same shape at file → folder → vault layers.
 * Each node summarizes its subtree's file count, type mix, and lead terms.
 */
export function buildFolderLattice(
  records: Map<string, PathRecord>,
): FolderNode {
  const root: FolderNode = {
    folder: "(vault)",
    files: 0,
    types: {},
    topTerms: [],
    subfolders: [],
  };
  const ensure = (parts: string[]): FolderNode => {
    let node = root;
    let acc = "";
    for (const part of parts) {
      acc = acc ? `${acc}/${part}` : part;
      let child = node.subfolders.find((s) => s.folder === acc);
      if (!child) {
        child = {
          folder: acc,
          files: 0,
          types: {},
          topTerms: [],
          subfolders: [],
        };
        node.subfolders.push(child);
      }
      node = child;
    }
    return node;
  };
  for (const [path, rec] of records) {
    const parts = path.split("/").slice(0, -1);
    // Count this file at every ancestor level (self-similar aggregation).
    const chain: FolderNode[] = [root];
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      node = ensure(parts.slice(0, i + 1));
      chain.push(node);
    }
    for (const n of chain) {
      n.files += 1;
      if (rec.type) n.types[rec.type] = (n.types[rec.type] ?? 0) + 1;
    }
  }
  const sortNode = (n: FolderNode): void => {
    n.subfolders.sort(
      (a, b) => b.files - a.files || a.folder.localeCompare(b.folder),
    );
    n.subfolders.forEach(sortNode);
  };
  sortNode(root);
  return root;
}
