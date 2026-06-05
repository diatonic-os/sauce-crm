// Model load/unload orchestration for the SauceBot chat window. When the user
// switches the active model, a local backend (LM Studio JIT) should load the new
// model and (optionally) unload the previous one to free VRAM. Cloud providers
// are server-managed → no-op. Pure orchestration over a manager interface, so it
// unit-tests without a live LM Studio.

/** Minimal slice of LMStudioModelManager this needs. */
export interface ModelManagerLike {
  listLoaded(): Promise<Array<{ id: string }>>;
  load(
    modelKey: string,
    opts?: { ttlSeconds?: number },
  ): Promise<{ id: string }>;
  unload(modelId: string): Promise<void>;
}

export interface SwitchModelOpts {
  /** Provider id of the new model (only local providers JIT-load). */
  provider: string;
  /** Previously-active model id, if any. */
  prev?: string;
  /** Newly-selected model id. */
  next: string;
  /** Unload `prev` after loading `next` (free VRAM). Default true. */
  unloadPrev?: boolean;
  /** Idle auto-unload TTL for the loaded model. */
  ttlSeconds?: number;
}

export interface SwitchModelResult {
  loaded?: string;
  unloaded?: string;
  skipped?: string;
}

const LOCAL_PROVIDERS = new Set(["lmstudio", "lmstudio-sdk", "ollama"]);

/** Ensure `next` is loaded and (optionally) `prev` is unloaded. Idempotent:
 *  won't reload an already-loaded model; won't unload `next` or a model that
 *  isn't loaded. Best-effort by contract — callers wrap to keep chat flowing if
 *  the local backend is unreachable. */
export async function switchModel(
  mgr: ModelManagerLike,
  opts: SwitchModelOpts,
): Promise<SwitchModelResult> {
  if (!LOCAL_PROVIDERS.has(opts.provider)) {
    return { skipped: `cloud provider (${opts.provider}) — server-managed` };
  }
  if (!opts.next) return { skipped: "no target model" };

  const loaded = await mgr.listLoaded();
  const isLoaded = (id: string): boolean => loaded.some((m) => m.id === id);

  const result: SwitchModelResult = {};
  if (!isLoaded(opts.next)) {
    await mgr.load(
      opts.next,
      opts.ttlSeconds !== undefined ? { ttlSeconds: opts.ttlSeconds } : {},
    );
    result.loaded = opts.next;
  }
  const unloadPrev = opts.unloadPrev ?? true;
  if (
    unloadPrev &&
    opts.prev &&
    opts.prev !== opts.next &&
    isLoaded(opts.prev)
  ) {
    await mgr.unload(opts.prev);
    result.unloaded = opts.prev;
  }
  return result;
}
