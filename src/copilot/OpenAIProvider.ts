// SPEC §19.1 — OpenAI ChatCompletions + function-calling + embeddings.
import type { CompletionEvent, CompletionRequest, ICopilotProvider, ModelDescriptor, ProviderCapabilities, ProviderHost } from './ICopilotProvider';

const MODELS: ModelDescriptor[] = [
  { id: 'gpt-4o', label: 'GPT-4o', contextTokens: 128_000, vision: true },
  { id: 'gpt-4o-mini', label: 'GPT-4o mini', contextTokens: 128_000, vision: true },
];

export class OpenAIProvider implements ICopilotProvider {
  readonly name = 'openai';
  readonly models = MODELS;
  constructor(private readonly host: ProviderHost, private readonly apiKey: () => Promise<string>, private readonly baseUrl = 'https://api.openai.com/v1') {}
  capabilities(): ProviderCapabilities { return { toolUse: true, streaming: true, vision: true, maxContext: 128_000 }; }

  async *complete(req: CompletionRequest): AsyncIterable<CompletionEvent> {
    const key = await this.apiKey();
    const messages = req.systemPrompt
      ? [{ role: 'system' as const, content: req.systemPrompt }, ...req.messages]
      : req.messages;
    const body = {
      model: req.model,
      messages: messages.map((m) => ({ role: m.role === 'tool' ? 'tool' : m.role, content: m.content, tool_call_id: m.toolCallId })),
      tools: req.tools?.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } })),
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? 4096,
    };
    const resp = await this.host.fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (resp.status >= 400) { yield { type: 'done', reason: 'error', error: resp.body }; return; }
    type R = { choices: Array<{ message: { content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }; finish_reason: string }>; usage: { prompt_tokens: number; completion_tokens: number } };
    const json = JSON.parse(resp.body) as R;
    const choice = json.choices[0];
    if (choice.message.content) yield { type: 'text', delta: choice.message.content };
    for (const tc of choice.message.tool_calls ?? []) {
      yield { type: 'tool_use', id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments) };
    }
    yield { type: 'usage', inputTokens: json.usage.prompt_tokens, outputTokens: json.usage.completion_tokens };
    yield { type: 'done', reason: choice.finish_reason === 'tool_calls' ? 'tool_use' : choice.finish_reason === 'stop' ? 'end_turn' : 'stop' };
  }

  async embed(text: string, model: string): Promise<Float32Array> {
    const key = await this.apiKey();
    const resp = await this.host.fetch(`${this.baseUrl}/embeddings`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model, input: text }),
    });
    if (resp.status >= 400) throw new Error(resp.body);
    const j = JSON.parse(resp.body) as { data: Array<{ embedding: number[] }> };
    return new Float32Array(j.data[0].embedding);
  }
}
