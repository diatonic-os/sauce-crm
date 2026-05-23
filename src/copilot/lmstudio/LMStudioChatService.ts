// SPEC §19 — LM Studio chat surface. Wraps SDK respond()/act() under a clean V2-friendly API.

import type {
  LMStudioClientLike,
  LMStudioLlmHandle,
  LMStudioRespondOpts,
  LMStudioStats,
} from "./LMStudioClientFactory";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
  images?: Array<{ base64: string; mimeType?: string }>;
}

export interface ChatRequest {
  modelId: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  topK?: number;
  topP?: number;
  draftModelId?: string; // speculative decoding
  structuredSchema?: unknown; // JSON-schema-like for structured response
  signal?: AbortSignal; // cancellation
}

export interface ChatStreamEvent {
  type: "first-token" | "text" | "done";
  delta?: string;
  stats?: LMStudioStats;
  reason?: "end" | "aborted" | "failed";
  error?: string;
}

export interface ChatResult {
  content: string;
  reasoning?: string;
  stats: LMStudioStats;
}

export class LMStudioChatService {
  constructor(private readonly client: LMStudioClientLike) {}

  async respond(req: ChatRequest): Promise<ChatResult> {
    const model = await this.client.llm.model(req.modelId);
    const chat = this.toSdkChat(req.messages);
    const opts: LMStudioRespondOpts = {
      temperature: req.temperature,
      maxTokens: req.maxTokens,
      topK: req.topK,
      topP: req.topP,
      signal: req.signal,
      draftModel: req.draftModelId,
      structured: req.structuredSchema,
    };
    const res = await model.respond(chat, opts);
    return {
      content: res.content ?? "",
      reasoning: res.reasoningContent,
      stats: res.stats ?? {},
    };
  }

  async *stream(req: ChatRequest): AsyncGenerator<ChatStreamEvent> {
    const model = await this.client.llm.model(req.modelId);
    const chat = this.toSdkChat(req.messages);
    const fragments: string[] = [];
    let firstSeen = false;

    const collect = (frag: { content?: string }) => {
      if (!frag.content) return;
      if (!firstSeen) {
        firstSeen = true;
      }
      fragments.push(frag.content);
    };

    const opts: LMStudioRespondOpts = {
      temperature: req.temperature,
      maxTokens: req.maxTokens,
      signal: req.signal,
      draftModel: req.draftModelId,
      structured: req.structuredSchema,
      onPredictionFragment: collect,
      onFirstToken: () => {
        firstSeen = true;
      },
    };

    try {
      const promise = model.respond(chat, opts);
      // Yield fragments as they arrive — SDK invokes callbacks synchronously during the await.
      // Poll the fragments array between microtasks until promise resolves.
      let consumed = 0;
      let done = false;
      let result: { content: string; stats?: LMStudioStats } | null = null;
      let err: unknown = null;
      promise
        .then((r) => {
          result = r as { content: string; stats?: LMStudioStats };
          done = true;
        })
        .catch((e) => {
          err = e;
          done = true;
        });
      if (firstSeen) yield { type: "first-token" };
      while (!done) {
        await new Promise((r) => setTimeout(r, 5));
        if (firstSeen && consumed === 0) yield { type: "first-token" };
        while (consumed < fragments.length) {
          yield { type: "text", delta: fragments[consumed++] };
        }
      }
      while (consumed < fragments.length)
        yield { type: "text", delta: fragments[consumed++] };
      if (err) {
        const msg = err instanceof Error ? err.message : String(err);
        yield {
          type: "done",
          reason: req.signal?.aborted ? "aborted" : "failed",
          error: msg,
        };
        return;
      }
      const finalStats = (result as { stats?: LMStudioStats } | null)?.stats;
      yield { type: "done", reason: "end", stats: finalStats };
    } catch (e) {
      yield {
        type: "done",
        reason: req.signal?.aborted ? "aborted" : "failed",
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async getHandle(modelId: string): Promise<LMStudioLlmHandle> {
    return this.client.llm.model(modelId);
  }

  private toSdkChat(messages: ChatMessage[]): unknown {
    // SDK accepts either: string | ChatLike (an array of role/content pairs) | Chat instance.
    // The array shape works in v1.x and is forward-compatible.
    return messages.map((m) => {
      if (!m.images || m.images.length === 0) {
        return { role: m.role, content: m.content };
      }
      return {
        role: m.role,
        content: [
          { type: "text", text: m.content },
          ...m.images.map((img) => ({
            type: "image",
            image: img.base64,
            mimeType: img.mimeType ?? "image/png",
          })),
        ],
      };
    });
  }
}
