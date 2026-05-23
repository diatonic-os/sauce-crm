// Unified credential precedence — shipped behaviour for V2 providers.
// Order (highest priority first):
//   1. KeyVault (user-set via Settings GUI) — the only production source
//   2. Plugin data.json (legacy / migration helper, deprecated)
//   3. Throw — never silently fall back to env vars in production
//
// The test harness can install a `EnvCredentialSource` for offline e2e verification,
// but no V2 source file imports `process.env`. Verified by a build-time grep gate.

export interface CredentialSource {
  /** Return the secret for `service` or null if absent. Implementations must redact in logs. */
  get(service: string): Promise<string | null>;
  /** Persist a secret for `service`. */
  put(service: string, value: string): Promise<void>;
  /** Forget a secret (does not unlock the vault; only deletes the entry). */
  clear(service: string): Promise<void>;
  /** True when the source is currently usable (e.g. KeyVault unlocked). */
  available(): boolean;
  /** Human-readable label for diagnostics — never the secret. */
  readonly label: string;
}

/**
 * KeyVaultCredentialSource — production source. Reads from an unlocked KeyVault.
 * If the vault is locked, `get` returns null (caller decides whether to prompt unlock).
 */
export class KeyVaultCredentialSource implements CredentialSource {
  readonly label = "KeyVault";
  constructor(
    private readonly vault: {
      isLocked(): boolean;
      get(service: string): Promise<string>;
      put(service: string, value: string): Promise<void>;
      list(): Promise<string[]>;
    },
  ) {}
  available(): boolean {
    return !this.vault.isLocked();
  }
  async get(service: string): Promise<string | null> {
    if (this.vault.isLocked()) return null;
    try {
      return await this.vault.get(service);
    } catch {
      return null;
    }
  }
  async put(service: string, value: string): Promise<void> {
    await this.vault.put(service, value);
  }
  async clear(service: string): Promise<void> {
    await this.vault.put(service, "");
  }
}

/**
 * ChainedCredentialSource — composes sources in order. First non-null wins.
 * Writes go to the first available source (typically the KeyVault).
 */
export class ChainedCredentialSource implements CredentialSource {
  readonly label: string;
  constructor(private readonly sources: CredentialSource[]) {
    this.label = sources.map((s) => s.label).join(" → ");
  }
  available(): boolean {
    return this.sources.some((s) => s.available());
  }
  async get(service: string): Promise<string | null> {
    for (const s of this.sources) {
      if (!s.available()) continue;
      const v = await s.get(service);
      if (v) return v;
    }
    return null;
  }
  async put(service: string, value: string): Promise<void> {
    const writable = this.sources.find((s) => s.available());
    if (!writable) throw new Error("no available credential source for write");
    await writable.put(service, value);
  }
  async clear(service: string): Promise<void> {
    for (const s of this.sources) {
      if (s.available()) {
        await s.clear(service);
      }
    }
  }
}

/**
 * Redact a secret for log display. Shows first 8 and last 4 chars; minimum 12 chars total.
 */
export function redactSecret(s: string | null | undefined): string {
  if (!s) return "(none)";
  if (s.length < 12) return "****";
  return `${s.slice(0, 8)}…${s.slice(-4)}`;
}

/**
 * Helper to build an apiKey getter that *only* reads from a CredentialSource.
 * Throws if no value is available — providers must surface this to the user, not silently fail.
 */
export function apiKeyGetter(
  source: CredentialSource,
  service: string,
): () => Promise<string> {
  return async () => {
    const v = await source.get(service);
    if (!v)
      throw new Error(
        `${service}: no credential available (label=${source.label}). Set the key in Settings → AI Copilot.`,
      );
    return v;
  };
}
