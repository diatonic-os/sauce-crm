// ─────────────────────────────────────────────────────────────────────────────
//  CACHE LAYER — SAUCEOM_HARNESS_DIRECTIVE @providers caching rule
// ─────────────────────────────────────────────────────────────────────────────
//
//  Implements the @providers directive: "canonicalize context to byte-stable
//  prefixes so WE control cache hits across LM Studio / OpenAI / Anthropic."
//
//  Three-layer strategy:
//    1. canonical() (from L0Substrate) — key-order-independent serialization
//       ensures that two structurally-equal blocks hash identically regardless
//       of JS property insertion order.
//    2. fnv1a — local 32-bit FNV-1a hash (no node:crypto dependency) produces
//       an 8-char hex key fast enough for hot-path context assembly.
//    3. PrefixCache<T> — Map-backed memo keyed by cacheKey(blocks), ready to
//       store provider responses or parsed completions for reuse.
//
//  Stable prefix detection (stablePrefixLength) drives both:
//    • Anthropic cache_control breakpoint placement (inject at prefix boundary)
//    • LM Studio client-side KV-cache reuse (same prefix ⇒ warm KV state)

import { canonical } from "./L0Substrate";
import { encodeToon } from "../Toon";

// ═══════════════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════════════

/** A single message block in a provider context window. */
export interface ContextBlock {
  role: string;
  content: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
//  FNV-1a (32-bit) — local, no crypto, platform-stable
// ═══════════════════════════════════════════════════════════════════════════

function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ═══════════════════════════════════════════════════════════════════════════
//  BLOCK KEY — stable hash for a single ContextBlock
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Produces an 8-char FNV-1a hex hash of a ContextBlock using canonical
 * (sorted-key) serialization.  Two blocks that differ only in JS property
 * insertion order hash identically — the basis for provider cache-hit control.
 *
 * @param block - A single role/content message block.
 * @returns 8-char lowercase hex string.
 */
export function blockKey(block: ContextBlock): string {
  return fnv1a(canonical(block));
}

// ═══════════════════════════════════════════════════════════════════════════
//  STABLE PREFIX LENGTH — shared leading blocks between two sequences
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Returns the count of leading ContextBlocks whose blockKey matches in order
 * between `prev` and `next`.  Stops at the first divergence.
 *
 * This is the reusable cached prefix length — use it to:
 *   • Place Anthropic `cache_control` breakpoints at index `result - 1`.
 *   • Know how many leading messages the LM Studio KV cache already covers.
 *
 * @param prev - Prior block sequence (already sent / cached).
 * @param next - Incoming block sequence to compare against.
 * @returns Number of matching leading blocks (0 when no shared prefix).
 */
export function stablePrefixLength(
  prev: ContextBlock[],
  next: ContextBlock[],
): number {
  const limit = Math.min(prev.length, next.length);
  let i = 0;
  while (i < limit) {
    const p = prev[i];
    const n = next[i];
    // noUncheckedIndexedAccess: both are defined because i < limit
    if (p === undefined || n === undefined) break;
    if (blockKey(p) !== blockKey(n)) break;
    i++;
  }
  return i;
}

// ═══════════════════════════════════════════════════════════════════════════
//  CACHE KEY — stable hash over an entire block sequence
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Produces a stable hex hash for the entire ContextBlock sequence.
 *
 * Order-sensitive: [A, B] and [B, A] yield different keys.
 * Content-stable: key-reordered content fields do not change the key.
 *
 * @param blocks - Ordered sequence of context blocks.
 * @returns Hex string uniquely identifying this ordered sequence.
 */
export function cacheKey(blocks: ContextBlock[]): string {
  // Chain each block key with a separator so order is encoded and collisions
  // across different-length sequences are avoided.
  const chain = blocks.map(blockKey).join("|");
  return fnv1a(chain);
}

// ═══════════════════════════════════════════════════════════════════════════
//  TOON TRANSPORT — token-optimised wire encoding
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Encodes a ContextBlock sequence to TOON (Token-Oriented Object Notation)
 * for token-efficient transport to the inference provider.
 *
 * @param blocks - Ordered sequence of context blocks.
 * @returns TOON-encoded string (non-empty for non-empty input; may be minimal
 *          for an empty sequence).
 */
export function toToonTransport(blocks: ContextBlock[]): string {
  // encodeToon expects Json-shaped values; ContextBlock satisfies that contract
  // because role is string and content is unknown (treated as Json at runtime).
  return encodeToon(
    blocks as unknown as Parameters<typeof encodeToon>[0],
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  PREFIX CACHE — Map-backed memo keyed by cacheKey
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Simple Map-backed memoization cache keyed by cacheKey(blocks).
 *
 * Intended to store provider responses, parsed completions, or any value T
 * associated with a particular ordered ContextBlock sequence.  Hits survive
 * key-reordered content (canonical normalisation means the same logical
 * block sequence always produces the same cache key).
 *
 * @template T - The type of value stored per context sequence.
 */
export class PrefixCache<T> {
  private readonly store = new Map<string, T>();

  /**
   * Look up the cached value for `blocks`.
   * @returns Cached value or `undefined` on a miss.
   */
  get(blocks: ContextBlock[]): T | undefined {
    return this.store.get(cacheKey(blocks));
  }

  /**
   * Store a value keyed by `blocks`.
   * Overwrites any prior value for the same sequence.
   */
  set(blocks: ContextBlock[], value: T): void {
    this.store.set(cacheKey(blocks), value);
  }

  /** Number of distinct sequences currently cached. */
  size(): number {
    return this.store.size;
  }
}
