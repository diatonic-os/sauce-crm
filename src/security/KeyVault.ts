// SPEC §18.2 — master key derived via PBKDF2-SHA256 (600k iterations) + an
// AES-256-GCM "secretbox" per secret. (The CryptoBackend method is named
// `argon2id` for historical reasons; the live backend in v2-init.ts implements
// it with PBKDF2-SHA256 — Argon2id would need a native dep we choose not to
// ship. UI/doc copy must say "PBKDF2-SHA256 (600k iterations) + AES-256-GCM".)
// Storage: the `api_keys_enc` table on the LanceDB single-backend, via the
// ISecretStore interface (implemented by LanceSecretStore).
// SGV2 envelope: every ciphertext written by secretboxSeal is prefixed with
// the 5-byte magic `SGV2\x01` so we can reject anything that pre-dates the
// async-AES-GCM rewrite (DEC §A2). secretboxOpen verifies the magic before
// attempting decryption.

import type { Logger } from "../telemetry";

export interface ISecretStore {
  put(service: string, row: EncryptedSecret): Promise<void>;
  get(service: string): Promise<EncryptedSecret | null>;
  list(): Promise<string[]>;
  remove(service: string): Promise<void>;
}

export interface EncryptedSecret {
  service: string;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  kdfSalt: Uint8Array;
  kdfIters: number;
  createdTs: number;
  rotatedTs: number | null;
}

export interface CryptoBackend {
  argon2id(
    password: string,
    salt: Uint8Array,
    opts: {
      memKiB: number;
      passes: number;
      parallelism: number;
      outBytes: number;
    },
  ): Promise<Uint8Array>;
  secretboxSeal(
    key: Uint8Array,
    nonce: Uint8Array,
    msg: Uint8Array,
  ): Promise<Uint8Array>;
  secretboxOpen(
    key: Uint8Array,
    nonce: Uint8Array,
    ct: Uint8Array,
  ): Promise<Uint8Array | null>;
  randomBytes(n: number): Uint8Array;
}

/** SGV2 envelope magic prefixed to every ciphertext emitted by the v2 AES-GCM
 * backend. Allows the open path to reject pre-rewrite zero-buffer "ciphertexts"
 * and any future envelope-format drift without silent-failure decryption. */
export const SGV2_MAGIC = new Uint8Array([0x53, 0x47, 0x56, 0x32, 0x01]); // "SGV2\x01"

/** Default sentinel service row — proves the master password and anchors the
 *  KDF salt. Used by unlock / changeMasterPassword / resetVault. */
export const KV_SENTINEL_SERVICE = "__kv_sentinel__";

const KDF = { memKiB: 64 * 1024, passes: 3, parallelism: 2, outBytes: 32 };
// AES-GCM uses a 96-bit (12-byte) IV. Previously this was 24 (a NaCl-secretbox
// holdover) but the AES-GCM backend only ever consumed nonce.slice(0,12), so the
// trailing 12 bytes were dead weight. We now generate exactly 12. Backward-compat:
// old stored blobs carry a 24-byte nonce field; decrypt still works because both
// seal and open slice(0,12), so the same first 12 bytes are used. (SEC-03)
const NONCE_BYTES = 12;
const SALT_BYTES = 16;

/**
 * In-memory / JSON-blob ISecretStore. **Test & dev harnesses only** — it is NOT
 * wired into the plugin runtime, which uses LanceSecretStore (the LanceDB
 * single-backend) exclusively. Kept so the live e2e scripts under test/ can run
 * without a LanceDB connection.
 */
export class JsonSecretStore implements ISecretStore {
  constructor(
    private readonly load: () => Promise<Record<string, unknown>>,
    private readonly save: (d: Record<string, unknown>) => Promise<void>,
  ) {}
  async put(service: string, row: EncryptedSecret): Promise<void> {
    const d = await this.load();
    d[service] = {
      ciphertext: Array.from(row.ciphertext),
      nonce: Array.from(row.nonce),
      kdfSalt: Array.from(row.kdfSalt),
      kdfIters: row.kdfIters,
      createdTs: row.createdTs,
      rotatedTs: row.rotatedTs,
    };
    await this.save(d);
  }
  async get(service: string): Promise<EncryptedSecret | null> {
    const d = await this.load();
    const r = d[service] as
      | {
          ciphertext: number[];
          nonce: number[];
          kdfSalt: number[];
          kdfIters: number;
          createdTs: number;
          rotatedTs: number | null;
        }
      | undefined;
    if (!r) return null;
    return {
      service,
      ciphertext: new Uint8Array(r.ciphertext),
      nonce: new Uint8Array(r.nonce),
      kdfSalt: new Uint8Array(r.kdfSalt),
      kdfIters: r.kdfIters,
      createdTs: r.createdTs,
      rotatedTs: r.rotatedTs,
    };
  }
  async list(): Promise<string[]> {
    return Object.keys(await this.load()).sort();
  }
  async remove(service: string): Promise<void> {
    const d = await this.load();
    delete d[service];
    await this.save(d);
  }
}

export class KeyVault {
  private masterKey: Uint8Array | null = null;
  private lastUnlock = 0;
  private autoLockMs = 30 * 60 * 1000;
  private cachedSalt: Uint8Array | null = null;

  constructor(
    private readonly store: ISecretStore,
    private readonly crypto: CryptoBackend,
    private readonly logger: Logger | null = null,
  ) {}

  private async timed<T>(
    op: string,
    service: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const t0 = Date.now();
    try {
      const result = await fn();
      this.logger?.event("crypto.op", {
        op,
        service,
        ok: true,
        ms: Date.now() - t0,
      });
      return result;
    } catch (e) {
      this.logger?.event("crypto.op", {
        op,
        service,
        ok: false,
        ms: Date.now() - t0,
        error: String(e),
      });
      throw e;
    }
  }

  isLocked(): boolean {
    if (!this.masterKey) return true;
    if (this.autoLockMs > 0 && Date.now() - this.lastUnlock > this.autoLockMs) {
      this.lock();
      return true;
    }
    return false;
  }

  setAutoLockMinutes(n: number): void {
    this.autoLockMs = Math.max(0, n) * 60 * 1000;
  }

  async unlock(
    password: string,
    sentinelService = KV_SENTINEL_SERVICE,
  ): Promise<void> {
    await this.timed("unlock", sentinelService, async () => {
      const existing = await this.store.get(sentinelService);
      if (existing) {
        const key = await this.crypto.argon2id(password, existing.kdfSalt, KDF);
        const open = await this.crypto.secretboxOpen(
          key,
          existing.nonce,
          existing.ciphertext,
        );
        if (!open) throw new Error("invalid password");
        this.masterKey = key;
        this.cachedSalt = existing.kdfSalt;
      } else {
        const salt = this.crypto.randomBytes(SALT_BYTES);
        const key = await this.crypto.argon2id(password, salt, KDF);
        const nonce = this.crypto.randomBytes(NONCE_BYTES);
        const sentinel = new TextEncoder().encode("sauce-graph-kv-v1");
        const ct = await this.crypto.secretboxSeal(key, nonce, sentinel);
        await this.store.put(sentinelService, {
          service: sentinelService,
          ciphertext: ct,
          nonce,
          kdfSalt: salt,
          kdfIters: KDF.passes,
          createdTs: Date.now(),
          rotatedTs: null,
        });
        this.masterKey = key;
        this.cachedSalt = salt;
      }
      this.lastUnlock = Date.now();
    });
  }

  lock(): void {
    this.masterKey = null;
    this.cachedSalt = null;
  }

  async put(service: string, secret: string): Promise<void> {
    if (this.isLocked() || !this.masterKey || !this.cachedSalt)
      throw new Error("vault locked");
    await this.timed("put", service, async () => {
      const nonce = this.crypto.randomBytes(NONCE_BYTES);
      const ct = await this.crypto.secretboxSeal(
        this.masterKey!,
        nonce,
        new TextEncoder().encode(secret),
      );
      await this.store.put(service, {
        service,
        ciphertext: ct,
        nonce,
        kdfSalt: this.cachedSalt!,
        kdfIters: KDF.passes,
        createdTs: Date.now(),
        rotatedTs: null,
      });
    });
  }

  async get(service: string): Promise<string> {
    if (this.isLocked() || !this.masterKey) throw new Error("vault locked");
    return this.timed("get", service, async () => {
      const row = await this.store.get(service);
      if (!row) throw new Error(`no secret: ${service}`);
      const pt = await this.crypto.secretboxOpen(
        this.masterKey!,
        row.nonce,
        row.ciphertext,
      );
      if (!pt) throw new Error("decrypt failed");
      return new TextDecoder().decode(pt);
    });
  }

  async rotate(service: string, newSecret: string): Promise<void> {
    await this.put(service, newSecret);
    const row = await this.store.get(service);
    if (row) await this.store.put(service, { ...row, rotatedTs: Date.now() });
  }

  async list(): Promise<string[]> {
    return (await this.store.list()).filter((s) => !s.startsWith("__"));
  }

  /**
   * SEC-08 — Derive a distinct HMAC subkey for the audit log instead of handing
   * out the raw AES master key. Uses HKDF-SHA256 (WebCrypto) with a fixed,
   * non-secret info string so the derivation is deterministic: the SAME master
   * password yields the SAME audit subkey every session, which preserves
   * audit-chain verifiability across unlocks (existing chains signed under this
   * subkey still verify after a relock/unlock with the same password).
   *
   * Audit-chain compatibility note: chains written before this change were
   * signed with the RAW master key. They will NOT verify under the derived
   * subkey. There is no in-place migration here (the audit log is append-only
   * and storage-agnostic); a re-key event is expected to roll the chain forward
   * under the new subkey. The same-password-same-subkey guarantee above means no
   * *future* breakage on relock — only the one-time transition off the raw key.
   */
  async deriveAuditHmacKey(): Promise<Uint8Array> {
    if (!this.masterKey) throw new Error("vault locked");
    return hkdfSha256(this.masterKey, "audit-hmac", 32);
  }

  /**
   * @deprecated SEC-08 — Renamed to {@link deriveAuditHmacKey}. Previously this
   * returned the RAW AES master key, which AuditLog then used directly as an
   * HMAC key (key reuse across two primitives). It now returns the HKDF-derived
   * audit subkey. Retained as an alias only so external callers (v2-init's
   * AuditLog/Provenance masterKey closures) keep compiling; prefer
   * `deriveAuditHmacKey` in new code.
   */
  async masterKeyHmacBytes(): Promise<Uint8Array> {
    return this.deriveAuditHmacKey();
  }

  /** True once a vault has been provisioned (sentinel row exists). Lets the UI
   *  distinguish "set a new master password" from "unlock the existing vault". */
  async hasVault(sentinelService = KV_SENTINEL_SERVICE): Promise<boolean> {
    return (await this.store.get(sentinelService)) !== null;
  }

  /**
   * SEC-05 — Change the master password. Verifies `oldPw` (decrypts the
   * sentinel), then decrypts every stored secret under the OLD key and
   * re-encrypts under a freshly derived NEW key (new salt), rewriting the
   * sentinel last so the swap is observable only once every entry is re-keyed.
   *
   * Re-encryption happens entry-by-entry into the store; the sentinel is
   * rewritten at the very end. If the process is interrupted mid-way, entries
   * already rewritten are under the new key while the sentinel still proves the
   * old one — so a retry with the old password would fail to read the rewritten
   * entries. We minimize that window by rewriting the sentinel last and keeping
   * the in-memory key pointed at the new key only after a clean pass. There is
   * no cross-row transaction at the ISecretStore layer to lean on.
   */
  async changeMasterPassword(
    oldPw: string,
    newPw: string,
    sentinelService = KV_SENTINEL_SERVICE,
  ): Promise<void> {
    if (!oldPw || !newPw) throw new Error("passwords must be non-empty");
    await this.timed("change-master-password", sentinelService, async () => {
      const sentinel = await this.store.get(sentinelService);
      if (!sentinel)
        throw new Error("no vault to change (set a password first)");

      // Verify old password by opening the sentinel.
      const oldKey = await this.crypto.argon2id(oldPw, sentinel.kdfSalt, KDF);
      const proof = await this.crypto.secretboxOpen(
        oldKey,
        sentinel.nonce,
        sentinel.ciphertext,
      );
      if (!proof) throw new Error("invalid old password");

      // Derive the new key under a fresh salt.
      const newSalt = this.crypto.randomBytes(SALT_BYTES);
      const newKey = await this.crypto.argon2id(newPw, newSalt, KDF);

      // Re-encrypt every non-sentinel secret: decrypt under oldKey, seal under newKey.
      const services = (await this.store.list()).filter(
        (s) => s !== sentinelService,
      );
      for (const service of services) {
        const row = await this.store.get(service);
        if (!row) continue;
        const pt = await this.crypto.secretboxOpen(
          oldKey,
          row.nonce,
          row.ciphertext,
        );
        if (!pt) throw new Error(`re-key failed: cannot decrypt ${service}`);
        const nonce = this.crypto.randomBytes(NONCE_BYTES);
        const ct = await this.crypto.secretboxSeal(newKey, nonce, pt);
        await this.store.put(service, {
          ...row,
          ciphertext: ct,
          nonce,
          kdfSalt: newSalt,
          rotatedTs: Date.now(),
        });
      }

      // Rewrite the sentinel under the new key LAST (commit point).
      const sentinelNonce = this.crypto.randomBytes(NONCE_BYTES);
      const sentinelPt = new TextEncoder().encode("sauce-graph-kv-v1");
      const sentinelCt = await this.crypto.secretboxSeal(
        newKey,
        sentinelNonce,
        sentinelPt,
      );
      await this.store.put(sentinelService, {
        service: sentinelService,
        ciphertext: sentinelCt,
        nonce: sentinelNonce,
        kdfSalt: newSalt,
        kdfIters: KDF.passes,
        createdTs: sentinel.createdTs,
        rotatedTs: Date.now(),
      });

      // Adopt the new key in memory so the session stays unlocked.
      this.masterKey = newKey;
      this.cachedSalt = newSalt;
      this.lastUnlock = Date.now();
    });
  }

  /**
   * SEC-05 — Destructive reset. Wipes every stored secret AND the sentinel so a
   * fresh master password can be provisioned via the next `unlock()`. All
   * encrypted secrets are irrecoverably lost. Locks the vault afterward.
   */
  async resetVault(sentinelService = KV_SENTINEL_SERVICE): Promise<void> {
    await this.timed("reset-vault", sentinelService, async () => {
      const services = await this.store.list();
      for (const service of services) {
        await this.store.remove(service);
      }
      // Ensure the sentinel is gone even if list() filtered it out.
      await this.store.remove(sentinelService);
    });
    this.lock();
  }
}

/**
 * HKDF-SHA256 (extract + expand) via WebCrypto. Deterministic for a given
 * (ikm, info) pair — no random salt — so derived subkeys are stable across
 * sessions, which audit-chain verification depends on. (SEC-08)
 */
async function hkdfSha256(
  ikm: Uint8Array,
  info: string,
  outBytes: number,
): Promise<Uint8Array> {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto
    ?.subtle;
  if (!subtle) throw new Error("Web Crypto unavailable for HKDF");
  const base = await subtle.importKey(
    "raw",
    ikm as BufferSource,
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(0) as BufferSource,
      info: new TextEncoder().encode(info) as BufferSource,
    },
    base,
    outBytes * 8,
  );
  return new Uint8Array(bits);
}
