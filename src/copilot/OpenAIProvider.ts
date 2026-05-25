// SPEC §19.1 — OpenAI ChatCompletions + function-calling + embeddings.
// Thin config over the shared OpenAICompatibleProvider harness (CON-SAUCEBOT
// S1): the streaming/batch/tool-call/embeddings logic lives in the base; this
// class just pins OpenAI's defaults (always-bearer auth, curated model list).
import type { ModelDescriptor, ProviderHost } from "./ICopilotProvider";
import { OpenAICompatibleProvider } from "./OpenAICompatibleProvider";

const MODELS: ModelDescriptor[] = [
  { id: "gpt-4o", label: "GPT-4o", contextTokens: 128_000, vision: true },
  {
    id: "gpt-4o-mini",
    label: "GPT-4o mini",
    contextTokens: 128_000,
    vision: true,
  },
];

export class OpenAIProvider extends OpenAICompatibleProvider {
  constructor(
    host: ProviderHost,
    apiKey: () => Promise<string>,
    baseUrl = "https://api.openai.com/v1",
  ) {
    super(host, {
      name: "openai",
      baseUrl,
      apiKey,
      authHeader: "bearer",
      supportsToolUse: true,
      supportsEmbeddings: true,
      staticModels: MODELS,
      maxContext: 128_000,
      vision: true,
    });
  }
}
