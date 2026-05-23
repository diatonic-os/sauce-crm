// MOB-BRIDGE-001 · W2 — Obsidian-bound adapters. The only bridge file that
// imports `obsidian`; it maps Obsidian's App/Vault/metadataCache + SearchService
// onto the platform-neutral interfaces the merged bridge tasks defined
// (VaultReader, IndexPersist, LexicalHost). Kept in its own subdir so the rest
// of src/bridge stays obsidian-free and unit-testable.

import { App, TFile, getAllTags, normalizePath } from "obsidian";
import type { SearchService } from "../../services/SearchService";
import type { VaultReader, IndexPersist, IndexEntry } from "../mobile/local";
import type { LexicalHost } from "../mobile/local";

/** Markdown listing + reads + metadata over an Obsidian vault. */
export function makeVaultReader(app: App): VaultReader {
  return {
    async list() {
      return app.vault.getMarkdownFiles().map((f) => ({ path: f.path, mtime: f.stat.mtime }));
    },
    async read(path) {
      const f = app.vault.getAbstractFileByPath(path);
      return f instanceof TFile ? app.vault.cachedRead(f) : "";
    },
    meta(path) {
      const f = app.vault.getAbstractFileByPath(path);
      if (!(f instanceof TFile)) return { title: path, type: "", tags: [], links: [] };
      const cache = app.metadataCache.getFileCache(f);
      const fm = cache?.frontmatter ?? {};
      const tags = (cache ? getAllTags(cache) : null) ?? [];
      const links = (cache?.links ?? []).map((l) => l.link);
      return {
        title: typeof fm.title === "string" ? fm.title : f.basename,
        type: typeof fm.type === "string" ? fm.type : "",
        tags,
        links,
      };
    },
  };
}

/** Lexical search over the plugin's existing fuzzy SearchService. */
export function makeLexicalHost(search: SearchService): LexicalHost {
  return {
    search(query, limit) {
      return search.fuzzy(query, limit).map((h) => ({
        path: h.file.path,
        score: h.score,
        snippet: h.context,
      }));
    },
  };
}

/** Persist the local hash index to a JSON file under the plugin's data dir via
 *  the vault adapter (works on desktop + mobile). */
export function makeVaultFilePersist(app: App, filePath: string): IndexPersist {
  const p = normalizePath(filePath);
  return {
    async load() {
      try {
        if (!(await app.vault.adapter.exists(p))) return null;
        return JSON.parse(await app.vault.adapter.read(p)) as Record<string, IndexEntry>;
      } catch {
        return null;
      }
    },
    async save(rows) {
      try {
        const dir = p.slice(0, p.lastIndexOf("/"));
        if (dir && !(await app.vault.adapter.exists(dir))) {
          await app.vault.adapter.mkdir(dir);
        }
        await app.vault.adapter.write(p, JSON.stringify(rows));
      } catch {
        /* best-effort cache; safe to lose */
      }
    },
  };
}
