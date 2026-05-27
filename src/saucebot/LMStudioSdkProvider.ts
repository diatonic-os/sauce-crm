// SPEC §19.1 — LM Studio via official SDK, exposed as ISauceBotProvider.
// Delegates to the rich service surface under `./lmstudio/`.
import type {
  CompletionEvent,
  CompletionRequest,
  ISauceBotProvider,
  ModelDescriptor,
  ProviderCapabilities,
} from "./ISauceBotProvider";
import type { CredentialSource } from "./CredentialSource";
import {
  buildLMStudioIntegration,
  type LMStudioIntegration,
  type LMStudioClientConfig,
} from "./lmstudio";

export class LMStudioSdkProvider implements ISauceBotProvider {
  readonly name = "lmstudio-sdk";
  models: ModelDescriptor[] = [];
  private integration: LMStudioIntegration | null = null;

  constructor(
    private readonly source: CredentialSource | null,
    private readonly cfg: LMStudioClientConfig = {},
    private readonly sdkLoader?: () => unknown,
  ) {}

  capabilities(): ProviderCapabilities {
    return { toolUse: true, streaming: true, vision: true, maxContext: 32_768 };
  }

  private async ensure(): Promise<LMStudioIntegration> {
    if (this.integration) return this.integration;
    this.integration = await buildLMStudioIntegration({
      source: this.source,
      config: this.cfg,
      ...(this.sdkLoader !== undefined ? { sdkLoader: this.sdkLoader } : {}),
    });
    return this.integration;
  }

  async refreshModels(): Promise<void> {
    try {
      const i = await this.ensure();
      const loaded = await i.models.listLoaded();
      this.models = loaded.map((m) => ({
        id: m.identifier,
        label: m.identifier,
        contextTokens: 32_768,
      }));
    } catch {
      this.models = [];
    }
  }

  async ping(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const start = Date.now();
    try {
      const i = await this.ensure();
      await i.models.listLoaded();
      return { ok: true, latencyMs: Date.now() - start };
    } catch (e) {
      return {
        ok: false,
        latencyMs: Date.now() - start,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  async *complete(req: CompletionRequest): AsyncIterable<CompletionEvent> {
    let i: LMStudioIntegration;
    try {
      i = await this.ensure();
    } catch (e) {
      yield {
        type: "done",
        reason: "error",
        error: e instanceof Error ? e.message : String(e),
      };
      return;
    }
    const messages = req.systemPrompt
      ? [
          { role: "system" as const, content: req.systemPrompt },
          ...req.messages,
        ]
      : req.messages;
    for await (const ev of i.chat.stream({
      modelId: req.model,
      messages: messages.map((m) => ({
        role:
          m.role === "tool"
            ? "user"
            : (m.role as "system" | "user" | "assistant"),
        content:
          typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      })),
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.maxTokens !== undefined ? { maxTokens: req.maxTokens } : {}),
    })) {
      if (ev.type === "text" && ev.delta)
        yield { type: "text", delta: ev.delta };
      if (ev.type === "done") {
        if (ev.stats)
          yield {
            type: "usage",
            inputTokens: ev.stats.promptTokensCount ?? 0,
            outputTokens: ev.stats.predictedTokensCount ?? 0,
          };
        yield {
          type: "done",
          reason:
            ev.reason === "end"
              ? "end_turn"
              : ev.reason === "aborted"
                ? "stop"
                : "error",
          ...(ev.error !== undefined ? { error: ev.error } : {}),
        };
      }
    }
  }

  async embed(text: string, model: string): Promise<Float32Array> {
    const i = await this.ensure();
    return i.embed.embed(model, text);
  }
}
