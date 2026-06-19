// The crystallized "brain" cache — a compacted key→digest matrix of the vault.
//
// Per query, SauceBotRuntime previously inlined up to ~8 000 chars (~2 000
// tokens) of RAW markdown bodies, re-read from disk every time. That is the
// dominant per-query token cost and feeds the model noise instead of signal.
//
// This module crystallizes each entity into a small deterministic DIGEST (key
// frontmatter + headings + lead sentences + outgoing links), keyed by a hash of
// the source body so it self-invalidates when the note changes. The runtime
// inlines the digest (~150 tokens) instead of the raw body — a ~10× token cut
// that also sharpens grounding (less noise) for cheaper, more accurate answers
// on both cloud APIs and local models.
//
// The matrix persists as ONE small JSON file under the vault (_brain/brain-
// crystal.json): a single-file write barely touches Obsidian's watcher, while
// the heavy embedding vectors stay in the out-of-vault LanceDB where they are.

export interface CrystalEntry {
  /** Hash of the source body the digest was derived from (self-invalidation). */
  hash: string;
  /** The compacted digest text inlined into the model context. */
  digest: string;
  /** Whether the digest was distilled by a model (vs deterministic). */
  distilled?: boolean;
}

export interface DigestOptions {
  /** Hard cap on digest length in characters (default 600 ≈ ~150 tokens). */
  maxChars?: number;
}

const DEFAULT_MAX_CHARS = 600;

// CRM-relevant frontmatter fields worth carrying into the digest, in priority
// order. Everything else is dropped — the digest is signal, not a dump.
const KEY_FRONTMATTER = [
  "type",
  "primary_type",
  "title",
  "role",
  "company",
  "org",
  "expertise",
  "status",
  "intro_opt_in",
  "closeness",
  "cadence",
  "last_touch",
  "location",
  "email",
  "tags",
];

/** djb2 — same cheap, stable string hash the LanceDB mirror uses for body
 *  change-detection, so a crystal entry and a mirror row agree on "changed". */
export function hashBody(body: string): string {
  let h = 5381;
  for (let i = 0; i < body.length; i++) h = (h * 33) ^ body.charCodeAt(i);
  return (h >>> 0).toString(36);
}

function stringifyField(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => String(x)).join(", ");
  if (v && typeof v === "object") return JSON.stringify(v);
  return String(v);
}

/** First non-empty paragraph of the body, stripped of markdown noise and
 *  truncated. Captures the "lead" of a note without the whole thing. */
function leadParagraph(body: string, cap: number): string {
  const paras = body
    .replace(/^#{1,6}\s+.*$/gm, "") // drop heading lines (captured separately)
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length > 0);
  const first = paras[0] ?? "";
  return first.length > cap ? first.slice(0, cap).trimEnd() + "…" : first;
}

/**
 * Build a compact, deterministic digest for one entity. Pure function — no I/O,
 * no model calls — so it is cheap, reproducible, and trivially testable.
 */
export function buildEntityDigest(
  path: string,
  frontmatter: Record<string, unknown>,
  body: string,
  opts: DigestOptions = {},
): string {
  const maxChars = opts.maxChars ?? DEFAULT_MAX_CHARS;
  const parts: string[] = [path];

  const fm = KEY_FRONTMATTER.filter(
    (k) => frontmatter[k] != null && stringifyField(frontmatter[k]).trim() !== "",
  ).map((k) => `${k}: ${stringifyField(frontmatter[k])}`);
  if (fm.length) parts.push(fm.join(" · "));

  const headings = (body.match(/^#{1,3}\s+.+$/gm) ?? [])
    .slice(0, 6)
    .map((h) => h.replace(/^#{1,3}\s+/, "").trim());
  if (headings.length) parts.push("§ " + headings.join(" / "));

  const lead = leadParagraph(body, 280);
  if (lead) parts.push(lead);

  const links = [...new Set((body.match(/\[\[([^\]|#]+)/g) ?? []).map((l) => l.slice(2).trim()))]
    .slice(0, 8);
  if (links.length) parts.push("links: " + links.join(", "));

  const digest = parts.join("\n");
  return digest.length > maxChars ? digest.slice(0, maxChars).trimEnd() + "…" : digest;
}

/**
 * The crystal matrix: a path → {hash, digest} map with hash-validated reads and
 * compact JSON (de)serialization. Self-invalidating: a read only returns a
 * digest when the supplied body hash still matches the one it was built from.
 */
export class BrainCrystalCache {
  private entries = new Map<string, CrystalEntry>();
  private _dirty = false;

  get size(): number {
    return this.entries.size;
  }
  get dirty(): boolean {
    return this._dirty;
  }

  /** Return the cached digest IFF it was built from the current body hash. */
  get(path: string, hash: string): string | null {
    const e = this.entries.get(path);
    return e && e.hash === hash ? e.digest : null;
  }

  set(path: string, hash: string, digest: string, distilled = false): void {
    this.entries.set(path, {
      hash,
      digest,
      ...(distilled ? { distilled: true } : {}),
    });
    this._dirty = true;
  }

  /** Drop entries for paths no longer present (called after a full rebuild). */
  retain(livePaths: Set<string>): void {
    for (const p of [...this.entries.keys()]) {
      if (!livePaths.has(p)) {
        this.entries.delete(p);
        this._dirty = true;
      }
    }
  }

  markClean(): void {
    this._dirty = false;
  }

  toJSON(): string {
    const obj: Record<string, CrystalEntry> = {};
    for (const [k, v] of this.entries) obj[k] = v;
    return JSON.stringify({ version: 1, entries: obj });
  }

  static fromJSON(raw: string): BrainCrystalCache {
    const cache = new BrainCrystalCache();
    try {
      const parsed = JSON.parse(raw) as {
        entries?: Record<string, CrystalEntry>;
      };
      for (const [k, v] of Object.entries(parsed.entries ?? {})) {
        if (v && typeof v.hash === "string" && typeof v.digest === "string") {
          cache.entries.set(k, v);
        }
      }
    } catch {
      /* corrupt cache file → start empty (it re-warms lazily) */
    }
    cache._dirty = false;
    return cache;
  }
}
