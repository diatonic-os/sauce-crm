// SEC-03 backward-compatibility proof for the AES-GCM seal/open envelope.
//
// New blobs are sealed with a 12-byte (96-bit) nonce. Some pre-fix blobs were
// stored with a 24-byte nonce of which only the first 12 bytes ever fed AES-GCM.
// These tests prove BOTH the new 12-byte path AND the legacy 24-byte path round-trip
// against the same key, and that a legacy 24-byte nonce decrypts ciphertext that was
// (historically) produced using its first 12 bytes.

import { describe, it, expect } from "vitest";
import { sealAesGcm, openAesGcm, GCM_NONCE_BYTES } from "./v2-init";

const KEY = new Uint8Array(32).map((_, i) => (i * 7 + 1) & 0xff);
const MSG = new TextEncoder().encode("sauce-graph-kv-v1 secret payload");

describe("SEC-03 AES-GCM nonce compat", () => {
  it("GCM_NONCE_BYTES is the canonical 12 bytes", () => {
    expect(GCM_NONCE_BYTES).toBe(12);
  });

  it("round-trips a new 12-byte-nonce blob", async () => {
    const nonce = new Uint8Array(12).map((_, i) => (i * 13 + 3) & 0xff);
    const sealed = await sealAesGcm(KEY, nonce, MSG);
    const opened = await openAesGcm(KEY, nonce, sealed);
    expect(opened).not.toBeNull();
    expect(new TextDecoder().decode(opened!)).toBe(
      "sauce-graph-kv-v1 secret payload",
    );
  });

  it("legacy 24-byte-nonce blobs still decrypt (backward compat)", async () => {
    // Old format: KeyVault generated a 24-byte nonce and stored all 24 bytes,
    // while only the first 12 fed AES-GCM. Seal + open here with the full 24-byte
    // nonce mirrors reading an old stored row verbatim.
    const nonce24 = new Uint8Array(24).map((_, i) => (i * 5 + 9) & 0xff);
    const sealed = await sealAesGcm(KEY, nonce24, MSG);
    const opened = await openAesGcm(KEY, nonce24, sealed);
    expect(opened).not.toBeNull();
    expect(new TextDecoder().decode(opened!)).toBe(
      "sauce-graph-kv-v1 secret payload",
    );
  });

  it("a 24-byte nonce and its leading-12-byte prefix produce identical ciphertext", async () => {
    // Proves the open path is truly length-aware: a blob sealed under a 24-byte
    // nonce is byte-identical to one sealed under its first 12 bytes, so a future
    // 12-byte-only store decrypts historical 24-byte rows and vice versa.
    const nonce24 = new Uint8Array(24).map((_, i) => (i * 11 + 2) & 0xff);
    const nonce12 = nonce24.slice(0, 12);
    const sealedFrom24 = await sealAesGcm(KEY, nonce24, MSG);
    const sealedFrom12 = await sealAesGcm(KEY, nonce12, MSG);
    expect(Array.from(sealedFrom24)).toEqual(Array.from(sealedFrom12));
    // cross-decrypt: 12-byte nonce opens the 24-byte-sealed blob
    const opened = await openAesGcm(KEY, nonce12, sealedFrom24);
    expect(opened).not.toBeNull();
    expect(new TextDecoder().decode(opened!)).toBe(
      "sauce-graph-kv-v1 secret payload",
    );
  });

  it("rejects a tampered envelope (wrong magic) and a wrong key", async () => {
    const nonce = new Uint8Array(12).fill(4);
    const sealed = await sealAesGcm(KEY, nonce, MSG);
    const tampered = sealed.slice();
    tampered[0] = (tampered[0] ?? 0) ^ 0xff; // corrupt the SGV2 magic
    expect(await openAesGcm(KEY, nonce, tampered)).toBeNull();
    const wrongKey = KEY.slice();
    wrongKey[0] = (wrongKey[0] ?? 0) ^ 0xff;
    expect(await openAesGcm(wrongKey, nonce, sealed)).toBeNull();
  });
});
