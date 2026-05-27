// MOB-BRIDGE-001 · T-C — device pairing.
//
// A pairing token is minted on the desktop, displayed to the operator, and
// entered on mobile. Both devices derive the SAME HMAC key from the token via
// `tokenToKey`, so neither device ever transmits the key itself.
//
// Portable by construction: the default RNG uses Web Crypto
// (crypto.getRandomValues), present on both Obsidian desktop and the mobile
// Capacitor WebView. A lazy `node:crypto` fallback exists ONLY for headless
// Node (tests/CI) and is required inside the fallback branch — never at module
// top level — so the mobile bundle has no static Node-builtin import.

/** Source of `n` random bytes. Injectable for deterministic tests. */
export type RandomBytes = (n: number) => Uint8Array;

/** Persistent home for the derived HMAC key. Production binds this to the
 *  KeyVault; it is injected here so this module never imports KeyVault and
 *  stays trivially testable. */
export interface PairingStore {
  /** Current pairing key, or null when the device is not paired. */
  getKey(): Promise<Uint8Array | null>;
  /** Persist a freshly derived pairing key. */
  setKey(key: Uint8Array): Promise<void>;
  /** Forget the pairing key (unpair). */
  clear(): Promise<void>;
}

/** Minimal hasher surface used to derive a key from a token. Matches
 *  ProvenanceCrypto.sha256Hex so production can pass the same crypto object. */
export interface PairingHasher {
  sha256Hex(data: string): Promise<string>;
}

const TOKEN_BYTES = 32; // → 64 hex chars

/** Default RNG: Web Crypto first (portable), lazy node:crypto fallback for
 *  headless environments. The Node require lives INSIDE this function so it is
 *  never statically imported into the mobile bundle. */
function defaultRandomBytes(n: number): Uint8Array {
  const wc: Crypto | undefined =
    typeof globalThis !== "undefined" ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  if (wc && typeof wc.getRandomValues === "function") {
    return wc.getRandomValues(new Uint8Array(n));
  }
  // Lazy, guarded Node fallback — only reached when Web Crypto is absent.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const nodeCrypto = require("crypto") as typeof import("node:crypto");
  return new Uint8Array(nodeCrypto.randomBytes(n));
}

function bytesToHex(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!; // for-loop: i is always < bytes.length
    out += b.toString(16).padStart(2, "0");
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const len = hex.length >> 1;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

/** Mint a fresh pairing token: 32 random bytes rendered as 64 lowercase hex
 *  chars. Unique per call (given a real RNG). */
export function generatePairingToken(rng: RandomBytes = defaultRandomBytes): string {
  return bytesToHex(rng(TOKEN_BYTES));
}

/**
 * Deterministically derive the shared HMAC key from a pairing token. Both
 * devices run this on the SAME token to obtain byte-identical keys, so the key
 * itself never crosses the wire. We domain-separate the hash input so a token
 * can't be confused with raw note content elsewhere in the system.
 */
export async function tokenToKey(token: string, hasher: PairingHasher): Promise<Uint8Array> {
  const digestHex = await hasher.sha256Hex(`sauce-bridge-pairing:v1:${token}`);
  return hexToBytes(digestHex);
}
