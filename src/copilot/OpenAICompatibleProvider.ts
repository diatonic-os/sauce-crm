// SPEC §19.1 / CON-SAUCEBOT S1 — shared OpenAI-compatible harness.
//
// OpenAIProvider, LMStudioProvider (REST), and every cloud OpenAI-compatible
// endpoint (nim, openrouter, groq, gemini's /v1beta/openai shim) are ~90%
// identical: the same ChatCompletions body builder, the same index-keyed SSE
// `tool_calls` accumulation loop, the same batch fallback, the same
// finish-reason map, and the same `/embeddings` shape. This class is that one
// implementation. The only things that vary between configs are the base URL,
// whether an auth header is sent, whether tool-use / embeddings are supported,
// and the default model — all parameterized via `OpenAICompatSpec`.
//
// Subclasses (OpenAIProvider / LMStudioProvider) keep their historical
// constructors and extra surface (setConfig / refreshModels / ping / dynamic
// tool-use) by overriding the small protected hooks below; all streaming and
// batch logic lives here, in one place.

import type {
  CompletionEvent,
  CompletionRequest,
  ICopilotProvider,
  ModelDescriptor,
  ProviderCapabilities,
  ProviderHost,
} from "./ICopilotProvider";
import { parseSse } from "./StreamParsers";

export interface OpenAICompatSpec {
  /** Provider id (matches the registry id), surfaced as `name`. */
  name: string;
  /** Base URL including `/v1` (e.g. `https://api.openai.com/v1`). */
  baseUrl: string;
  /** Bearer-token getter; absent ⇒ no auth header (local endpoints). */
  apiKey?: () => Promise<string | undefined>;
  /** `"none"` forces no auth header even when an apiKey getter is present. */
  authHeader?: "bearer" | "none";
  /** Pre-selected model when `req.model` is empty. */
  defaultModel?: string;
  /** Whether tool/function-calling is sent + advertised. Default true. */
  supportsToolUse?: boolean;
  /** Whether `/embeddings` is available. Default true. */
  supportsEmbeddings?: boolean;
  staticModels?: ModelDescriptor[];
  maxContext?: number;
  vision?: boolean;
}

export class OpenAICompatibleProvider implements ICopilotProvider {
  readonly name: string;
  models: ModelDescriptor[];

  constructor(
    protected readonly host: ProviderHost,
    protected spec: OpenAICompatSpec,
  ) {
    this.name = spec.name;
    this.models = spec.staticModels ?? [];
  }

  capabilities(): ProviderCapabilities {
    return {
      toolUse: this.supportsToolUse(),
      streaming: true,
      vision: this.spec.vision ?? false,
      maxContext: this.spec.maxContext ?? 128_000,
    };
  }

  /** The resolved chat/embeddings base URL (trailing-slash normalized). */
  get endpoint(): string {
    return this.base();
  }

  // ── Overridable hooks (the only per-provider differences) ───────────────
  protected supportsToolUse(): boolean {
    return this.spec.supportsToolUse ?? true;
  }
  protected supportsEmbeddings(): boolean {
    return this.spec.supportsEmbeddings ?? true;
  }
  /** Base URL with trailing slashes stripped (so `${base}/chat/completions`). */
  protected base(): string {
    return this.spec.baseUrl.replace(/\/+$/, "");
  }
  protected modelOf(req: CompletionRequest): string {
    return req.model || this.spec.defaultModel || "local-model";
  }
  /** Whether to attach `tools` to this request. */
  protected sendTools(req: CompletionRequest): boolean {
    return this.supportsToolUse() && !!req.tools?.length;
  }
  /** Request headers, resolving the bearer token when configured. */
  protected async headers(): Promise<Record<string, string>> {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.spec.authHeader === "none") return h;
    const key = this.spec.apiKey ? await this.spec.apiKey() : undefined;
    if (key) h.authorization = `Bearer ${key}`;
    return h;
  }

  protected buildBody(req: CompletionRequest): Record<string, unknown> {
    const messages = req.systemPrompt
      ? [
          { role: "system" as const, content: req.systemPrompt },
          ...req.messages,
        ]
      : req.messages;
    const body: Record<string, unknown> = {
      model: this.modelOf(req),
      messages: messages.map((m) => ({
        role: m.role === "tool" ? "tool" : m.role,
        content: m.content,
        tool_call_id: m.toolCallId,
      })),
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? 4096,
    };
    if (this.sendTools(req)) {
      body.tools = req.tools!.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }));
    }
    return body;
  }

  async *complete(req: CompletionRequest): AsyncIterable<CompletionEvent> {
    const url = `${this.base()}/chat/completions`;
    const body = this.buildBody(req);

    // ---- Streaming branch (OpenAI-shape SSE) ---------------------------------
    if (req.stream && this.host.fetchStream) {
      body.stream = true;
      body.stream_options = { include_usage: true };
      try {
        const resp = await this.host.fetchStream(url, {
          method: "POST",
          headers: { ...(await this.headers()), accept: "text/event-stream" },
          body: JSON.stringify(body),
        });
        if (resp.status >= 400) {
          let err = "";
          for await (const c of resp.iter) {
            err += c;
            if (err.length > 4096) break;
          }
          yield {
            type: "done",
            reason: "error",
            error: err || `HTTP ${resp.status}`,
          };
          return;
        }
        type Delta = {
          content?: string | null;
          tool_calls?: Array<{
            index?: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }>;
        };
        type Chunk = {
          choices?: Array<{ delta?: Delta; finish_reason?: string | null }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number };
        };
        const toolBuf = new Map<
          number,
          { id: string; name: string; args: string }
        >();
        let finishReason: string | null = null;
        let usage:
          | { prompt_tokens?: number; completion_tokens?: number }
          | undefined;
        try {
          for await (const evt of parseSse(resp.iter)) {
            let parsed: Chunk;
            try {
              parsed = JSON.parse(evt.data) as Chunk;
            } catch {
              continue;
            }
            if (parsed.usage) usage = parsed.usage;
            const choice = parsed.choices?.[0];
            if (!choice) continue;
            const d = choice.delta;
            if (d?.content) yield { type: "text", delta: d.content };
            if (d?.tool_calls) {
              for (const tc of d.tool_calls) {
                const idx = tc.index ?? 0;
                const cur = toolBuf.get(idx) ?? { id: "", name: "", args: "" };
                if (tc.id) cur.id = tc.id;
                if (tc.function?.name) cur.name = tc.function.name;
                if (tc.function?.arguments) cur.args += tc.function.arguments;
                toolBuf.set(idx, cur);
              }
            }
            if (choice.finish_reason) finishReason = choice.finish_reason;
          }
        } catch (e) {
          yield {
            type: "done",
            reason: "error",
            error: e instanceof Error ? e.message : String(e),
          };
          return;
        }
        for (const tc of toolBuf.values()) {
          try {
            yield {
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: JSON.parse(tc.args || "{}"),
            };
          } catch {
            yield {
              type: "tool_use",
              id: tc.id,
              name: tc.name,
              input: { _raw: tc.args },
            };
          }
        }
        yield {
          type: "usage",
          inputTokens: usage?.prompt_tokens ?? 0,
          outputTokens: usage?.completion_tokens ?? 0,
        };
        yield { type: "done", reason: mapFinish(finishReason) };
        return;
      } catch (e) {
        yield {
          type: "done",
          reason: "error",
          error: e instanceof Error ? e.message : String(e),
        };
        return;
      }
    }

    // ---- Batch fallback (no streaming) ---------------------------------------
    const resp = await this.host.fetch(url, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify(body),
    });
    if (resp.status >= 400) {
      yield { type: "done", reason: "error", error: resp.body };
      return;
    }
    type R = {
      choices: Array<{
        message: {
          content: string | null;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
        finish_reason: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const j = JSON.parse(resp.body) as R;
    const choice = j.choices[0];
    if (choice === undefined) {
      yield { type: "done", reason: "stop" };
      return;
    }
    if (choice.message.content)
      yield { type: "text", delta: choice.message.content };
    for (const tc of choice.message.tool_calls ?? []) {
      try {
        yield {
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: JSON.parse(tc.function.arguments),
        };
      } catch {
        yield {
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: { _raw: tc.function.arguments },
        };
      }
    }
    yield {
      type: "usage",
      inputTokens: j.usage?.prompt_tokens ?? 0,
      outputTokens: j.usage?.completion_tokens ?? 0,
    };
    yield { type: "done", reason: mapFinish(choice.finish_reason) };
  }

  async embed(text: string, model: string): Promise<Float32Array> {
    if (!this.supportsEmbeddings())
      throw new Error(`${this.name} does not provide an embeddings endpoint.`);
    const resp = await this.host.fetch(`${this.base()}/embeddings`, {
      method: "POST",
      headers: await this.headers(),
      body: JSON.stringify({ model, input: text }),
    });
    if (resp.status >= 400) throw new Error(resp.body);
    const j = JSON.parse(resp.body) as { data: Array<{ embedding: number[] }> };
    const first = j.data[0];
    if (first === undefined)
      throw new Error(`${this.name} embeddings response contains no data`);
    return new Float32Array(first.embedding);
  }
}

/** Map an OpenAI `finish_reason` to the normalized CompletionEvent done reason. */
function mapFinish(reason: string | null): "tool_use" | "end_turn" | "stop" {
  if (reason === "tool_calls") return "tool_use";
  if (reason === "stop") return "end_turn";
  return "stop";
}
