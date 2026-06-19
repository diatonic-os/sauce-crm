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
  ISauceBotProvider,
  ModelDescriptor,
  ProviderCapabilities,
  ProviderHost,
} from "./ISauceBotProvider";
import { parseSse } from "./StreamParsers";
import { parseToolArgs, extractTextToolCalls } from "./LocalToolParse";

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

export class OpenAICompatibleProvider implements ISauceBotProvider {
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
          // Reasoning models (qwen3 / deepseek-r1 via LM Studio, etc.) stream
          // their thinking here; some emit ONLY this until the final content.
          reasoning_content?: string | null;
          reasoning?: string | null;
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
        // Accumulate streamed text so we can salvage a text-embedded tool call
        // (local models often "speak" the call instead of emitting tool_calls).
        let streamedText = "";
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
            const reasoning = d?.reasoning_content ?? d?.reasoning;
            if (reasoning) yield { type: "reasoning", delta: reasoning };
            if (d?.content) {
              streamedText += d.content;
              yield { type: "text", delta: d.content };
            }
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
        let emittedToolCall = false;
        for (const tc of toolBuf.values()) {
          if (!tc.name) continue; // index buffer with no name → not a real call
          emittedToolCall = true;
          // Tolerant parse: fence-stripped / repaired / partial JSON args. A
          // small local model that emits `{path: x}` or a fenced block no
          // longer dead-ends the turn (it used to fall to `{_raw}` and fail).
          yield {
            type: "tool_use",
            id: tc.id,
            name: tc.name,
            input: parseToolArgs(tc.args),
          };
        }
        // Salvage: when the model produced NO structured tool_calls but spoke a
        // call in plain text (a very common local-model failure), recover it so
        // the loop can still execute the tool instead of treating the call as a
        // final answer. Only matches registered tool names.
        if (!emittedToolCall && streamedText) {
          const known = (req.tools ?? []).map((t) => t.name);
          const textCalls = extractTextToolCalls(streamedText, known);
          for (let i = 0; i < textCalls.length; i++) {
            const c = textCalls[i]!;
            emittedToolCall = true;
            yield {
              type: "tool_use",
              id: `text_call_${i}`,
              name: c.name,
              input: c.input,
            };
          }
          if (emittedToolCall && finishReason === "stop")
            finishReason = "tool_calls";
        }
        yield {
          type: "usage",
          inputTokens: usage?.prompt_tokens ?? 0,
          outputTokens: usage?.completion_tokens ?? 0,
        };
        yield { type: "done", reason: mapFinish(finishReason) };
        return;
      } catch {
        // Streaming connection failed. The common cause inside Obsidian/Electron
        // is CORS: native fetch() from the app://obsidian.md origin is blocked
        // against a local http endpoint (LM Studio / Ollama), even though the
        // server is up. Rather than error out, fall through to the batch path,
        // which uses Obsidian's requestUrl — a CORS-bypassing net request. We
        // lose token streaming but the request actually works. No partial text
        // was emitted (the throw is connection-level), so there is no dup risk.
        delete body.stream;
        delete body.stream_options;
        // fall through to batch ↓
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
          reasoning_content?: string | null;
          reasoning?: string | null;
          tool_calls?: Array<{
            id: string;
            function: { name: string; arguments: string };
          }>;
        };
        finish_reason: string;
      }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    let j: R;
    try {
      j = JSON.parse(resp.body) as R;
    } catch {
      yield {
        type: "done",
        reason: "error",
        error: `non-JSON response (HTTP ${resp.status}): ${resp.body.slice(0, 200)}`,
      };
      return;
    }
    // Guard the ARRAY, not just the element: a malformed/error body (e.g. wrong
    // endpoint missing /v1) parses without `choices`, and `j.choices[0]` would
    // throw "reading '0'". Surface it as a graceful error instead of crashing.
    if (!Array.isArray(j.choices)) {
      yield {
        type: "done",
        reason: "error",
        error: `unexpected response (no choices): ${resp.body.slice(0, 200)}`,
      };
      return;
    }
    const choice = j.choices[0];
    if (choice === undefined) {
      yield { type: "done", reason: "stop" };
      return;
    }
    const batchReasoning =
      choice.message.reasoning_content ?? choice.message.reasoning;
    if (batchReasoning) yield { type: "reasoning", delta: batchReasoning };
    if (choice.message.content)
      yield { type: "text", delta: choice.message.content };
    let batchFinish = choice.finish_reason;
    let emittedBatchCall = false;
    for (const tc of choice.message.tool_calls ?? []) {
      if (!tc.function?.name) continue;
      emittedBatchCall = true;
      // Tolerant arg parse (fence/repair/partial) — see streaming branch.
      yield {
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input: parseToolArgs(tc.function.arguments),
      };
    }
    // Text-embedded tool-call salvage for local models (see streaming branch).
    if (!emittedBatchCall && choice.message.content) {
      const known = (req.tools ?? []).map((t) => t.name);
      const textCalls = extractTextToolCalls(choice.message.content, known);
      for (let i = 0; i < textCalls.length; i++) {
        const c = textCalls[i]!;
        emittedBatchCall = true;
        yield {
          type: "tool_use",
          id: `text_call_${i}`,
          name: c.name,
          input: c.input,
        };
      }
      if (emittedBatchCall && batchFinish === "stop") batchFinish = "tool_calls";
    }
    yield {
      type: "usage",
      inputTokens: j.usage?.prompt_tokens ?? 0,
      outputTokens: j.usage?.completion_tokens ?? 0,
    };
    yield { type: "done", reason: mapFinish(batchFinish) };
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
    let j: { data?: Array<{ embedding: number[] }> };
    try {
      j = JSON.parse(resp.body) as { data?: Array<{ embedding: number[] }> };
    } catch {
      throw new Error(
        `${this.name} embeddings: non-JSON response: ${resp.body.slice(0, 200)}`,
      );
    }
    const first = j.data?.[0];
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
