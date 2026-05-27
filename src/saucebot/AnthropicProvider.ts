// SPEC §19.1 — Anthropic Messages API. Defaults to claude-opus-4-7.
import type {
  CompletionEvent,
  CompletionRequest,
  ISauceBotProvider,
  ModelDescriptor,
  ProviderCapabilities,
  ProviderHost,
} from "./ISauceBotProvider";
import { parseSse } from "./StreamParsers";

const MODELS: ModelDescriptor[] = [
  {
    id: "claude-opus-4-7",
    label: "Claude Opus 4.7",
    contextTokens: 1_000_000,
    vision: true,
  },
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    contextTokens: 1_000_000,
    vision: true,
  },
  {
    id: "claude-haiku-4-5-20251001",
    label: "Claude Haiku 4.5",
    contextTokens: 200_000,
    vision: true,
  },
];

export class AnthropicProvider implements ISauceBotProvider {
  readonly name = "anthropic";
  readonly models = MODELS;
  constructor(
    private readonly host: ProviderHost,
    private readonly apiKey: () => Promise<string>,
    private readonly baseUrl = "https://api.anthropic.com/v1",
  ) {}
  capabilities(): ProviderCapabilities {
    return {
      toolUse: true,
      streaming: true,
      vision: true,
      maxContext: 1_000_000,
    };
  }

  async *complete(req: CompletionRequest): AsyncIterable<CompletionEvent> {
    const key = await this.apiKey();
    const body: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.7,
      system: req.systemPrompt,
      messages: req.messages.map((m) => ({
        role: m.role === "tool" ? "user" : m.role,
        content: m.content,
      })),
      tools: req.tools?.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema,
      })),
      stream: false,
    };

    // ---- Streaming branch ------------------------------------------------------
    // Anthropic's Messages stream is true SSE with `event:` + `data:` lines.
    // Event taxonomy:
    //   message_start                    → {message:{usage:{input_tokens}}}
    //   content_block_start              → {index, content_block:{type:'text'|'tool_use', id?, name?}}
    //   content_block_delta              → {index, delta:{type:'text_delta'|'input_json_delta', text?, partial_json?}}
    //   content_block_stop               → {index}
    //   message_delta                    → {delta:{stop_reason}, usage:{output_tokens}}
    //   message_stop                     → end
    if (req.stream && this.host.fetchStream) {
      body.stream = true;
      try {
        const resp = await this.host.fetchStream(`${this.baseUrl}/messages`, {
          method: "POST",
          headers: {
            "x-api-key": key,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
            accept: "text/event-stream",
          },
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
        // index → buffered tool_use (id, name, accumulated JSON string).
        const toolBuf = new Map<
          number,
          { id: string; name: string; args: string }
        >();
        let inputTokens = 0;
        let outputTokens = 0;
        let stopReason: string | null = null;
        try {
          for await (const evt of parseSse(resp.iter)) {
            let payload: {
              index?: number;
              message?: { usage?: { input_tokens?: number } };
              content_block?: { type?: string; id?: unknown; name?: unknown };
              delta?: {
                type?: string;
                text?: string;
                partial_json?: string;
                stop_reason?: string;
              };
              usage?: { output_tokens?: number };
            };
            try {
              payload = JSON.parse(evt.data) as typeof payload;
            } catch {
              continue;
            }
            switch (evt.event) {
              case "message_start":
                inputTokens = payload?.message?.usage?.input_tokens ?? 0;
                break;
              case "content_block_start": {
                const cb = payload?.content_block;
                if (cb?.type === "tool_use") {
                  toolBuf.set(payload.index ?? -1, {
                    id: String(cb.id ?? ""),
                    name: String(cb.name ?? ""),
                    args: "",
                  });
                }
                break;
              }
              case "content_block_delta": {
                const d = payload?.delta;
                if (d?.type === "text_delta" && typeof d.text === "string") {
                  yield { type: "text", delta: d.text };
                } else if (
                  d?.type === "input_json_delta" &&
                  typeof d.partial_json === "string"
                ) {
                  const cur = toolBuf.get(payload.index ?? -1);
                  if (cur) cur.args += d.partial_json;
                }
                break;
              }
              case "message_delta":
                if (payload?.delta?.stop_reason)
                  stopReason = payload.delta.stop_reason;
                if (payload?.usage?.output_tokens != null)
                  outputTokens = payload.usage.output_tokens;
                break;
              case "message_stop":
              case "content_block_stop":
              default:
                break;
            }
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
              input: tc.args ? JSON.parse(tc.args) : {},
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
        yield { type: "usage", inputTokens, outputTokens };
        yield {
          type: "done",
          reason:
            stopReason === "tool_use"
              ? "tool_use"
              : stopReason === "end_turn"
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

    const resp = await this.host.fetch(`${this.baseUrl}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (resp.status >= 400) {
      yield { type: "done", reason: "error", error: resp.body };
      return;
    }
    type R = {
      content: Array<{
        type: "text" | "tool_use";
        text?: string;
        id?: string;
        name?: string;
        input?: unknown;
      }>;
      usage: { input_tokens: number; output_tokens: number };
      stop_reason: string;
    };
    const json = JSON.parse(resp.body) as R;
    for (const c of json.content) {
      if (c.type === "text" && c.text) yield { type: "text", delta: c.text };
      else if (c.type === "tool_use")
        yield { type: "tool_use", id: c.id!, name: c.name!, input: c.input };
    }
    yield {
      type: "usage",
      inputTokens: json.usage.input_tokens,
      outputTokens: json.usage.output_tokens,
    };
    yield {
      type: "done",
      reason:
        json.stop_reason === "tool_use"
          ? "tool_use"
          : json.stop_reason === "end_turn"
            ? "end_turn"
            : "stop",
    };
  }

  async embed(_text: string, _model: string): Promise<Float32Array> {
    throw new Error(
      "Anthropic does not provide an embeddings endpoint; configure OpenAI or Ollama for embeddings.",
    );
  }
}
