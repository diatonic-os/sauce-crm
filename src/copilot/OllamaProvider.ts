// SPEC §19.1 — Ollama local. Endpoint defaults to http://localhost:11434 but is configurable;
// optional bearer token for reverse-proxied setups (Caddy/Nginx with auth).
import type { CompletionEvent, CompletionRequest, ICopilotProvider, ModelDescriptor, ProviderCapabilities, ProviderHost } from './ICopilotProvider';

export interface OllamaConfig {
  endpoint: string;          // e.g. 'http://localhost:11434' or 'https://ollama.internal'
  apiKey?: string;           // optional — bearer-style auth in front of Ollama
  defaultModel?: string;     // pre-selected when no req.model
}

export class OllamaProvider implements ICopilotProvider {
  readonly name = 'ollama';
  models: ModelDescriptor[] = [];
  private cfg: OllamaConfig;

  constructor(private readonly host: ProviderHost, cfgOrBaseUrl: Partial<OllamaConfig> | string = {}) {
    // Backwards compat: V1 callers pass a string baseUrl as the second arg; V2 callers pass a config object.
    const cfg: Partial<OllamaConfig> = typeof cfgOrBaseUrl === 'string' ? { endpoint: cfgOrBaseUrl } : cfgOrBaseUrl;
    this.cfg = { endpoint: cfg.endpoint ?? 'http://localhost:11434', apiKey: cfg.apiKey, defaultModel: cfg.defaultModel };
  }

  setConfig(cfg: Partial<OllamaConfig>): void {
    this.cfg = { ...this.cfg, ...cfg };
    if (!this.cfg.endpoint) this.cfg.endpoint = 'http://localhost:11434';
  }
  getConfig(): OllamaConfig { return { ...this.cfg }; }

  capabilities(): ProviderCapabilities { return { toolUse: false, streaming: true, vision: false, maxContext: 32_768 }; }

  private authHeaders(): Record<string, string> {
    return this.cfg.apiKey ? { authorization: `Bearer ${this.cfg.apiKey}` } : {};
  }

  async refreshModels(): Promise<void> {
    const r = await this.host.fetch(`${this.cfg.endpoint}/api/tags`, { method: 'GET', headers: this.authHeaders() }).catch(() => null);
    if (!r || r.status >= 400) return;
    const j = JSON.parse(r.body) as { models: Array<{ name: string; size?: number }> };
    this.models = j.models.map((m) => ({ id: m.name, label: m.name, contextTokens: 32_768 }));
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      const r = await this.host.fetch(`${this.cfg.endpoint}/api/tags`, { method: 'GET', headers: this.authHeaders() });
      return { ok: r.status < 400, latencyMs: Date.now() - start, error: r.status >= 400 ? `HTTP ${r.status}` : undefined };
    } catch (e) {
      return { ok: false, latencyMs: Date.now() - start, error: e instanceof Error ? e.message : String(e) };
    }
  }

  async *complete(req: CompletionRequest): AsyncIterable<CompletionEvent> {
    const messages = req.systemPrompt ? [{ role: 'system', content: req.systemPrompt }, ...req.messages] : req.messages;
    const body = {
      model: req.model || this.cfg.defaultModel || 'llama3',
      messages: messages.map((m) => ({ role: m.role === 'tool' ? 'user' : m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) })),
      options: { temperature: req.temperature ?? 0.7, num_predict: req.maxTokens ?? 4096 },
      stream: false,
    };
    const resp = await this.host.fetch(`${this.cfg.endpoint}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...this.authHeaders() }, body: JSON.stringify(body),
    });
    if (resp.status >= 400) { yield { type: 'done', reason: 'error', error: resp.body }; return; }
    const j = JSON.parse(resp.body) as { message: { content: string }; prompt_eval_count?: number; eval_count?: number };
    if (j.message?.content) yield { type: 'text', delta: j.message.content };
    yield { type: 'usage', inputTokens: j.prompt_eval_count ?? 0, outputTokens: j.eval_count ?? 0 };
    yield { type: 'done', reason: 'end_turn' };
  }

  async embed(text: string, model: string): Promise<Float32Array> {
    const r = await this.host.fetch(`${this.cfg.endpoint}/api/embeddings`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...this.authHeaders() },
      body: JSON.stringify({ model, prompt: text }),
    });
    if (r.status >= 400) throw new Error(r.body);
    const j = JSON.parse(r.body) as { embedding: number[] };
    return new Float32Array(j.embedding);
  }
}
