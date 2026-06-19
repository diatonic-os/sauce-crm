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
  /** LM Studio native /api/v0 metadata (the "model card"). */
  kind?: "llm" | "vlm" | "embeddings" | "unknown";
  contextTokens?: number;
  quantization?: string;
  publisher?: string;
  arch?: string;
  vision?: boolean;
  /** Native capabilities array (e.g. ["tool_use"]). */
  capabilities?: string[];
  /** Convenience flag derived from capabilities — gates tool calls per model. */
  toolUse?: boolean;
}

export interface CatalogContext {
  provider: ProviderId;
  endpoint?: string;
  apiKey?: string;
  /** "chat" (default) lists completion models; "embedding" lists embedding
   *  models (for the RAG embed-model picker). */
  kind?: "chat" | "embedding";
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
    {
      id: "claude-haiku-4-5-20251001",
      label: "Claude Haiku 4.5",
      family: "claude-4",
    },
    {
      id: "claude-3-5-sonnet-latest",
      label: "Claude 3.5 Sonnet (legacy)",
      family: "claude-3",
    },
  ],
};

/** Curated OpenAI embedding models — fallback when no key / fetch fails. */
const STATIC_EMBED: Record<"openai", CatalogModel[]> = {
  openai: [
    {
      id: "text-embedding-3-small",
      label: "text-embedding-3-small",
      family: "text-embedding-3",
    },
    {
      id: "text-embedding-3-large",
      label: "text-embedding-3-large",
      family: "text-embedding-3",
    },
    {
      id: "text-embedding-ada-002",
      label: "text-embedding-ada-002 (legacy)",
      family: "ada",
    },
  ],
};

// Heuristic for spotting embedding models in a local provider's flat /v1/models
// or /api/tags list (they aren't tagged by kind over REST).
const EMBED_RE = /(embed|nomic|bge|gte|e5|minilm|mxbai|arctic)/i;

function cacheKey(ctx: CatalogContext): string {
  return `${ctx.provider}:${ctx.kind ?? "chat"}:${(ctx.endpoint ?? "").replace(/\/+$/, "")}`;
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
const OPENAI_EXCLUDE_RE =
  /(embedding|whisper|tts|dall-e|audio|transcribe|realtime|moderation|image|search|computer-use|instruct)/i;

export class ModelCatalog {
  private cache = new Map<string, CacheEntry>();

  constructor(
    private fetchImpl: (url: string, init?: RequestInit) => Promise<Response> = (
      u,
      i,
    ) => fetch(u, i),
    private readonly logger: Logger | null = null,
  ) {}

  /** Swap the HTTP impl. The plugin installs a requestUrl-backed (CORS-bypassing)
   *  fetch here, because native fetch() from app://obsidian.md is blocked against
   *  local endpoints (LM Studio / Ollama) — which left the model list empty. */
  setFetch(fn: (url: string, init?: RequestInit) => Promise<Response>): void {
    this.fetchImpl = fn;
    this.cache.clear();
  }

  /** Bust cache for one provider+endpoint (or all when arg omitted). */
  invalidate(ctx?: CatalogContext): void {
    if (!ctx) {
      this.cache.clear();
      return;
    }
    this.cache.delete(cacheKey(ctx));
  }

  async list(ctx: CatalogContext): Promise<CatalogModel[]> {
    const key = cacheKey(ctx);
    const hit = this.cache.get(key);
    const log = ctx.logger ?? this.logger;
    if (hit && hit.expires > Date.now()) {
      log?.event("model_catalog.hit", {
        provider: ctx.provider,
        count: hit.models.length,
      });
      return hit.models;
    }
    log?.event("model_catalog.fetch", {
      provider: ctx.provider,
      endpoint: ctx.endpoint,
    });
    let models: CatalogModel[] = [];
    try {
      switch (ctx.provider) {
        case "ollama":
          models = await this.fetchOllama(ctx);
          break;
        case "lmstudio":
          models = await this.fetchLmStudio(ctx);
          break;
        case "nim":
          models = await this.fetchNim(ctx);
          break;
        case "openai":
          models = await this.fetchOpenAI(ctx);
          break;
        case "anthropic":
          models = ctx.kind === "embedding" ? [] : STATIC.anthropic;
          break;
        default: {
          const _exhaustive: never = ctx.provider;
          throw new Error(`unhandled: ${String(_exhaustive)}`);
        }
      }
      // Local/NIM providers return a flat, untyped list mixing chat + embedding
      // models. Narrow by the requested kind. In both directions, keep the full
      // list if the heuristic would empty it (better a noisy list than none).
      if (
        ctx.provider === "ollama" ||
        ctx.provider === "lmstudio" ||
        ctx.provider === "nim"
      ) {
        // Prefer the EXACT model-card kind (LM Studio /api/v0 `type`) over the
        // name regex; fall back to the regex when kind is unknown/absent.
        const byRegex = (m: CatalogModel): boolean =>
          m.kind === undefined || m.kind === "unknown";
        const isEmbed = (m: CatalogModel): boolean =>
          m.kind === "embeddings" || (byRegex(m) && EMBED_RE.test(m.id));
        const isChat = (m: CatalogModel): boolean =>
          m.kind === "llm" ||
          m.kind === "vlm" ||
          (byRegex(m) && !EMBED_RE.test(m.id));
        if (ctx.kind === "embedding") {
          const embeds = models.filter(isEmbed);
          if (embeds.length) models = embeds;
        } else {
          // chat (default): drop embedding-only models so the chat picker never
          // offers something that 400s on /chat/completions.
          const chat = models.filter(isChat);
          if (chat.length) models = chat;
        }
      }
      log?.event("model_catalog.miss", {
        provider: ctx.provider,
        count: models.length,
      });
    } catch (e) {
      log?.event("model_catalog.error", {
        provider: ctx.provider,
        error: String(e),
      });
      // On error, fall back to whatever's static for that provider (or empty).
      models = this.staticFallback(ctx);
    }
    this.cache.set(key, { models, expires: Date.now() + CACHE_TTL_MS });
    return models;
  }

  private async fetchOllama(ctx: CatalogContext): Promise<CatalogModel[]> {
    const endpoint = ctx.endpoint || "http://localhost:11434";
    const url = `${endpoint.replace(/\/+$/, "")}/api/tags`;
    const r = await (ctx.fetch ?? this.fetchImpl)(url, {
      ...(ctx.apiKey
        ? { headers: { authorization: `Bearer ${ctx.apiKey}` } }
        : {}),
    });
    if (!r.ok) throw new Error(`ollama ${r.status}`);
    const body = (await r.json()) as {
      models?: Array<{
        name?: string;
        size?: number;
        details?: { family?: string };
      }>;
    };
    return (body.models ?? []).map((m) => ({
      id: m.name ?? "unknown",
      label: m.name ?? "unknown",
      ...(m.size !== undefined ? { sizeBytes: m.size } : {}),
      ...(m.details?.family !== undefined ? { family: m.details.family } : {}),
    }));
  }

  private async fetchLmStudio(ctx: CatalogContext): Promise<CatalogModel[]> {
    const base = (ctx.endpoint || "http://localhost:1234")
      .replace(/\/+$/, "")
      .replace(/\/v1$/, "");
    const headers = ctx.apiKey
      ? { authorization: `Bearer ${ctx.apiKey}` }
      : undefined;
    const fetch = ctx.fetch ?? this.fetchImpl;

    // Prefer LM Studio's NATIVE /api/v0/models — it carries the model card:
    // type (llm/vlm/embeddings), arch, loaded state, max context, quantization,
    // publisher. This is what makes the picker show real metadata + lets us
    // classify embeddings exactly (by type) instead of guessing from the name.
    try {
      const r = await fetch(`${base}/api/v0/models`, headers ? { headers } : {});
      if (r.ok) {
        const body = (await r.json()) as {
          data?: Array<{
            id?: string;
            type?: string;
            arch?: string;
            state?: string;
            max_context_length?: number;
            quantization?: string;
            publisher?: string;
            capabilities?: string[];
          }>;
        };
        if (Array.isArray(body.data) && body.data.length > 0) {
          return body.data.map((m) => {
            const id = m.id ?? "unknown";
            const kind =
              m.type === "embeddings"
                ? ("embeddings" as const)
                : m.type === "vlm"
                  ? ("vlm" as const)
                  : m.type === "llm"
                    ? ("llm" as const)
                    : ("unknown" as const);
            return {
              id,
              label: id,
              kind,
              loaded: m.state === "loaded",
              vision: kind === "vlm",
              ...(m.arch ? { arch: m.arch } : {}),
              ...(m.max_context_length
                ? { contextTokens: m.max_context_length }
                : {}),
              ...(m.quantization ? { quantization: m.quantization } : {}),
              ...(m.publisher ? { publisher: m.publisher } : {}),
              ...(Array.isArray(m.capabilities)
                ? {
                    capabilities: m.capabilities,
                    toolUse: m.capabilities.includes("tool_use"),
                  }
                : {}),
              family: m.publisher ?? id.split("/")[0] ?? id,
            };
          });
        }
      }
    } catch {
      /* native API unavailable (older LM Studio) → OpenAI-compat fallback ↓ */
    }

    // Fallback: OpenAI-compatible /v1/models (ids only).
    const r = await fetch(`${base}/v1/models`, headers ? { headers } : {});
    if (!r.ok) throw new Error(`lmstudio ${r.status}`);
    const body = (await r.json()) as {
      data?: Array<{ id?: string; object?: string }>;
    };
    return (body.data ?? []).map((m) => {
      const id = m.id ?? "unknown";
      return { id, label: id, family: id.split("/")[0] ?? id };
    });
  }

  private async fetchNim(ctx: CatalogContext): Promise<CatalogModel[]> {
    const url = modelsUrl(ctx.endpoint || "https://integrate.api.nvidia.com");
    const r = await (ctx.fetch ?? this.fetchImpl)(url, {
      ...(ctx.apiKey
        ? { headers: { authorization: `Bearer ${ctx.apiKey}` } }
        : {}),
    });
    if (!r.ok) throw new Error(`nim ${r.status}`);
    const body = (await r.json()) as {
      data?: Array<{ id?: string; owned_by?: string }>;
    };
    return (body.data ?? []).map((m) => ({
      id: m.id ?? "unknown",
      label: m.id ?? "unknown",
      ...(m.owned_by !== undefined ? { family: m.owned_by } : {}),
    }));
  }

  /** Live OpenAI catalog via GET /v1/models (requires the API key). Filters to
   *  chat-capable (or embedding, per ctx.kind) models and sorts. Falls back to
   *  the matching curated list when no key is configured or nothing matches. */
  private async fetchOpenAI(ctx: CatalogContext): Promise<CatalogModel[]> {
    const fallback =
      ctx.kind === "embedding" ? STATIC_EMBED.openai : STATIC.openai;
    if (!ctx.apiKey) return fallback; // catalog is auth-walled
    const url = modelsUrl(ctx.endpoint || "https://api.openai.com");
    const r = await (ctx.fetch ?? this.fetchImpl)(url, {
      headers: { authorization: `Bearer ${ctx.apiKey}` },
    });
    if (!r.ok) throw new Error(`openai ${r.status}`);
    const body = (await r.json()) as {
      data?: Array<{ id?: string; owned_by?: string }>;
    };
    const ids = (body.data ?? []).map((m) => m.id ?? "");
    const filtered = (
      ctx.kind === "embedding"
        ? ids.filter((id) => /embedding/i.test(id))
        : ids.filter(
            (id) => OPENAI_CHAT_RE.test(id) && !OPENAI_EXCLUDE_RE.test(id),
          )
    ).sort();
    if (!filtered.length) return fallback;
    return filtered.map((id) => ({
      id,
      label: id,
      // split always returns ≥1 element; [0] is provably the prefix before the first separator
      family: id.split(/[-.]/)[0] ?? id,
    }));
  }

  /** Curated/empty list for a provider+kind, used as the on-error fallback. */
  private staticFallback(ctx: CatalogContext): CatalogModel[] {
    if (ctx.provider === "openai")
      return ctx.kind === "embedding" ? STATIC_EMBED.openai : STATIC.openai;
    if (ctx.provider === "anthropic")
      return ctx.kind === "embedding" ? [] : STATIC.anthropic;
    return [];
  }
}

/** Compact context size, e.g. 32768 → "32k". */
export function contextShort(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

/** A rich, human dropdown label for a model card: a ● when loaded, plus context
 *  size and quantization when known. Falls back to the bare id. */
export function formatModelLabel(m: CatalogModel): string {
  const meta: string[] = [];
  if (m.contextTokens) meta.push(contextShort(m.contextTokens));
  if (m.quantization) meta.push(m.quantization);
  if (m.kind === "vlm") meta.push("vision");
  if (m.toolUse && m.kind !== "embeddings") meta.push("tools");
  const dot = m.loaded ? "● " : "";
  return meta.length ? `${dot}${m.label}  ·  ${meta.join(" · ")}` : `${dot}${m.label}`;
}

/** Singleton accessor — most callers want one shared cache across the plugin. */
let _shared: ModelCatalog | null = null;
let _sharedFetch:
  | ((url: string, init?: RequestInit) => Promise<Response>)
  | null = null;

/** Install the HTTP impl the shared catalog should use. The plugin calls this at
 *  startup with a requestUrl-backed fetch so local-endpoint model lists (LM
 *  Studio / Ollama) aren't blocked by CORS. Applies to the live singleton too. */
export function setSharedCatalogFetch(
  fn: (url: string, init?: RequestInit) => Promise<Response>,
): void {
  _sharedFetch = fn;
  if (_shared) _shared.setFetch(fn);
}

export function sharedModelCatalog(logger?: Logger | null): ModelCatalog {
  if (!_shared)
    _shared = new ModelCatalog(_sharedFetch ?? undefined, logger ?? null);
  return _shared;
}
