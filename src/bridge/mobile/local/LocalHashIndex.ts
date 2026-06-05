// MOB-BRIDGE-001 · T-E · mobile offline tier — LocalHashIndex.
//
// Fingerprints synced markdown locally, incrementally, using Web Crypto (via the
// injected ContentHasher). Keeps a fp → {path,title,type,tags,links,mtime} map so
// the offline LexicalMemoryBackend can attach the universal `fp` join key to its
// hits, matching the desktop-minted fingerprints byte-for-byte.
//
// Mobile-safe: NO node builtins, no global fetch. Every side effect (hashing,
// persistence, vault reads/metadata) is injected. Imports ONLY from the keystone
// contract.

import { type ContentHasher, normalizeForFingerprint } from "../../contract";

/** One indexed note, keyed by both path and fingerprint. */
export interface IndexEntry {
  path: string;
  fp: string;
  title: string;
  type: string;
  tags: string[];
  links: string[];
  mtime: number;
}

/** Persistence surface for the index map (synced JSON / localStorage / etc.). */
export interface IndexPersist {
  load(): Promise<Record<string, IndexEntry> | null>;
  save(rows: Record<string, IndexEntry>): Promise<void>;
}

/** Vault access surface — markdown listing, content reads, Obsidian metadata. */
export interface VaultReader {
  /** markdown files with their mtimes. */
  list(): Promise<{ path: string; mtime: number }[]>;
  read(path: string): Promise<string>;
  /** derived from Obsidian metadataCache (injected in production). */
  meta(path: string): {
    title: string;
    type: string;
    tags: string[];
    links: string[];
  };
}

export interface LocalHashIndexDeps {
  hasher: ContentHasher;
  persist: IndexPersist;
  vault: VaultReader;
}

export class LocalHashIndex {
  private readonly hasher: ContentHasher;
  private readonly persist: IndexPersist;
  private readonly vault: VaultReader;

  /** path → entry (primary store). */
  private byPathMap: Map<string, IndexEntry> = new Map();
  /** fp → entry (secondary index; last-writer-wins on fp collision). */
  private byFpMap: Map<string, IndexEntry> = new Map();
  /** whether load() has hydrated the in-memory maps from persistence. */
  private hydrated = false;

  constructor(deps: LocalHashIndexDeps) {
    this.hasher = deps.hasher;
    this.persist = deps.persist;
    this.vault = deps.vault;
  }

  /** Hydrate in-memory maps from persistence. Idempotent; safe to call eagerly. */
  async load(): Promise<void> {
    if (this.hydrated) return;
    const rows = await this.persist.load();
    if (rows) {
      for (const entry of Object.values(rows)) {
        this.put(entry);
      }
    }
    this.hydrated = true;
  }

  /** Full rebuild: list all markdown, (re)hash incrementally, gather meta, persist.
   *  Only files whose mtime changed vs the stored entry are re-hashed; unchanged
   *  files keep their existing fingerprint. Files no longer present are dropped. */
  async rebuild(): Promise<void> {
    await this.load();
    const files = await this.vault.list();
    const nextByPath = new Map<string, IndexEntry>();
    const nextByFp = new Map<string, IndexEntry>();

    for (const file of files) {
      const prev = this.byPathMap.get(file.path);
      const entry = await this.computeEntry(file.path, file.mtime, prev);
      nextByPath.set(entry.path, entry);
      nextByFp.set(entry.fp, entry);
    }

    this.byPathMap = nextByPath;
    this.byFpMap = nextByFp;
    await this.flush();
  }

  /** Re-index one file (call on Obsidian modify/create events). Skips work when the
   *  mtime is unchanged AND the file is already indexed. */
  async update(path: string): Promise<void> {
    await this.load();
    const files = await this.vault.list();
    const file = files.find((f) => f.path === path);
    if (!file) {
      // File vanished — drop it from the index.
      this.remove(path);
      await this.flush();
      return;
    }

    const prev = this.byPathMap.get(path);
    if (prev && prev.mtime === file.mtime) {
      // Unchanged and already indexed — no work.
      return;
    }

    const entry = await this.computeEntry(path, file.mtime, prev);
    this.put(entry);
    await this.flush();
  }

  /** Lookup by vault-relative path. */
  byPath(path: string): IndexEntry | undefined {
    return this.byPathMap.get(path);
  }

  /** Lookup by content fingerprint. */
  byFp(fp: string): IndexEntry | undefined {
    return this.byFpMap.get(fp);
  }

  /** Fingerprint for a path, if indexed. */
  fpFor(path: string): string | undefined {
    return this.byPathMap.get(path)?.fp;
  }

  /** Snapshot of all entries (path-keyed). */
  all(): Record<string, IndexEntry> {
    const out: Record<string, IndexEntry> = {};
    for (const [path, entry] of this.byPathMap) out[path] = entry;
    return out;
  }

  // ───────────────────────── internals ─────────────────────────

  /** Compute (or reuse) the entry for one file. Re-hashes only when mtime changed
   *  vs `prev`; otherwise reuses the prior fp but refreshes metadata. */
  private async computeEntry(
    path: string,
    mtime: number,
    prev: IndexEntry | undefined,
  ): Promise<IndexEntry> {
    const meta = this.vault.meta(path);
    let fp: string;
    if (prev && prev.mtime === mtime) {
      fp = prev.fp;
    } else {
      const content = await this.vault.read(path);
      fp = await this.hasher.sha256Hex(normalizeForFingerprint(content));
    }
    return {
      path,
      fp,
      title: meta.title,
      type: meta.type,
      tags: meta.tags,
      links: meta.links,
      mtime,
    };
  }

  /** Insert/replace an entry in both maps, pruning any stale fp for the same path. */
  private put(entry: IndexEntry): void {
    const existing = this.byPathMap.get(entry.path);
    if (
      existing &&
      existing.fp !== entry.fp &&
      this.byFpMap.get(existing.fp) === existing
    ) {
      this.byFpMap.delete(existing.fp);
    }
    this.byPathMap.set(entry.path, entry);
    this.byFpMap.set(entry.fp, entry);
  }

  /** Drop an entry by path from both maps. */
  private remove(path: string): void {
    const existing = this.byPathMap.get(path);
    if (!existing) return;
    this.byPathMap.delete(path);
    if (this.byFpMap.get(existing.fp) === existing) {
      this.byFpMap.delete(existing.fp);
    }
  }

  /** Persist the current path-keyed snapshot. */
  private async flush(): Promise<void> {
    await this.persist.save(this.all());
  }
}
