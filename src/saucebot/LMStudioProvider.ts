// SPEC §19.1 (Custom OpenAI-compatible) — LM Studio REST surface.
// LM Studio exposes an OpenAI-compatible API at http://localhost:1234/v1 by
// default. Tool-use is supported by recent LM Studio builds via the OpenAI
// function-calling schema.
//
// Thin subclass over OpenAICompatibleProvider (CON-SAUCEBOT S1): all
// streaming/batch/tool-call logic lives in the base. This class keeps LM
// Studio's mutable config (endpoint/apiKey/defaultModel/dynamic toolUse) plus
// the REST-only extras (`refreshModels`, `ping`) and routes the harness's
// overridable hooks at its live `cfg`.
import type { ModelDescriptor, ProviderHost } from "./ISauceBotProvider";
import type { CompletionRequest } from "./ISauceBotProvider";
import { OpenAICompatibleProvider } from "./OpenAICompatibleProvider";

export interface LMStudioConfig {
  endpoint: string; // base URL, e.g. 'http://localhost:1234/v1'
  apiKey?: string; // optional — LM Studio ignores by default, present for compat
  defaultModel?: string;
  toolUse?: boolean; // user-toggle; not all loaded models support it
}

export class LMStudioProvider extends OpenAICompatibleProvider {
  override models: ModelDescriptor[] = [];
  private cfg: LMStudioConfig;

  constructor(host: ProviderHost, cfg: Partial<LMStudioConfig> = {}) {
    super(host, {
      name: "lmstudio",
      baseUrl: cfg.endpoint ?? "http://localhost:1234/v1",
      maxContext: 32_768,
      vision: false,
    });
    this.cfg = {
      endpoint: cfg.endpoint ?? "http://localhost:1234/v1",
      ...(cfg.apiKey !== undefined ? { apiKey: cfg.apiKey } : {}),
      ...(cfg.defaultModel !== undefined ? { defaultModel: cfg.defaultModel } : {}),
      toolUse: cfg.toolUse ?? false,
    };
  }

  setConfig(cfg: Partial<LMStudioConfig>): void {
    this.cfg = { ...this.cfg, ...cfg };
    if (!this.cfg.endpoint) this.cfg.endpoint = "http://localhost:1234/v1";
  }
  getConfig(): LMStudioConfig {
    return { ...this.cfg };
  }

  // ── Harness hooks routed at the live config ──────────────────────────────
  protected override supportsToolUse(): boolean {
    return !!this.cfg.toolUse;
  }
  protected override base(): string {
    return this.cfg.endpoint.replace(/\/+$/, "");
  }
  protected override modelOf(req: CompletionRequest): string {
    return req.model || this.cfg.defaultModel || "local-model";
  }
  protected override async headers(): Promise<Record<string, string>> {
    const h: Record<string, string> = { "content-type": "application/json" };
    if (this.cfg.apiKey) h.authorization = `Bearer ${this.cfg.apiKey}`;
    return h;
  }

  async refreshModels(): Promise<void> {
    const r = await this.host
      .fetch(`${this.base()}/models`, {
        method: "GET",
        headers: await this.headers(),
      })
      .catch(() => null);
    if (!r || r.status >= 400) return;
    try {
      const j = JSON.parse(r.body) as { data: Array<{ id: string }> };
      this.models = j.data.map((m) => ({
        id: m.id,
        label: m.id,
        contextTokens: 32_768,
      }));
    } catch {
      /* keep prior */
    }
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      const r = await this.host.fetch(`${this.base()}/models`, {
        method: "GET",
        headers: await this.headers(),
      });
      return {
        ok: r.status < 400,
        latencyMs: Date.now() - start,
        ...(r.status >= 400 ? { error: `HTTP ${r.status}` } : {}),
      };
    } catch (e) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }
}
