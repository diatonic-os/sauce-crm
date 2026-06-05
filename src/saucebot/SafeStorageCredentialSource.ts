// CredentialSource backed by Electron's safeStorage — the OS "core secrets
// vault" (Keychain on macOS, libsecret on Linux, DPAPI on Windows). Secrets are
// encrypted with a key held by the OS keychain; only the resulting ciphertext is
// persisted (base64) to a file OUTSIDE the vault. No master password to unlock.
//
// Per GR-005: the secret-protecting key lives in the OS credential store; the
// on-disk file is keychain-bound ciphertext, useless without the OS keychain.
//
// Both safeStorage and the file IO are INJECTED so the logic unit-tests with
// fakes; `makeSafeStorageCredentialSource` wires the real Electron + fs.

import type { CredentialSource } from "./CredentialSource";
import { tryRequire } from "../utils/lazyRequire";

/** The slice of Electron's safeStorage we depend on. */
export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(cipher: Buffer): string;
}

/** Persistence of the service→ciphertext(base64) map. */
export interface SecretsIO {
  read(): Record<string, string>;
  write(map: Record<string, string>): void;
}

export class SafeStorageCredentialSource implements CredentialSource {
  readonly label = "OS keychain (safeStorage)";

  constructor(
    private readonly ss: SafeStorageLike | null,
    private readonly io: SecretsIO,
  ) {}

  /** Usable only when safeStorage exists AND the OS reports encryption available
   *  (e.g. a logged-in desktop session with an unlocked keyring). */
  available(): boolean {
    try {
      return this.ss !== null && this.ss.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  async get(service: string): Promise<string | null> {
    if (!this.available()) return null;
    const enc = this.io.read()[service];
    if (!enc) return null;
    try {
      return this.ss!.decryptString(Buffer.from(enc, "base64"));
    } catch {
      return null; // wrong keychain / corrupt blob — never throw a secret path
    }
  }

  async put(service: string, value: string): Promise<void> {
    if (!this.available()) {
      throw new Error(
        "safeStorage unavailable — cannot store secret in OS keychain",
      );
    }
    const map = this.io.read();
    if (value === "") delete map[service];
    else map[service] = this.ss!.encryptString(value).toString("base64");
    this.io.write(map);
  }

  async clear(service: string): Promise<void> {
    const map = this.io.read();
    if (service in map) {
      delete map[service];
      this.io.write(map);
    }
  }
}

/** Wire the real Electron safeStorage + a file-backed SecretsIO at `secretsPath`.
 *  Renderer-safe (lazy require). Returns a source whose `available()` is false
 *  when safeStorage/fs are absent (mobile / headless) — the chain falls through
 *  to the KeyVault source. */
export function makeSafeStorageCredentialSource(
  secretsPath: string,
): SafeStorageCredentialSource {
  const electron = tryRequire<{ safeStorage?: SafeStorageLike }>("electron");
  const ss: SafeStorageLike | null = electron?.safeStorage ?? null;
  const fs = tryRequire<typeof import("fs")>("fs") ?? null;
  const path = fs ? tryRequire<typeof import("path")>("path") ?? null : null;
  const io: SecretsIO = {
    read(): Record<string, string> {
      if (!fs) return {};
      try {
        return JSON.parse(fs.readFileSync(secretsPath, "utf-8")) as Record<
          string,
          string
        >;
      } catch {
        return {};
      }
    },
    write(map: Record<string, string>): void {
      if (!fs || !path) return;
      try {
        fs.mkdirSync(path.dirname(secretsPath), { recursive: true });
        // 0600 — owner-only; the contents are ciphertext but defense in depth.
        fs.writeFileSync(secretsPath, JSON.stringify(map, null, 2), {
          mode: 0o600,
        });
      } catch {
        /* best-effort; surfaced via available()/get returning null */
      }
    },
  };
  return new SafeStorageCredentialSource(ss, io);
}
