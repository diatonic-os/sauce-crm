// SPEC §19.1 — Model lifecycle. List downloaded, list loaded, JIT load, unload, get info.
import type {
  LMStudioClientLike,
  LMStudioModelInstanceInfo,
} from "./LMStudioClientFactory";

export interface DownloadedModel {
  modelKey: string;
  path?: string;
  type?: string;
  sizeBytes?: number;
}
export interface LoadedModel {
  identifier: string;
  path?: string;
}

export interface LoadOptions {
  ttlSeconds?: number; // auto-unload after idle
  contextLength?: number;
  gpuLayers?: number;
  signal?: AbortSignal;
}

export class LMStudioModelManager {
  constructor(private readonly client: LMStudioClientLike) {}

  async listDownloaded(): Promise<DownloadedModel[]> {
    const rows = await this.client.system.listDownloadedModels();
    return rows.map((r) => ({
      modelKey: r.modelKey ?? r.path ?? "unknown",
      ...(r.path !== undefined ? { path: r.path } : {}),
      ...(r.type !== undefined ? { type: r.type } : {}),
      ...(r.sizeBytes !== undefined ? { sizeBytes: r.sizeBytes } : {}),
    }));
  }

  async listLoaded(): Promise<LoadedModel[]> {
    const rows = await this.client.llm.listLoaded();
    return rows.map((r) => ({
      identifier: r.identifier ?? r.path ?? "unknown",
      ...(r.path !== undefined ? { path: r.path } : {}),
    }));
  }

  async load(modelKey: string, opts: LoadOptions = {}): Promise<LoadedModel> {
    const config: Record<string, unknown> = {};
    if (opts.contextLength) config.contextLength = opts.contextLength;
    if (opts.gpuLayers !== undefined) config.gpuLayers = opts.gpuLayers;
    const handle = await this.client.llm.load({
      model: modelKey,
      ...(opts.ttlSeconds !== undefined ? { ttl: opts.ttlSeconds } : {}),
      ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
      config,
    });
    return { identifier: handle.identifier ?? modelKey };
  }

  async unload(modelId: string): Promise<void> {
    const handle = await this.client.llm.model(modelId);
    await handle.unload();
  }

  async getInfo(
    modelId: string,
  ): Promise<LMStudioModelInstanceInfo | undefined> {
    const handle = await this.client.llm.model(modelId);
    return handle.getModelInfo();
  }

  async getContextLength(modelId: string): Promise<number> {
    const handle = await this.client.llm.model(modelId);
    return handle.getContextLength();
  }

  async lmStudioVersion(): Promise<{ version: string; build?: string } | null> {
    if (!this.client.system.getLMStudioVersion) return null;
    try {
      return await this.client.system.getLMStudioVersion();
    } catch {
      return null;
    }
  }
}
