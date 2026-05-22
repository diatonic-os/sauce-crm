// Orchestrator: provider selection + RAG assembly + streaming completion.
// Keeps the chat surface (CopilotView) thin.

import {
  AnthropicProvider, OpenAIProvider, OllamaProvider,
  RagAssembler, ConversationStore, ToolUseAdapter,
} from "./index";
import type { ChatMessage, ICopilotProvider, CompletionEvent } from "./ICopilotProvider";
import { ObsidianProviderHost, ObsidianRagHost, ObsidianConversationHost } from "./CopilotHostAdapters";
import { App } from "obsidian";
import { EntityService } from "../services/EntityService";
import { SearchService } from "../services/SearchService";

export interface CopilotSettings {
  provider: "anthropic" | "openai" | "ollama";
  model: string;
  apiKey: string;             // P15 swaps for KeyVault lookup
  baseUrl?: string;           // ollama override / proxy URL
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
      case "openai": return new OpenAIProvider(this.providerHost, key, this.settings.baseUrl);
      case "ollama": return new OllamaProvider(this.providerHost, this.settings.baseUrl ?? "http://localhost:11434");
      case "anthropic":
      default:       return new AnthropicProvider(this.providerHost, key, this.settings.baseUrl);
    }
  }

  /**
   * One-shot question with RAG context. Streams text events.
   */
  async *ask(query: string, focus?: string, prior: ChatMessage[] = []): AsyncIterable<CompletionEvent> {
    const ctx = await this.rag.assemble(query, focus);
    const systemPlus = this.settings.systemPrompt + "\n\n## Context paths (read these via tool if needed)\n" +
      [...new Set([...ctx.pinned, ...(ctx.focus ? [ctx.focus] : []), ...ctx.graph, ...ctx.semantic])].slice(0, 25).map((p) => `- ${p}`).join("\n") +
      `\n\n## Recent touches (${ctx.recentTouches.length})\n` +
      ctx.recentTouches.slice(0, 10).map((t) => `- ${t.date} · ${t.contactId}`).join("\n");

    const provider = this.provider();
    const messages: ChatMessage[] = [...prior, { role: "user", content: query }];

    for await (const ev of provider.complete({
      model: this.settings.model,
      messages,
      systemPrompt: systemPlus,
      temperature: this.settings.temperature,
      maxTokens: this.settings.maxTokens,
      tools: this.toolUse.asTools(),
    })) {
      yield ev;
    }
  }
}
