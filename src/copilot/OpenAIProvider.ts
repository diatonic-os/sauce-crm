// SPEC §19.1 — OpenAI ChatCompletions + function-calling + embeddings.
import type {
  CompletionEvent,
  CompletionRequest,
  ICopilotProvider,
  ModelDescriptor,
  ProviderCapabilities,
  ProviderHost,
} from "./ICopilotProvider";
import { parseSse } from "./StreamParsers";

const MODELS: ModelDescriptor[] = [
  { id: "gpt-4o", label: "GPT-4o", contextTokens: 128_000, vision: true },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    contextTokens: 128_000,
    vision: true,
  },
];

export class OpenAIProvider implements ICopilotProvider {
  readonly name = "openai";
  readonly models = MODELS;
  constructor(
    private readonly host: ProviderHost,
    private readonly apiKey: () => Promise<string>,
    private readonly baseUrl = "https://api.openai.com/v1",
  ) {}
  capabilities(): ProviderCapabilities {
    return {
      toolUse: true,
      streaming: true,
      vision: true,
      maxContext: 128_000,
    };
  }

  async *complete(req: CompletionRequest): AsyncIterable<CompletionEvent> {
    const key = await this.apiKey();
    const messages = req.systemPrompt
      ? [
          { role: "system" as const, content: req.systemPrompt },
          ...req.messages,
        ]
      : req.messages;
    const body: Record<string, unknown> = {
      model: req.model,
      messages: messages.map((m) => ({
        role: m.role === "tool" ? "tool" : m.role,
        content: m.content,
        tool_call_id: m.toolCallId,
      })),
      tools: req.tools?.map((t) => ({
        type: "function",
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      })),
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? 4096,
    };

    // ---- Streaming branch (SSE, OpenAI shape — identical to LM Studio) ---------
    if (req.stream && this.host.fetchStream) {
      body.stream = true;
      body.stream_options = { include_usage: true };
      try {
        const resp = await this.host.fetchStream(
          `${this.baseUrl}/chat/completions`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${key}`,
              "content-type": "application/json",
              accept: "text/event-stream",
            },
            body: JSON.stringify(body),
          },
        );
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
        yield {
          type: "done",
          reason:
            finishReason === "tool_calls"
              ? "tool_use"
              : finishReason === "stop"
                ? "end_turn"
                : "stop",
        };
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

    const resp = await this.host.fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
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
      usage: { prompt_tokens: number; completion_tokens: number };
    };
    const json = JSON.parse(resp.body) as R;
    const choice = json.choices[0];
    if (choice.message.content)
      yield { type: "text", delta: choice.message.content };
    for (const tc of choice.message.tool_calls ?? []) {
      yield {
        type: "tool_use",
        id: tc.id,
        name: tc.function.name,
        input: JSON.parse(tc.function.arguments),
      };
    }
    yield {
      type: "usage",
      inputTokens: json.usage.prompt_tokens,
      outputTokens: json.usage.completion_tokens,
    };
    yield {
      type: "done",
      reason:
        choice.finish_reason === "tool_calls"
          ? "tool_use"
          : choice.finish_reason === "stop"
            ? "end_turn"
            : "stop",
    };
  }

  async embed(text: string, model: string): Promise<Float32Array> {
    const key = await this.apiKey();
    const resp = await this.host.fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ model, input: text }),
    });
    if (resp.status >= 400) throw new Error(resp.body);
    const j = JSON.parse(resp.body) as { data: Array<{ embedding: number[] }> };
    return new Float32Array(j.data[0].embedding);
  }
}
