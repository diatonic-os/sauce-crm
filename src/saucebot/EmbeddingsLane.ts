// EmbeddingsLane — realtime embeddings "second lane".
//
// Ensures the embedding model is loaded (JIT-warm via EmbeddingsHost),
// computes query embeddings, caches them in a bounded LRU, and makes
// failures VISIBLE as a typed EmbedStatus rather than silently falling
// back to lexical search.
//
// Pure module: NO imports from "obsidian". All side effects (HTTP, model
// load/unload, persistence) come in through the EmbeddingsHost seam so
// tests can use plain fakes.

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Seam injected by the plugin host that owns the inference connection. */
export interface EmbeddingsHost {
  /** Load / JIT-warm the embed model on its own lane. */
  ensureModel(id: string): Promise<{ ok: boolean; error?: string }>;
  /** POST /embeddings via the provider; returns null on any failure. */
  embed(text: string, model: string): Promise<Float32Array | null>;
}

/** Configuration for the embeddings lane. */
export interface EmbedLaneConfig {
  model: string;
  enabled: boolean;
  /** Maximum cache entries (LRU); defaults to 128. */
  cacheSize?: number;
}

export type EmbedStatus = "ok" | "cached" | "failed" | "disabled";

export interface EmbedResult {
  vec: Float32Array | null;
  status: EmbedStatus;
  dims?: number;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Bounded LRU cache
// ---------------------------------------------------------------------------

/**
 * Simple LRU cache backed by a Map (insertion-order). When the map exceeds
 * `capacity`, the oldest (first-inserted) entry is evicted.
 */
class LruCache<K, V> {
  private readonly map: Map<K, V> = new Map();

  constructor(readonly capacity: number) {}

  get(key: K): V | undefined {
    const value = this.map.get(key);
    if (value === undefined) return undefined;
    // Move to most-recently-used position.
    this.map.delete(key);
    this.map.set(key, value);
    return value;
  }

  set(key: K, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      // Evict oldest (first) entry.
      const oldest = this.map.keys().next().value;
      if (oldest !== undefined) {
        this.map.delete(oldest);
      }
    }
    this.map.set(key, value);
  }

  has(key: K): boolean {
    return this.map.has(key);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}

// ---------------------------------------------------------------------------
// EmbeddingsLane
// ---------------------------------------------------------------------------

const DEFAULT_CACHE_SIZE = 128;

export class EmbeddingsLane {
  private cfg: EmbedLaneConfig;
  private cache: LruCache<string, Float32Array>;

  /** Whether ensureModel has been called and succeeded for cfg.model. */
  private modelReady: boolean = false;
  /** Whether ensureModel is currently in-flight (prevents concurrent calls). */
  private modelEnsuring: Promise<{ ok: boolean; error?: string }> | null = null;

  // Counters
  private _hits: number = 0;
  private _misses: number = 0;
  private _failures: number = 0;

  /** Dimensionality recorded from the first successful embed call. */
  private _dims: number | null = null;

  constructor(
    private readonly host: EmbeddingsHost,
    cfg: EmbedLaneConfig,
  ) {
    this.cfg = { ...cfg };
    this.cache = new LruCache<string, Float32Array>(
      cfg.cacheSize ?? DEFAULT_CACHE_SIZE,
    );
  }

  /**
   * Update the configuration. If the model id changes, the "model ready" flag
   * is cleared and the cache is invalidated so the next embedQuery will
   * re-call ensureModel.
   */
  setConfig(cfg: EmbedLaneConfig): void {
    const modelChanged = cfg.model !== this.cfg.model;
    const newSize = cfg.cacheSize ?? DEFAULT_CACHE_SIZE;
    this.cfg = { ...cfg };
    if (modelChanged) {
      this.modelReady = false;
      this.modelEnsuring = null;
      // Rebuild the cache for the new model (different key-space).
      this.cache = new LruCache<string, Float32Array>(newSize);
    } else if (newSize !== this.cache.capacity) {
      // Same model, but capacity changed — rebuild preserving no entries
      // (simpler than rehashing; cache will warm back up naturally).
      this.cache = new LruCache<string, Float32Array>(newSize);
    }
    // If neither the model nor the capacity changed, keep the existing
    // cache intact so callers do not lose previously computed vectors.
  }

  /**
   * Compute an embedding for `text` using the configured model.
   *
   * Status matrix:
   *  - "disabled" — cfg.enabled is false or cfg.model is empty
   *  - "cached"   — result found in LRU cache
   *  - "failed"   — ensureModel rejected, or embed() returned null
   *  - "ok"       — freshly computed and now cached
   */
  async embedQuery(text: string): Promise<EmbedResult> {
    if (!this.cfg.enabled || !this.cfg.model) {
      return { vec: null, status: "disabled" };
    }

    const cacheKey = `${this.cfg.model}\x00${text}`;

    const cached = this.cache.get(cacheKey);
    if (cached !== undefined) {
      this._hits++;
      return {
        vec: cached,
        status: "cached",
        dims: this._dims ?? cached.length,
      };
    }

    this._misses++;

    // Ensure model is loaded (memoize the promise so concurrent calls share it).
    if (!this.modelReady) {
      if (this.modelEnsuring === null) {
        this.modelEnsuring = this.host.ensureModel(this.cfg.model);
      }
      const ensureResult = await this.modelEnsuring;
      if (!ensureResult.ok) {
        // Clear the promise so subsequent calls can retry rather than
        // re-awaiting the same permanently-failed settled promise.
        this.modelEnsuring = null;
        this._failures++;
        return {
          vec: null,
          status: "failed",
          reason: ensureResult.error ?? "ensureModel failed",
        };
      }
      this.modelReady = true;
      this.modelEnsuring = null;
    }

    // Call the provider.
    const vec = await this.host.embed(text, this.cfg.model);
    if (vec === null) {
      this._failures++;
      return { vec: null, status: "failed", reason: "embed() returned null" };
    }

    // Record dimensionality on first success.
    if (this._dims === null) {
      this._dims = vec.length;
    }

    // Cache and return.
    this.cache.set(cacheKey, vec);
    return { vec, status: "ok", dims: vec.length };
  }

  /** Returns counters and freshness signals for observability. */
  stats(): {
    hits: number;
    misses: number;
    failures: number;
    modelReady: boolean;
    dims: number | null;
  } {
    return {
      hits: this._hits,
      misses: this._misses,
      failures: this._failures,
      modelReady: this.modelReady,
      dims: this._dims,
    };
  }
}
