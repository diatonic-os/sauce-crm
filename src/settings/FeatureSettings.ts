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
    provider: "lmstudio",
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
        enabled: false,
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
