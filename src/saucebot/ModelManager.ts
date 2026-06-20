// ModelManager — pure model-management module for LM Studio / OpenAI-compatible
// providers. Classifies load failures, remembers known-bad models (blocklist),
// ensures a model is loaded (OOM-aware), and picks a safe fallback.
//
// Design contract:
//   - NO imports from "obsidian" — pure TypeScript, no Obsidian coupling.
//   - All side effects (HTTP, catalog reads, model load/unload, persistence) are
//     injected via ModelManagerHost and BlocklistStore interface seams so the
//     module is fully unit-testable with plain fakes/vi.fn().
//   - TypeScript strict + exactOptionalPropertyTypes + noUncheckedIndexedAccess.

// ---------------------------------------------------------------------------
// Failure classification
// ---------------------------------------------------------------------------

export type LoadFailureKind =
  | "arch-unsupported"
  | "oom"
  | "not-found"
  | "transient"
  | "unknown";

export interface ModelLoadError {
  kind: LoadFailureKind;
  model: string;
  raw: string;
  permanent: boolean;
  userMessage: string;
}

/** Patterns that signal a permanent architecture / build incompatibility. */
const ARCH_RE =
  /unknown model architecture|GGML_ASSERT|Error loading model|Failed to load model/i;

/** Patterns that signal GPU / host memory exhaustion. */
const OOM_RE =
  /cudaMalloc failed: out of memory|alloc_tensor_range: failed to allocate|out of memory/i;

/** Patterns that signal the model id is not installed in the provider. */
const NOT_FOUND_RE = /HTTP 404|model_not_found|not found/i;

/** Patterns that signal a transient / infrastructure issue (not the model). */
const TRANSIENT_RE =
  /ECONNREFUSED|fetch failed|Failed to fetch|timeout|network|No models loaded\. Please load a model/i;

function buildUserMessage(kind: LoadFailureKind, model: string): string {
  switch (kind) {
    case "arch-unsupported":
      return `${model} isn't supported by this LM Studio runtime build.`;
    case "oom":
      return `${model} ran out of GPU memory — try a smaller model or quantization.`;
    case "not-found":
      return `${model} isn't installed in LM Studio.`;
    case "transient":
      return `${model} wasn't loaded yet — retrying.`;
    case "unknown":
      return `${model} failed to load for an unknown reason.`;
  }
}

/**
 * Classify a raw load-failure string into a typed ModelLoadError.
 *
 * Priority order: arch-unsupported > oom > not-found > transient > unknown.
 * Only arch-unsupported, oom, and not-found are permanent (blocklist-eligible).
 */
export function classifyLoadFailure(
  model: string,
  raw: string,
): ModelLoadError {
  let kind: LoadFailureKind;
  let permanent: boolean;

  if (ARCH_RE.test(raw)) {
    kind = "arch-unsupported";
    permanent = true;
  } else if (OOM_RE.test(raw)) {
    kind = "oom";
    permanent = true;
  } else if (NOT_FOUND_RE.test(raw)) {
    kind = "not-found";
    permanent = true;
  } else if (TRANSIENT_RE.test(raw)) {
    kind = "transient";
    permanent = false;
  } else {
    kind = "unknown";
    permanent = false;
  }

  return {
    kind,
    model,
    raw,
    permanent,
    userMessage: buildUserMessage(kind, model),
  };
}

// ---------------------------------------------------------------------------
// Catalog model (decoupled from ModelCatalog.ts to keep this module pure)
// ---------------------------------------------------------------------------

export interface CatalogModel {
  id: string;
  loaded: boolean;
  kind: "llm" | "vlm" | "embeddings" | "unknown";
  contextLength?: number;
  sizeBytes?: number;
}

// ---------------------------------------------------------------------------
// Seam interfaces
// ---------------------------------------------------------------------------

export interface ModelManagerHost {
  listModels(): Promise<CatalogModel[]>;
  loadModel?(id: string): Promise<void>; // optional — JIT providers may omit
  unloadModel?(id: string): Promise<void>; // optional
}

export interface BlocklistStore {
  get(): string[];
  add(id: string): void;
  remove(id: string): void;
}

// ---------------------------------------------------------------------------
// ModelManager
// ---------------------------------------------------------------------------

export class ModelManager {
  constructor(
    private readonly host: ModelManagerHost,
    private readonly blocklist: BlocklistStore,
    /** Optional store of models that have successfully warmed up. When present,
     *  fallbackChatModel prefers these — so we never suggest an untested-but-
     *  doomed model (e.g. another incompatible arch that just hasn't failed
     *  yet). Backward compatible: omitted ⇒ prior prefer>loaded>smallest order. */
    private readonly knownGood?: BlocklistStore,
  ) {}

  /** Returns true when `id` is on the permanent-failure blocklist. */
  isBlocked(id: string): boolean {
    return this.blocklist.get().includes(id);
  }

  /** Returns true when `id` has previously loaded successfully. */
  isKnownGood(id: string): boolean {
    return this.knownGood?.get().includes(id) ?? false;
  }

  /**
   * Classify `raw` and, if the failure is permanent, add `model` to the
   * blocklist. Always returns the classified error.
   */
  recordFailure(model: string, raw: string): ModelLoadError {
    const err = classifyLoadFailure(model, raw);
    if (err.permanent) {
      this.blocklist.add(model);
    }
    return err;
  }

  /**
   * Record that `model` loaded + answered successfully: add it to the known-good
   * set and clear any stale blocklist entry (a model that now works was either
   * never broken or has been fixed). Makes fallback suggestions trustworthy.
   */
  recordSuccess(model: string): void {
    if (!model) return;
    this.knownGood?.add(model);
    if (this.isBlocked(model)) this.blocklist.remove(model);
  }

  /**
   * Ensure the model identified by `id` is loaded.
   *
   * Returns one of four statuses:
   *   - "blocked"  — model is on the blocklist; no load attempt made.
   *   - "already"  — catalog reports the model is already loaded.
   *   - "loaded"   — host.loadModel() was called and succeeded.
   *   - "jit"      — host has no loadModel(); provider will load on demand.
   *
   * The `ok` field unambiguously signals whether the model is ready to use:
   *   - true  — status is "already", "loaded" (success), or "jit".
   *   - false — status is "blocked", or "loaded" with a non-undefined error
   *             (load was attempted but failed; `error` carries the details).
   *
   * Callers should inspect `ok` first; check `error` for diagnosis on failure.
   */
  async ensureLoaded(id: string): Promise<{
    status: "already" | "loaded" | "jit" | "blocked";
    /** true when the model is ready (or will self-load on first request). */
    ok: boolean;
    error?: ModelLoadError;
  }> {
    if (this.isBlocked(id)) {
      return { status: "blocked", ok: false };
    }

    const catalog = await this.host.listModels();
    const entry = catalog.find((m) => m.id === id);
    if (entry?.loaded) {
      return { status: "already", ok: true };
    }

    if (this.host.loadModel) {
      try {
        await this.host.loadModel(id);
        return { status: "loaded", ok: true };
      } catch (e: unknown) {
        const raw = e instanceof Error ? e.message : String(e);
        const error = this.recordFailure(id, raw);
        return { status: "loaded", ok: false, error };
      }
    }

    // JIT: provider loads on first request — nothing to do here.
    return { status: "jit", ok: true };
  }

  /**
   * Pick the best available chat model (kind llm | vlm, not blocked).
   *
   * Preference order:
   *   1. The `prefer` id, if present, not blocked, and in the catalog as llm/vlm.
   *   2. Any currently-loaded llm/vlm model that isn't blocked.
   *   3. The smallest unblocked llm/vlm model by sizeBytes (then contextLength).
   *   4. null — no suitable model found.
   */
  async fallbackChatModel(prefer?: string): Promise<string | null> {
    const catalog = await this.host.listModels();
    const chatModels = catalog.filter(
      (m) => (m.kind === "llm" || m.kind === "vlm") && !this.isBlocked(m.id),
    );

    if (chatModels.length === 0) return null;

    // 1. Prefer the explicitly requested model.
    if (prefer !== undefined) {
      const found = chatModels.find((m) => m.id === prefer);
      if (found) return found.id;
    }

    // 2. Prefer a KNOWN-GOOD model (loaded first) — one that has actually warmed
    //    up before, so we never suggest an untested model that may also be
    //    incompatible. No-op when no known-good store is wired.
    const goodLoaded = chatModels.find(
      (m) => m.loaded && this.isKnownGood(m.id),
    );
    if (goodLoaded) return goodLoaded.id;
    const good = chatModels.find((m) => this.isKnownGood(m.id));
    if (good) return good.id;

    // 3. Prefer an already-loaded model.
    const loaded = chatModels.find((m) => m.loaded);
    if (loaded) return loaded.id;

    // 3. Smallest by sizeBytes (ascending), then contextLength (ascending).
    const sorted = [...chatModels].sort((a, b) => {
      const sa = a.sizeBytes ?? Number.MAX_SAFE_INTEGER;
      const sb = b.sizeBytes ?? Number.MAX_SAFE_INTEGER;
      if (sa !== sb) return sa - sb;
      const ca = a.contextLength ?? Number.MAX_SAFE_INTEGER;
      const cb = b.contextLength ?? Number.MAX_SAFE_INTEGER;
      return ca - cb;
    });

    return sorted[0]?.id ?? null;
  }
}
