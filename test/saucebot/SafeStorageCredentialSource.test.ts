import { describe, it, expect } from "vitest";
import {
  SafeStorageCredentialSource,
  type SafeStorageLike,
  type SecretsIO,
} from "../../src/saucebot/SafeStorageCredentialSource";

// Fake safeStorage: "encrypt" = reversible base64 tag so we can assert ciphertext
// ≠ plaintext and that decrypt round-trips.
function fakeSS(available = true): SafeStorageLike {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plain) => Buffer.from("ENC:" + plain, "utf-8"),
    decryptString: (cipher) => {
      const s = cipher.toString("utf-8");
      if (!s.startsWith("ENC:")) throw new Error("bad cipher");
      return s.slice(4);
    },
  };
}
function memIO(): SecretsIO & { store: Record<string, string> } {
  const store: Record<string, string> = {};
  return {
    store,
    read: () => ({ ...store }),
    write: (m) => {
      for (const k of Object.keys(store)) delete store[k];
      Object.assign(store, m);
    },
  };
}

describe("SafeStorageCredentialSource", () => {
  it("round-trips a secret and persists CIPHERTEXT (not plaintext)", async () => {
    const io = memIO();
    const s = new SafeStorageCredentialSource(fakeSS(), io);
    expect(s.available()).toBe(true);
    await s.put("anthropic:key", "sk-secret-123");
    // stored value must be encrypted base64, never the raw secret
    expect(io.store["anthropic:key"]).toBeTruthy();
    expect(io.store["anthropic:key"]).not.toContain("sk-secret-123");
    expect(await s.get("anthropic:key")).toBe("sk-secret-123");
  });

  it("returns null for an absent service", async () => {
    const s = new SafeStorageCredentialSource(fakeSS(), memIO());
    expect(await s.get("missing")).toBeNull();
  });

  it("clear() and put('') both forget the secret", async () => {
    const io = memIO();
    const s = new SafeStorageCredentialSource(fakeSS(), io);
    await s.put("k1", "v1");
    await s.put("k2", "v2");
    await s.clear("k1");
    expect(await s.get("k1")).toBeNull();
    await s.put("k2", "");
    expect(await s.get("k2")).toBeNull();
    expect(Object.keys(io.store)).toHaveLength(0);
  });

  it("is unavailable when safeStorage is null → get null, put throws", async () => {
    const s = new SafeStorageCredentialSource(null, memIO());
    expect(s.available()).toBe(false);
    expect(await s.get("k")).toBeNull();
    await expect(s.put("k", "v")).rejects.toThrow(/safeStorage unavailable/);
  });

  it("is unavailable when OS reports encryption unavailable", async () => {
    const s = new SafeStorageCredentialSource(fakeSS(false), memIO());
    expect(s.available()).toBe(false);
    expect(await s.get("k")).toBeNull();
  });

  it("get() returns null (not throw) on a corrupt/foreign-keychain blob", async () => {
    const io = memIO();
    io.store["k"] = Buffer.from("not-our-cipher").toString("base64");
    const s = new SafeStorageCredentialSource(fakeSS(), io);
    expect(await s.get("k")).toBeNull();
  });
});
