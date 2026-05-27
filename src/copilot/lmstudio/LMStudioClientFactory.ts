// SPEC §19.1 — Auth-aware LM Studio client factory.
//
// Supports three authentication modes:
//   1. Disabled — LM Studio Server Settings → "Require Authentication" off. No token needed.
//   2. apiToken — Bearer-style token from LM Studio's "Manage Tokens" UI. Passed via `apiToken`
//      in newer SDK versions, or via `LM_API_TOKEN` env var. Stored in KeyVault under
//      `copilot:lmstudio:api-token`.
//   3. Client-share keys — `clientIdentifier`+`clientPasskey` for sharing resources across
//      multiple LMStudioClient instances. Stored under `copilot:lmstudio:client-id` /
//      `copilot:lmstudio:client-passkey`.
//
// In production the credentials come from `CredentialSource` (KeyVault); in tests they
// can come from env via the test-only EnvCredentialSource. No src/* file reads process.env.

import type { CredentialSource } from "../CredentialSource";

export interface LMStudioClientConfig {
  baseUrl?: string; // ws://127.0.0.1:1234 by default
  verboseErrors?: boolean;
}

export interface LMStudioCredentials {
  apiToken?: string;
  clientIdentifier?: string;
  clientPasskey?: string;
}

export interface LMStudioClientLike {
  readonly llm: LMStudioLlmNamespace;
  readonly embedding: LMStudioEmbeddingNamespace;
  readonly system: LMStudioSystemNamespace;
}

// Structural shapes — keep V2 source decoupled from concrete @lmstudio/sdk types so the
// dependency stays optional at build time.
export interface LMStudioLlmNamespace {
  model(id: string, opts?: { ttl?: number }): Promise<LMStudioLlmHandle>;
  load(opts: {
    model: string;
    ttl?: number;
    signal?: AbortSignal;
    config?: Record<string, unknown>;
  }): Promise<LMStudioLlmHandle>;
  listLoaded(): Promise<Array<{ identifier?: string; path?: string }>>;
}
export interface LMStudioEmbeddingNamespace {
  model(id: string): Promise<LMStudioEmbedHandle>;
  listLoaded?(): Promise<Array<{ identifier?: string; path?: string }>>;
}
export interface LMStudioSystemNamespace {
  listDownloadedModels(): Promise<
    Array<{
      modelKey?: string;
      path?: string;
      type?: string;
      sizeBytes?: number;
    }>
  >;
  getLMStudioVersion?(): Promise<{ version: string; build?: string }>;
}

export interface LMStudioLlmHandle {
  readonly identifier?: string;
  respond(
    chat: unknown,
    opts?: LMStudioRespondOpts,
  ): Promise<{
    content: string;
    stats?: LMStudioStats;
    nonReasoningContent?: string;
    reasoningContent?: string;
  }>;
  complete?(
    prompt: string,
    opts?: LMStudioCompleteOpts,
  ): Promise<{ content: string; stats?: LMStudioStats }>;
  act?(
    chat: unknown,
    tools: unknown[],
    opts?: LMStudioActOpts,
  ): Promise<{ stats?: LMStudioStats; rounds?: unknown[] }>;
  unload(): Promise<void>;
  getModelInfo(): Promise<LMStudioModelInstanceInfo | undefined>;
  getContextLength(): Promise<number>;
  tokenize(input: string): Promise<number[]>;
  countTokens(input: string): Promise<number>;
  applyPromptTemplate?(history: unknown, opts?: unknown): Promise<string>;
}
export interface LMStudioEmbedHandle {
  embed(
    input: string | string[],
  ): Promise<{ embedding: number[] } | { embedding: number[] }[]>;
  getContextLength(): Promise<number>;
  tokenize(input: string): Promise<number[]>;
  countTokens(input: string): Promise<number>;
  unload(): Promise<void>;
}

export interface LMStudioModelInstanceInfo {
  identifier?: string;
  path?: string;
  format?: string;
  contextLength?: number;
  vramBytes?: number;
  ramBytes?: number;
}
export interface LMStudioStats {
  promptTokensCount?: number;
  predictedTokensCount?: number;
  totalTokensCount?: number;
  tokensPerSecond?: number;
  timeToFirstTokenSec?: number;
  stopReason?: string;
}

export interface LMStudioRespondOpts {
  temperature?: number;
  maxTokens?: number;
  topK?: number;
  topP?: number;
  signal?: AbortSignal;
  structured?: unknown;
  draftModel?: string; // speculative decoding
  onPredictionFragment?: (frag: { content?: string; index?: number }) => void;
  onFirstToken?: () => void;
  config?: Record<string, unknown>;
}
export interface LMStudioCompleteOpts extends LMStudioRespondOpts {}
export interface LMStudioActOpts {
  maxParallelToolCallCount?: number;
  guardToolCall?: (
    roundIndex: number,
    callId: string,
    ctx: {
      toolCallRequest: { name: string; arguments: Record<string, unknown> };
      allow: () => void;
      deny: (reason: string) => void;
    },
  ) => void | Promise<void>;
  onMessage?: (m: unknown) => void;
  onRoundEnd?: (roundIndex: number) => void;
  signal?: AbortSignal;
}

export class LMStudioClientFactory {
  constructor(
    private readonly source: CredentialSource | null,
    private readonly cfg: LMStudioClientConfig = {},
    private readonly options: { sdkLoader?: () => unknown } = {},
  ) {}

  /** Resolve credentials from the CredentialSource. Returns empty object if no source or all keys missing. */
  async resolveCredentials(): Promise<LMStudioCredentials> {
    if (!this.source) return {};
    const [apiToken, clientIdentifier, clientPasskey] = await Promise.all([
      this.source.get("copilot:lmstudio:api-token"),
      this.source.get("copilot:lmstudio:client-id"),
      this.source.get("copilot:lmstudio:client-passkey"),
    ]);
    return {
      ...(apiToken != null ? { apiToken } : {}),
      ...(clientIdentifier != null ? { clientIdentifier } : {}),
      ...(clientPasskey != null ? { clientPasskey } : {}),
    };
  }

  async build(): Promise<LMStudioClientLike> {
    const sdk = this.loadSdk();
    if (!sdk?.LMStudioClient)
      throw new Error(
        "@lmstudio/sdk not available — install with `npm install @lmstudio/sdk`",
      );
    const creds = await this.resolveCredentials();
    const baseOpts: Record<string, unknown> = {
      baseUrl: this.cfg.baseUrl ?? "ws://127.0.0.1:1234",
      verboseErrorMessages: this.cfg.verboseErrors ?? false,
    };

    // Strategy: try the strongest opts first; on "Unrecognized key" zod errors, drop the unsupported
    // field and retry. This keeps V2 forward-compatible with future SDK releases while still working
    // with the current published version (1.5.0) that does NOT yet accept apiToken.
    const attempts: Array<Record<string, unknown>> = [];
    if (creds.apiToken && (creds.clientIdentifier || creds.clientPasskey)) {
      attempts.push({
        ...baseOpts,
        apiToken: creds.apiToken,
        clientIdentifier: creds.clientIdentifier,
        clientPasskey: creds.clientPasskey,
      });
    }
    if (creds.apiToken)
      attempts.push({ ...baseOpts, apiToken: creds.apiToken });
    if (creds.clientIdentifier || creds.clientPasskey) {
      attempts.push({
        ...baseOpts,
        clientIdentifier: creds.clientIdentifier,
        clientPasskey: creds.clientPasskey,
      });
    }
    attempts.push(baseOpts);

    let lastError: unknown = null;
    for (const opts of attempts) {
      try {
        return new sdk.LMStudioClient(opts) as LMStudioClientLike;
      } catch (e) {
        lastError = e;
        const msg = e instanceof Error ? e.message : String(e);
        // Only retry on key-shape errors; auth failures will surface on first WS message, not here.
        if (!/Unrecognized key|Invalid parameter|Unknown option/i.test(msg))
          throw e;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error("LMStudioClient construction failed");
  }

  private loadSdk(): {
    LMStudioClient: new (opts: Record<string, unknown>) => LMStudioClientLike;
  } | null {
    if (this.options.sdkLoader)
      return this.options.sdkLoader() as {
        LMStudioClient: new (
          opts: Record<string, unknown>,
        ) => LMStudioClientLike;
      };
    const req = (typeof require !== "undefined" ? require : null) as
      | null
      | ((m: string) => unknown);
    if (!req) return null;
    try {
      return req("@lmstudio/sdk") as {
        LMStudioClient: new (
          opts: Record<string, unknown>,
        ) => LMStudioClientLike;
      };
    } catch {
      return null;
    }
  }
}
