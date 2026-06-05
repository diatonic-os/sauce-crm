// sauce-crm-daemon · multi-vault Lance registry.
//
// The bridge wire contract (src/bridge/contract.ts) does NOT carry vault
// identity — it was minted one-desktop-one-vault. Per the daemon design, we
// therefore key Lance stores by the DATA-DIR a client requests, derived from
// the vault's absolute base path via the plugin's own `lanceDataDir`
// (vaultId-hashed). A request selects its vault with the `x-sauce-vault`
// header (absolute vault base path); absent that, the daemon's configured
// `defaultVault` is used.
//
// SINGLE-WRITER: exactly one LanceBackend is opened per vaultId across the
// daemon's lifetime. The plugin probes GET /health and, on success, uses the
// remote backend and SKIPS its own initLanceBackend — so daemon and plugin
// never both open the same store.
//
// LAZY: a vault's store is opened on FIRST request for that vault, not at
// startup. Opens are de-duplicated via an in-flight promise map so concurrent
// first-requests share one open.

import type { PathEnv } from "../../src/services/platformPaths";
import {
  initLanceBackend,
  type LanceBackend,
} from "../../src/backend/lance";
import { LanceMemoryBackend } from "../../src/bridge/desktop/LanceMemoryBackend";
import type { MemoryBackend } from "../../src/bridge/contract";
import { vaultId } from "../../src/services/platformPaths";
import { vaultLanceDir } from "./config";

/** One opened vault: the raw Lance backend + the bridge MemoryBackend over it. */
export interface OpenVault {
  vaultBasePath: string;
  vaultId: string;
  dataDir: string;
  lance: LanceBackend;
  memory: MemoryBackend;
}

export interface VaultRegistryDeps {
  env: PathEnv;
  /** Native-module resolution base (central runtime). Forwarded to Lance. */
  requireBase: string | undefined;
  /** Embedding fn. Headless daemon has no LLM → returns null (semantic search
   *  degrades to empty; provenance/by-fp remain fully functional). Injectable
   *  so a future local-embed daemon can supply a real one. */
  embedFn?: (text: string) => Promise<number[] | null>;
  /** Open override for tests (bypasses native LanceDB). */
  openVault?: (vaultBasePath: string) => Promise<OpenVault>;
}

const NO_EMBED = async (): Promise<number[] | null> => null;

/** Lazily-opening, single-writer registry of per-vault Lance backends. */
export class VaultRegistry {
  private readonly open = new Map<string, OpenVault>();
  private readonly inflight = new Map<string, Promise<OpenVault>>();

  constructor(private readonly deps: VaultRegistryDeps) {}

  /** vaultId for an absolute vault base path (stable, hash-suffixed). */
  idFor(vaultBasePath: string): string {
    return vaultId(vaultBasePath);
  }

  /** Resolve (opening lazily, de-duped) the OpenVault for a base path. */
  async acquire(vaultBasePath: string): Promise<OpenVault> {
    const id = this.idFor(vaultBasePath);
    const existing = this.open.get(id);
    if (existing) return existing;
    const pending = this.inflight.get(id);
    if (pending) return pending;
    const p = this.doOpen(vaultBasePath, id).finally(() => {
      this.inflight.delete(id);
    });
    this.inflight.set(id, p);
    return p;
  }

  /** The bridge MemoryBackend for a vault — what the HTTP server consumes. */
  async memoryFor(vaultBasePath: string): Promise<MemoryBackend> {
    return (await this.acquire(vaultBasePath)).memory;
  }

  /** True once a vault's store has been opened (for /health dim reporting). */
  isOpen(vaultBasePath: string): boolean {
    return this.open.has(this.idFor(vaultBasePath));
  }

  /** Embedding dim of an already-open vault, or null if none open. Used by
   *  /health to report `lance.dim` without forcing a lazy open. */
  anyOpenDim(): number | null {
    for (const v of this.open.values()) return v.lance.embeddingDim;
    return null;
  }

  /** Close every open store (graceful shutdown — releases native handles). */
  async closeAll(): Promise<void> {
    const vaults = [...this.open.values()];
    this.open.clear();
    for (const v of vaults) {
      try {
        await v.lance.close();
      } catch {
        /* best-effort: still close the rest */
      }
    }
  }

  private async doOpen(
    vaultBasePath: string,
    id: string,
  ): Promise<OpenVault> {
    const opened = this.deps.openVault
      ? await this.deps.openVault(vaultBasePath)
      : await this.realOpen(vaultBasePath, id);
    this.open.set(id, opened);
    return opened;
  }

  private async realOpen(
    vaultBasePath: string,
    id: string,
  ): Promise<OpenVault> {
    const dataDir = vaultLanceDir(this.deps.env, vaultBasePath);
    const lance = await initLanceBackend({
      dataDir,
      ...(this.deps.requireBase !== undefined
        ? { requireBase: this.deps.requireBase }
        : {}),
    });
    const memory = new LanceMemoryBackend({
      vectorIndex: lance.vectors,
      provenanceStore: lance.provenanceStore,
      embedFn: this.deps.embedFn ?? NO_EMBED,
    });
    return { vaultBasePath, vaultId: id, dataDir, lance, memory };
  }
}
