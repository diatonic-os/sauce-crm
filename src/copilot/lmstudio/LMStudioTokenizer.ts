// SPEC §19.3 — Token counting for RagAssembler trim decisions.
import type { LMStudioClientLike } from './LMStudioClientFactory';

export class LMStudioTokenizer {
  constructor(private readonly client: LMStudioClientLike) {}

  async tokenize(modelId: string, text: string): Promise<number[]> {
    const handle = await this.client.llm.model(modelId);
    return handle.tokenize(text);
  }

  async countTokens(modelId: string, text: string): Promise<number> {
    const handle = await this.client.llm.model(modelId);
    return handle.countTokens(text);
  }

  async countBatch(modelId: string, texts: string[]): Promise<number[]> {
    const handle = await this.client.llm.model(modelId);
    const out: number[] = [];
    for (const t of texts) out.push(await handle.countTokens(t));
    return out;
  }
}
