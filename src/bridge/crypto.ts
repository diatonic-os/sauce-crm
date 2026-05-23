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
  for (let i = 0; i < bytes.length; i++) out += bytes[i].toString(16).padStart(2, "0");
  return out;
}

export async function sha256Hex(data: string): Promise<string> {
  const digest = await subtle().digest("SHA-256", new TextEncoder().encode(data));
  return toHex(digest);
}

export async function hmacHex(key: Uint8Array, msg: string): Promise<string> {
  const k = await subtle().importKey(
    "raw",
    key as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await subtle().sign("HMAC", k, new TextEncoder().encode(msg));
  return toHex(sig);
}
