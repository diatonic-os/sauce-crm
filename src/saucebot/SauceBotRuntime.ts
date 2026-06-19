// Orchestrator: provider selection + RAG assembly + streaming completion.
// Keeps the chat surface (SauceBotView) thin.

import { RagAssembler, ConversationStore, ToolUseAdapter } from "./index";
import {
  buildProvider,
  PROVIDER_REGISTRY,
  type ProviderId,
  type BuildProviderOpts,
} from "./ProviderRegistry";
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
import {
  BrainCrystalCache,
  buildEntityDigest,
  hashBody,
} from "./BrainCrystal";
import {
  Distiller,
  DistillCache,
  pickBestLocalModel,
  type DistillChunk,
} from "./Distiller";

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
  provider: "anthropic",
  model: "claude-opus-4-7",
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
};

export class SauceBotRuntime {
  rag: RagAssembler;
  conversations: ConversationStore;
  toolUse: ToolUseAdapter;
  private providerHost = new ObsidianProviderHost();

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
    try {
      if (c) {
        const vec = await this.embedProvider(c).embed(text, c.model);
        return Array.from(vec);
      }
      const model = this.settings.embedModel ?? this.settings.model;
      const vec = await this.provider().embed(text, model);
      return Array.from(vec);
    } catch {
      return null;
    }
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
    const user =
      `Question:\n${query}\n\nReasoning so far:\n${reasoning.slice(-6000)}\n\nFinal answer:`;
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
          : [
              ...new Set([
                ...ctx.pinned,
                ...ctx.graph,
                ...ctx.semantic,
              ]),
            ].slice(0, 12);
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
      if (!emitted && attempt < maxAttempts && this.isTransientError(lastError)) {
        yield {
          type: "status",
          state: "retrying",
          detail: `attempt ${attempt + 1}/${maxAttempts}`,
        };
        await this.backoff(attempt);
        continue;
      }
      yield { type: "done", reason: "error", error: lastError ?? "request failed" };
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

    const provider = this.provider();
    // Honor the contextTurns setting: keep only the most recent N turns of
    // prior history (a turn ≈ a user+assistant pair). 0 ⇒ no prior context.
    const maxTurns = this.settings.contextTurns ?? 15;
    const trimmedPrior = maxTurns > 0 ? prior.slice(-maxTurns * 2) : [];
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
        // Reasoning salvage: a reasoning model can exhaust its token budget in
        // `reasoning_content` and emit ZERO final text. Rather than return a
        // blank answer, inject the reasoning back into a short extraction pass
        // to recover the conclusion the model ran out of room to write.
        if (
          assistantTextParts.join("").trim().length === 0 &&
          reasoningParts.length > 0 &&
          endReason !== "error"
        ) {
          const salvaged = await this.extractFromReasoning(
            query,
            reasoningParts.join(""),
          );
          if (salvaged) yield { type: "text", delta: salvaged };
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
        const result = await this.toolUse.runTool(c.name, c.input, this.app);
        const content =
          typeof result === "string" ? result : JSON.stringify(result);
        messages.push({ role: "tool", toolCallId: c.id, content });
      }
    }
  }
}
