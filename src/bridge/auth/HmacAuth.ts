// MOB-BRIDGE-001 · T-C — HMAC auth: signer (mobile) + verifier (desktop).
//
// Codes against the shared keystone contract only (src/bridge/contract.ts).
// Crypto is injected (mirrors ProvenanceCrypto) so this stays portable across
// desktop AND mobile bundles and is unit-testable with a deterministic fake.
//
// Security properties enforced by the verifier (spec §3.2):
//   - clock-skew window (TS_WINDOW_MS, default ±300s)
//   - replay protection via a bounded LRU nonce set
//   - constant-time signature comparison (no `===`, no early-return)

import {
  type AuthResult,
  type AuthSigner,
  type AuthVerifier,
  type SignedRequestParts,
  canonicalRequestString,
  TS_WINDOW_MS,
} from "../contract";

/** Portable HMAC surface. Prod binds this to Web Crypto on both platforms
 *  (matches ProvenanceCrypto.hmacHex); tests inject a deterministic fake. */
export interface HmacCrypto {
  hmacHex(key: Uint8Array, msg: string): Promise<string>;
}

/** Resolves the shared pairing key. Returns null when the device is not yet
 *  paired (no key available) so the verifier can answer `not-paired`. */
export type KeyProvider = () => Promise<Uint8Array | null>;

/** Mobile side: sign an outbound request's canonical string with the pairing
 *  key. The signer never needs the key to be present synchronously — it is
 *  resolved per-call so re-pairing takes effect immediately. */
export class HmacAuthSigner implements AuthSigner {
  constructor(
    private readonly crypto: HmacCrypto,
    private readonly keyProvider: () => Promise<Uint8Array>,
  ) {}

  async sign(parts: SignedRequestParts): Promise<string> {
    const key = await this.keyProvider();
    return this.crypto.hmacHex(key, canonicalRequestString(parts));
  }
}

export interface HmacVerifierOpts {
  /** Max clock skew tolerated, ms. Defaults to TS_WINDOW_MS (300_000). */
  windowMs?: number;
  /** Max distinct nonces remembered for replay protection. Default 5000. */
  nonceCacheSize?: number;
}

const DEFAULT_NONCE_CACHE = 5000;

/** Desktop side: verify an inbound request. Enforces TS window, replay
 *  protection, and constant-time signature comparison. */
export class HmacAuthVerifier implements AuthVerifier {
  private readonly windowMs: number;
  private readonly nonceCacheSize: number;
  /** Insertion-ordered LRU set of seen nonces. A Map preserves insertion order
   *  in JS; we evict the oldest key when capacity is exceeded. */
  private readonly seen = new Map<string, true>();

  constructor(
    private readonly crypto: HmacCrypto,
    private readonly keyProvider: KeyProvider,
    opts?: HmacVerifierOpts,
  ) {
    this.windowMs = opts?.windowMs ?? TS_WINDOW_MS;
    this.nonceCacheSize = Math.max(
      1,
      opts?.nonceCacheSize ?? DEFAULT_NONCE_CACHE,
    );
  }

  async verify(
    parts: SignedRequestParts,
    signature: string,
  ): Promise<AuthResult> {
    const key = await this.keyProvider();
    if (key === null) return { ok: false, reason: "not-paired" };

    if (Math.abs(Date.now() - parts.ts) > this.windowMs) {
      return { ok: false, reason: "stale-timestamp" };
    }

    // Replay check happens BEFORE recording so a valid-but-replayed nonce is
    // rejected even though its signature would match.
    if (this.seen.has(parts.nonce)) {
      return { ok: false, reason: "replayed-nonce" };
    }

    const expected = await this.crypto.hmacHex(
      key,
      canonicalRequestString(parts),
    );
    if (!constantTimeEqualHex(expected, signature)) {
      return { ok: false, reason: "bad-signature" };
    }

    this.recordNonce(parts.nonce);
    return { ok: true };
  }

  private recordNonce(nonce: string): void {
    // Refresh LRU position.
    this.seen.delete(nonce);
    this.seen.set(nonce, true);
    while (this.seen.size > this.nonceCacheSize) {
      const oldest = this.seen.keys().next().value;
      if (oldest === undefined) break;
      this.seen.delete(oldest);
    }
  }
}

/**
 * Length-checked constant-time comparison of two hex strings.
 *
 * Returns false for unequal lengths WITHOUT throwing and without leaking the
 * mismatch position via timing: we always walk a fixed number of characters
 * (the length of `a`) and accumulate differences into `diff`. We never use
 * `===` between the two strings and never early-return on first mismatch.
 *
 * Note: a length mismatch is detectable in time (we OR the length delta into
 * the accumulator), which is acceptable — hex signature length is not secret.
 * What must not leak is *where* two equal-length signatures first differ.
 */
export function constantTimeEqualHex(a: string, b: string): boolean {
  // Fold the length difference into the accumulator so unequal-length inputs
  // can never compare equal, while still scanning a fixed window.
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) {
    // When i is out of range for b, charCodeAt returns NaN; (NaN ^ x) === x in
    // JS bitwise semantics is not guaranteed, so clamp to a stable sentinel.
    const ca = a.charCodeAt(i);
    const cb = i < b.length ? b.charCodeAt(i) : -1;
    diff |= ca ^ cb;
  }
  return diff === 0;
}
