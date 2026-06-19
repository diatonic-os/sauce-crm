// SPEC §19.1 — Provider abstraction. Same surface for Anthropic / OpenAI / Ollama / OpenAI-compat.

import type { LoadFailureKind } from "./ModelManager";

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
  /** Stable per-message id (msg_…) + creation time, for trace/replay. */
  id?: string;
  ts?: number;
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
  // Chain-of-thought / "thinking" stream emitted by reasoning models (LM Studio
  // qwen3 / deepseek-r1, etc.) in `reasoning_content`. Kept distinct from `text`
  // so UIs can render it collapsed/muted; consumers that don't care ignore it.
  // Without surfacing this, reasoning models that put their whole reply in
  // `reasoning_content` (empty `content`) render as a blank answer.
  | { type: "reasoning"; delta: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "usage"; inputTokens: number; outputTokens: number }
  // Transient lifecycle signal for the UI (provider reachability, cold model
  // load, retry-in-progress). Non-content; safe for any consumer to ignore.
  | {
      type: "status";
      state: "connecting" | "loading" | "retrying" | "ok";
      detail?: string;
    }
  | {
      type: "done";
      reason: "end_turn" | "tool_use" | "max_tokens" | "stop" | "error";
      error?: string;
      // Set on reason:"error" when a model LOAD failure is classified (see
      // ModelManager.classifyLoadFailure). `userMessage` is a short non-developer
      // explanation; `kind` lets UIs distinguish permanent (arch/oom/not-found)
      // from transient; `fallback` names a known-good model to switch to.
      kind?: LoadFailureKind;
      userMessage?: string;
      fallback?: string | null;
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
