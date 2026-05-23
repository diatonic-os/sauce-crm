// Orchestrator: provider selection + RAG assembly + streaming completion.
// Keeps the chat surface (CopilotView) thin.

import {
  AnthropicProvider, OpenAIProvider, OllamaProvider,
  RagAssembler, ConversationStore, ToolUseAdapter,
} from "./index";
import { LMStudioProvider } from "./LMStudioProvider";
import type { ChatMessage, ICopilotProvider, CompletionEvent } from "./ICopilotProvider";
import { ObsidianProviderHost, ObsidianRagHost, ObsidianConversationHost } from "./CopilotHostAdapters";
import { App } from "obsidian";
import { EntityService } from "../services/EntityService";
import { SearchService } from "../services/SearchService";

export interface CopilotSettings {
  provider: "anthropic" | "openai" | "ollama" | "lmstudio";
  model: string;
  apiKey: string;             // P15 swaps for KeyVault lookup
  baseUrl?: string;           // ollama override / proxy URL / LM Studio endpoint
  temperature: number;
  maxTokens: number;
  systemPrompt: string;
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
  ) {
    this.rag = new RagAssembler(new ObsidianRagHost(app, entities, search));
    this.conversations = new ConversationStore(new ObsidianConversationHost(app));
    this.toolUse = new ToolUseAdapter();
  }

  updateSettings(s: Partial<CopilotSettings>): void {
    this.settings = { ...this.settings, ...s };
  }

  getSettings(): CopilotSettings { return this.settings; }

  provider(): ICopilotProvider {
    const key = async () => this.settings.apiKey;
    switch (this.settings.provider) {
      case "openai":   return new OpenAIProvider(this.providerHost, key, this.settings.baseUrl);
      case "ollama":   return new OllamaProvider(this.providerHost, this.settings.baseUrl ?? "http://localhost:11434");
      case "lmstudio": return new LMStudioProvider(this.providerHost, {
        endpoint: this.settings.baseUrl ?? "http://localhost:1234/v1",
        apiKey: this.settings.apiKey || undefined,
        defaultModel: this.settings.model,
      });
      case "anthropic":
      default:         return new AnthropicProvider(this.providerHost, key, this.settings.baseUrl);
    }
  }

  /**
   * Multi-turn question with RAG context. Streams text events and tool_use
   * events; when the model calls a tool we execute it via ToolUseAdapter,
   * append the assistant tool_use message + a tool result message, and call
   * the provider again. Capped at MAX_TOOL_TURNS to prevent runaway loops.
   */
  async *ask(query: string, focus?: string, prior: ChatMessage[] = []): AsyncIterable<CompletionEvent> {
    const ctx = await this.rag.assemble(query, focus);
    const centered = ctx.centered.length > 0
      ? ctx.centered
      : [...new Set([...ctx.pinned, ...(ctx.focus ? [ctx.focus] : []), ...ctx.graph, ...ctx.semantic])].slice(0, 12);
    const systemPlus = this.settings.systemPrompt + "\n\n## Context paths (read these via tool if needed)\n" +
      centered.map((p) => `- ${p}`).join("\n") +
      `\n\n## Recent touches (${ctx.recentTouches.length})\n` +
      ctx.recentTouches.slice(0, 10).map((t) => `- ${t.date} · ${t.contactId}`).join("\n");

    const provider = this.provider();
    const messages: ChatMessage[] = [...prior, { role: "user", content: query }];

    const MAX_TOOL_TURNS = 8;
    for (let turn = 0; turn <= MAX_TOOL_TURNS; turn++) {
      // Collect tool_use calls + assistant text emitted this round so we can
      // append them to the message history before the next round.
      const pendingCalls: Array<{ id: string; name: string; input: unknown }> = [];
      const assistantTextParts: string[] = [];
      let endReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop' | 'error' | null = null;
      let endError: string | undefined;

      for await (const ev of provider.complete({
        model: this.settings.model,
        messages,
        systemPrompt: systemPlus,
        temperature: this.settings.temperature,
        maxTokens: this.settings.maxTokens,
        tools: this.toolUse.asTools(),
        // Opt into token-by-token streaming when the host supports it.
        // Providers fall back to batch when fetchStream is unavailable
        // (e.g. legacy ObsidianProviderHost via requestUrl), so this is
        // safe to set unconditionally.
        stream: true,
      })) {
        if (ev.type === 'text') {
          assistantTextParts.push(ev.delta);
          yield ev;
        } else if (ev.type === 'tool_use') {
          pendingCalls.push({ id: ev.id, name: ev.name, input: ev.input });
          yield ev;
        } else if (ev.type === 'done') {
          endReason = ev.reason;
          endError = ev.error;
        } else {
          yield ev;
        }
      }

      // No tool calls — terminal turn. Forward the done event and exit.
      if (pendingCalls.length === 0) {
        yield { type: 'done', reason: endReason ?? 'end_turn', ...(endError ? { error: endError } : {}) };
        return;
      }

      // Cap hit: we have tool calls but no more turns budgeted.
      if (turn >= MAX_TOOL_TURNS) {
        yield { type: 'done', reason: 'max_tokens', error: 'tool-turn cap reached' };
        return;
      }

      // Append the assistant message (text + tool_use blocks) and each tool
      // result so the next provider.complete sees the full turn.
      const assistantBlocks: Array<{ type: 'text' | 'tool_use'; [k: string]: unknown }> = [];
      const joinedText = assistantTextParts.join("");
      if (joinedText.length > 0) assistantBlocks.push({ type: 'text', text: joinedText });
      for (const c of pendingCalls) {
        assistantBlocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.input });
      }
      messages.push({ role: 'assistant', content: assistantBlocks });

      for (const c of pendingCalls) {
        const result = await this.toolUse.runTool(c.name, c.input, this.app);
        const content = typeof result === 'string' ? result : JSON.stringify(result);
        messages.push({ role: 'tool', toolCallId: c.id, content });
      }
    }
  }
}
