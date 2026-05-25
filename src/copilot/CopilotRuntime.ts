// Orchestrator: provider selection + RAG assembly + streaming completion.
// Keeps the chat surface (CopilotView) thin.

import { RagAssembler, ConversationStore, ToolUseAdapter } from "./index";
import {
  buildProvider,
  PROVIDER_REGISTRY,
  type ProviderId,
  type BuildProviderOpts,
} from "./ProviderRegistry";
import type {
  ChatMessage,
  ICopilotProvider,
  CompletionEvent,
} from "./ICopilotProvider";
import type { CredentialSource } from "./CredentialSource";
import type { CopilotSession } from "./ConversationStore";
import {
  ObsidianProviderHost,
  ObsidianRagHost,
  ObsidianConversationHost,
} from "./CopilotHostAdapters";
import { App } from "obsidian";
import { EntityService } from "../services/EntityService";
import { SearchService } from "../services/SearchService";
import type { LanceVectorIndex } from "../backend/lance";
import { SlashCommand, defaultSlashCommands } from "./SlashCommands";

export interface CopilotSettings {
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

export const COPILOT_DEFAULTS: CopilotSettings = {
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
};

export class CopilotRuntime {
  rag: RagAssembler;
  conversations: ConversationStore;
  toolUse: ToolUseAdapter;
  private providerHost = new ObsidianProviderHost();

  constructor(
    private app: App,
    entities: EntityService,
    search: SearchService,
    private settings: CopilotSettings,
    /** LanceDB vector index for semantic RAG. When present (and an embed model
     *  is reachable), RagAssembler uses real embeddings; otherwise it falls
     *  back to fuzzy/tag-cosine search. */
    ragVectorIndex: LanceVectorIndex | null = null,
  ) {
    const embedFn = ragVectorIndex ? (text: string) => this.embed(text) : null;
    this.rag = new RagAssembler(
      new ObsidianRagHost(
        app,
        entities,
        search,
        () => [],
        ragVectorIndex,
        embedFn,
      ),
    );
    this.conversations = new ConversationStore(
      new ObsidianConversationHost(app),
    );
    this.toolUse = new ToolUseAdapter();
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
    const firstLine = (firstMessage ?? "").trim().split("\n")[0].trim();
    if (!firstLine) return null;
    return firstLine.length > 60 ? `${firstLine.slice(0, 57)}…` : firstLine;
  }

  /** Persist a session, applying autonaming (the first user message names it
   *  when the toggle is on). Returns the saved path. */
  async persistSession(
    session: CopilotSession,
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
  private embedProvider(c: EmbeddingRuntimeConfig): ICopilotProvider {
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
  private providerCache = new Map<string, ICopilotProvider>();
  /** Optional credential source for the lmstudio-sdk harness (JIT load). */
  private credentialSource: CredentialSource | null = null;

  setCredentialSource(src: CredentialSource | null): void {
    this.credentialSource = src;
    this.providerCache.clear();
  }

  private getOrBuildProvider(
    id: ProviderId,
    opts: BuildProviderOpts,
  ): ICopilotProvider {
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

  updateSettings(s: Partial<CopilotSettings>): void {
    this.settings = { ...this.settings, ...s };
    this.providerCache.clear(); // endpoint/provider may have changed
  }

  getSettings(): CopilotSettings {
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

  provider(): ICopilotProvider {
    // Guard against a corrupt/legacy provider value: an unknown id falls back
    // to the historical default (anthropic) rather than throwing inside the
    // chat path. Known ids derive from the registry (S1).
    const id: ProviderId =
      this.settings.provider in PROVIDER_REGISTRY
        ? this.settings.provider
        : "anthropic";
    return this.getOrBuildProvider(id, {
      apiKey: async () => this.settings.apiKey || undefined,
      baseUrl: this.settings.baseUrl,
      defaultModel: this.settings.model,
    });
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
      let endReason:
        | "end_turn"
        | "tool_use"
        | "max_tokens"
        | "stop"
        | "error"
        | null = null;
      let endError: string | undefined;

      for await (const ev of provider.complete({
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

      // No tool calls — terminal turn. Forward the done event and exit.
      if (pendingCalls.length === 0) {
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
