// V2 Obsidian-side glue. Adapts the sibling agent's pure copilot host interfaces
// (ProviderHost, RagAssemblerHost, ConversationHost) to live Obsidian Vault +
// MetadataCache + requestUrl + my V1 EntityService/SearchService.

import { App, normalizePath, TFile, requestUrl } from "obsidian";
import type { ProviderHost } from "./ICopilotProvider";
import type { RagAssemblerHost } from "./RagAssembler";
import type { ConversationHost } from "./ConversationStore";
import { EntityService } from "../services/EntityService";
import { SearchService } from "../services/SearchService";
import { parseWikilink } from "../util/Wikilink";

export class ObsidianProviderHost implements ProviderHost {
  async fetch(url: string, init: { method: string; headers: Record<string, string>; body?: string }): Promise<{ status: number; headers: Record<string, string>; body: string }> {
    // Use Obsidian's requestUrl to bypass CORS in Electron renderer
    const r = await requestUrl({
      url,
      method: init.method,
      headers: init.headers,
      body: init.body,
      throw: false,
    });
    const headers: Record<string, string> = {};
    for (const k of Object.keys(r.headers ?? {})) headers[k.toLowerCase()] = String((r.headers as any)[k]);
    return { status: r.status, headers, body: r.text };
  }
}

export class ObsidianRagHost implements RagAssemblerHost {
  constructor(
    private app: App,
    private entities: EntityService,
    private search: SearchService,
    private pinnedPaths: () => string[] = () => [],
  ) {}

  async pinned(): Promise<string[]> { return this.pinnedPaths(); }

  async oneHop(path: string): Promise<string[]> {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(f instanceof TFile)) return [];
    const fm = this.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
    const out = new Set<string>();
    for (const edge of ["knows", "worked_with", "intro_candidates", "family_of", "intro_via", "parent", "company"]) {
      const v = (fm as any)[edge];
      const list = Array.isArray(v) ? v : v ? [v] : [];
      for (const link of list) {
        const t = parseWikilink(String(link)) ?? String(link);
        const peer = this.app.metadataCache.getFirstLinkpathDest(t, f.path);
        if (peer) out.add(peer.path);
      }
    }
    return [...out];
  }

  async semantic(query: string, topK: number): Promise<{ path: string; score: number }[]> {
    // Until embeddings ship, use tag-cosine + fuzzy as a stand-in.
    const fuzzy = this.search.fuzzy(query, topK);
    return fuzzy.map((h) => ({ path: h.file.path, score: h.score }));
  }

  async recentTouches(days: number): Promise<{ id: string; date: string; contactId: string }[]> {
    const out: { id: string; date: string; contactId: string }[] = [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffIso = cutoff.toISOString().slice(0, 10);
    for (const t of this.entities.allTouches()) {
      const date = String((t.frontmatter as any).date ?? "");
      if (date && date >= cutoffIso) {
        out.push({ id: t.file.path, date, contactId: String((t.frontmatter as any).contact ?? "") });
      }
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }

  async addendaTail(path: string, n: number): Promise<{ id: string; date: string; body: string }[]> {
    const basename = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
    const tail: { id: string; date: string; body: string }[] = [];
    for (const a of this.entities.allAddenda()) {
      const addends = String((a.frontmatter as any).addends ?? "").replace(/\[\[|\]\]/g, "").split("|")[0];
      if (addends !== basename) continue;
      const body = ""; // body not loaded in V1 EntityService; left empty for v0
      tail.push({ id: a.file.path, date: String((a.frontmatter as any).date ?? ""), body });
    }
    tail.sort((a, b) => b.date.localeCompare(a.date));
    return tail.slice(0, n);
  }

  async readFile(path: string): Promise<{ frontmatter: Record<string, unknown>; body: string }> {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(f instanceof TFile)) return { frontmatter: {}, body: "" };
    const fm = (this.app.metadataCache.getFileCache(f)?.frontmatter ?? {}) as Record<string, unknown>;
    const body = await this.app.vault.cachedRead(f);
    return { frontmatter: fm, body };
  }

  estimateTokens(text: string): number {
    // 4 chars/token rule of thumb
    return Math.ceil((text?.length ?? 0) / 4);
  }
}

export class ObsidianConversationHost implements ConversationHost {
  constructor(private app: App) {}

  async readJson<T>(path: string): Promise<T | null> {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(f instanceof TFile)) return null;
    try { return JSON.parse(await this.app.vault.cachedRead(f)) as T; }
    catch { return null; }
  }

  async writeMarkdown(path: string, frontmatter: Record<string, unknown>, body: string): Promise<void> {
    const np = normalizePath(path);
    const dir = np.substring(0, np.lastIndexOf("/"));
    if (dir && !this.app.vault.getAbstractFileByPath(dir)) {
      await this.app.vault.createFolder(dir).catch(() => { /* exists */ });
    }
    const yaml = ["---", ...Object.entries(frontmatter).map(([k, v]) => `${k}: ${JSON.stringify(v)}`), "---", ""].join("\n");
    const content = yaml + body;
    const ex = this.app.vault.getAbstractFileByPath(np);
    if (ex instanceof TFile) await this.app.vault.modify(ex, content);
    else await this.app.vault.create(np, content);
  }

  async list(dir: string): Promise<string[]> {
    const out: string[] = [];
    const prefix = normalizePath(dir).replace(/\/$/, "") + "/";
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (f.path.startsWith(prefix)) out.push(f.path);
    }
    return out;
  }
}
