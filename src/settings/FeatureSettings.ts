// Typed settings spine for the post-LanceDB feature program (PLAN-FEATURE-
// PROGRAM.md). Every new on/off switch and tunable lives here so the runtime
// services (embedding/RAG, realtime embeddings, enrichment, prompts, document
// harvest) read one coherent model. Defaults are conservative: nothing that
// touches the vault or hits a model is on by default.

export type EmbedProviderId = "lmstudio" | "openai" | "ollama";

export interface EmbeddingProviderConfig {
  enabled: boolean;
  endpoint: string;
  model: string;
}

export interface RagSettings {
  /** Master RAG switch. Off ⇒ no embeddings written, semantic search falls
   *  back to lexical everywhere. */
  enabled: boolean;
  /** Which provider supplies embeddings (decoupled from the chat provider). */
  provider: EmbedProviderId;
  /** Embed on every vault change (T4). Off ⇒ embeddings only on manual
   *  "Rebuild LanceDB Index". */
  realtimeEmbeddings: boolean;
  providers: Record<EmbedProviderId, EmbeddingProviderConfig>;
  /** Mirror ALL markdown notes (not just typed entities) into the vector
   *  index. Untyped notes receive a fallback type of "note". */
  fullVaultIndex: boolean;
  /** Glob patterns (minimatch syntax) for paths to skip during whole-vault
   *  indexing. Each entry is tested against the file's vault-relative path.
   *  Example: ["templates/**", "archive/**"] */
  excludeGlobs: string[];
  /** Override the LanceDB embedding vector dimension. Must match the model's
   *  actual output dimension. Change requires a full index rebuild. Default
   *  is the compiled DEFAULT_EMBEDDING_DIM (768). */
  embeddingDim: number | null;
}

export interface EnrichmentSettings {
  enabled: boolean;
  autostart: boolean;
  classify: boolean;
  tag: boolean;
  graph: boolean;
}

export interface PromptSettings {
  /** Global system prompt prepended to every session (T6). */
  globalSystemPrompt: string;
  /** Auto-name sessions from their first message (T6). */
  sessionAutoNaming: boolean;
}

export interface DocumentSettings {
  enabled: boolean;
  formats: string[];
}

/** Per-local-provider chat config (endpoint + default model), surfaced in the
 *  Local LLM settings section with a live model picker. Lets Ollama and LM
 *  Studio both be configured at once and used as the active chat provider. */
export interface LocalLLMProviderConfig {
  endpoint: string;
  model: string;
}
export interface LocalLLMSettings {
  ollama: LocalLLMProviderConfig;
  lmstudio: LocalLLMProviderConfig;
}
export type LocalProviderId = keyof LocalLLMSettings;

export interface SauceFeatureSettings {
  rag: RagSettings;
  enrichment: EnrichmentSettings;
  prompts: PromptSettings;
  documents: DocumentSettings;
  localLLM: LocalLLMSettings;
}

export const DEFAULT_FEATURE_SETTINGS: SauceFeatureSettings = {
  rag: {
    // On by default so the realtime embeddings lane actually grounds chat (the
    // lane JIT-loads the embed model at query time and degrades to lexical if
    // the embed endpoint is unreachable, so this is safe on a fresh install).
    enabled: true,
    // OpenAI is the preferred default for embedding accuracy, but selection is
    // KEY-GATED at runtime via resolveEmbeddingProvider(): a keyless install
    // transparently falls back to the local LM Studio model below, so a fresh
    // vault without an API key still gets working (768-dim) embeddings.
    provider: "openai",
    realtimeEmbeddings: true,
    fullVaultIndex: false,
    excludeGlobs: [],
    embeddingDim: null,
    providers: {
      lmstudio: {
        enabled: true,
        endpoint: "http://localhost:1234/v1",
        // A small, fast, broadly-compatible local embed model (validated to
        // JIT-load in ~1.3s and return 768-dim vectors).
        model: "text-embedding-nomic-embed-text-v1.5",
      },
      openai: {
        // Enabled so the preferred default is usable the moment a key is set;
        // resolveEmbeddingProvider still falls back to LM Studio when no key.
        enabled: true,
        endpoint: "https://api.openai.com/v1",
        model: "text-embedding-3-small",
      },
      ollama: {
        enabled: false,
        endpoint: "http://localhost:11434",
        model: "nomic-embed-text",
      },
    },
  },
  enrichment: {
    enabled: false,
    autostart: false,
    classify: true,
    tag: true,
    graph: true,
  },
  prompts: { globalSystemPrompt: "", sessionAutoNaming: true },
  documents: { enabled: false, formats: ["txt", "md", "pdf", "docx"] },
  localLLM: {
    ollama: { endpoint: "http://localhost:11434", model: "" },
    lmstudio: { endpoint: "http://localhost:1234/v1", model: "" },
  },
};

/** Deep-merge persisted feature settings over defaults (used in loadSettings).
 *  Tolerates partial/legacy blobs and never drops a default sub-key. */
export function mergeFeatureSettings(
  loaded: Partial<SauceFeatureSettings> | undefined,
): SauceFeatureSettings {
  const d = DEFAULT_FEATURE_SETTINGS;
  const l = loaded ?? {};
  return {
    rag: {
      ...d.rag,
      ...(l.rag ?? {}),
      fullVaultIndex: l.rag?.fullVaultIndex ?? d.rag.fullVaultIndex,
      excludeGlobs: l.rag?.excludeGlobs ?? d.rag.excludeGlobs,
      embeddingDim: l.rag?.embeddingDim ?? d.rag.embeddingDim,
      providers: {
        lmstudio: {
          ...d.rag.providers.lmstudio,
          ...(l.rag?.providers?.lmstudio ?? {}),
        },
        openai: {
          ...d.rag.providers.openai,
          ...(l.rag?.providers?.openai ?? {}),
        },
        ollama: {
          ...d.rag.providers.ollama,
          ...(l.rag?.providers?.ollama ?? {}),
        },
      },
    },
    enrichment: { ...d.enrichment, ...(l.enrichment ?? {}) },
    prompts: { ...d.prompts, ...(l.prompts ?? {}) },
    documents: { ...d.documents, ...(l.documents ?? {}) },
    localLLM: {
      ollama: { ...d.localLLM.ollama, ...(l.localLLM?.ollama ?? {}) },
      lmstudio: { ...d.localLLM.lmstudio, ...(l.localLLM?.lmstudio ?? {}) },
    },
  };
}

/** Resolve the active embedding provider config, or null when RAG is off or
 *  the selected provider is disabled. */
export function activeEmbeddingProvider(
  f: SauceFeatureSettings,
): { provider: EmbedProviderId; config: EmbeddingProviderConfig } | null {
  if (!f.rag.enabled) return null;
  const config = f.rag.providers[f.rag.provider];
  if (!config?.enabled || !config.model) return null;
  return { provider: f.rag.provider, config };
}

/** Known embed-model → output-dimension map. The LanceDB vector column dim is
 *  fixed at table creation, so the index dim MUST match the active model's
 *  output dim or every vector is dropped (EMB-1). Used to derive the table dim
 *  from the resolved model and to detect a model/index dim mismatch. */
export const EMBED_MODEL_DIMS: Readonly<Record<string, number>> = {
  "text-embedding-3-small": 1536,
  "text-embedding-3-large": 3072,
  "text-embedding-ada-002": 1536,
  "text-embedding-nomic-embed-text-v1.5": 768,
  "nomic-embed-text-v1.5": 768,
  "nomic-embed-text": 768,
  "mxbai-embed-large": 1024,
  "bge-large": 1024,
  "bge-base": 768,
  "bge-small": 384,
  "all-minilm-l6-v2": 384,
  "all-minilm": 384,
};

/** Resolve a model id to its embedding dimension, tolerating common id
 *  decorations (`nomic-embed-text:latest`, `text-embedding-3-small@8bit`).
 *  Returns null for unknown models so callers keep their configured/default dim. */
export function embedDimForModel(model: string): number | null {
  if (!model) return null;
  const key = model.toLowerCase().trim();
  if (EMBED_MODEL_DIMS[key] != null) return EMBED_MODEL_DIMS[key]!;
  for (const [name, dim] of Object.entries(EMBED_MODEL_DIMS)) {
    if (key.includes(name)) return dim;
  }
  return null;
}

export interface ResolvedEmbedProvider {
  provider: EmbedProviderId;
  config: EmbeddingProviderConfig;
  /** Why this provider was chosen — surfaced in the RAG settings UI so the user
   *  understands a silent fallback ("OpenAI preferred but no API key"). */
  reason: "preferred" | "fallback-no-openai-key" | "fallback-disabled";
}

/**
 * Resolve which embedding provider to ACTUALLY use, honoring the preferred
 * provider but gating OpenAI on the presence of an API key and falling back to
 * a reachable local provider otherwise (EMB-2). This is what makes an OpenAI
 * default safe for keyless installs: they transparently use the local model.
 * Returns null only when RAG is off or no provider is usable at all.
 */
export function resolveEmbeddingProvider(
  f: SauceFeatureSettings,
  hasOpenAIKey: boolean,
): ResolvedEmbedProvider | null {
  if (!f.rag.enabled) return null;
  const usable = (id: EmbedProviderId): EmbeddingProviderConfig | null => {
    const c = f.rag.providers[id];
    if (!c?.enabled || !c.model) return null;
    if (id === "openai" && !hasOpenAIKey) return null; // key-gated
    return c;
  };
  const preferred = f.rag.provider;
  const pc = usable(preferred);
  if (pc) return { provider: preferred, config: pc, reason: "preferred" };
  // Fallback: prefer reachable local providers, then OpenAI (if a key appeared).
  for (const id of ["lmstudio", "ollama", "openai"] as EmbedProviderId[]) {
    if (id === preferred) continue;
    const c = usable(id);
    if (c) {
      return {
        provider: id,
        config: c,
        reason:
          preferred === "openai" && !hasOpenAIKey
            ? "fallback-no-openai-key"
            : "fallback-disabled",
      };
    }
  }
  return null;
}
