// Transport-encryption (app-layer AES-256-GCM) specs for crypto.ts. Runs on the
// real Web Crypto provided by the Node test runtime — no mocks: we want to know
// the actual primitives round-trip and that tamper is rejected by the GCM tag.

import { describe, expect, it } from "vitest";

import {
  deriveTransportKey,
  transportEncrypt,
  transportDecrypt,
  TRANSPORT_ENC_INFO,
} from "./crypto";

const pairingKey = (seed = 1): Uint8Array => {
  const b = new Uint8Array(32);
  for (let i = 0; i < b.length; i++) b[i] = (seed * 31 + i) & 0xff;
  return b;
};

describe("transport encryption (AES-256-GCM over HKDF subkey)", () => {
  it("round-trips a UTF-8 payload", async () => {
    const key = await deriveTransportKey(pairingKey());
    const pt = JSON.stringify({
      hits: [{ path: "people/Jane.md", fp: "abc" }],
    });
    const wire = await transportEncrypt(key, pt);
    expect(wire).not.toContain("Jane"); // ciphertext, not cleartext
    const back = await transportDecrypt(key, wire);
    expect(back).toBe(pt);
  });

  it("uses a fresh IV per call (ciphertext differs for identical plaintext)", async () => {
    const key = await deriveTransportKey(pairingKey());
    const a = await transportEncrypt(key, "same");
    const b = await transportEncrypt(key, "same");
    expect(a).not.toBe(b);
    expect(await transportDecrypt(key, a)).toBe("same");
    expect(await transportDecrypt(key, b)).toBe("same");
  });

  it("derives byte-identical keys on both ends from the same pairing key", async () => {
    const k1 = await deriveTransportKey(pairingKey(7));
    const k2 = await deriveTransportKey(pairingKey(7));
    const wire = await transportEncrypt(k1, "cross-device");
    // Decrypt with the INDEPENDENTLY derived key — must succeed.
    expect(await transportDecrypt(k2, wire)).toBe("cross-device");
  });

  it("HKDF info domain-separates: a different pairing key cannot decrypt", async () => {
    const k1 = await deriveTransportKey(pairingKey(1));
    const k2 = await deriveTransportKey(pairingKey(2));
    const wire = await transportEncrypt(k1, "secret");
    await expect(transportDecrypt(k2, wire)).rejects.toBeTruthy();
  });

  it("rejects tampered ciphertext (GCM tag failure)", async () => {
    const key = await deriveTransportKey(pairingKey());
    const wire = await transportEncrypt(key, "integrity-protected");
    // Flip a base64 char in the middle of the token.
    const mid = Math.floor(wire.length / 2);
    const flipped =
      wire.slice(0, mid) +
      (wire[mid] === "A" ? "B" : "A") +
      wire.slice(mid + 1);
    await expect(transportDecrypt(key, flipped)).rejects.toBeTruthy();
  });

  it("rejects a truncated token (too short for IV+tag)", async () => {
    const key = await deriveTransportKey(pairingKey());
    await expect(transportDecrypt(key, "AAAA")).rejects.toThrow(/too short/);
  });

  it("exposes a versioned, stable HKDF info label", () => {
    expect(TRANSPORT_ENC_INFO).toBe("sauce-bridge:transport-enc:v1");
  });
});
