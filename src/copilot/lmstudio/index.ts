// SPEC §19 — V2 LM Studio integration facade. Single import surface for the rest of V2.
import { LMStudioClientFactory } from './LMStudioClientFactory';
import { LMStudioChatService } from './LMStudioChatService';
import { LMStudioActService } from './LMStudioActService';
import { LMStudioEmbedService } from './LMStudioEmbedService';
import { LMStudioModelManager } from './LMStudioModelManager';
import { LMStudioTokenizer } from './LMStudioTokenizer';
import { LMStudioToolBuilder } from './LMStudioToolBuilder';
import type { CredentialSource } from '../CredentialSource';
import type { LMStudioClientConfig, LMStudioClientLike } from './LMStudioClientFactory';

export * from './LMStudioClientFactory';
export { LMStudioChatService, type ChatMessage as LMStudioChatMessage, type ChatRequest as LMStudioChatRequest, type ChatStreamEvent as LMStudioChatStreamEvent, type ChatResult as LMStudioChatResult } from './LMStudioChatService';
export { LMStudioActService, type ToolSpec, type ActRequest, type ActResult } from './LMStudioActService';
export { LMStudioEmbedService } from './LMStudioEmbedService';
export { LMStudioModelManager, type DownloadedModel, type LoadedModel, type LoadOptions } from './LMStudioModelManager';
export { LMStudioTokenizer } from './LMStudioTokenizer';
export { LMStudioToolBuilder } from './LMStudioToolBuilder';

export interface LMStudioIntegration {
  factory: LMStudioClientFactory;
  client: LMStudioClientLike;
  chat: LMStudioChatService;
  act: LMStudioActService;
  embed: LMStudioEmbedService;
  models: LMStudioModelManager;
  tokenizer: LMStudioTokenizer;
  tools: LMStudioToolBuilder;
}

export interface BuildLMStudioOpts {
  source: CredentialSource | null;
  config?: LMStudioClientConfig;
  sdkLoader?: () => unknown;
}

export async function buildLMStudioIntegration(opts: BuildLMStudioOpts): Promise<LMStudioIntegration> {
  const factory = new LMStudioClientFactory(opts.source, opts.config ?? {}, { sdkLoader: opts.sdkLoader });
  const client = await factory.build();
  const sdkExports = opts.sdkLoader
    ? opts.sdkLoader() as { tool: (def: unknown) => unknown }
    : (((typeof require !== 'undefined' ? require : null) as null | ((m: string) => unknown))?.('@lmstudio/sdk') as { tool: (def: unknown) => unknown });
  return {
    factory,
    client,
    chat: new LMStudioChatService(client),
    act: new LMStudioActService(client, sdkExports),
    embed: new LMStudioEmbedService(client),
    models: new LMStudioModelManager(client),
    tokenizer: new LMStudioTokenizer(client),
    tools: new LMStudioToolBuilder(),
  };
}
