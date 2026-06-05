// SEC-05 / SEC-08 / SEC-03 — Unit tests for the new KeyVault methods:
//   • changeMasterPassword — verify-old, re-encrypt-all, atomic-ish swap
//   • resetVault — destructive wipe of store + sentinel
//   • deriveAuditHmacKey (SEC-08) — distinct, deterministic HKDF subkey
//   • 12-byte nonce + old-24-byte-blob decrypt compat (SEC-03)
//
// The CryptoBackend mirrors the live one in v2-init.ts (PBKDF2-SHA256 +
// AES-256-GCM under the SGV2 envelope, WebCrypto-backed). We point globalThis
// .crypto at Node's webcrypto exactly like test/v2-crypto.test.ts does.

import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { webcrypto } from "node:crypto";

const priorDescriptor = Object.getOwnPropertyDescriptor(globalThis, "crypto");
Object.defineProperty(globalThis, "crypto", {
  configurable: true,
  enumerable: true,
  writable: true,
  value: webcrypto,
});
afterAll(() => {
  if (priorDescriptor)
    Object.defineProperty(globalThis, "crypto", priorDescriptor);
});

import {
  JsonSecretStore,
  KeyVault,
  SGV2_MAGIC,
  KV_SENTINEL_SERVICE,
  type CryptoBackend,
} from "./KeyVault";

// ── Test crypto backend (mirrors v2-init makeCryptoBackend) ────────────────
function subtle(): SubtleCrypto {
  return (globalThis as { crypto: Crypto }).crypto.subtle;
}

async function sealAesGcm(
  key: Uint8Array,
  nonce: Uint8Array,
  msg: Uint8Array,
): Promise<Uint8Array> {
  const k = await subtle().importKey(
    "raw",
    key as BufferSource,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const ct = new Uint8Array(
    await subtle().encrypt(
      { name: "AES-GCM", iv: nonce.slice(0, 12) as BufferSource },
      k,
      msg as BufferSource,
    ),
  );
  const out = new Uint8Array(SGV2_MAGIC.length + ct.length);
  out.set(SGV2_MAGIC, 0);
  out.set(ct, SGV2_MAGIC.length);
  return out;
}

async function openAesGcm(
  key: Uint8Array,
  nonce: Uint8Array,
  enveloped: Uint8Array,
): Promise<Uint8Array | null> {
  if (enveloped.length < SGV2_MAGIC.length) return null;
  for (let i = 0; i < SGV2_MAGIC.length; i++)
    if (enveloped[i] !== SGV2_MAGIC[i]) return null;
  const ct = enveloped.slice(SGV2_MAGIC.length);
  const k = await subtle().importKey(
    "raw",
    key as BufferSource,
    "AES-GCM",
    false,
    ["decrypt"],
  );
  try {
    return new Uint8Array(
      await subtle().decrypt(
        { name: "AES-GCM", iv: nonce.slice(0, 12) as BufferSource },
        k,
        ct as BufferSource,
      ),
    );
  } catch {
    return null;
  }
}

function makeCryptoBackend(): CryptoBackend {
  return {
    async argon2id(password, salt, opts) {
      const km = await subtle().importKey(
        "raw",
        new TextEncoder().encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveBits"],
      );
      const bits = await subtle().deriveBits(
        {
          name: "PBKDF2",
          salt: salt as BufferSource,
          iterations: 200_000 * opts.passes,
          hash: "SHA-256",
        },
        km,
        opts.outBytes * 8,
      );
      return new Uint8Array(bits);
    },
    secretboxSeal: (key, nonce, msg) => sealAesGcm(key, nonce, msg),
    secretboxOpen: (key, nonce, ct) => openAesGcm(key, nonce, ct),
    randomBytes(n) {
      const out = new Uint8Array(n);
      (globalThis as { crypto: Crypto }).crypto.getRandomValues(out);
      return out;
    },
  };
}

function makeVault() {
  let data: Record<string, unknown> = {};
  const store = new JsonSecretStore(
    async () => data,
    async (d) => {
      data = d;
    },
  );
  const kv = new KeyVault(store, makeCryptoBackend());
  return { kv, store, peek: () => data };
}

describe("KeyVault.changeMasterPassword (SEC-05)", () => {
  let h: ReturnType<typeof makeVault>;
  beforeEach(() => {
    h = makeVault();
  });

  it("re-encrypts all secrets and unlocks under the new password", async () => {
    await h.kv.unlock("old-pass");
    await h.kv.put("svc:a", "alpha");
    await h.kv.put("svc:b", "beta");

    await h.kv.changeMasterPassword("old-pass", "new-pass");

    // Session stays usable under the rotated key.
    expect(await h.kv.get("svc:a")).toBe("alpha");
    expect(await h.kv.get("svc:b")).toBe("beta");

    // A fresh vault over the same store opens with the NEW password…
    const fresh = new KeyVault(h.store, makeCryptoBackend());
    await fresh.unlock("new-pass");
    expect(await fresh.get("svc:a")).toBe("alpha");

    // …and the OLD password no longer opens it.
    const stale = new KeyVault(h.store, makeCryptoBackend());
    await expect(stale.unlock("old-pass")).rejects.toThrow(/invalid password/);
  });

  it("rejects a wrong old password without mutating the store", async () => {
    await h.kv.unlock("old-pass");
    await h.kv.put("svc:a", "alpha");
    const before = JSON.stringify(h.peek());

    await expect(
      h.kv.changeMasterPassword("WRONG", "new-pass"),
    ).rejects.toThrow(/invalid old password/);

    expect(JSON.stringify(h.peek())).toBe(before);
    // Old password still works.
    const fresh = new KeyVault(h.store, makeCryptoBackend());
    await fresh.unlock("old-pass");
    expect(await fresh.get("svc:a")).toBe("alpha");
  });

  it("throws when there is no vault to change", async () => {
    await expect(h.kv.changeMasterPassword("a", "b")).rejects.toThrow(
      /no vault/,
    );
  });

  it("rotates the sentinel salt so the new key derives from a fresh salt", async () => {
    await h.kv.unlock("old-pass");
    const saltBefore = Array.from(
      (h.peek()[KV_SENTINEL_SERVICE] as { kdfSalt: number[] }).kdfSalt,
    );
    await h.kv.changeMasterPassword("old-pass", "new-pass");
    const saltAfter = Array.from(
      (h.peek()[KV_SENTINEL_SERVICE] as { kdfSalt: number[] }).kdfSalt,
    );
    expect(saltAfter).not.toEqual(saltBefore);
  });
});

describe("KeyVault.resetVault (SEC-05)", () => {
  it("wipes all secrets and the sentinel, allowing a fresh password", async () => {
    const h = makeVault();
    await h.kv.unlock("pass-1");
    await h.kv.put("svc:a", "alpha");

    expect(await h.kv.hasVault()).toBe(true);
    await h.kv.resetVault();

    expect(await h.kv.hasVault()).toBe(false);
    expect(h.kv.isLocked()).toBe(true);
    expect(Object.keys(h.peek())).toHaveLength(0);

    // A brand-new password provisions a clean vault; old secret is gone.
    await h.kv.unlock("pass-2");
    await expect(h.kv.get("svc:a")).rejects.toThrow(/no secret/);
  });
});

describe("KeyVault.deriveAuditHmacKey (SEC-08)", () => {
  it("derives a key DISTINCT from the raw master key", async () => {
    const h = makeVault();
    await h.kv.unlock("pass");
    const audit = await h.kv.deriveAuditHmacKey();
    // The sentinel salt + KDF lets us recompute the raw master key for the assertion.
    const sentinel = h.peek()[KV_SENTINEL_SERVICE] as { kdfSalt: number[] };
    const raw = await makeCryptoBackend().argon2id(
      "pass",
      new Uint8Array(sentinel.kdfSalt),
      { memKiB: 0, passes: 3, parallelism: 0, outBytes: 32 },
    );
    expect(Array.from(audit)).not.toEqual(Array.from(raw));
    expect(audit.length).toBe(32);
  });

  it("is deterministic: same password yields the same audit key across unlocks", async () => {
    const h = makeVault();
    await h.kv.unlock("pass");
    const a = await h.kv.deriveAuditHmacKey();
    h.kv.lock();
    await h.kv.unlock("pass");
    const b = await h.kv.deriveAuditHmacKey();
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it("masterKeyHmacBytes alias returns the derived subkey (not the raw key)", async () => {
    const h = makeVault();
    await h.kv.unlock("pass");
    const viaAlias = await h.kv.masterKeyHmacBytes();
    const viaName = await h.kv.deriveAuditHmacKey();
    expect(Array.from(viaAlias)).toEqual(Array.from(viaName));
  });

  it("throws when locked", async () => {
    const h = makeVault();
    await expect(h.kv.deriveAuditHmacKey()).rejects.toThrow(/locked/);
  });
});

describe("KeyVault nonce (SEC-03)", () => {
  it("writes a 12-byte nonce for new secrets", async () => {
    const h = makeVault();
    await h.kv.unlock("pass");
    await h.kv.put("svc:a", "alpha");
    const row = h.peek()["svc:a"] as { nonce: number[] };
    expect(row.nonce).toHaveLength(12);
  });

  it("still decrypts a legacy 24-byte-nonce blob (backward compat)", async () => {
    const h = makeVault();
    await h.kv.unlock("pass");
    // Simulate a legacy write: seal with a 24-byte nonce (only first 12 used).
    const masterKey = await h.kv.deriveAuditHmacKey(); // proves unlocked; not used for seal
    expect(masterKey.length).toBe(32);
    // Reach into the store with a hand-crafted 24-byte nonce row using the same
    // master key path as put(): re-derive the raw key via the backend.
    const sentinel = h.peek()[KV_SENTINEL_SERVICE] as { kdfSalt: number[] };
    const raw = await makeCryptoBackend().argon2id(
      "pass",
      new Uint8Array(sentinel.kdfSalt),
      { memKiB: 0, passes: 3, parallelism: 0, outBytes: 32 },
    );
    const nonce24 = makeCryptoBackend().randomBytes(24);
    const ct = await sealAesGcm(
      raw,
      nonce24,
      new TextEncoder().encode("legacy"),
    );
    await h.store.put("svc:legacy", {
      service: "svc:legacy",
      ciphertext: ct,
      nonce: nonce24,
      kdfSalt: new Uint8Array(sentinel.kdfSalt),
      kdfIters: 3,
      createdTs: Date.now(),
      rotatedTs: null,
    });
    expect(await h.kv.get("svc:legacy")).toBe("legacy");
  });
});
