// Bridges Obsidian vault events to the LanceDB entity mirror + vector index.
// The vault .md files stay the source of truth; this keeps LanceDB in step:
// every create/modify upserts the entity (and re-embeds when the body changed),
// deletes/renames propagate to all derived rows.
//
// Embeddings are best-effort: when no embed model is reachable (embedFn returns
// null) or its dimension doesn't match the table, the vector write is skipped
// and semantic RAG transparently falls back to lexical search.

import { App, TFile } from "obsidian";
import { parseWikilink } from "../util/Wikilink";
import type {
  LanceEntityMirror,
  MirrorFile,
  LanceVectorIndex,
} from "../backend/lance";
import type { ProvenanceService } from "./Provenance";

export type MirrorEmbedFn = (text: string) => Promise<number[] | null>;
export interface MirrorSyncOptions {
  /** Embed during realtime vault-event syncs. Manual fullResync embeds by default. */
  realtimeEmbeddings?: () => boolean;
  /** When true, notes WITHOUT a `type:` frontmatter field are mirrored with a
   *  fallback type of "note" rather than being skipped. Defaults to false to
   *  preserve legacy behaviour. */
  fullVaultIndex?: boolean;
  /** Glob-like prefix patterns — files whose vault-relative path STARTS WITH any
   *  of these segments (after splitting on "/") are excluded from indexing.
   *  Uses simple prefix matching (no regex) so it is ReDoS-safe.
   *  Example: ["templates", "archive"] excludes those top-level folders. */
  excludeGlobs?: string[];
}

/** Returns true when `path` matches any of the simple exclude prefixes.
 *  Each pattern is matched against the leading path segment(s) — e.g.
 *  pattern "templates" matches "templates/Header.md" but not "my-templates/Foo.md". */
function isExcluded(path: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  for (const pat of patterns) {
    // Strip leading/trailing slashes for robustness
    const p = pat.replace(/^\/|\/$/g, "");
    if (!p) continue;
    // Match exact segment prefix: path starts with "<pat>" or "<pat>/"
    if (path === p || path.startsWith(p + "/")) return true;
  }
  return false;
}

/** Leading YAML frontmatter block, stripped to leave the markdown body. */
const FRONTMATTER_RE = /^---\n[\s\S]*?\n---\n?/;
const EMBED_TEXT_CAP = 8000;

/** djb2 — fast non-cryptographic hash, used only for body change detection. */
function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export class MirrorSync {
  constructor(
    private readonly app: App,
    private readonly mirror: LanceEntityMirror,
    private readonly vectors: LanceVectorIndex | null,
    private readonly edgeFields: string[],
    private readonly embedFn: MirrorEmbedFn | null = null,
    private readonly provenance: ProvenanceService | null = null,
    private readonly opts: MirrorSyncOptions = {},
  ) {}

  // ── Per-path serialization (LANCE-003) ─────────────────────────────────
  // Lance mirror ops are read-modify-write (tags/edges are delete-then-add,
  // entities mergeInsert), so overlapping invocations for the same path can
  // duplicate or drop rows under Obsidian's rapid-fire `changed` events.
  // Every mutation for a path runs on that path's promise chain. syncFile
  // additionally COALESCES: while one run is queued (not yet started), new
  // requests for the same path fold into it — the file content is re-read at
  // execution time, so the last run always reflects the latest state.
  private readonly pathChains = new Map<string, Promise<void>>();
  private readonly pathQueued = new Set<string>();

  // PLC-04: once the plugin unloads, the mirror is closed and every realtime
  // vault-event entrypoint returns early — no new ops are enqueued onto the
  // path chains after teardown begins.
  private closed = false;

  /** Stop accepting new realtime sync ops. Called from the plugin's onunload. */
  close(): void {
    this.closed = true;
  }

  private chainTail(key: string): Promise<void> {
    return this.pathChains.get(key) ?? Promise.resolve();
  }

  /** Run `op` after every previously enqueued op for `keys` has settled. */
  private enqueue<T>(keys: string[], op: () => Promise<T>): Promise<T> {
    const prev = Promise.allSettled(keys.map((k) => this.chainTail(k)));
    const run = prev.then(() => op());
    // The chain must survive op failures — park a settled tail per key.
    const tail = run.then(
      () => undefined,
      () => undefined,
    );
    for (const k of keys) this.pathChains.set(k, tail);
    void tail.then(() => {
      for (const k of keys) {
        if (this.pathChains.get(k) === tail) this.pathChains.delete(k);
      }
    });
    return run;
  }

  async syncFile(
    file: TFile,
    opts: { embed?: boolean } = {},
  ): Promise<boolean> {
    if (this.closed) return false; // PLC-04
    if (file.extension !== "md") return false;
    if (isExcluded(file.path, this.opts.excludeGlobs ?? [])) return false;
    // Coalesce: if a sync for this path is already queued behind an in-flight
    // one, this event is redundant — the queued run re-reads the file.
    const key = file.path;
    if (this.pathQueued.has(key)) return false;
    this.pathQueued.add(key);
    return this.enqueue([key], async () => {
      this.pathQueued.delete(key);
      return this.syncFileNow(file, opts);
    });
  }

  /** The unserialized sync body — only ever invoked via the path chain. */
  private async syncFileNow(
    file: TFile,
    opts: { embed?: boolean } = {},
  ): Promise<boolean> {
    const mf = await this.build(file);
    if (!mf) return false; // not a typed entity (and fullVaultIndex is off)
    const changed = await this.mirror.bodyChanged(mf);
    await this.mirror.onModify(mf);
    // Fingerprint the indexed entity; the embedding (if any) links to it as a
    // child in the provenance lineage.
    const entityFp = await this.provenance
      ?.record("index", mf.path, "entity", mf.body, {
        meta: { type: mf.type, tags: mf.tags },
      })
      .then((r) => r.fp)
      .catch(() => undefined);
    const shouldEmbed = opts.embed ?? this.opts.realtimeEmbeddings?.() ?? true;
    if ((changed || opts.embed === true) && shouldEmbed)
      await this.embed(mf, entityFp);
    return true;
  }

  async deleteFile(path: string): Promise<void> {
    if (this.closed) return; // PLC-04
    await this.enqueue([path], () => this.mirror.onDelete(path));
  }

  async renameFile(oldPath: string, newPath: string): Promise<void> {
    if (this.closed) return; // PLC-04
    // Serialize against BOTH paths: a rename races with edits to either side.
    await this.enqueue([oldPath, newPath], () =>
      this.mirror.onRename(oldPath, newPath),
    );
  }

  /** Full reconcile of every markdown entity — first install / manual rebuild.
   *  Returns the count of entities synced. */
  async fullResync(
    opts: { embed?: boolean } = { embed: true },
  ): Promise<number> {
    let n = 0;
    for (const f of this.app.vault.getMarkdownFiles()) {
      try {
        if (await this.syncFile(f, opts)) n += 1;
      } catch {
        /* skip a single malformed file rather than abort the whole resync */
      }
    }
    return n;
  }

  private async embed(mf: MirrorFile, parentFp?: string): Promise<void> {
    if (!this.vectors || !this.embedFn) return;
    const title = String(
      mf.frontmatter["name"] ?? mf.frontmatter["title"] ?? mf.path,
    );
    const text = `${title}\n\n${mf.body}`.slice(0, EMBED_TEXT_CAP);
    const vec = await this.embedFn(text);
    if (!vec || vec.length !== this.vectors.dim) return; // no model / dim mismatch
    await this.vectors.store(mf.path, vec, "copilot", mf.bodyHash);
    await this.provenance
      ?.record("embed", mf.path, "embedding", text, {
        ...(parentFp !== undefined && { parentFp }),
        meta: { dim: vec.length },
      })
      .catch(() => {});
  }

  private async build(file: TFile): Promise<MirrorFile | null> {
    const fm = (this.app.metadataCache.getFileCache(file)?.frontmatter ??
      {}) as Record<string, unknown>;
    const rawType = String(fm["type"] ?? "");
    // When fullVaultIndex is enabled, untyped notes fall back to type "note"
    // so they are indexed for semantic search. Legacy typed-entity behaviour
    // is unchanged when a `type:` is present.
    if (!rawType && !this.opts.fullVaultIndex) return null;
    const type = rawType || "note";
    const raw = await this.app.vault.cachedRead(file);
    return {
      path: file.path,
      type,
      ...(fm["primary_type"]
        ? { primaryType: String(fm["primary_type"]) }
        : {}),
      frontmatter: fm,
      body: raw.replace(FRONTMATTER_RE, ""),
      bodyHash: hashString(raw),
      mtime: file.stat.mtime,
      ctime: file.stat.ctime,
      tags: this.arr(fm["tags"]).map(String),
      edges: this.edges(file, fm),
    };
  }

  private edges(file: TFile, fm: Record<string, unknown>): MirrorFile["edges"] {
    const out: MirrorFile["edges"] = [];
    for (const field of this.edgeFields) {
      for (const link of this.arr(fm[field])) {
        const target = parseWikilink(String(link)) ?? String(link);
        const dest = this.app.metadataCache.getFirstLinkpathDest(
          target,
          file.path,
        );
        if (dest) out.push({ to: dest.path, edgeType: field, directed: true });
      }
    }
    return out;
  }

  private arr(v: unknown): unknown[] {
    return Array.isArray(v) ? v : v == null || v === "" ? [] : [v];
  }
}
