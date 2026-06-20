// ─────────────────────────────────────────────────────────────────────────────
//  MEMORY STORE — durable cross-session fact store for the updateMemory tool
// ─────────────────────────────────────────────────────────────────────────────
//
//  WHY THIS EXISTS
//  SauceBot needs a lightweight, provider-agnostic key-value store that can
//  survive across sessions (conversation windows) so the assistant can
//  remember user-asserted facts, project context, and preferences without
//  relying on the LLM context window.
//
//  Design decisions:
//  - Injected MemoryHost: the persistence mechanism (Obsidian file, SQLite,
//    remote API) is supplied by the caller so this module stays pure and
//    unit-testable with no native dependencies.
//  - Injected clock (`now`): enables deterministic unit tests; defaults to
//    `Date.now` in production.
//  - Lexical recall: token overlap scoring is intentionally simple — no
//    vector math, no native addons. Good enough for short user-asserted
//    facts; vector recall (lancedb) lives upstream in the RAG pipeline.
//  - Slug-based id generation: deterministic from text + ts so two calls
//    with the same text in the same tick yield the same id (idempotent
//    client retry).

/** A single persisted memory fact. */
export interface MemoryRecord {
  /** Stable identifier. Auto-generated from a text slug when not supplied. */
  id: string;
  /** Human-readable fact text. */
  text: string;
  /** Searchable labels; may be empty. */
  tags: string[];
  /** Creation / last-update timestamp (injected `now()` value). */
  ts: number;
}

/**
 * Persistence contract.  Implementors provide only two primitives; the store
 * handles all merge / query logic in memory after loading.
 */
export interface MemoryHost {
  /** Load all persisted records. Must return a fresh copy each time. */
  read(): Promise<MemoryRecord[]>;
  /** Persist the full record set, replacing prior state. */
  write(records: MemoryRecord[]): Promise<void>;
}

// ── internal helpers ──────────────────────────────────────────────────────────

/** Tokenise a string into lower-case words for overlap scoring. */
function tokenise(s: string): Set<string> {
  return new Set(s.toLowerCase().match(/\w+/g) ?? []);
}

/**
 * Derive a URL-safe slug from arbitrary text. Truncated so ids stay compact
 * even for long fact strings.
 */
function slugify(text: string, ts: number): string {
  const base = text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .slice(0, 40);
  return `${base}-${ts}`;
}

// ── MemoryStore ────────────────────────────────────────────────────────────────

/**
 * Durable key-value store for short user-asserted facts.
 *
 * All public methods are async to match the injected MemoryHost surface, even
 * when the underlying operation could be synchronous.
 */
export class MemoryStore {
  constructor(
    private readonly host: MemoryHost,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * Insert or replace a memory record.
   *
   * - If `id` is omitted a slug is generated from `text` + `now()`.
   * - If a record with the same `id` already exists it is replaced entirely.
   * - `ts` is always set to `now()` at the moment of the call.
   *
   * @returns The id of the created / updated record.
   */
  async upsert(input: { id?: string; text: string; tags?: string[] }): Promise<string> {
    const ts = this.now();
    const id = input.id ?? slugify(input.text, ts);
    const record: MemoryRecord = {
      id,
      text: input.text,
      tags: input.tags ?? [],
      ts,
    };

    const records = await this.host.read();
    const idx = records.findIndex(r => r.id === id);
    if (idx >= 0) {
      records[idx] = record;
    } else {
      records.push(record);
    }
    await this.host.write(records);
    return id;
  }

  /** Return all persisted records in insertion order. */
  async all(): Promise<MemoryRecord[]> {
    return this.host.read();
  }

  /**
   * Lexical search over text + tags.
   *
   * Score = count of query tokens that appear in the record's combined text
   * and tags (case-insensitive).  Records with score 0 are excluded.
   * Ties are broken by `ts` descending (most recent first).
   *
   * @param query   Free-text search string; tokenised on whitespace / punctuation.
   * @param limit   Maximum results to return (default 5).
   */
  async recall(query: string, limit = 5): Promise<MemoryRecord[]> {
    const queryTokens = tokenise(query);
    if (queryTokens.size === 0) return [];

    const records = await this.host.read();

    const scored = records
      .map(r => {
        const haystack = tokenise(`${r.text} ${r.tags.join(" ")}`);
        let score = 0;
        for (const token of queryTokens) {
          if (haystack.has(token)) score++;
        }
        return { record: r, score };
      })
      .filter(s => s.score > 0)
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.record.ts - a.record.ts;
      });

    return scored.slice(0, limit).map(s => s.record);
  }

  /**
   * Remove the record with the given id.
   *
   * @returns `true` if a record was found and removed, `false` otherwise.
   */
  async forget(id: string): Promise<boolean> {
    const records = await this.host.read();
    const idx = records.findIndex(r => r.id === id);
    if (idx < 0) return false;
    records.splice(idx, 1);
    await this.host.write(records);
    return true;
  }
}
