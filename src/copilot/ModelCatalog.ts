// Unified per-provider model catalog. Surfaces "auto model indexing" to every
// GUI component (settings sections, onboarding wizard, copilot chat) so the
// user picks from a real, live list instead of typing a model id by hand.
//
// Per-provider strategy:
//   - ollama:    GET {endpoint}/api/tags         → models[].name
//   - lmstudio:  GET {endpoint}/v1/models (REST)  → data[].id
//   - openai:    GET {endpoint}/v1/models with the API key → data[].id, filtered
//                to chat-capable models; static curated list when no key / on error
//   - anthropic: static curated list (no public catalog endpoint)
//   - nim:       GET https://integrate.api.nvidia.com/v1/models (public)
//
// Endpoint normalization: callers may configure a base with or without a
// trailing `/v1` (the chat baseUrl usually includes it). `modelsUrl` strips a
// trailing `/v1` before appending `/v1/models` so we never hit `/v1/v1/models`.
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
    { id: "gpt-4.1", label: "GPT-4.1", family: "gpt-4" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini", family: "gpt-4" },
    { id: "o3", label: "o3", family: "o3" },
    { id: "o4-mini", label: "o4-mini", family: "o4" },
    { id: "o1", label: "o1", family: "o1" },
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

/** `<base>/v1/models`, tolerating a base that already ends in `/v1` or has
 *  trailing slashes — prevents `/v1/v1/models`. */
function modelsUrl(endpoint: string): string {
  const base = endpoint.replace(/\/+$/, "").replace(/\/v1$/, "");
  return `${base}/v1/models`;
}

// Which OpenAI model ids the picker should surface — chat/completion models
// only, excluding embeddings / audio / image / moderation / realtime variants
// that share the gpt-/o-prefix but aren't chat completions.
const OPENAI_CHAT_RE = /^(gpt-|o1|o3|o4|chatgpt)/i;
const OPENAI_EXCLUDE_RE = /(embedding|whisper|tts|dall-e|audio|transcribe|realtime|moderation|image|search|computer-use|instruct)/i;

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
        case "openai":    models = await this.fetchOpenAI(ctx); break;
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
    const url = modelsUrl(ctx.endpoint || "http://localhost:1234");
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
    const url = modelsUrl(ctx.endpoint || "https://integrate.api.nvidia.com");
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

  /** Live OpenAI catalog via GET /v1/models (requires the API key). Filters to
   *  chat-capable models and sorts. Falls back to the curated list when no key
   *  is configured or the response yields no chat models. */
  private async fetchOpenAI(ctx: CatalogContext): Promise<CatalogModel[]> {
    if (!ctx.apiKey) return STATIC.openai; // catalog is auth-walled
    const url = modelsUrl(ctx.endpoint || "https://api.openai.com");
    const r = await (ctx.fetch ?? this.fetchImpl)(url, {
      headers: { authorization: `Bearer ${ctx.apiKey}` },
    });
    if (!r.ok) throw new Error(`openai ${r.status}`);
    const body = (await r.json()) as { data?: Array<{ id?: string; owned_by?: string }> };
    const chat = (body.data ?? [])
      .map((m) => m.id ?? "")
      .filter((id) => OPENAI_CHAT_RE.test(id) && !OPENAI_EXCLUDE_RE.test(id))
      .sort();
    if (!chat.length) return STATIC.openai;
    return chat.map((id) => ({ id, label: id, family: id.split(/[-.]/)[0] }));
  }
}

/** Singleton accessor — most callers want one shared cache across the plugin. */
let _shared: ModelCatalog | null = null;
export function sharedModelCatalog(logger?: Logger | null): ModelCatalog {
  if (!_shared) _shared = new ModelCatalog(undefined, logger ?? null);
  return _shared;
}
