import { describe, it, expect } from "vitest";
import {
  generatePairingToken,
  tokenToKey,
  type PairingHasher,
  type PairingStore,
  type RandomBytes,
} from "./Pairing";

// Deterministic fake hasher: same FNV-1a-derived 64-hex digest used in the
// auth tests, so tokenToKey is reproducible without a real crypto backend.
function fnvHex64(s: string): string {
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

const fakeHasher: PairingHasher = {
  async sha256Hex(data: string): Promise<string> {
    return fnvHex64(data);
  },
};

describe("generatePairingToken", () => {
  it("produces 64 lowercase hex chars", () => {
    const token = generatePairingToken();
    expect(token).toHaveLength(64);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is unique across calls", () => {
    const tokens = new Set<string>();
    for (let i = 0; i < 100; i++) tokens.add(generatePairingToken());
    expect(tokens.size).toBe(100);
  });

  it("honors an injected RNG (deterministic)", () => {
    let call = 0;
    const rng: RandomBytes = (n) => {
      const a = new Uint8Array(n);
      for (let i = 0; i < n; i++) a[i] = (i + call) & 0xff;
      call++;
      return a;
    };
    const t1 = generatePairingToken(rng);
    expect(t1).toHaveLength(64);
    // 32 bytes 0x00..0x1f → "0001020304...1f"
    expect(t1.startsWith("000102030405")).toBe(true);
  });
});

describe("tokenToKey", () => {
  it("is deterministic for the same token", async () => {
    const token = "a".repeat(64);
    const k1 = await tokenToKey(token, fakeHasher);
    const k2 = await tokenToKey(token, fakeHasher);
    expect(Array.from(k1)).toEqual(Array.from(k2));
  });

  it("derives a 32-byte key from a 64-hex digest", async () => {
    const k = await tokenToKey("deadbeef", fakeHasher);
    expect(k).toBeInstanceOf(Uint8Array);
    expect(k.length).toBe(32);
  });

  it("different tokens → different keys", async () => {
    const ka = await tokenToKey("token-a", fakeHasher);
    const kb = await tokenToKey("token-b", fakeHasher);
    expect(Array.from(ka)).not.toEqual(Array.from(kb));
  });

  it("both devices derive the same key from the same token", async () => {
    // Simulate two independent devices each running tokenToKey on the shared
    // token with their own (identical-shape) hasher instance.
    const desktopHasher: PairingHasher = { sha256Hex: async (d) => fnvHex64(d) };
    const mobileHasher: PairingHasher = { sha256Hex: async (d) => fnvHex64(d) };
    const token = generatePairingToken();
    const desktopKey = await tokenToKey(token, desktopHasher);
    const mobileKey = await tokenToKey(token, mobileHasher);
    expect(Array.from(desktopKey)).toEqual(Array.from(mobileKey));
  });
});

describe("PairingStore (injected interface)", () => {
  it("an in-memory store satisfies get/set/clear", async () => {
    let stored: Uint8Array | null = null;
    const store: PairingStore = {
      getKey: async () => stored,
      setKey: async (k) => {
        stored = k;
      },
      clear: async () => {
        stored = null;
      },
    };
    expect(await store.getKey()).toBeNull();
    const key = await tokenToKey(generatePairingToken(), fakeHasher);
    await store.setKey(key);
    expect(Array.from((await store.getKey())!)).toEqual(Array.from(key));
    await store.clear();
    expect(await store.getKey()).toBeNull();
  });
});
