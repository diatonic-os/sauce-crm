// SPEC §18.2 — Argon2id-derived master key + AES-256-GCM secretbox per secret.
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

const KDF = { memKiB: 64 * 1024, passes: 3, parallelism: 2, outBytes: 32 };
const NONCE_BYTES = 24;
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
    sentinelService = "__kv_sentinel__",
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

  async masterKeyHmacBytes(): Promise<Uint8Array> {
    if (!this.masterKey) throw new Error("vault locked");
    return this.masterKey;
  }
}
