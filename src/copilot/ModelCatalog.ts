// Unified per-provider model catalog. Surfaces "auto model indexing" to every
// GUI component (settings sections, onboarding wizard, copilot chat) so the
// user picks from a real, live list instead of typing a model id by hand.
//
// Per-provider strategy:
//   - ollama:    GET {endpoint}/api/tags         → models[].name
//   - lmstudio:  LMStudioModelManager.listDownloaded() (SDK)
//                fallback: GET {endpoint}/v1/models (REST)
//   - openai:    static curated list (catalog is auth-walled)
//   - anthropic: static curated list
//   - nim:       GET https://integrate.api.nvidia.com/v1/models (public)
//
// Catalog is cached per (provider, endpoint) for 30s. Every fetch emits a
// telemetry event so we can observe cache hit rates + provider reachability
// in TRACE-LOG.jsonl.

import type { Logger } from "../telemetry";

export type ProviderId = "ollama" | "lmstudio" | "openai" | "anthropic" | "nim";

export interface CatalogModel {
  id: string;
  label: string;
  sizeBytes?: number;
  loaded?: boolean;
  family?: string;
}

export interface CatalogContext {
  provider: ProviderId;
  endpoint?: string;
  apiKey?: string;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  logger?: Logger | null;
}

const CACHE_TTL_MS = 30_000;

type CacheEntry = { models: CatalogModel[]; expires: number };

// Static curated lists for providers whose catalog isn't enumerable without
// privileged credentials. Kept tight on purpose — users can still type a
// model id manually if they need something not in the list.
const STATIC: Record<"openai" | "anthropic", CatalogModel[]> = {
  openai: [
    { id: "gpt-4o", label: "GPT-4o", family: "gpt-4" },
    { id: "gpt-4o-mini", label: "GPT-4o mini", family: "gpt-4" },
    { id: "gpt-4-turbo", label: "GPT-4 Turbo", family: "gpt-4" },
    { id: "o1-mini", label: "o1-mini", family: "o1" },
    { id: "o1-preview", label: "o1-preview", family: "o1" },
  ],
  anthropic: [
    { id: "claude-opus-4-7", label: "Claude Opus 4.7", family: "claude-4" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", family: "claude-4" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5", family: "claude-4" },
    { id: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet (legacy)", family: "claude-3" },
  ],
};

function cacheKey(ctx: CatalogContext): string {
  return `${ctx.provider}::${(ctx.endpoint ?? "").replace(/\/+$/, "")}`;
}

export class ModelCatalog {
  private cache = new Map<string, CacheEntry>();

  constructor(
    private readonly fetchImpl: (url: string, init?: RequestInit) => Promise<Response>
      = (u, i) => fetch(u, i),
    private readonly logger: Logger | null = null,
  ) {}

  /** Bust cache for one provider+endpoint (or all when arg omitted). */
  invalidate(ctx?: CatalogContext): void {
    if (!ctx) { this.cache.clear(); return; }
    this.cache.delete(cacheKey(ctx));
  }

  async list(ctx: CatalogContext): Promise<CatalogModel[]> {
    const key = cacheKey(ctx);
    const hit = this.cache.get(key);
    const log = ctx.logger ?? this.logger;
    if (hit && hit.expires > Date.now()) {
      log?.event("model_catalog.hit", { provider: ctx.provider, count: hit.models.length });
      return hit.models;
    }
    log?.event("model_catalog.fetch", { provider: ctx.provider, endpoint: ctx.endpoint });
    let models: CatalogModel[] = [];
    try {
      switch (ctx.provider) {
        case "ollama":    models = await this.fetchOllama(ctx); break;
        case "lmstudio":  models = await this.fetchLmStudio(ctx); break;
        case "nim":       models = await this.fetchNim(ctx); break;
        case "openai":    models = STATIC.openai; break;
        case "anthropic": models = STATIC.anthropic; break;
      }
      log?.event("model_catalog.miss", { provider: ctx.provider, count: models.length });
    } catch (e) {
      log?.event("model_catalog.error", { provider: ctx.provider, error: String(e) });
      // On error, fall back to whatever's static for that provider (or empty).
      models = ctx.provider === "openai" || ctx.provider === "anthropic"
        ? STATIC[ctx.provider]
        : [];
    }
    this.cache.set(key, { models, expires: Date.now() + CACHE_TTL_MS });
    return models;
  }

  private async fetchOllama(ctx: CatalogContext): Promise<CatalogModel[]> {
    const endpoint = ctx.endpoint || "http://localhost:11434";
    const url = `${endpoint.replace(/\/+$/, "")}/api/tags`;
    const r = await (ctx.fetch ?? this.fetchImpl)(url, {
      headers: ctx.apiKey ? { authorization: `Bearer ${ctx.apiKey}` } : undefined,
    });
    if (!r.ok) throw new Error(`ollama ${r.status}`);
    const body = (await r.json()) as { models?: Array<{ name?: string; size?: number; details?: { family?: string } }> };
    return (body.models ?? []).map((m) => ({
      id: m.name ?? "unknown",
      label: m.name ?? "unknown",
      sizeBytes: m.size,
      family: m.details?.family,
    }));
  }

  private async fetchLmStudio(ctx: CatalogContext): Promise<CatalogModel[]> {
    const endpoint = ctx.endpoint || "http://localhost:1234";
    const url = `${endpoint.replace(/\/+$/, "")}/v1/models`;
    const r = await (ctx.fetch ?? this.fetchImpl)(url, {
      headers: ctx.apiKey ? { authorization: `Bearer ${ctx.apiKey}` } : undefined,
    });
    if (!r.ok) throw new Error(`lmstudio ${r.status}`);
    const body = (await r.json()) as { data?: Array<{ id?: string; object?: string }> };
    return (body.data ?? []).map((m) => ({
      id: m.id ?? "unknown",
      label: m.id ?? "unknown",
      family: m.id?.split("/")[0],
    }));
  }

  private async fetchNim(ctx: CatalogContext): Promise<CatalogModel[]> {
    const endpoint = ctx.endpoint || "https://integrate.api.nvidia.com";
    const url = `${endpoint.replace(/\/+$/, "")}/v1/models`;
    const r = await (ctx.fetch ?? this.fetchImpl)(url, {
      headers: ctx.apiKey ? { authorization: `Bearer ${ctx.apiKey}` } : undefined,
    });
    if (!r.ok) throw new Error(`nim ${r.status}`);
    const body = (await r.json()) as { data?: Array<{ id?: string; owned_by?: string }> };
    return (body.data ?? []).map((m) => ({
      id: m.id ?? "unknown",
      label: m.id ?? "unknown",
      family: m.owned_by,
    }));
  }
}

/** Singleton accessor — most callers want one shared cache across the plugin. */
let _shared: ModelCatalog | null = null;
export function sharedModelCatalog(logger?: Logger | null): ModelCatalog {
  if (!_shared) _shared = new ModelCatalog(undefined, logger ?? null);
  return _shared;
}
