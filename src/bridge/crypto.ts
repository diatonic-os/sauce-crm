// MOB-BRIDGE-001 — Web Crypto SHA-256 + HMAC-SHA256. Portable across desktop
// (Electron) and mobile (Capacitor WebView): both expose globalThis.crypto.subtle.
// The mobile signer and the desktop verifier both route through these, so their
// HMAC is identical by construction. Standard primitives only — no custom crypto.

function subtle(): SubtleCrypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c?.subtle) throw new Error("Web Crypto unavailable");
  return c.subtle;
}

function toHex(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!; // for-loop: i is always < bytes.length
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

export async function sha256Hex(data: string): Promise<string> {
  const digest = await subtle().digest(
    "SHA-256",
    new TextEncoder().encode(data),
  );
  return toHex(digest);
}

export async function hmacHex(key: Uint8Array, msg: string): Promise<string> {
  const k = await subtle().importKey(
    "raw",
    // TS 6.0 generic typed arrays: a Uint8Array<ArrayBufferLike> isn't a
    // BufferSource (could be SharedArrayBuffer-backed); ours never is.
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await subtle().sign("HMAC", k, new TextEncoder().encode(msg));
  return toHex(sig);
}

// ───────────────────────── transport encryption (app-layer) ─────────────────
//
// App-layer payload encryption for the bridge/daemon HTTP listeners. We never
// transmit the pairing key — instead each side derives a SEPARATE 256-bit
// transport key from the pairing key via HKDF-SHA256 (RFC 5869) under a fixed
// `info` label, so the HMAC-auth key and the AES key are cryptographically
// independent (compromise of one does not yield the other). The encrypted body
// is AES-256-GCM with a fresh random 12-byte IV per message; GCM's auth tag
// gives integrity + tamper detection on the ciphertext itself.
//
// Wire format (single base64 token, see contract.TRANSPORT_ENC_VERSION = "v1"):
//   base64( IV[12] || ciphertext[n] || tag[16] )
// WebCrypto's AES-GCM appends the 16-byte tag to the ciphertext, so the layout
// is simply: 12-byte IV prefix, followed by WebCrypto's (ciphertext||tag).

/** HKDF info label that domain-separates the transport (AES) subkey from the
 *  HMAC pairing key. Versioned so a future rotation is unambiguous. */
export const TRANSPORT_ENC_INFO = "sauce-bridge:transport-enc:v1";

const GCM_IV_BYTES = 12;
const GCM_TAG_BYTES = 16;

function bytesToBase64(bytes: Uint8Array): string {
  // Avoid String.fromCharCode(...spread) blowups on large buffers.
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  if (typeof btoa === "function") return btoa(bin);
  // Node headless fallback (no btoa in older runtimes).
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const buf = (globalThis as { Buffer?: typeof import("buffer").Buffer })
    .Buffer;
  if (buf) return buf.from(bytes).toString("base64");
  throw new Error("no base64 encoder available");
}

function base64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  if (typeof atob === "function") {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  const buf = (globalThis as { Buffer?: typeof import("buffer").Buffer })
    .Buffer;
  if (buf) return new Uint8Array(buf.from(b64, "base64"));
  throw new Error("no base64 decoder available");
}

/**
 * Derive a 256-bit transport-encryption subkey from the pairing key via
 * HKDF-SHA256 under {@link TRANSPORT_ENC_INFO}. Deterministic: both ends derive
 * the byte-identical key from the same pairing key. Returns a non-extractable
 * AES-GCM CryptoKey ready for encrypt/decrypt.
 */
export async function deriveTransportKey(
  pairingKey: Uint8Array,
): Promise<CryptoKey> {
  const ikm = await subtle().importKey("raw", pairingKey as BufferSource, "HKDF", false, [
    "deriveKey",
  ]);
  return subtle().deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      // Empty salt is RFC 5869-compliant (treated as a zero string of hashLen).
      salt: new Uint8Array(0),
      info: new TextEncoder().encode(TRANSPORT_ENC_INFO),
    },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt a UTF-8 plaintext under the derived transport key. Returns the base64
 * wire token `IV || ciphertext || tag`. A fresh random IV is minted per call.
 */
export async function transportEncrypt(
  key: CryptoKey,
  plaintext: string,
): Promise<string> {
  const iv = randomBytes(GCM_IV_BYTES);
  const ctWithTag = await subtle().encrypt(
    { name: "AES-GCM", iv, tagLength: GCM_TAG_BYTES * 8 },
    key,
    new TextEncoder().encode(plaintext),
  );
  const ct = new Uint8Array(ctWithTag);
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv, 0);
  out.set(ct, iv.length);
  return bytesToBase64(out);
}

/**
 * Decrypt a base64 wire token produced by {@link transportEncrypt}. Throws if
 * the token is malformed or the GCM tag fails to authenticate (tamper/replay of
 * ciphertext) — callers MUST treat any throw as a hard reject.
 */
export async function transportDecrypt(
  key: CryptoKey,
  wire: string,
): Promise<string> {
  const buf = base64ToBytes(wire);
  if (buf.length < GCM_IV_BYTES + GCM_TAG_BYTES) {
    throw new Error("transport: ciphertext too short");
  }
  const iv = buf.subarray(0, GCM_IV_BYTES);
  const ctWithTag = buf.subarray(GCM_IV_BYTES);
  const pt = await subtle().decrypt(
    { name: "AES-GCM", iv, tagLength: GCM_TAG_BYTES * 8 },
    key,
    ctWithTag,
  );
  return new TextDecoder().decode(pt);
}

/** Cryptographically-strong random bytes, Web Crypto with a guarded fallback. */
function randomBytes(n: number): Uint8Array<ArrayBuffer> {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && typeof c.getRandomValues === "function") {
    return c.getRandomValues(new Uint8Array(n));
  }
  throw new Error("Web Crypto getRandomValues unavailable");
}
