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

export interface SauceFeatureSettings {
  rag: RagSettings;
  enrichment: EnrichmentSettings;
  prompts: PromptSettings;
  documents: DocumentSettings;
}

export const DEFAULT_FEATURE_SETTINGS: SauceFeatureSettings = {
  rag: {
    enabled: false,
    provider: "lmstudio",
    realtimeEmbeddings: false,
    providers: {
      lmstudio: { enabled: true, endpoint: "http://localhost:1234/v1", model: "" },
      openai: { enabled: false, endpoint: "https://api.openai.com/v1", model: "text-embedding-3-small" },
      ollama: { enabled: false, endpoint: "http://localhost:11434", model: "nomic-embed-text" },
    },
  },
  enrichment: { enabled: false, autostart: false, classify: true, tag: true, graph: true },
  prompts: { globalSystemPrompt: "", sessionAutoNaming: true },
  documents: { enabled: false, formats: ["txt", "md", "pdf", "docx"] },
};

/** Deep-merge persisted feature settings over defaults (used in loadSettings).
 *  Tolerates partial/legacy blobs and never drops a default sub-key. */
export function mergeFeatureSettings(loaded: Partial<SauceFeatureSettings> | undefined): SauceFeatureSettings {
  const d = DEFAULT_FEATURE_SETTINGS;
  const l = loaded ?? {};
  return {
    rag: {
      ...d.rag,
      ...(l.rag ?? {}),
      providers: {
        lmstudio: { ...d.rag.providers.lmstudio, ...(l.rag?.providers?.lmstudio ?? {}) },
        openai: { ...d.rag.providers.openai, ...(l.rag?.providers?.openai ?? {}) },
        ollama: { ...d.rag.providers.ollama, ...(l.rag?.providers?.ollama ?? {}) },
      },
    },
    enrichment: { ...d.enrichment, ...(l.enrichment ?? {}) },
    prompts: { ...d.prompts, ...(l.prompts ?? {}) },
    documents: { ...d.documents, ...(l.documents ?? {}) },
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
