// CON-SAUCEBOT S1 — Provider Registry (the keystone).
//
// One `ProviderSpec` entry per provider is the single source of truth for
// "what providers exist". The runtime (SauceBotRuntime.provider/embedProvider),
// the model catalog, the chat header lists, the settings provider picker, and
// the vault-bound credential keys all derive from this registry — so adding a
// provider is one entry here, not edits across ~7 files.
//
// `buildProvider()` is the harness factory: it maps a spec's `harness` to a
// concrete ISauceBotProvider, sharing the OpenAI-compatible harness across
// openai / lmstudio / nim / openrouter / groq / gemini.

import type {
  ISauceBotProvider,
  ModelDescriptor,
  ProviderHost,
} from "./ISauceBotProvider";
import type { CredentialSource } from "./CredentialSource";
import { OpenAICompatibleProvider } from "./OpenAICompatibleProvider";
import { AnthropicProvider } from "./AnthropicProvider";
import { OllamaProvider } from "./OllamaProvider";
import { LMStudioSdkProvider } from "./LMStudioSdkProvider";

export type ProviderId =
  | "anthropic"
  | "openai"
  | "ollama"
  | "lmstudio"
  | "lmstudio-sdk"
  | "nim"
  | "openrouter"
  | "groq"
  | "gemini";

export type ProviderHarness =
  | "anthropic"
  | "openai-compat"
  | "ollama"
  | "lmstudio-sdk";

export interface ProviderSpec {
  id: ProviderId;
  /** UI label. */
  label: string;
  harness: ProviderHarness;
  kind: "cloud" | "local";
  /** Default base URL (cloud) or local default (overridable from settings). */
  baseUrl?: string;
  authHeader?: "bearer" | "x-api-key" | "none";
  capabilities: { toolUse: boolean; embeddings: boolean; streaming: boolean };
  /** KeyVault service id: `copilot:<id>:api-key` (cloud providers). */
  credentialKey?: string;
  /** `dynamic` = live /models list endpoint; `static` = curated list. */
  catalog: "dynamic" | "static";
  staticModels?: ModelDescriptor[];
  /** Whether the endpoint is user-configurable (local providers). */
  endpointConfigurable?: boolean;
  /** Whether this provider can serve as the chat provider in the runtime. */
  chat?: boolean;
}

const ANTHROPIC_MODELS: ModelDescriptor[] = [
  {
    id: "claude-opus-4-7",
    label: "Claude Opus 4.7",
    contextTokens: 1_000_000,
    vision: true,
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    contextTokens: 1_000_000,
    vision: true,
  },
  {
    id: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    contextTokens: 200_000,
    vision: true,
  },
];

const OPENAI_MODELS: ModelDescriptor[] = [
  { id: "gpt-4o", label: "GPT-4o", contextTokens: 128_000, vision: true },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    contextTokens: 128_000,
    vision: true,
  },
  { id: "gpt-4.1", label: "GPT-4.1", contextTokens: 128_000, vision: true },
  { id: "o3", label: "o3", contextTokens: 200_000 },
  { id: "o4-mini", label: "o4-mini", contextTokens: 200_000 },
];

const GEMINI_MODELS: ModelDescriptor[] = [
  {
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    contextTokens: 1_000_000,
    vision: true,
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    contextTokens: 1_000_000,
    vision: true,
  },
];

export const PROVIDER_REGISTRY: Record<ProviderId, ProviderSpec> = {
  anthropic: {
    id: "anthropic",
    label: "Anthropic",
    harness: "anthropic",
    kind: "cloud",
    baseUrl: "https://api.anthropic.com/v1",
    authHeader: "x-api-key",
    capabilities: { toolUse: true, embeddings: false, streaming: true },
    credentialKey: "copilot:anthropic:api-key",
    catalog: "static",
    staticModels: ANTHROPIC_MODELS,
    chat: true,
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    harness: "openai-compat",
    kind: "cloud",
    baseUrl: "https://api.openai.com/v1",
    authHeader: "bearer",
    capabilities: { toolUse: true, embeddings: true, streaming: true },
    credentialKey: "copilot:openai:api-key",
    catalog: "dynamic",
    staticModels: OPENAI_MODELS,
    chat: true,
  },
  ollama: {
    id: "ollama",
    label: "Ollama (local)",
    harness: "ollama",
    kind: "local",
    baseUrl: "http://localhost:11434",
    authHeader: "bearer",
    capabilities: { toolUse: false, embeddings: true, streaming: true },
    catalog: "dynamic",
    endpointConfigurable: true,
    chat: true,
  },
  lmstudio: {
    id: "lmstudio",
    label: "LM Studio (REST)",
    harness: "openai-compat",
    kind: "local",
    baseUrl: "http://localhost:1234/v1",
    authHeader: "bearer",
    capabilities: { toolUse: false, embeddings: true, streaming: true },
    catalog: "dynamic",
    endpointConfigurable: true,
    chat: true,
  },
  "lmstudio-sdk": {
    id: "lmstudio-sdk",
    label: "LM Studio (SDK / JIT)",
    harness: "lmstudio-sdk",
    kind: "local",
    baseUrl: "ws://localhost:1234",
    authHeader: "none",
    capabilities: { toolUse: true, embeddings: true, streaming: true },
    catalog: "dynamic",
    endpointConfigurable: true,
    chat: true,
  },
  nim: {
    id: "nim",
    label: "NVIDIA NIM",
    harness: "openai-compat",
    kind: "cloud",
    baseUrl: "https://integrate.api.nvidia.com/v1",
    authHeader: "bearer",
    capabilities: { toolUse: true, embeddings: true, streaming: true },
    credentialKey: "copilot:nim:api-key",
    catalog: "dynamic",
    chat: true,
  },
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    harness: "openai-compat",
    kind: "cloud",
    baseUrl: "https://openrouter.ai/api/v1",
    authHeader: "bearer",
    capabilities: { toolUse: true, embeddings: true, streaming: true },
    credentialKey: "copilot:openrouter:api-key",
    catalog: "dynamic",
    chat: true,
  },
  groq: {
    id: "groq",
    label: "Groq",
    harness: "openai-compat",
    kind: "cloud",
    baseUrl: "https://api.groq.com/openai/v1",
    authHeader: "bearer",
    capabilities: { toolUse: true, embeddings: false, streaming: true },
    credentialKey: "copilot:groq:api-key",
    catalog: "dynamic",
    chat: true,
  },
  gemini: {
    id: "gemini",
    label: "Google Gemini",
    harness: "openai-compat",
    kind: "cloud",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    authHeader: "bearer",
    capabilities: { toolUse: true, embeddings: true, streaming: true },
    credentialKey: "copilot:gemini:api-key",
    catalog: "dynamic",
    staticModels: GEMINI_MODELS,
    chat: true,
  },
};

/** Stable id list (declaration order). */
export const PROVIDER_IDS: ProviderId[] = Object.keys(
  PROVIDER_REGISTRY,
) as ProviderId[];

export function getProviderSpec(id: ProviderId): ProviderSpec {
  const spec = PROVIDER_REGISTRY[id];
  if (!spec) throw new Error(`unknown provider id: ${id}`);
  return spec;
}

/** Providers selectable as the chat provider in the runtime/UI. */
export function chatProviderIds(): ProviderId[] {
  return PROVIDER_IDS.filter((id) => PROVIDER_REGISTRY[id].chat !== false);
}

/** Providers that can produce embeddings (RAG embed-model picker). */
export function embeddingProviderIds(): ProviderId[] {
  return PROVIDER_IDS.filter(
    (id) => PROVIDER_REGISTRY[id].capabilities.embeddings,
  );
}

export interface BuildProviderOpts {
  /** Resolves the bearer / x-api-key secret (typically from KeyVault). */
  apiKey?: () => Promise<string | undefined>;
  /** Override base URL (local endpoints / proxies). */
  baseUrl?: string;
  defaultModel?: string;
  /** Force tool/function-calling on (local providers default off). */
  toolUse?: boolean;
  /** Credential source for the lmstudio-sdk harness. */
  credentialSource?: CredentialSource | null;
  /** Test seam: inject the @lmstudio/sdk module for lmstudio-sdk. */
  sdkLoader?: () => unknown;
}

/**
 * When a saved/override endpoint carries no API path (just scheme://host:port),
 * restore the path from the spec default. LM Studio's autodetect stores
 * "http://127.0.0.1:1234" with no "/v1", which otherwise makes chat hit
 * ".../chat/completions" → 404. A non-empty override path is left untouched
 * (e.g. a user proxy), and non-URL strings pass through unchanged.
 */
export function restoreSpecPath(override: string, specDefault: string): string {
  try {
    const o = new URL(override);
    if (o.pathname && o.pathname !== "/") return override.replace(/\/+$/, "");
    const s = new URL(specDefault);
    const path = s.pathname === "/" ? "" : s.pathname.replace(/\/+$/, "");
    return o.origin + path;
  } catch {
    return override;
  }
}

/**
 * Harness factory — maps a provider id to a concrete ISauceBotProvider via its
 * registry spec. Synchronous (the apiKey getter is resolved lazily at request
 * time inside each provider).
 */
export function buildProvider(
  id: ProviderId,
  host: ProviderHost,
  opts: BuildProviderOpts = {},
): ISauceBotProvider {
  const spec = getProviderSpec(id);
  const baseUrl = opts.baseUrl || spec.baseUrl || "";
  switch (spec.harness) {
    case "anthropic": {
      const getter = opts.apiKey ?? (async () => undefined);
      return new AnthropicProvider(
        host,
        async () => (await getter()) ?? "",
        baseUrl,
      );
    }
    case "ollama":
      return new OllamaProvider(host, {
        endpoint: baseUrl || "http://localhost:11434",
        ...(opts.defaultModel !== undefined
          ? { defaultModel: opts.defaultModel }
          : {}),
      });
    case "lmstudio-sdk":
      return new LMStudioSdkProvider(
        opts.credentialSource ?? null,
        { baseUrl },
        opts.sdkLoader,
      );
    case "openai-compat":
    default: {
      const authHeader =
        spec.authHeader === "x-api-key"
          ? "bearer"
          : (spec.authHeader as "bearer" | "none" | undefined);
      return new OpenAICompatibleProvider(host, {
        name: id,
        // A saved endpoint override often drops the API path (e.g. LM Studio's
        // autodetect stores "http://127.0.0.1:1234" with no "/v1"), which makes
        // chat hit ".../chat/completions" → 404. Restore the spec path here.
        baseUrl: restoreSpecPath(baseUrl, spec.baseUrl ?? baseUrl),
        ...(opts.apiKey !== undefined ? { apiKey: opts.apiKey } : {}),
        ...(authHeader !== undefined ? { authHeader } : {}),
        ...(opts.defaultModel !== undefined
          ? { defaultModel: opts.defaultModel }
          : {}),
        supportsToolUse: opts.toolUse ?? spec.capabilities.toolUse,
        supportsEmbeddings: spec.capabilities.embeddings,
        ...(spec.staticModels !== undefined
          ? { staticModels: spec.staticModels }
          : {}),
        ...(spec.staticModels?.[0]?.contextTokens !== undefined
          ? { maxContext: spec.staticModels[0].contextTokens }
          : {}),
        vision: spec.staticModels?.some((m) => m.vision) ?? false,
      });
    }
  }
}
