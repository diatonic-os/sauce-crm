// CON-SAUCEBOT · B-patch · VaultGraphIndexer
//
// Walks all markdown notes in the vault and builds/updates a graph of
// nodes (one per note) and edges (one per wikilink) in the provided
// GraphService. The indexer uses `metadataCache.resolvedLinks` — the same
// data Obsidian's own graph view uses — so it is ReDoS-safe (no dynamic
// regex) and relies on zero additional I/O.
//
// Design invariants:
//   - Constructor-injected deps only (fully unit-testable; no global singletons).
//   - Async-safe: `rebuild()` can be called repeatedly; it is idempotent.
//   - Best-effort per-note: a single malformed file never aborts the walk.
//   - Optional persist: when a GraphStore is supplied, changes are flushed;
//     callers that only need the in-memory graph can omit it.

import type { GraphService } from "./GraphService";
import type { GraphStore } from "../backend/lance/graph";

/** Minimal Obsidian surface this indexer needs. Injected for testability. */
export interface VaultGraphIndexerHost {
  /** All markdown files in the vault (vault-relative paths). */
  getMarkdownPaths(): string[];
  /** Wikilink edges from a source path to destination paths.
   *  Returns an empty array when the cache has no data for `path`. */
  resolvedLinksFor(path: string): string[];
  /** Frontmatter for a path, or an empty object when absent. */
  frontmatterFor(path: string): Record<string, unknown>;
}

export interface VaultGraphIndexerOpts {
  /** When supplied, `rebuild()` persists the updated graph via `store.upsertNode/Edge`. */
  store?: GraphStore;
  /** Paths starting with these prefix segments are skipped. */
  excludeGlobs?: string[];
}

function isExcluded(path: string, patterns: string[]): boolean {
  if (patterns.length === 0) return false;
  for (const pat of patterns) {
    const p = pat.replace(/^\/|\/$/g, "");
    if (!p) continue;
    if (path === p || path.startsWith(p + "/")) return true;
  }
  return false;
}

export class VaultGraphIndexer {
  constructor(
    private readonly graph: GraphService,
    private readonly host: VaultGraphIndexerHost,
    private readonly opts: VaultGraphIndexerOpts = {},
  ) {}

  /**
   * Full rebuild: upsert a node for every markdown file, then upsert edges for
   * every resolved wikilink. Optionally persists to the supplied GraphStore.
   * Returns the count of nodes indexed.
   */
  async rebuild(): Promise<number> {
    const paths = this.host.getMarkdownPaths();
    const exclude = this.opts.excludeGlobs ?? [];
    let nodeCount = 0;

    // Phase 1: ensure a node exists for every non-excluded note.
    for (const path of paths) {
      if (isExcluded(path, exclude)) continue;
      try {
        const fm = this.host.frontmatterFor(path);
        const type = String(fm["type"] ?? "note");
        const title = String(fm["name"] ?? fm["title"] ?? basename(path));
        this.graph.upsertNode({ id: path, type, fields: { title, path } });
        if (this.opts.store) {
          await this.opts.store.upsertNode({
            id: path,
            type,
            fields: { title, path },
          });
        }
        nodeCount += 1;
      } catch {
        /* skip a single malformed entry */
      }
    }

    // Phase 2: upsert edges from resolvedLinks.
    for (const path of paths) {
      if (isExcluded(path, exclude)) continue;
      try {
        const targets = this.host.resolvedLinksFor(path);
        for (const dst of targets) {
          if (isExcluded(dst, exclude)) continue;
          this.graph.upsertEdge(path, dst, "wikilink");
          if (this.opts.store) {
            await this.opts.store.upsertEdge(path, dst, "wikilink");
          }
        }
      } catch {
        /* skip a single malformed entry */
      }
    }

    return nodeCount;
  }
}

/** Extract the basename (no extension) from a vault-relative path. */
function basename(path: string): string {
  const last = path.lastIndexOf("/");
  const name = last >= 0 ? path.slice(last + 1) : path;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Build a VaultGraphIndexerHost from the live Obsidian App.
 * Extracted so that tests can supply a hand-rolled stub instead.
 */
export function buildVaultGraphIndexerHost(
  app: import("obsidian").App,
): VaultGraphIndexerHost {
  const mc = app.metadataCache as typeof app.metadataCache & {
    resolvedLinks?: Record<string, Record<string, number>>;
  };
  return {
    getMarkdownPaths: () => app.vault.getMarkdownFiles().map((f) => f.path),
    resolvedLinksFor: (path) => Object.keys(mc.resolvedLinks?.[path] ?? {}),
    frontmatterFor: (path) => {
      const f = app.vault.getAbstractFileByPath(path);
      if (!f) return {};
      return mc.getFileCache(f as import("obsidian").TFile)?.frontmatter ?? {};
    },
  };
}
