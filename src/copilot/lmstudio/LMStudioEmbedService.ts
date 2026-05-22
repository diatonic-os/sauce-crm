// SPEC §19.3 — Embeddings via LM Studio. Used by RagAssembler for semantic search.
import type { LMStudioClientLike } from './LMStudioClientFactory';

export class LMStudioEmbedService {
  constructor(private readonly client: LMStudioClientLike) {}

  async embed(modelId: string, text: string): Promise<Float32Array> {
    const handle = await this.client.embedding.model(modelId);
    const res = await handle.embed(text) as { embedding: number[] };
    return new Float32Array(res.embedding);
  }

  async embedBatch(modelId: string, texts: string[]): Promise<Float32Array[]> {
    const handle = await this.client.embedding.model(modelId);
    const res = await handle.embed(texts) as { embedding: number[] }[];
    return res.map((r) => new Float32Array(r.embedding));
  }

  async getContextLength(modelId: string): Promise<number> {
    const handle = await this.client.embedding.model(modelId);
    return handle.getContextLength();
  }
}
