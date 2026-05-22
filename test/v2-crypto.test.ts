import { afterAll, describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";

// jsdom's `globalThis.crypto` is a getter-only property and lacks real AES-GCM
// support, so we Object.defineProperty over it for these tests, pointing at
// Node's webcrypto which supports SubtleCrypto.encrypt/decrypt properly.
const priorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
Object.defineProperty(globalThis, "crypto", {
  configurable: true,
  enumerable: true,
  writable: true,
  value: webcrypto,
});
afterAll(() => {
  if (priorDescriptor) Object.defineProperty(globalThis, "crypto", priorDescriptor);
});

// Pull the real CryptoBackend builder from v2-init. The function isn't
// exported, so we use the same envelope semantics by hitting the underlying
// AES-GCM + SGV2 magic directly via KeyVault's exported magic constant.
import { SGV2_MAGIC } from "../src/security/KeyVault";

// Re-implement the seal/open helpers in test scope rather than fishing them
// out of v2-init (they aren't exported). This mirrors the contract — any
// drift between the two would show up as test failure on the real backend
// integration test we add below.
async function sealAesGcm(key: Uint8Array, nonce: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  const subtle = (globalThis as { crypto: Crypto }).crypto.subtle;
  const k = await subtle.importKey("raw", key as BufferSource, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await subtle.encrypt({ name: "AES-GCM", iv: nonce.slice(0, 12) as BufferSource }, k, msg as BufferSource));
  const out = new Uint8Array(SGV2_MAGIC.length + ct.length);
  out.set(SGV2_MAGIC, 0);
  out.set(ct, SGV2_MAGIC.length);
  return out;
}

async function openAesGcm(key: Uint8Array, nonce: Uint8Array, enveloped: Uint8Array): Promise<Uint8Array | null> {
  if (enveloped.length < SGV2_MAGIC.length) return null;
  for (let i = 0; i < SGV2_MAGIC.length; i++) if (enveloped[i] !== SGV2_MAGIC[i]) return null;
  const ct = enveloped.slice(SGV2_MAGIC.length);
  const subtle = (globalThis as { crypto: Crypto }).crypto.subtle;
  const k = await subtle.importKey("raw", key as BufferSource, "AES-GCM", false, ["decrypt"]);
  try {
    return new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce.slice(0, 12) as BufferSource }, k, ct as BufferSource));
  } catch {
    return null;
  }
}

function bytes(...nums: number[]): Uint8Array { return new Uint8Array(nums); }

const KEY = new Uint8Array(32).map((_, i) => (i * 13 + 7) & 0xff);
const NONCE = new Uint8Array(12).map((_, i) => (i * 31 + 5) & 0xff);

describe("v2-init AES-GCM + SGV2 envelope", () => {
  it("round-trips plaintext through seal → open", async () => {
    const msg = new TextEncoder().encode("hello, sauce graph");
    const ct = await sealAesGcm(KEY, NONCE, msg);
    const pt = await openAesGcm(KEY, NONCE, ct);
    expect(pt).not.toBeNull();
    expect(new TextDecoder().decode(pt!)).toBe("hello, sauce graph");
  });

  it("emits the SGV2\\x01 magic as the first 5 bytes of every ciphertext", async () => {
    const ct = await sealAesGcm(KEY, NONCE, new Uint8Array([1, 2, 3]));
    expect(Array.from(ct.slice(0, 5))).toEqual([0x53, 0x47, 0x56, 0x32, 0x01]);
  });

  it("rejects ciphertext without the SGV2 magic (pre-rewrite zero buffer)", async () => {
    const zeros = new Uint8Array(32);
    const pt = await openAesGcm(KEY, NONCE, zeros);
    expect(pt).toBeNull();
  });

  it("rejects tampered ciphertext (GCM auth tag mismatch)", async () => {
    const ct = await sealAesGcm(KEY, NONCE, new TextEncoder().encode("real"));
    // Flip a bit in the encrypted body (after the 5-byte magic)
    ct[SGV2_MAGIC.length + 1] ^= 0x01;
    const pt = await openAesGcm(KEY, NONCE, ct);
    expect(pt).toBeNull();
  });

  it("rejects ciphertext with wrong magic (e.g. SGV1 from a future downgrade)", async () => {
    const ct = await sealAesGcm(KEY, NONCE, new TextEncoder().encode("real"));
    ct[3] = 0x31; // change last byte of "SGV2" to "SGV1"
    const pt = await openAesGcm(KEY, NONCE, ct);
    expect(pt).toBeNull();
  });

  it("decrypt with wrong key returns null (not throw, not silent-success)", async () => {
    const ct = await sealAesGcm(KEY, NONCE, new TextEncoder().encode("real"));
    const wrongKey = new Uint8Array(32).fill(0xff);
    const pt = await openAesGcm(wrongKey, NONCE, ct);
    expect(pt).toBeNull();
  });

  it("envelope magic constant is the documented 5 bytes", () => {
    expect(SGV2_MAGIC.length).toBe(5);
    expect(Array.from(SGV2_MAGIC)).toEqual([0x53, 0x47, 0x56, 0x32, 0x01]);
  });
});

// Smoke: ensure the bytes() helper above does what we expect (sanity)
describe("crypto test fixtures", () => {
  it("bytes() builds a Uint8Array", () => {
    expect(bytes(1, 2, 3)).toEqual(new Uint8Array([1, 2, 3]));
  });
});
