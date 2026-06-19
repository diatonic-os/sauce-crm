// Orchestrator: provider selection + RAG assembly + streaming completion.
// Keeps the chat surface (SauceBotView) thin.

import { RagAssembler, ConversationStore, ToolUseAdapter } from "./index";
import {
  buildProvider,
  PROVIDER_REGISTRY,
  getProviderSpec,
  type ProviderId,
  type BuildProviderOpts,
} from "./ProviderRegistry";
import { estimateTokens } from "./Toon";
import type {
  ChatMessage,
  ISauceBotProvider,
  CompletionEvent,
  CompletionRequest,
} from "./ISauceBotProvider";
import type { CredentialSource } from "./CredentialSource";
import type { SauceBotSession } from "./ConversationStore";
import {
  ObsidianProviderHost,
  ObsidianRagHost,
  ObsidianConversationHost,
} from "./SauceBotHostAdapters";
import { App, TFile, normalizePath } from "obsidian";
import { EntityService } from "../services/EntityService";
import { SearchService } from "../services/SearchService";
import type { LanceVectorIndex } from "../backend/lance";
import { SlashCommand, defaultSlashCommands } from "./SlashCommands";
import {
  type BrainAnswer,
  brainSystemPrompt,
  parseBrainAnswer,
} from "./BrainAsk";
import { BrainCrystalCache, buildEntityDigest, hashBody } from "./BrainCrystal";
import {
  Distiller,
  DistillCache,
  pickBestLocalModel,
  type DistillChunk,
} from "./Distiller";
import {
  ModelManager,
  type BlocklistStore,
  type CatalogModel as MMCatalogModel,
  type LoadFailureKind,
} from "./ModelManager";
import { EmbeddingsLane } from "./EmbeddingsLane";
import { sharedModelCatalog } from "./ModelCatalog";

export interface SauceBotSettings {
  /** Provider id — derived from the ProviderRegistry (S1). Older saved
   *  settings only ever held anthropic/openai/ollama/lmstudio; the registry
   *  superset (nim/openrouter/groq/gemini/lmstudio-sdk) is now valid too. */
  provider: ProviderId;
  model: string;
  apiKey: string; // P15 swaps for KeyVault lookup
  baseUrl?: string; // ollama override / proxy URL / LM Studio endpoint
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
  /** Model id used for embeddings (LanceDB vector RAG). Defaults to `model`
   *  when unset; ignored by providers without an embeddings endpoint. Legacy
   *  fallback only — prefer EmbeddingRuntimeConfig via setEmbeddingConfig. */
  embedModel?: string;
  /** User-editable slash/menu command registry (Command settings tab).
   *  Optional so older saved settings don't need migration; the UI lazily
   *  seeds defaults when absent. */
  slashCommands?: SlashCommand[];
  /** Stream tokens as they arrive (vs await the full response). */
  stream?: boolean;
  /** How many prior conversation turns to include as context. */
  contextTurns?: number;
  /** Vault folder holding custom command/prompt `.md` files. */
  promptsFolder?: string;
  /** Bounded auto-retry count for transient connection failures (per turn).
   *  Only retried when nothing was streamed yet; default 1 (⇒ 2 attempts). */
  maxRetries?: number;
  /** Context-distillation config (TOON compaction of retrieved context). */
  distill?: DistillSettings;
  /** Local-model multi-turn/tool quality tuning. Off ⇒ behaves exactly as
   *  before. Auto-enabled for local providers (lmstudio/ollama) unless the
   *  caller forces it via `localTuning.enabled`. */
  localTuning?: LocalTuningSettings;
  /** Models that permanently failed to load (unsupported arch / OOM / missing).
   *  ModelManager appends here on a permanent failure so the picker can mark +
   *  skip them instead of re-attempting a doomed load. User-clearable. */
  disabledModels?: string[];
  /** When on, periodically warm the active model so LM Studio's idle TTL doesn't
   *  unload it (kills the cold-reload latency). Off by default. */
  keepModelWarm?: boolean;
  /** Re-warm cadence (seconds) when keepModelWarm is on. Default 240. */
  modelTtlSeconds?: number;
  /** Override the embedding model id for the realtime embeddings lane; falls
   *  back to embedModel, then the chat model. */
  preferredEmbeddingModel?: string;
}

/** Knobs for closing the local-vs-cloud quality gap. Cloud providers ignore
 *  these (they don't need prose tool prompts or aggressive compaction); they
 *  only activate when the active provider is `kind: "local"` OR `enabled:true`. */
export interface LocalTuningSettings {
  /** Force on/off. undefined ⇒ auto (on for local providers, off for cloud). */
  enabled?: boolean;
  /** Inject a prose tool schema + one-shot example into the system prompt. */
  toolPrompt?: boolean;
  /** Compact prior history once accumulated tokens exceed this budget. The most
   *  recent turn is always kept verbatim. Default 2000 (~8k chars). */
  historyTokenBudget?: number;
  /** Re-ask once on a malformed (`_raw`) tool call to coax valid tool JSON. */
  toolRepairReask?: boolean;
  /** One compaction+retry when a turn ends empty/truncated (self-correction). */
  emptyAnswerRetry?: boolean;
}

/** Distillation: by default the chat model compacts retrieved context to TOON
 *  before it is sent; the model/provider can be overridden, and a token gate
 *  controls when the (cost-incurring) LLM pass actually runs. */
export interface DistillSettings {
  /** Master switch. Default ON — distillation is the default behavior. */
  enabled?: boolean;
  /** Override provider; undefined ⇒ use the chat provider. Must be active. */
  provider?: ProviderId;
  /** Override model; undefined ⇒ chat model (or auto-best local when enabled). */
  model?: string;
  /** When the model is unset and the provider is local, pick the best model. */
  autoSelectLocal?: boolean;
  /** Target context size (estimated tokens); the LLM pass only runs above it. */
  tokenGate?: number;
  /** Max inference passes per distillation (bounded loop). */
  maxPasses?: number;
}

/** Embedding provider config — decoupled from the chat provider so RAG can use
 *  a local embed model (LM Studio/Ollama) while chatting with a cloud model. */
export interface EmbeddingRuntimeConfig {
  enabled: boolean;
  provider: ProviderId;
  endpoint: string;
  model: string;
  apiKey?: string;
}

export const COPILOT_DEFAULTS: SauceBotSettings = {
  // Local-first: a fresh install runs entirely on-device (LM Studio) with NO
  // cloud calls until the user configures a cloud provider + key. The model is
  // empty so the chat picker auto-selects the first available local model.
  provider: "lmstudio",
  model: "",
  apiKey: "",
  temperature: 0.4,
  maxTokens: 4096,
  systemPrompt:
    "You are Sauce Graph, an assistant grounded in the user's personal relationship graph. " +
    "Answer using the supplied context. Cite people and orgs by `[[Name]]` wikilinks. " +
    "If you don't know, say so. Refuse external information requests unless explicitly asked.",
  slashCommands: defaultSlashCommands(),
  stream: true,
  contextTurns: 15,
  promptsFolder: "copilot/sauce-commands",
  distill: {
    enabled: true,
    autoSelectLocal: true,
    tokenGate: 700,
    maxPasses: 2,
  },
  localTuning: {
    // enabled undefined ⇒ auto (on for local providers only).
    toolPrompt: true,
    historyTokenBudget: 2000,
    toolRepairReask: true,
    emptyAnswerRetry: true,
  },
  disabledModels: [],
  keepModelWarm: false,
  modelTtlSeconds: 240,
};

export class SauceBotRuntime {
  rag: RagAssembler;
  conversations: ConversationStore;
  toolUse: ToolUseAdapter;
  private providerHost = new ObsidianProviderHost();
  /** Classifies load failures, blocklists doomed models, picks a safe fallback.
   *  Public so the chat picker can mark blocked models. */
  modelManager!: ModelManager;
  /** Realtime embeddings "second lane": ensure-load + cache + visible failures. */
  embeddingsLane!: EmbeddingsLane;
  /** Persist hook (wired by the plugin) so a runtime-discovered blocklist entry
   *  is saved immediately rather than only on the next settings edit. */
  private onSettingsChanged?: () => void;
  private lastEmbedModel = "";
  private keepWarmTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private app: App,
    entities: EntityService,
    search: SearchService,
    private settings: SauceBotSettings,
    /** LanceDB vector index for semantic RAG. When present (and an embed model
     *  is reachable), RagAssembler uses real embeddings; otherwise it falls
     *  back to fuzzy/tag-cosine search. */
    ragVectorIndex: LanceVectorIndex | null = null,
  ) {
    const embedFn = ragVectorIndex ? (text: string) => this.embed(text) : null;
    this.ragHost = new ObsidianRagHost(
      app,
      entities,
      search,
      () => [],
      ragVectorIndex,
      embedFn,
    );
    this.rag = new RagAssembler(this.ragHost);
    this.conversations = new ConversationStore(
      new ObsidianConversationHost(app),
    );
    this.toolUse = new ToolUseAdapter();

    // ── Model management + realtime embeddings lane ──────────────────────────
    const blocklist: BlocklistStore = {
      get: () => this.settings.disabledModels ?? [],
      add: (mid) => {
        const cur = this.settings.disabledModels ?? [];
        if (!cur.includes(mid)) {
          this.settings.disabledModels = [...cur, mid];
          this.onSettingsChanged?.();
        }
      },
      remove: (mid) => {
        this.settings.disabledModels = (
          this.settings.disabledModels ?? []
        ).filter((x) => x !== mid);
        this.onSettingsChanged?.();
      },
    };
    this.modelManager = new ModelManager(
      { listModels: () => this.listModelsForManager() },
      blocklist,
    );
    this.embeddingsLane = new EmbeddingsLane(
      {
        ensureModel: (mid) => this.ensureEmbedModelLoaded(mid),
        embed: (t, m) => this.rawEmbed(t, m),
      },
      { model: "", enabled: true },
    );
    if (this.settings.keepModelWarm) {
      this.setKeepWarm(true, this.settings.modelTtlSeconds ?? 240);
    }
  }

  /** Plugin wires this to saveSettings() so blocklist changes persist at once. */
  setOnSettingsChanged(fn: () => void): void {
    this.onSettingsChanged = fn;
  }

  /** Catalog source for ModelManager — only local providers have a real load
   *  lifecycle; cloud models never "fail to load", so return []. Maps the shared
   *  ModelCatalog (LM Studio /api/v0 cards) to the manager's CatalogModel. */
  private async listModelsForManager(): Promise<MMCatalogModel[]> {
    const id = this.settings.provider;
    const catProvider =
      id === "lmstudio" || id === "lmstudio-sdk"
        ? "lmstudio"
        : id === "ollama"
          ? "ollama"
          : null;
    if (!catProvider) return [];
    try {
      const ctx = {
        provider: catProvider as "lmstudio" | "ollama",
        ...(this.settings.baseUrl ? { endpoint: this.settings.baseUrl } : {}),
      };
      const models = await sharedModelCatalog().list(ctx);
      return models.map((m) => {
        const out: MMCatalogModel = {
          id: m.id,
          loaded: m.loaded ?? false,
          kind: m.kind ?? "unknown",
        };
        if (m.contextTokens !== undefined) out.contextLength = m.contextTokens;
        if (m.sizeBytes !== undefined) out.sizeBytes = m.sizeBytes;
        return out;
      });
    } catch {
      return [];
    }
  }

  /** Embeddings-lane seam: confirm the embed model isn't blocklisted and the
   *  catalog/provider is reachable (the /embeddings POST JIT-loads it). */
  private async ensureEmbedModelLoaded(
    model: string,
  ): Promise<{ ok: boolean; error?: string }> {
    if (this.modelManager.isBlocked(model))
      return { ok: false, error: `${model} is blocked (a prior load failed).` };
    const r = await this.modelManager.ensureLoaded(model);
    if (r.error) return { ok: false, error: r.error.userMessage };
    return { ok: true };
  }

  /** Embeddings-lane seam: POST one embedding via the active embed provider. */
  private async rawEmbed(
    text: string,
    model: string,
  ): Promise<Float32Array | null> {
    const c = this.embedConfig;
    const prov = c ? this.embedProvider(c) : this.provider();
    try {
      return await prov.embed(text, model);
    } catch {
      return null;
    }
  }

  /** Start/stop a periodic re-warm so the active model survives LM Studio's idle
   *  TTL unload. Self-managed single timer; cleared on dispose() / disable. */
  setKeepWarm(enabled: boolean, seconds = 240): void {
    if (this.keepWarmTimer) {
      clearInterval(this.keepWarmTimer);
      this.keepWarmTimer = null;
    }
    if (!enabled) return;
    const ms = Math.max(30, seconds) * 1000;
    this.keepWarmTimer = setInterval(() => {
      void this.warmup().catch(() => {});
    }, ms);
  }

  /** Release the keep-warm timer (plugin onunload). */
  dispose(): void {
    this.setKeepWarm(false);
  }

  /** The RAG host (kept so the link provider + S9 remote-semantic fallback can
   *  be injected after construction). */
  private ragHost: ObsidianRagHost;

  /** S9: route semantic RAG through the bridge memory backend when no local
   *  vector index is usable (mobile). The getter is read at call time so it
   *  picks up `this.memory` once the bridge starts. */
  setSemanticFallback(
    fn:
      | (() =>
          | ((
              query: string,
              topK: number,
            ) => Promise<{ path: string; score: number }[]>)
          | null)
      | null,
  ): void {
    this.ragHost.setSemanticFallback(fn);
  }

  /** Dedicated embedding provider config (decoupled from chat). When set and
   *  disabled, embeddings are off (RAG master switch). */
  private embedConfig: EmbeddingRuntimeConfig | null = null;

  setEmbeddingConfig(cfg: EmbeddingRuntimeConfig | null): void {
    this.embedConfig = cfg;
    this.providerCache.clear(); // embed endpoint/provider may have changed
  }

  // ── Prompt + session management (PLAN T6) ──────────────────────────
  private promptConfig: {
    globalSystemPrompt: string;
    sessionAutoNaming: boolean;
  } = {
    globalSystemPrompt: "",
    sessionAutoNaming: true,
  };
  private sessionPrompt: string | null = null;

  setPromptConfig(cfg: {
    globalSystemPrompt: string;
    sessionAutoNaming: boolean;
  }): void {
    this.promptConfig = cfg;
  }

  /** Per-session system prompt override (null ⇒ use the copilot's base prompt). */
  setSessionPrompt(prompt: string | null): void {
    this.sessionPrompt = prompt && prompt.trim() ? prompt : null;
  }
  getSessionPrompt(): string | null {
    return this.sessionPrompt;
  }

  /** Effective system prompt: global prefix + (session override ?? base). */
  composeSystemPrompt(): string {
    return [
      this.promptConfig.globalSystemPrompt,
      this.sessionPrompt ?? this.settings.systemPrompt,
    ]
      .filter((p) => p && p.trim())
      .join("\n\n");
  }

  /** Auto-derived session title from the first user message, or null when
   *  session autonaming is off (caller keeps its own/default name). */
  sessionTitle(firstMessage: string): string | null {
    if (!this.promptConfig.sessionAutoNaming) return null;
    // split("\n") always returns at least one element; [0] is provably present
    const firstLine = ((firstMessage ?? "").trim().split("\n")[0] ?? "").trim();
    if (!firstLine) return null;
    return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine;
  }

  /** Persist a session, applying autonaming (the first user message names it
   *  when the toggle is on). Returns the saved path. */
  async persistSession(
    session: SauceBotSession,
    firstMessage = "",
  ): Promise<string> {
    return this.conversations.save(
      session,
      this.sessionTitle(firstMessage) ?? "",
    );
  }

  // ── Document RAG context (T7) + query provenance (T8) ───────────────
  private docSearch:
    | ((
        query: string,
        k: number,
      ) => Promise<{ docName: string; text: string }[]>)
    | null = null;
  private traceSink: {
    record(
      op: string,
      subject: string,
      kind: string,
      content: string,
      opts?: { meta?: Record<string, unknown> | null },
    ): Promise<unknown>;
  } | null = null;

  /** Inject harvested-document retrieval (embeds the query + searches LanceDB
   *  doc chunks). Returns top chunk texts that ask() appends to the prompt. */
  setDocumentSearch(
    fn:
      | ((
          query: string,
          k: number,
        ) => Promise<{ docName: string; text: string }[]>)
      | null,
  ): void {
    this.docSearch = fn;
  }

  /** Inject the provenance sink so queries are fingerprinted/traced (T8). */
  setTraceSink(sink: typeof this.traceSink): void {
    this.traceSink = sink;
  }

  // ── Crystallized brain cache (compacted entity digests) ───────────────────
  // The dominant per-query token cost used to be inlining ~8 000 chars of RAW
  // markdown re-read from disk every question. We now inline a small, hash-
  // validated DIGEST per entity (see BrainCrystal.ts) — a ~10× token cut that
  // also feeds the model signal instead of noise. The matrix persists as one
  // small JSON file under the brain folder; heavy vectors stay in LanceDB.
  private static readonly ENTITY_INLINE_CEILING = 8000;
  // Only inline when there are centered paths to show content for.
  private static readonly ENTITY_INLINE_TOP_N = 6;
  private crystal: BrainCrystalCache | null = null;
  private brainFolder = "_brain";
  private _distiller: Distiller | null = null;
  private distillCache: DistillCache | null = null;
  /** Strip leading YAML frontmatter block from a markdown string. */
  private static stripFrontmatter(raw: string): string {
    return raw.replace(/^---\n[\s\S]*?\n---\n?/, "");
  }

  /** Point the crystal manifest at the configured brain folder. */
  setBrainFolder(folder: string): void {
    const next = folder.trim() || "_brain";
    if (next !== this.brainFolder) {
      this.brainFolder = next;
      this.crystal = null; // re-load from the new location lazily
    }
  }

  private get crystalPath(): string {
    return `${this.brainFolder}/brain-crystal.json`;
  }

  /** Lazily load the crystal matrix from disk (or start empty). */
  private async ensureCrystal(): Promise<BrainCrystalCache> {
    if (this.crystal) return this.crystal;
    try {
      const adapter = this.app.vault.adapter;
      this.crystal = (await adapter.exists(this.crystalPath))
        ? BrainCrystalCache.fromJSON(await adapter.read(this.crystalPath))
        : new BrainCrystalCache();
    } catch {
      this.crystal = new BrainCrystalCache();
    }
    return this.crystal;
  }

  /** Persist the crystal matrix when dirty (single small file ⇒ cheap write). */
  private async saveCrystal(): Promise<void> {
    const c = this.crystal;
    if (!c || !c.dirty) return;
    try {
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(this.brainFolder)))
        await adapter.mkdir(this.brainFolder);
      await adapter.write(this.crystalPath, c.toJSON());
      c.markClean();
    } catch {
      /* persistence is best-effort; the cache re-warms next session */
    }
  }

  /** Build/refresh a digest for one file. Returns the digest, or null on read
   *  failure. Warms the crystal (hash-validated) without re-reading if fresh. */
  private async digestFor(
    path: string,
    crystal: BrainCrystalCache,
  ): Promise<{ digest: string; fresh: boolean } | null> {
    const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
    if (!(f instanceof TFile)) return null;
    const raw = await this.app.vault.cachedRead(f);
    const hash = hashBody(raw);
    const cached = crystal.get(path, hash);
    if (cached != null) return { digest: cached, fresh: false };
    const body = SauceBotRuntime.stripFrontmatter(raw).trim();
    if (!body) return null;
    const fm =
      (this.app.metadataCache.getFileCache(f)?.frontmatter as
        | Record<string, unknown>
        | undefined) ?? {};
    const digest = buildEntityDigest(path, fm, body);
    crystal.set(path, hash, digest);
    return { digest, fresh: true };
  }

  // ── Distillation (TOON context compaction) ────────────────────────────────
  /** Resolve the provider + model that should perform distillation. Defaults to
   *  the chat provider/model; overridable to any active provider, with optional
   *  auto-best-local model selection. Never silently picks a different chat
   *  provider for the actual answer — this only governs the compaction pass. */
  private resolveDistill(): {
    provider: ISauceBotProvider;
    model: string;
    tag: string;
  } {
    const d = this.settings.distill;
    const overrideId =
      d?.provider && d.provider in PROVIDER_REGISTRY ? d.provider : null;
    if (overrideId) {
      const provider = this.getOrBuildProvider(overrideId, {
        apiKey: async () =>
          (await this.credentialSource
            ?.get(`copilot:${overrideId}:api-key`)
            .catch(() => null)) || undefined,
        ...(d?.model !== undefined ? { defaultModel: d.model } : {}),
      });
      let model = d?.model;
      if (!model && (d?.autoSelectLocal ?? true)) {
        model =
          pickBestLocalModel(provider.models.map((m) => m.id)) ?? undefined;
      }
      model = model || this.settings.model;
      return { provider, model, tag: `${overrideId}:${model}` };
    }
    const provider = this.provider();
    const model = this.settings.distill?.model || this.settings.model;
    return { provider, model, tag: `${this.settings.provider}:${model}` };
  }

  /** One-shot non-streaming completion bound to the resolved distill model.
   *  Best-effort: returns null on any failure so the caller falls back to the
   *  deterministic TOON. */
  private async distillOnce(
    system: string,
    user: string,
  ): Promise<string | null> {
    const { provider, model } = this.resolveDistill();
    let text = "";
    try {
      for await (const ev of provider.complete({
        model,
        messages: [{ role: "user", content: user }],
        systemPrompt: system,
        temperature: 0,
        maxTokens: Math.max(this.settings.maxTokens, 1024),
        stream: false,
      })) {
        if (ev.type === "text") text += ev.delta;
        else if (ev.type === "done" && ev.reason === "error") return null;
      }
    } catch {
      return null;
    }
    return text.trim() || null;
  }

  private get distillManifestPath(): string {
    return `${this.brainFolder}/brain-distill.json`;
  }

  /** Lazily build the Distiller with a persisted cache + the model-bound seam. */
  private async distiller(): Promise<Distiller> {
    if (this._distiller) return this._distiller;
    if (!this.distillCache) {
      try {
        const adapter = this.app.vault.adapter;
        this.distillCache = (await adapter.exists(this.distillManifestPath))
          ? DistillCache.fromJSON(await adapter.read(this.distillManifestPath))
          : new DistillCache();
      } catch {
        this.distillCache = new DistillCache();
      }
    }
    this._distiller = new Distiller(
      (sys, usr) => this.distillOnce(sys, usr),
      this.distillCache,
    );
    return this._distiller;
  }

  private async saveDistillCache(): Promise<void> {
    const c = this.distillCache;
    if (!c || !c.dirty) return;
    try {
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(this.brainFolder)))
        await adapter.mkdir(this.brainFolder);
      await adapter.write(this.distillManifestPath, c.toJSON());
      c.markClean();
    } catch {
      /* best-effort */
    }
  }

  /**
   * Inline the top-N centered entities into the system prompt. When distillation
   * is enabled (default), the crystal digests are run through the Distiller →
   * TOON: a deterministic compaction, plus a gated LLM pass that only fires when
   * the context exceeds the token gate (so cheap contexts cost nothing extra).
   * When disabled, falls back to the plain crystallized digest section.
   * Best-effort: never throws; warms + persists crystal/distill caches.
   */
  private async inlineEntityContent(
    centered: string[],
    query: string,
  ): Promise<string> {
    const top = centered.slice(0, SauceBotRuntime.ENTITY_INLINE_TOP_N);
    if (top.length === 0) return "";
    const crystal = await this.ensureCrystal();
    const chunks: DistillChunk[] = [];
    for (const path of top) {
      try {
        const r = await this.digestFor(path, crystal);
        if (r) chunks.push({ path, text: r.digest });
      } catch {
        /* single-file read failure → skip, keep gathering others */
      }
    }
    if (crystal.dirty) void this.saveCrystal();
    if (chunks.length === 0) return "";

    // Recency-of-attention ordering for local models: small models weight the
    // tail of a long prompt most heavily, so reverse the digest order to place
    // the MOST relevant (centered[0]) LAST — immediately before the question.
    // `centered` arrives best-first; `chunks` mirror that order. Cloud models
    // are order-robust, so we only reorder when local tuning is active.
    if (this.localTuningOn()) chunks.reverse();

    const d = this.settings.distill;
    if (d?.enabled ?? true) {
      try {
        const distiller = await this.distiller();
        const { tag } = this.resolveDistill();
        const result = await distiller.distill(
          { query, chunks },
          {
            useLlm: true,
            ...(d?.tokenGate !== undefined ? { tokenGate: d.tokenGate } : {}),
            ...(d?.maxPasses !== undefined ? { maxPasses: d.maxPasses } : {}),
            modelTag: tag,
          },
        );
        if (this.distillCache?.dirty) void this.saveDistillCache();
        return "\n\n## Distilled context (TOON)\n" + result.toon;
      } catch {
        /* distillation failed → fall back to the plain digest section below */
      }
    }

    // Deterministic digest section (distillation off or failed).
    let budget = SauceBotRuntime.ENTITY_INLINE_CEILING;
    const parts: string[] = [];
    for (const c of chunks) {
      if (budget <= 0) break;
      const used = Math.min(c.text.length, budget);
      parts.push(`### ${c.path}\n${c.text.slice(0, used)}`);
      budget -= used;
    }
    return parts.length
      ? "\n\n## Entity digest (crystallized)\n" + parts.join("\n\n")
      : "";
  }

  // ── Local-model tuning (close the local-vs-cloud quality gap) ──────────────
  /** Whether the active chat provider runs locally (LM Studio / Ollama). Cloud
   *  providers are order-robust and tool-reliable, so the local-only
   *  enhancements (prose tool prompt, aggressive compaction, tail-ordering,
   *  re-ask salvage) stay off for them by default. */
  private isLocalProvider(): boolean {
    const id: ProviderId =
      this.settings.provider in PROVIDER_REGISTRY
        ? this.settings.provider
        : "anthropic";
    try {
      return getProviderSpec(id).kind === "local";
    } catch {
      return false;
    }
  }

  /** Master gate for the local-tuning behaviors. Honors an explicit override;
   *  otherwise auto-on for local providers, off for cloud. */
  private localTuningOn(): boolean {
    const t = this.settings.localTuning;
    if (t?.enabled !== undefined) return t.enabled;
    return this.isLocalProvider();
  }

  /**
   * MULTI-TURN CONTEXT COMPACTION. When accumulated prior history exceeds the
   * token budget, summarize the OLDER turns into a single compact note and keep
   * the most recent turn verbatim. Local models degrade sharply as the working
   * context grows across turns; this keeps the live context tight without
   * losing the thread. Best-effort: on any failure returns the input unchanged.
   * Pure of provider-answer behavior — only the messages handed forward change.
   */
  private async compactPriorHistory(
    prior: ChatMessage[],
  ): Promise<ChatMessage[]> {
    if (!this.localTuningOn() || prior.length <= 2) return prior;
    const budget = this.settings.localTuning?.historyTokenBudget ?? 2000;
    const sizeOf = (m: ChatMessage): number =>
      estimateTokens(
        typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      );
    const total = prior.reduce((s, m) => s + sizeOf(m), 0);
    if (total <= budget) return prior;

    // Keep the last turn (last user+assistant pair, i.e. up to 2 msgs) verbatim.
    const keepCount = Math.min(2, prior.length);
    const recent = prior.slice(prior.length - keepCount);
    const older = prior.slice(0, prior.length - keepCount);
    if (older.length === 0) return prior;

    const transcript = older
      .map((m) => {
        const c =
          typeof m.content === "string" ? m.content : JSON.stringify(m.content);
        return `${m.role.toUpperCase()}: ${c}`;
      })
      .join("\n")
      .slice(0, 12000);
    const summary = await this.completeOnce(
      "Summarize the earlier part of this conversation into a few tight bullet " +
        "points capturing decisions, facts established, and open threads. No " +
        "preamble — just the bullets. This will be the assistant's memory of " +
        "the earlier turns.",
      transcript,
      { temperature: 0, maxTokens: 512 },
    );
    if (!summary) return prior; // compaction failed → keep full history
    const memo: ChatMessage = {
      role: "user",
      content: `[Earlier conversation summary]\n${summary}`,
    };
    return [memo, ...recent];
  }

  /**
   * Bounded re-ask when the model emitted a MALFORMED tool call (the provider
   * could not parse the args and surfaced `{_raw: …}`). Rather than dispatch a
   * broken call (or fail the turn), we nudge the model once with the exact
   * schema and its own bad output, asking for valid tool JSON. Returns the
   * repaired input object, or null when no repair was produced (caller then
   * dispatches the original so the model at least sees an error result).
   */
  private async repairToolCall(
    name: string,
    raw: string,
  ): Promise<Record<string, unknown> | null> {
    const tool = this.toolUse.asTools().find((t) => t.name === name);
    if (!tool) return null;
    const schema = JSON.stringify(tool.inputSchema);
    const out = await this.completeOnce(
      "You produced an invalid tool call. Given the tool's JSON schema and your " +
        "previous malformed arguments, output ONLY a single valid JSON object " +
        "of arguments — no prose, no code fence, no tool name, just the JSON.",
      `Tool: ${name}\nSchema: ${schema}\nYour invalid arguments:\n${raw}\n\nValid JSON arguments:`,
      { temperature: 0, maxTokens: 512 },
    );
    if (!out) return null;
    try {
      const start = out.indexOf("{");
      const end = out.lastIndexOf("}");
      if (start < 0 || end <= start) return null;
      const parsed = JSON.parse(out.slice(start, end + 1));
      return parsed && typeof parsed === "object"
        ? (parsed as Record<string, unknown>)
        : null;
    } catch {
      return null;
    }
  }

  /** True when a tool input is the provider's "couldn't parse" sentinel. */
  private isRawToolInput(input: unknown): input is { _raw: string } {
    return (
      typeof input === "object" &&
      input !== null &&
      "_raw" in input &&
      typeof (input as { _raw: unknown })._raw === "string"
    );
  }

  /**
   * SELF-CONTEXT-FILTERING per turn. After tools have run, the accumulated
   * tool-result messages can balloon the prompt and bury the signal — exactly
   * what degrades local models. Before the next provider.complete in the loop,
   * compact any oversized tool-result message down to the facts relevant to the
   * CURRENT query, reusing the same gated Distiller (TOON + token gate) used for
   * RAG context. Mutates the messages array in place. Best-effort + bounded:
   * only fires for local tuning, only on messages over a size threshold, and
   * silently leaves a message untouched on any failure.
   */
  private async filterToolResults(
    query: string,
    messages: ChatMessage[],
  ): Promise<void> {
    if (!this.localTuningOn()) return;
    const gate = this.settings.distill?.tokenGate ?? 700;
    // A tool result is "large" when it materially exceeds the distill gate.
    const threshold = gate * 4 * 2; // gate→tokens→chars, ×2 headroom
    for (const m of messages) {
      if (m.role !== "tool" || typeof m.content !== "string") continue;
      if (
        m.content.length < threshold ||
        (m as { _filtered?: boolean })._filtered
      )
        continue;
      try {
        const distiller = await this.distiller();
        const { tag } = this.resolveDistill();
        const result = await distiller.distill(
          {
            query,
            chunks: [{ path: m.toolCallId ?? "tool_result", text: m.content }],
          },
          { useLlm: true, tokenGate: gate, maxPasses: 1, modelTag: tag },
        );
        if (this.distillCache?.dirty) void this.saveDistillCache();
        // Only adopt the compaction when it actually shrank the content.
        if (result.toon && result.toon.length < m.content.length) {
          m.content =
            "[tool result distilled to relevant facts]\n" + result.toon;
          (m as { _filtered?: boolean })._filtered = true;
        }
      } catch {
        /* leave this tool result untouched */
      }
    }
  }

  /** Heuristic: an answer that is empty or visibly cut off mid-thought. Drives
   *  the one-shot self-correction retry for local models. */
  private looksTruncated(text: string): boolean {
    const t = text.trim();
    if (t.length === 0) return true;
    if (t.length < 24) return false; // short but complete answers are fine
    const last = t[t.length - 1] ?? "";
    // Ends without terminal punctuation / closing fence ⇒ likely cut off.
    return !/[.!?)\]}"'`\n]/.test(last) && !t.endsWith("```");
  }

  /**
   * Eagerly crystallize a set of entity paths (the "Crystallize brain" command).
   * Skips entries already fresh (hash match), prunes paths no longer present,
   * and persists the matrix. Returns how many digests were (re)built.
   */
  async crystallizeAll(
    paths: string[],
  ): Promise<{ built: number; total: number }> {
    const crystal = await this.ensureCrystal();
    const live = new Set<string>();
    let built = 0;
    for (const path of paths) {
      try {
        const r = await this.digestFor(path, crystal);
        if (r) {
          live.add(path);
          if (r.fresh) built++;
        }
      } catch {
        /* skip unreadable entity */
      }
    }
    crystal.retain(live);
    await this.saveCrystal();
    return { built, total: paths.length };
  }

  /** Fingerprint + trace a copilot query. Best-effort; never throws. */
  async recordQuery(query: string): Promise<void> {
    try {
      await this.traceSink?.record("query", "copilot", "query", query, {
        meta: { len: query.length },
      });
    } catch {
      /* trace is best-effort */
    }
  }

  /** Embed text for LanceDB vector RAG. Uses the configured embedding provider
   *  when set; otherwise falls back to the chat provider's embeddings endpoint.
   *  Returns null when RAG is disabled, the provider lacks embeddings (e.g.
   *  Anthropic), or the endpoint is unreachable — callers fall back to lexical
   *  search. */
  async embed(text: string): Promise<number[] | null> {
    const c = this.embedConfig;
    if (c && !c.enabled) return null; // RAG master switch off
    const model =
      c?.model ||
      this.settings.preferredEmbeddingModel ||
      this.settings.embedModel ||
      this.settings.model;
    if (!model) return null;
    // Route through the EmbeddingsLane so the embed model is actually ensured-
    // loaded (was silently never JIT-loaded before), query vectors are cached,
    // and failures are VISIBLE (traced) instead of a silent lexical fallback.
    if (model !== this.lastEmbedModel) {
      this.embeddingsLane.setConfig({ model, enabled: true });
      this.lastEmbedModel = model;
    }
    const r = await this.embeddingsLane.embedQuery(text);
    if (r.vec) return Array.from(r.vec);
    if (r.status === "failed") {
      void this.traceSink
        ?.record("embed", "copilot", "embed", model, {
          meta: { status: r.status, reason: r.reason ?? "" },
        })
        .catch(() => {});
    }
    return null;
  }

  /** Build the embedding provider from its config (independent of chat). */
  private embedProvider(c: EmbeddingRuntimeConfig): ISauceBotProvider {
    return this.getOrBuildProvider(c.provider, {
      apiKey: async () => c.apiKey || undefined,
      baseUrl: c.endpoint,
      defaultModel: c.model,
    });
  }

  // ── Provider instance cache (S1) ────────────────────────────────────────
  // Providers were re-`new`ed every ask()/embed(), discarding warm connections
  // and dynamic refreshModels()/JIT state. Memoize by (id, endpoint); the
  // apiKey getter closes over live settings so credential changes are still
  // picked up, and updateSettings/setEmbeddingConfig invalidate the cache.
  private providerCache = new Map<string, ISauceBotProvider>();
  /** Optional credential source for the lmstudio-sdk harness (JIT load). */
  private credentialSource: CredentialSource | null = null;

  setCredentialSource(src: CredentialSource | null): void {
    this.credentialSource = src;
    this.providerCache.clear();
  }

  private getOrBuildProvider(
    id: ProviderId,
    opts: BuildProviderOpts,
  ): ISauceBotProvider {
    const key = `${id}::${opts.baseUrl ?? ""}`;
    let p = this.providerCache.get(key);
    if (!p) {
      p = buildProvider(id, this.providerHost, {
        ...opts,
        credentialSource: this.credentialSource,
      });
      this.providerCache.set(key, p);
    }
    return p;
  }

  updateSettings(s: Partial<SauceBotSettings>): void {
    this.settings = { ...this.settings, ...s };
    this.providerCache.clear(); // endpoint/provider may have changed
  }

  getSettings(): SauceBotSettings {
    return this.settings;
  }

  /** Single-shot completion (no RAG, no tools, no streaming surface) for
   *  structured background tasks like enrichment classification. Accumulates
   *  the streamed text and returns it; null on any provider error. */
  async completeOnce(
    systemPrompt: string,
    userPrompt: string,
    opts: { maxTokens?: number; temperature?: number } = {},
  ): Promise<string | null> {
    try {
      let text = "";
      for await (const ev of this.provider().complete({
        model: this.settings.model,
        messages: [{ role: "user", content: userPrompt }],
        systemPrompt,
        temperature: opts.temperature ?? 0,
        maxTokens: opts.maxTokens ?? 512,
        stream: false,
      })) {
        if (ev.type === "text") text += ev.delta;
      }
      return text.trim() || null;
    } catch {
      return null;
    }
  }

  /**
   * Warm up / JIT-load the active model with a 1-token request, surfacing
   * whether the model loaded and how long it took. Drives the chat view's
   * realtime "loading → ready/failed" indicator on model switch. Goes through
   * completeResilient so an unreachable server is reported cleanly.
   */
  async warmup(): Promise<{
    ok: boolean;
    ms: number;
    error?: string;
    kind?: LoadFailureKind;
    userMessage?: string;
    fallback?: string | null;
  }> {
    const t0 = Date.now();
    let ok = false;
    let error: string | undefined;
    let kind: LoadFailureKind | undefined;
    let userMessage: string | undefined;
    let fallback: string | null | undefined;
    try {
      // completeResilient classifies + blocklists the failure and attaches
      // kind/userMessage/fallback to its done/error event — we just surface them.
      for await (const ev of this.completeResilient(this.provider(), {
        model: this.settings.model,
        messages: [{ role: "user", content: "hi" }],
        temperature: 0,
        maxTokens: 1,
        stream: false,
      })) {
        if (ev.type === "text" || ev.type === "reasoning") ok = true;
        else if (ev.type === "done") {
          if (ev.reason === "error") {
            error = ev.error;
            kind = ev.kind;
            userMessage = ev.userMessage;
            fallback = ev.fallback;
          } else ok = true;
        }
      }
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    if (error) {
      return {
        ok: false,
        ms: Date.now() - t0,
        error,
        ...(kind !== undefined ? { kind } : {}),
        ...(userMessage !== undefined ? { userMessage } : {}),
        ...(fallback !== undefined ? { fallback } : {}),
      };
    }
    return { ok, ms: Date.now() - t0 };
  }

  /**
   * Reasoning salvage: when a turn produced only `reasoning_content` and no
   * final answer (the model spent its whole budget thinking), inject that
   * reasoning into a short extraction call and ask for ONLY the conclusion.
   * Falls back to a trimmed tail of the reasoning so the user is never left
   * with a blank answer. One bounded extra call; null only if nothing salvages.
   */
  private async extractFromReasoning(
    query: string,
    reasoning: string,
  ): Promise<string | null> {
    const system =
      "An assistant reasoned about the user's question but did not produce a " +
      "final answer (it ran out of output budget while thinking). Given that " +
      "reasoning, write ONLY the final answer for the user: concise, directly " +
      "responsive, no preamble, no chain-of-thought, no 'based on my reasoning'.";
    const user = `Question:\n${query}\n\nReasoning so far:\n${reasoning.slice(-6000)}\n\nFinal answer:`;
    const out = await this.completeOnce(system, user, {
      temperature: 0,
      maxTokens: Math.max(512, Math.min(this.settings.maxTokens, 1024)),
    });
    if (out && out.trim()) return out.trim();
    const tail = reasoning.trim().slice(-800);
    return tail
      ? `_(No clean answer was produced; surfacing the model's reasoning.)_\n\n${tail}`
      : null;
  }

  /** One-shot document rewrite for the `propose_edit` vault tool (S2). Applies
   *  `instructions` to `original` and returns ONLY the revised full text.
   *  Falls back to the original on any provider error (never throws), so the
   *  diff a caller computes is a no-op rather than a destructive blank. */
  async rewrite(original: string, instructions: string): Promise<string> {
    const system =
      "You are a precise document editor. Apply the user's instruction to the " +
      "document and return ONLY the complete revised document text — no " +
      "preamble, no code fences, no commentary.";
    const user = `Instruction:\n${instructions}\n\nDocument:\n${original}`;
    const out = await this.completeOnce(system, user, {
      maxTokens: this.settings.maxTokens,
      temperature: 0,
    });
    return out ?? original;
  }

  /**
   * Brain "Ask" — a structured, citation-guarded answer over the vault, routed
   * through the configured provider (LM Studio / Anthropic / …) instead of the
   * prototype's `claude -p` spawn. RAG context (candidate paths + inlined
   * entity bodies) is handed to the model so it cites real content; the
   * defensive parser enforces NO-CITATION ⇒ NO-CLAIM. Throws only on a hard
   * provider error (unreachable / 5xx) so the caller can surface it.
   */
  async askBrainStructured(question: string): Promise<BrainAnswer> {
    let system = brainSystemPrompt();
    try {
      const ctx = await this.rag.assemble(question);
      const centered =
        ctx.centered.length > 0
          ? ctx.centered
          : [...new Set([...ctx.pinned, ...ctx.graph, ...ctx.semantic])].slice(
              0,
              12,
            );
      if (centered.length) {
        system +=
          "\n\n## Candidate vault paths (cite these by path:line)\n" +
          centered.map((p) => `- ${p}`).join("\n");
        system += await this.inlineEntityContent(centered, question);
      }
    } catch {
      /* RAG context is best-effort; the model can still answer "I don't have that". */
    }

    let text = "";
    for await (const ev of this.completeResilient(this.provider(), {
      model: this.settings.model,
      messages: [{ role: "user", content: question }],
      systemPrompt: system,
      temperature: 0,
      maxTokens: Math.max(this.settings.maxTokens, 1024),
      stream: false,
    })) {
      if (ev.type === "text") text += ev.delta;
      else if (ev.type === "done" && ev.reason === "error")
        throw new Error(ev.error ?? "ask failed");
    }
    return parseBrainAnswer(text);
  }

  provider(): ISauceBotProvider {
    // Guard against a corrupt/legacy provider value: an unknown id falls back
    // to the historical default (anthropic) rather than throwing inside the
    // chat path. Known ids derive from the registry (S1).
    const id: ProviderId =
      this.settings.provider in PROVIDER_REGISTRY
        ? this.settings.provider
        : "anthropic";
    return this.getOrBuildProvider(id, {
      // SEC-02: the durable key lives in the credential chain (OS keychain /
      // KeyVault); the in-memory settings copy is a session-only fallback.
      apiKey: async () =>
        (await this.credentialSource
          ?.get(`copilot:${id}:api-key`)
          .catch(() => null)) ||
        this.settings.apiKey ||
        undefined,
      ...(this.settings.baseUrl !== undefined
        ? { baseUrl: this.settings.baseUrl }
        : {}),
      defaultModel: this.settings.model,
    });
  }

  /** Connection-class errors that are safe to retry (server starting, network
   *  blip, rate limit, 5xx). An undefined message ⇒ treat as transient. */
  private isTransientError(msg: string | undefined): boolean {
    if (!msg) return true;
    const m = msg.toLowerCase();
    return (
      m.includes("econnrefused") ||
      m.includes("econnreset") ||
      m.includes("enotfound") ||
      m.includes("fetch failed") ||
      m.includes("network") ||
      m.includes("timeout") ||
      m.includes("timed out") ||
      m.includes("socket hang up") ||
      /http (408|425|429|5\d\d)/.test(m)
    );
  }

  private backoff(attempt: number): Promise<void> {
    const ms = Math.min(4000, 400 * 2 ** (attempt - 1));
    return new Promise((r) => setTimeout(r, ms));
  }

  /**
   * Reachability + bounded-retry wrapper around ONE provider.complete() turn.
   * - When the provider exposes ping() (local LM Studio / Ollama), probe first
   *   so an unreachable server short-circuits to a clear, cited error instead
   *   of a long opaque hang ("can't send messages").
   * - Retries ONLY when nothing was streamed yet (safe — no duplicate output)
   *   and the failure looks transient. Never retries mid-stream.
   * - Emits `status` events ("connecting" / "loading" / "retrying") so the UI
   *   can show progress during slow JIT model loads rather than appearing dead.
   * The user's chosen provider/model is never silently changed.
   */
  private async *completeResilient(
    provider: ISauceBotProvider,
    req: CompletionRequest,
  ): AsyncIterable<CompletionEvent> {
    const maxAttempts = Math.max(0, this.settings.maxRetries ?? 1) + 1;
    const pingable = provider as Partial<{
      ping(): Promise<{ ok: boolean; error?: string }>;
      endpoint?: string;
    }>;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (typeof pingable.ping === "function") {
        yield { type: "status", state: "connecting", detail: provider.name };
        const health = await pingable.ping();
        if (!health.ok) {
          if (attempt < maxAttempts && this.isTransientError(health.error)) {
            yield {
              type: "status",
              state: "retrying",
              detail: `attempt ${attempt + 1}/${maxAttempts}`,
            };
            await this.backoff(attempt);
            continue;
          }
          const where = pingable.endpoint ?? provider.name;
          yield {
            type: "done",
            reason: "error",
            error: `${provider.name} is unreachable at ${where} — ${health.error ?? "no response"}. Is the server running?`,
          };
          return;
        }
      }
      yield { type: "status", state: "loading", detail: req.model };
      let emitted = false;
      let errored = false;
      let lastError: string | undefined;
      for await (const ev of provider.complete(req)) {
        if (ev.type === "done") {
          if (ev.reason === "error") {
            errored = true;
            lastError = ev.error;
            break;
          }
          yield ev;
          return;
        }
        if (
          ev.type === "text" ||
          ev.type === "tool_use" ||
          ev.type === "reasoning"
        )
          emitted = true;
        yield ev;
      }
      if (!errored) return;
      if (
        !emitted &&
        attempt < maxAttempts &&
        this.isTransientError(lastError)
      ) {
        yield {
          type: "status",
          state: "retrying",
          detail: `attempt ${attempt + 1}/${maxAttempts}`,
        };
        await this.backoff(attempt);
        continue;
      }
      // Classify the failure (arch-unsupported / oom / not-found → permanent),
      // blocklist a permanently-doomed model, and suggest a known-good fallback
      // so the UI can offer a one-click switch instead of a dead end.
      const classified = this.modelManager.recordFailure(
        req.model,
        lastError ?? "request failed",
      );
      const fallback = classified.permanent
        ? await this.modelManager.fallbackChatModel()
        : null;
      yield {
        type: "done",
        reason: "error",
        error: lastError ?? "request failed",
        kind: classified.kind,
        userMessage: classified.userMessage,
        fallback,
      };
      return;
    }
  }

  /**
   * Multi-turn question with RAG context. Streams text events and tool_use
   * events; when the model calls a tool we execute it via ToolUseAdapter,
   * append the assistant tool_use message + a tool result message, and call
   * the provider again. Capped at MAX_TOOL_TURNS to prevent runaway loops.
   */
  async *ask(
    query: string,
    focus?: string,
    prior: ChatMessage[] = [],
    opts: { forceSkill?: string } = {},
  ): AsyncIterable<CompletionEvent> {
    void this.recordQuery(query); // T8: fingerprint/trace the query (fire-and-forget)
    const ctx = await this.rag.assemble(query, focus);
    const centered =
      ctx.centered.length > 0
        ? ctx.centered
        : [
            ...new Set([
              ...ctx.pinned,
              ...(ctx.focus ? [ctx.focus] : []),
              ...ctx.graph,
              ...ctx.semantic,
            ]),
          ].slice(0, 12);
    let systemPlus =
      this.composeSystemPrompt() +
      "\n\n## Context paths (call read_note with any of these paths to retrieve content)\n" +
      centered.map((p) => `- ${p}`).join("\n") +
      `\n\n## Recent touches (${ctx.recentTouches.length})\n` +
      ctx.recentTouches
        .slice(0, 10)
        .map((t) => `- ${t.date} · ${t.contactId}`)
        .join("\n");

    // B-patch: inline trimmed entity bodies for the top centered paths so the
    // model has immediate content without needing a read_note round-trip.
    // Budgeted at ENTITY_INLINE_TOKEN_CEILING chars (~2 k tokens) shared across
    // all inlined notes; each note is capped at ENTITY_INLINE_PER_NOTE chars.
    // Best-effort: any vault read failure silently falls back to path-only mode.
    systemPlus += await this.inlineEntityContent(centered, query);

    // T7: append harvested-document context when available.
    if (this.docSearch) {
      try {
        const docs = await this.docSearch(query, 5);
        if (docs.length) {
          systemPlus +=
            "\n\n## Document context (from uploaded files)\n" +
            docs.map((d) => `### ${d.docName}\n${d.text}`).join("\n\n");
        }
      } catch {
        /* document context is best-effort */
      }
    }

    // S4: when the chat slash-picker forces a specific skill, instruct the
    // model to call that tool immediately with the message as its arguments.
    // The tool must already be registered (skills bound via bindToCopilot).
    if (opts.forceSkill && this.toolUse.has(opts.forceSkill)) {
      systemPlus +=
        `\n\n## Required action\nYou MUST call the \`${opts.forceSkill}\` tool now, ` +
        `passing the user's message as its arguments. Do not reply with text first.`;
    }

    // TOOL-USE PROMPTING for local models: cloud models are driven reliably by
    // the structured `tools` array alone, but small local models follow tools
    // far better when the schemas + a one-shot example + the "emit ONLY the
    // tool call" rule are ALSO stated in prose. Skipped for cloud providers.
    if (
      this.localTuningOn() &&
      (this.settings.localTuning?.toolPrompt ?? true)
    ) {
      const tp = this.toolUse.localToolPrompt();
      if (tp) systemPlus += "\n\n" + tp;
    }

    const provider = this.provider();
    // Honor the contextTurns setting: keep only the most recent N turns of
    // prior history (a turn ≈ a user+assistant pair). 0 ⇒ no prior context.
    const maxTurns = this.settings.contextTurns ?? 15;
    let trimmedPrior = maxTurns > 0 ? prior.slice(-maxTurns * 2) : [];
    // MULTI-TURN COMPACTION: when prior history is large, summarize the older
    // turns (keeping the most recent verbatim) so the local model's working
    // context stays within budget across turns. No-op for cloud / small history.
    trimmedPrior = await this.compactPriorHistory(trimmedPrior);
    const messages: ChatMessage[] = [
      ...trimmedPrior,
      { role: "user", content: query },
    ];

    const MAX_TOOL_TURNS = 8;
    for (let turn = 0; turn <= MAX_TOOL_TURNS; turn++) {
      // Collect tool_use calls + assistant text emitted this round so we can
      // append them to the message history before the next round.
      const pendingCalls: Array<{ id: string; name: string; input: unknown }> =
        [];
      const assistantTextParts: string[] = [];
      const reasoningParts: string[] = [];
      let endReason:
        | "end_turn"
        | "tool_use"
        | "max_tokens"
        | "stop"
        | "error"
        | null = null;
      let endError: string | undefined;

      for await (const ev of this.completeResilient(provider, {
        model: this.settings.model,
        messages,
        systemPrompt: systemPlus,
        temperature: this.settings.temperature,
        maxTokens: this.settings.maxTokens,
        tools: this.toolUse.asTools(),
        // Honor the "Stream responses" setting (default on). Providers fall
        // back to batch when fetchStream is unavailable (e.g. legacy
        // ObsidianProviderHost via requestUrl), so this is safe either way.
        stream: this.settings.stream !== false,
      })) {
        if (ev.type === "text") {
          assistantTextParts.push(ev.delta);
          yield ev;
        } else if (ev.type === "reasoning") {
          reasoningParts.push(ev.delta);
          yield ev;
        } else if (ev.type === "tool_use") {
          pendingCalls.push({ id: ev.id, name: ev.name, input: ev.input });
          yield ev;
        } else if (ev.type === "done") {
          endReason = ev.reason;
          endError = ev.error;
        } else {
          yield ev;
        }
      }

      // No tool calls — terminal turn.
      if (pendingCalls.length === 0) {
        const answerSoFar = assistantTextParts.join("");
        // Reasoning salvage: a reasoning model can exhaust its token budget in
        // `reasoning_content` and emit ZERO final text. Rather than return a
        // blank answer, inject the reasoning back into a short extraction pass
        // to recover the conclusion the model ran out of room to write.
        if (
          answerSoFar.trim().length === 0 &&
          reasoningParts.length > 0 &&
          endReason !== "error"
        ) {
          const salvaged = await this.extractFromReasoning(
            query,
            reasoningParts.join(""),
          );
          if (salvaged) yield { type: "text", delta: salvaged };
        } else if (
          // SELF-CORRECTION: a local model can stop with an empty or visibly
          // truncated answer (no reasoning to salvage from). Do ONE
          // compaction+retry — compact the working context and re-ask — before
          // giving up. Distinct from the reasoning-extraction salvage above and
          // bounded to a single extra call. Cloud / non-truncated answers skip.
          this.localTuningOn() &&
          (this.settings.localTuning?.emptyAnswerRetry ?? true) &&
          endReason !== "error" &&
          reasoningParts.length === 0 &&
          this.looksTruncated(answerSoFar)
        ) {
          const retry = await this.selfCorrectAnswer(
            query,
            systemPlus,
            messages,
            answerSoFar,
          );
          // Emit only the remainder so we don't duplicate any text already
          // streamed (the retry returns the FULL answer; diff off the prefix).
          if (
            retry &&
            retry.length > answerSoFar.length &&
            retry.startsWith(answerSoFar)
          )
            yield { type: "text", delta: retry.slice(answerSoFar.length) };
          else if (
            retry &&
            retry !== answerSoFar &&
            answerSoFar.trim().length === 0
          )
            yield { type: "text", delta: retry };
        }
        yield {
          type: "done",
          reason: endReason ?? "end_turn",
          ...(endError ? { error: endError } : {}),
        };
        return;
      }

      // Cap hit: we have tool calls but no more turns budgeted.
      if (turn >= MAX_TOOL_TURNS) {
        yield {
          type: "done",
          reason: "max_tokens",
          error: "tool-turn cap reached",
        };
        return;
      }

      // Append the assistant message (text + tool_use blocks) and each tool
      // result so the next provider.complete sees the full turn.
      const assistantBlocks: Array<{
        type: "text" | "tool_use";
        [k: string]: unknown;
      }> = [];
      const joinedText = assistantTextParts.join("");
      if (joinedText.length > 0)
        assistantBlocks.push({ type: "text", text: joinedText });
      for (const c of pendingCalls) {
        assistantBlocks.push({
          type: "tool_use",
          id: c.id,
          name: c.name,
          input: c.input,
        });
      }
      messages.push({ role: "assistant", content: assistantBlocks });

      for (const c of pendingCalls) {
        let input = c.input;
        // TOOL-CALL REPAIR: when the provider could not parse the model's args
        // (`{_raw}` sentinel), do ONE bounded re-ask nudging the model to emit
        // valid tool JSON rather than dispatching a broken call. On success we
        // dispatch the repaired args; on failure we dispatch the original so
        // the model still sees a (likely error) result and can adapt.
        if (
          this.localTuningOn() &&
          (this.settings.localTuning?.toolRepairReask ?? true) &&
          this.isRawToolInput(input)
        ) {
          const repaired = await this.repairToolCall(c.name, input._raw);
          if (repaired) input = repaired;
        }
        const result = await this.toolUse.runTool(c.name, input, this.app);
        const content =
          typeof result === "string" ? result : JSON.stringify(result);
        messages.push({ role: "tool", toolCallId: c.id, content });
      }

      // SELF-CONTEXT-FILTERING: before the next provider.complete, compact any
      // oversized tool results down to facts relevant to the current query
      // (reusing the gated Distiller). Keeps the working context tight so the
      // local model isn't buried by a large tool payload. No-op for cloud.
      await this.filterToolResults(query, messages);
    }
  }

  /**
   * One-shot self-correction: re-ask the model for a COMPLETE answer when the
   * first attempt came back empty or truncated. Compacts the working context
   * (system prompt is already RAG-grounded) and runs a single bounded,
   * non-streamed completion. Returns the full answer text, or null. Used only
   * for local providers; bounded to one extra call.
   */
  private async selfCorrectAnswer(
    query: string,
    systemPlus: string,
    messages: ChatMessage[],
    partial: string,
  ): Promise<string | null> {
    const nudge =
      partial.trim().length === 0
        ? "Your previous reply was empty. Provide a complete, direct answer now."
        : "Your previous reply was cut off. Provide the COMPLETE answer now, in full.";
    const system = systemPlus + "\n\n## Important\n" + nudge;
    // Reuse the existing prior turns but drop the trailing assistant fragment if
    // any; ask plainly for the full answer.
    const userParts = [query];
    if (partial.trim()) userParts.push(`(Partial draft so far:\n${partial})`);
    const out = await this.completeOnce(system, userParts.join("\n\n"), {
      temperature: this.settings.temperature,
      maxTokens: Math.max(this.settings.maxTokens, 1024),
    });
    void messages; // signature kept for future context-aware retries
    return out;
  }
}
