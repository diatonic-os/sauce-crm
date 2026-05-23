import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  HmacAuthSigner,
  HmacAuthVerifier,
  constantTimeEqualHex,
  type HmacCrypto,
} from "./HmacAuth";
import type { SignedRequestParts } from "../contract";

// Deterministic fake HMAC: a stable sha256-like hex digest of key+msg. NOT a
// real MAC — just enough that (key,msg) → fixed hex, different inputs → different
// hex. We use FNV-1a folded into 64 hex chars so output length matches a real
// hex digest and constant-time compare exercises realistic strings.
function fnvHex64(s: string): string {
  // Produce 8 independent 8-hex-char lanes by salting the FNV seed.
  let out = "";
  for (let lane = 0; lane < 8; lane++) {
    let h = 0x811c9dc5 ^ (lane * 0x9e3779b1);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i) + lane;
      h = Math.imul(h, 0x01000193);
    }
    out += (h >>> 0).toString(16).padStart(8, "0");
  }
  return out;
}

const fakeCrypto: HmacCrypto = {
  async hmacHex(key: Uint8Array, msg: string): Promise<string> {
    return fnvHex64(`${Array.from(key).join(",")}|${msg}`);
  },
};

const KEY = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const keyProvider = async () => KEY;
const nullableKeyProvider = async () => KEY as Uint8Array | null;

function makeParts(overrides: Partial<SignedRequestParts> = {}): SignedRequestParts {
  return {
    method: "POST",
    path: "/v1/memory/search",
    bodyHash: "abc123",
    nonce: "nonce-1",
    ts: Date.now(),
    ...overrides,
  };
}

describe("HmacAuthSigner + HmacAuthVerifier", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-23T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sign → verify round-trips ok", async () => {
    const signer = new HmacAuthSigner(fakeCrypto, keyProvider);
    const verifier = new HmacAuthVerifier(fakeCrypto, nullableKeyProvider);
    const parts = makeParts();
    const sig = await signer.sign(parts);
    expect(await verifier.verify(parts, sig)).toEqual({ ok: true });
  });

  it("tampered body → bad-signature", async () => {
    const signer = new HmacAuthSigner(fakeCrypto, keyProvider);
    const verifier = new HmacAuthVerifier(fakeCrypto, nullableKeyProvider);
    const parts = makeParts();
    const sig = await signer.sign(parts);
    const tampered = { ...parts, bodyHash: "deadbeef" };
    expect(await verifier.verify(tampered, sig)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("tampered path → bad-signature", async () => {
    const signer = new HmacAuthSigner(fakeCrypto, keyProvider);
    const verifier = new HmacAuthVerifier(fakeCrypto, nullableKeyProvider);
    const parts = makeParts();
    const sig = await signer.sign(parts);
    const tampered = { ...parts, path: "/v1/memory/recall" };
    expect(await verifier.verify(tampered, sig)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("tampered nonce → bad-signature", async () => {
    const signer = new HmacAuthSigner(fakeCrypto, keyProvider);
    const verifier = new HmacAuthVerifier(fakeCrypto, nullableKeyProvider);
    const parts = makeParts();
    const sig = await signer.sign(parts);
    // Different nonce ⇒ different canonical string ⇒ signature mismatch (and it
    // is also a fresh, unseen nonce, so the failure is signature, not replay).
    const tampered = { ...parts, nonce: "nonce-other" };
    expect(await verifier.verify(tampered, sig)).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("ts outside window → stale-timestamp", async () => {
    const signer = new HmacAuthSigner(fakeCrypto, keyProvider);
    const verifier = new HmacAuthVerifier(fakeCrypto, nullableKeyProvider, { windowMs: 1000 });
    const parts = makeParts({ ts: Date.now() - 5000 });
    const sig = await signer.sign(parts);
    expect(await verifier.verify(parts, sig)).toEqual({ ok: false, reason: "stale-timestamp" });
  });

  it("ts in the future beyond window → stale-timestamp", async () => {
    const signer = new HmacAuthSigner(fakeCrypto, keyProvider);
    const verifier = new HmacAuthVerifier(fakeCrypto, nullableKeyProvider, { windowMs: 1000 });
    const parts = makeParts({ ts: Date.now() + 5000 });
    const sig = await signer.sign(parts);
    expect(await verifier.verify(parts, sig)).toEqual({ ok: false, reason: "stale-timestamp" });
  });

  it("same nonce twice → replayed-nonce", async () => {
    const signer = new HmacAuthSigner(fakeCrypto, keyProvider);
    const verifier = new HmacAuthVerifier(fakeCrypto, nullableKeyProvider);
    const parts = makeParts({ nonce: "replay-me" });
    const sig = await signer.sign(parts);
    expect(await verifier.verify(parts, sig)).toEqual({ ok: true });
    expect(await verifier.verify(parts, sig)).toEqual({ ok: false, reason: "replayed-nonce" });
  });

  it("no key available → not-paired", async () => {
    const verifier = new HmacAuthVerifier(fakeCrypto, async () => null);
    const parts = makeParts();
    // Signature value is irrelevant; not-paired is decided first.
    expect(await verifier.verify(parts, "whatever")).toEqual({ ok: false, reason: "not-paired" });
  });

  it("not-paired wins even with a valid-looking but stale ts", async () => {
    const verifier = new HmacAuthVerifier(fakeCrypto, async () => null, { windowMs: 1 });
    const parts = makeParts({ ts: 0 });
    expect(await verifier.verify(parts, "x")).toEqual({ ok: false, reason: "not-paired" });
  });

  it("LRU evicts oldest nonce so a very old nonce can be reused", async () => {
    const signer = new HmacAuthSigner(fakeCrypto, keyProvider);
    const verifier = new HmacAuthVerifier(fakeCrypto, nullableKeyProvider, { nonceCacheSize: 2 });
    const mk = (n: string) => makeParts({ nonce: n });

    const s1 = await signer.sign(mk("n1"));
    expect(await verifier.verify(mk("n1"), s1)).toEqual({ ok: true });
    const s2 = await signer.sign(mk("n2"));
    expect(await verifier.verify(mk("n2"), s2)).toEqual({ ok: true });
    // n3 evicts n1 (oldest) → seen={n2,n3}.
    const s3 = await signer.sign(mk("n3"));
    expect(await verifier.verify(mk("n3"), s3)).toEqual({ ok: true });
    // n2 is still resident → replay-rejected.
    expect(await verifier.verify(mk("n2"), s2)).toEqual({ ok: false, reason: "replayed-nonce" });
    // n1 was evicted → accepted again; recording it evicts the new oldest (n2).
    expect(await verifier.verify(mk("n1"), s1)).toEqual({ ok: true });
    // n2 was just evicted by the n1 record → no longer replay-rejected.
    expect(await verifier.verify(mk("n2"), s2)).toEqual({ ok: true });
  });
});

describe("constantTimeEqualHex", () => {
  it("returns true for identical strings", () => {
    expect(constantTimeEqualHex("abcd1234", "abcd1234")).toBe(true);
  });

  it("returns false for equal-length but different strings", () => {
    expect(constantTimeEqualHex("abcd1234", "abcd1235")).toBe(false);
  });

  it("returns false for unequal-length without throwing", () => {
    expect(() => constantTimeEqualHex("abcd", "abcd1234")).not.toThrow();
    expect(constantTimeEqualHex("abcd", "abcd1234")).toBe(false);
    expect(constantTimeEqualHex("abcd1234", "abcd")).toBe(false);
  });

  it("returns false when one side is empty", () => {
    expect(constantTimeEqualHex("", "abcd")).toBe(false);
    expect(constantTimeEqualHex("abcd", "")).toBe(false);
  });

  it("returns true for two empty strings", () => {
    expect(constantTimeEqualHex("", "")).toBe(true);
  });
});
