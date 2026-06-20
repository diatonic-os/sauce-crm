// V2 Obsidian-side glue. Adapts the sibling agent's pure copilot host interfaces
// (ProviderHost, RagAssemblerHost, ConversationHost) to live Obsidian Vault +
// MetadataCache + requestUrl + my V1 EntityService/SearchService.

import { App, normalizePath, TFile, requestUrl } from "obsidian";
import type { ProviderHost } from "./ISauceBotProvider";
import type { RagAssemblerHost } from "./RagAssembler";
import type { ConversationHost } from "./ConversationStore";
import { EntityService } from "../services/EntityService";
import { SearchService } from "../services/SearchService";
import { parseWikilink } from "../util/Wikilink";
import type { LanceVectorIndex } from "../backend/lance";
import type { VaultContextProvider } from "./VaultContextProvider";

/** Embeds query text for semantic RAG; returns null when embeddings are
 *  unavailable so the host can fall back to lexical search. */
export type EmbedFn = (text: string) => Promise<number[] | null>;

export class ObsidianProviderHost implements ProviderHost {
  async fetch(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
  }> {
    // Use Obsidian's requestUrl to bypass CORS in Electron renderer
    const r = await requestUrl({
      url,
      method: init.method,
      headers: init.headers,
      ...(init.body !== undefined ? { body: init.body } : {}),
      throw: false,
    });
    const headers: Record<string, string> = {};
    const rawHeaders = r.headers as Record<string, unknown>;
    for (const k of Object.keys(rawHeaders))
      headers[k.toLowerCase()] = String(rawHeaders[k]);
    return { status: r.status, headers, body: r.text };
  }

  /**
   * True-streaming fetch via the Electron renderer's native fetch(). Obsidian's
   * `requestUrl` buffers the full body, so SSE / NDJSON would only land once
   * the model finished generating. Native fetch streams the ReadableStream
   * incrementally. Localhost (LM Studio, Ollama) has no CORS gate. Cloud
   * providers (OpenAI, Anthropic) ship `Access-Control-Allow-Origin: *` on
   * the streaming endpoints in modern Electron, so this works there too.
   * If a provider can't reach this path it should fall back to batch fetch.
   */
  async fetchStream(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<{
    status: number;
    headers: Record<string, string>;
    iter: AsyncIterable<string>;
  }> {
    const resp = await fetch(url, {
      method: init.method,
      headers: init.headers,
      ...(init.body !== undefined ? { body: init.body } : {}),
    });
    const headers: Record<string, string> = {};
    resp.headers.forEach((v, k) => {
      headers[k.toLowerCase()] = v;
    });
    const body = resp.body;
    const decoder = new TextDecoder();
    async function* iter(): AsyncIterable<string> {
      if (!body) {
        const text = await resp.text();
        if (text) yield text;
        return;
      }
      const reader = body.getReader();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) yield decoder.decode(value, { stream: true });
        }
        const tail = decoder.decode();
        if (tail) yield tail;
      } finally {
        try {
          reader.releaseLock();
        } catch {
          /* ignore */
        }
      }
    }
    return { status: resp.status, headers, iter: iter() };
  }
}

export class ObsidianRagHost implements RagAssemblerHost {
  constructor(
    private app: App,
    private entities: EntityService,
    private search: SearchService,
    private pinnedPaths: () => string[] = () => [],
    private vectorIndex: LanceVectorIndex | null = null,
    private embedFn: EmbedFn | null = null,
    /** Optional VaultContextProvider (F2).  When supplied, oneHop uses the
     *  real wikilink index instead of the hand-rolled CRM-frontmatter walk.
     *  The CRM-frontmatter walk is kept as a fallback so existing tests pass. */
    private linkProvider: VaultContextProvider | null = null,
  ) {}

  /** S9: lazy remote-semantic fallback (the bridge memory adapter). Read at
   *  call time because the bridge memory backend is built after the runtime.
   *  Returns null when no remote backend is wired. */
  private semanticFallback:
    | (() =>
        | ((
            query: string,
            topK: number,
          ) => Promise<{ path: string; score: number }[]>)
        | null)
    | null = null;
  setSemanticFallback(fn: ObsidianRagHost["semanticFallback"]): void {
    this.semanticFallback = fn;
  }

  async pinned(): Promise<string[]> {
    return this.pinnedPaths();
  }

  async oneHop(path: string): Promise<string[]> {
    // Prefer the real wikilink index when available (F2 VaultContextProvider).
    if (this.linkProvider) {
      return this.linkProvider.oneHop(path);
    }
    // Fallback: CRM-frontmatter edge walk (pre-F2 behaviour; keeps existing tests green).
    const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(f instanceof TFile)) return [];
    const fm: Record<string, unknown> =
      this.app.metadataCache.getFileCache(f)?.frontmatter ?? {};
    const out = new Set<string>();
    for (const edge of [
      "knows",
      "worked_with",
      "intro_candidates",
      "family_of",
      "intro_via",
      "parent",
      "company",
    ]) {
      const v = fm[edge];
      const list = Array.isArray(v) ? v : v ? [v] : [];
      for (const link of list) {
        const t = parseWikilink(String(link)) ?? String(link);
        const peer = this.app.metadataCache.getFirstLinkpathDest(t, f.path);
        if (peer) out.add(peer.path);
      }
    }
    return [...out];
  }

  async semantic(
    query: string,
    topK: number,
  ): Promise<{ path: string; score: number }[]> {
    // Prefer LanceDB vector search when an embedding model is reachable; the
    // mirror stores embeddings keyed by entity path (entity_id === path).
    // Any gap — no index, no embed model, dim mismatch, empty index — falls
    // through to lexical fuzzy/tag-cosine so RAG never hard-fails.
    if (this.vectorIndex && this.embedFn) {
      try {
        if (!(await this.vectorIndex.isEmpty())) {
          const vec = await this.embedFn(query);
          if (vec && vec.length === this.vectorIndex.dim) {
            const hits = await this.vectorIndex.query(vec, topK);
            if (hits.length) {
              // Convert distance → similarity (monotonic, in (0,1]).
              return hits.map((h) => ({
                path: h.id,
                score: 1 / (1 + h.distance),
              }));
            }
          }
        }
      } catch {
        /* fall through to remote/lexical */
      }
    }
    // S9: when there's no usable local vector index (mobile) but a bridge
    // memory backend is wired, route semantic search through it (→ desktop
    // LanceDB) before falling back to lexical.
    if (this.semanticFallback) {
      try {
        const fn = this.semanticFallback();
        if (fn) {
          const hits = await fn(query, topK);
          if (hits.length) return hits;
        }
      } catch {
        /* fall through to lexical */
      }
    }
    const fuzzy = this.search.fuzzy(query, topK);
    return fuzzy.map((h) => ({ path: h.file.path, score: h.score }));
  }

  async recentTouches(
    days: number,
  ): Promise<{ id: string; date: string; contactId: string }[]> {
    const out: { id: string; date: string; contactId: string }[] = [];
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    const cutoffIso = cutoff.toISOString().slice(0, 10);
    for (const t of this.entities.allTouches()) {
      const fm = t.frontmatter as Record<string, unknown>;
      const date = String(fm.date ?? "");
      if (date && date >= cutoffIso) {
        out.push({
          id: t.file.path,
          date,
          contactId: String(fm.contact ?? ""),
        });
      }
    }
    return out.sort((a, b) => b.date.localeCompare(a.date));
  }

  async addendaTail(
    path: string,
    n: number,
  ): Promise<{ id: string; date: string; body: string }[]> {
    const basename = path.split("/").pop()?.replace(/\.md$/, "") ?? path;
    const tail: { id: string; date: string; body: string }[] = [];
    for (const a of this.entities.allAddenda()) {
      const fm = a.frontmatter as Record<string, unknown>;
      const addends = String(fm.addends ?? "")
        .replace(/\[\[|\]\]/g, "")
        .split("|")[0];
      if (addends !== basename) continue;
      const raw = await this.app.vault.cachedRead(a.file);
      const body = raw.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
      tail.push({
        id: a.file.path,
        date: String(fm.date ?? ""),
        body,
      });
    }
    tail.sort((a, b) => b.date.localeCompare(a.date));
    return tail.slice(0, n);
  }

  async readFile(
    path: string,
  ): Promise<{ frontmatter: Record<string, unknown>; body: string }> {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(f instanceof TFile)) return { frontmatter: {}, body: "" };
    const fm = (this.app.metadataCache.getFileCache(f)?.frontmatter ??
      {}) as Record<string, unknown>;
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
    try {
      return JSON.parse(await this.app.vault.cachedRead(f)) as T;
    } catch {
      return null;
    }
  }

  async writeMarkdown(
    path: string,
    frontmatter: Record<string, unknown>,
    body: string,
  ): Promise<void> {
    const np = normalizePath(path);
    const dir = np.substring(0, np.lastIndexOf("/"));
    if (dir && !this.app.vault.getAbstractFileByPath(dir)) {
      await this.app.vault.createFolder(dir).catch(() => {
        /* exists */
      });
    }
    const yaml = [
      "---",
      ...Object.entries(frontmatter).map(
        ([k, v]) => `${k}: ${JSON.stringify(v)}`,
      ),
      "---",
      "",
    ].join("\n");
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
