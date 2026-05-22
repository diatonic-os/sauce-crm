// SPEC §19.1 (Custom OpenAI-compatible) — LM Studio surface.
// LM Studio exposes an OpenAI-compatible API at http://localhost:1234/v1 by default.
// Tool-use is supported by recent LM Studio builds via the OpenAI function-calling schema.
import type { CompletionEvent, CompletionRequest, ICopilotProvider, ModelDescriptor, ProviderCapabilities, ProviderHost } from './ICopilotProvider';

export interface LMStudioConfig {
  endpoint: string;          // base URL, e.g. 'http://localhost:1234/v1'
  apiKey?: string;           // optional — LM Studio ignores by default, present for compat
  defaultModel?: string;
  toolUse?: boolean;         // user-toggle; not all loaded models support it
}

export class LMStudioProvider implements ICopilotProvider {
  readonly name = 'lmstudio';
  models: ModelDescriptor[] = [];
  private cfg: LMStudioConfig;

  constructor(private readonly host: ProviderHost, cfg: Partial<LMStudioConfig> = {}) {
    this.cfg = {
      endpoint: cfg.endpoint ?? 'http://localhost:1234/v1',
      apiKey: cfg.apiKey,
      defaultModel: cfg.defaultModel,
      toolUse: cfg.toolUse ?? false,
    };
  }

  setConfig(cfg: Partial<LMStudioConfig>): void {
    this.cfg = { ...this.cfg, ...cfg };
    if (!this.cfg.endpoint) this.cfg.endpoint = 'http://localhost:1234/v1';
  }
  getConfig(): LMStudioConfig { return { ...this.cfg }; }

  capabilities(): ProviderCapabilities {
    return { toolUse: !!this.cfg.toolUse, streaming: true, vision: false, maxContext: 32_768 };
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'content-type': 'application/json' };
    if (this.cfg.apiKey) h.authorization = `Bearer ${this.cfg.apiKey}`;
    return h;
  }

  async refreshModels(): Promise<void> {
    const r = await this.host.fetch(`${this.cfg.endpoint.replace(/\/$/, '')}/models`, { method: 'GET', headers: this.headers() }).catch(() => null);
    if (!r || r.status >= 400) return;
    try {
      const j = JSON.parse(r.body) as { data: Array<{ id: string }> };
      this.models = j.data.map((m) => ({ id: m.id, label: m.id, contextTokens: 32_768 }));
    } catch { /* keep prior */ }
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      const r = await this.host.fetch(`${this.cfg.endpoint.replace(/\/$/, '')}/models`, { method: 'GET', headers: this.headers() });
      return { ok: r.status < 400, latencyMs: Date.now() - start, error: r.status >= 400 ? `HTTP ${r.status}` : undefined };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async *complete(req: CompletionRequest): AsyncIterable<CompletionEvent> {
    const messages = req.systemPrompt
      ? [{ role: 'system' as const, content: req.systemPrompt }, ...req.messages]
      : req.messages;
    const body: Record<string, unknown> = {
      model: req.model || this.cfg.defaultModel || 'local-model',
      messages: messages.map((m) => ({ role: m.role === 'tool' ? 'tool' : m.role, content: m.content, tool_call_id: m.toolCallId })),
      temperature: req.temperature ?? 0.7,
      max_tokens: req.maxTokens ?? 4096,
    };
    if (this.cfg.toolUse && req.tools?.length) {
      body.tools = req.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
    }
    const resp = await this.host.fetch(`${this.cfg.endpoint.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST', headers: this.headers(), body: JSON.stringify(body),
    });
    if (resp.status >= 400) { yield { type: 'done', reason: 'error', error: resp.body }; return; }
    type R = { choices: Array<{ message: { content: string | null; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }; finish_reason: string }>; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    const j = JSON.parse(resp.body) as R;
    const choice = j.choices[0];
    if (choice.message.content) yield { type: 'text', delta: choice.message.content };
    for (const tc of choice.message.tool_calls ?? []) {
      try { yield { type: 'tool_use', id: tc.id, name: tc.function.name, input: JSON.parse(tc.function.arguments) }; }
      catch { yield { type: 'tool_use', id: tc.id, name: tc.function.name, input: { _raw: tc.function.arguments } }; }
    }
    yield { type: 'usage', inputTokens: j.usage?.prompt_tokens ?? 0, outputTokens: j.usage?.completion_tokens ?? 0 };
    yield { type: 'done', reason: choice.finish_reason === 'tool_calls' ? 'tool_use' : choice.finish_reason === 'stop' ? 'end_turn' : 'stop' };
  }

  async embed(text: string, model: string): Promise<Float32Array> {
    const r = await this.host.fetch(`${this.cfg.endpoint.replace(/\/$/, '')}/embeddings`, {
      method: 'POST', headers: this.headers(),
      body: JSON.stringify({ model, input: text }),
    });
    if (r.status >= 400) throw new Error(r.body);
    const j = JSON.parse(r.body) as { data: Array<{ embedding: number[] }> };
    return new Float32Array(j.data[0].embedding);
  }
}
