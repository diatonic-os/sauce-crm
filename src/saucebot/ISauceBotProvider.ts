// SPEC §19.1 — Provider abstraction. Same surface for Anthropic / OpenAI / Ollama / OpenAI-compat.

export interface ModelDescriptor {
  id: string;
  label: string;
  contextTokens: number;
  vision?: boolean;
}
export interface ProviderCapabilities {
  toolUse: boolean;
  streaming: boolean;
  vision: boolean;
  maxContext: number;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content:
    | string
    | Array<{
        type: "text" | "image" | "tool_use" | "tool_result";
        [k: string]: unknown;
      }>;
  name?: string;
  toolCallId?: string;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDef[];
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
  stream?: boolean;
}

export type CompletionEvent =
  | { type: "text"; delta: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  | {
      type: "done";
      reason: "end_turn" | "tool_use" | "max_tokens" | "stop" | "error";
      error?: string;
    };

export interface ISauceBotProvider {
  readonly name: string;
  readonly models: ModelDescriptor[];
  capabilities(): ProviderCapabilities;
  complete(req: CompletionRequest): AsyncIterable<CompletionEvent>;
  embed(text: string, model: string): Promise<Float32Array>;
}

export interface ProviderHost {
  fetch(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
    iter?: AsyncIterable<string>;
  }>;
  /**
   * Optional true-streaming fetch. When present, providers may use this to
   * consume Server-Sent Events / NDJSON without buffering the entire body.
   * Returns a status + an async iterable of UTF-8 chunks (NOT line-split).
   * Implementations should NOT throw on non-2xx — surface status and let the
   * caller drain the iterable (which may carry an error body).
   */
  fetchStream?(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<{
    status: number;
    headers: Record<string, string>;
    iter: AsyncIterable<string>;
  }>;
}
