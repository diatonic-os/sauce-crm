// Bridge/daemon abuse control: a small in-memory per-remote-address token
// bucket. Pure (clock injected) so it is deterministic under test. Used by both
// HTTP listeners to answer 429 before any auth/crypto work is done on a flood.
//
// Token bucket: each remote addr gets a bucket of `capacity` tokens that refills
// at `refillPerSec`. Each request costs one token; an empty bucket → throttled.
// A bounded LRU caps memory so a spray of distinct source addresses can't grow
// the map without limit (oldest idle bucket is evicted).

export interface TokenBucketOpts {
  /** Max burst — tokens a fresh bucket starts with. Default 60. */
  capacity?: number;
  /** Sustained refill rate, tokens per second. Default 30. */
  refillPerSec?: number;
  /** Max distinct remote addresses tracked. Default 4096. */
  maxKeys?: number;
  /** Injectable clock (ms). Default Date.now. */
  now?: () => number;
}

interface Bucket {
  tokens: number;
  last: number;
}

const DEFAULT_CAPACITY = 60;
const DEFAULT_REFILL = 30;
const DEFAULT_MAX_KEYS = 4096;

export class TokenBucketRateLimiter {
  private readonly capacity: number;
  private readonly refillPerSec: number;
  private readonly maxKeys: number;
  private readonly now: () => number;
  /** Insertion-ordered map = cheap LRU (Map preserves insertion order). */
  private readonly buckets = new Map<string, Bucket>();

  constructor(opts?: TokenBucketOpts) {
    this.capacity = Math.max(1, opts?.capacity ?? DEFAULT_CAPACITY);
    this.refillPerSec = Math.max(0.001, opts?.refillPerSec ?? DEFAULT_REFILL);
    this.maxKeys = Math.max(1, opts?.maxKeys ?? DEFAULT_MAX_KEYS);
    this.now = opts?.now ?? Date.now;
  }

  /**
   * Charge one token for `key` (a remote address). Returns true when the
   * request is allowed, false when the bucket is empty (caller → 429).
   */
  allow(key: string): boolean {
    const t = this.now();
    let b = this.buckets.get(key);
    if (!b) {
      b = { tokens: this.capacity, last: t };
    } else {
      // Refresh LRU position.
      this.buckets.delete(key);
      const elapsedSec = Math.max(0, (t - b.last) / 1000);
      b.tokens = Math.min(
        this.capacity,
        b.tokens + elapsedSec * this.refillPerSec,
      );
      b.last = t;
    }

    let allowed: boolean;
    if (b.tokens >= 1) {
      b.tokens -= 1;
      allowed = true;
    } else {
      allowed = false;
    }

    this.buckets.set(key, b);
    while (this.buckets.size > this.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
    return allowed;
  }
}
