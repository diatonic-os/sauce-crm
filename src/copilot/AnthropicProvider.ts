// SPEC §19.1 — Anthropic Messages API. Defaults to claude-opus-4-7.
import type { CompletionEvent, CompletionRequest, ICopilotProvider, ModelDescriptor, ProviderCapabilities, ProviderHost } from './ICopilotProvider';

const MODELS: ModelDescriptor[] = [
  { id: 'claude-opus-4-7', label: 'Claude Opus 4.7', contextTokens: 1_000_000, vision: true },
  { id: 'claude-sonnet-4-6', label: 'Claude Sonnet 4.6', contextTokens: 1_000_000, vision: true },
  { id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5', contextTokens: 200_000, vision: true },
];

export class AnthropicProvider implements ICopilotProvider {
  readonly name = 'anthropic';
  readonly models = MODELS;
  constructor(private readonly host: ProviderHost, private readonly apiKey: () => Promise<string>, private readonly baseUrl = 'https://api.anthropic.com/v1') {}
  capabilities(): ProviderCapabilities { return { toolUse: true, streaming: true, vision: true, maxContext: 1_000_000 }; }

  async *complete(req: CompletionRequest): AsyncIterable<CompletionEvent> {
    const key = await this.apiKey();
    const body = {
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      temperature: req.temperature ?? 0.7,
      system: req.systemPrompt,
      messages: req.messages.map((m) => ({ role: m.role === 'tool' ? 'user' : m.role, content: m.content })),
      tools: req.tools?.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema })),
      stream: false,
    };
    const resp = await this.host.fetch(`${this.baseUrl}/messages`, {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (resp.status >= 400) { yield { type: 'done', reason: 'error', error: resp.body }; return; }
    type R = { content: Array<{ type: 'text' | 'tool_use'; text?: string; id?: string; name?: string; input?: unknown }>; usage: { input_tokens: number; output_tokens: number }; stop_reason: string };
    const json = JSON.parse(resp.body) as R;
    for (const c of json.content) {
      if (c.type === 'text' && c.text) yield { type: 'text', delta: c.text };
      else if (c.type === 'tool_use') yield { type: 'tool_use', id: c.id!, name: c.name!, input: c.input };
    }
    yield { type: 'usage', inputTokens: json.usage.input_tokens, outputTokens: json.usage.output_tokens };
    yield { type: 'done', reason: json.stop_reason === 'tool_use' ? 'tool_use' : json.stop_reason === 'end_turn' ? 'end_turn' : 'stop' };
  }

  async embed(_text: string, _model: string): Promise<Float32Array> {
    throw new Error('Anthropic does not provide an embeddings endpoint; configure OpenAI or Ollama for embeddings.');
  }
}
