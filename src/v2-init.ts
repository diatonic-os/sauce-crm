// V2 initialization layer. Full mount: backend + security + sync + inference + scopes.
// Each mount step is best-effort — V2 stays functional under partial init (e.g. no SQLite).

import { App, Plugin, normalizePath, requestUrl } from "obsidian";
import { initLanceBackend, type LanceBackend } from "./backend/lance";
import {
  withTimeout,
  dirSizeBounded,
  dirFileCountBounded,
  compactConnection,
  LANCE_BLOAT_WARN_BYTES,
  LANCE_BLOAT_WARN_FILES,
  LANCE_INIT_BUDGET_MS,
} from "./backend/lance/maintenance";
import { detectLanceDB } from "./services/LanceDBInstaller";
import {
  currentPathEnv,
  lanceDataDir,
  lanceRuntimeDir,
  legacyLanceDir,
  migrateLegacyStore,
  firstExistingModuleBase,
} from "./services/platformPaths";
import {
  KeyVault,
  AuditLog,
  ScopeRegistry,
  ProxyClient,
  DEFAULT_SCOPES,
  type CryptoBackend,
  type ProxyConfig,
} from "./security";
import { SGV2_MAGIC } from "./security/KeyVault";
import { SyncEngine } from "./sync";
import { InferenceEngine } from "./inference";
import { ProvenanceService } from "./services/Provenance";
import type { Logger } from "./telemetry/types";

// Web Crypto-backed CryptoBackend. Obsidian runs in Electron's renderer which exposes
// window.crypto.subtle. KDF is PBKDF2-SHA256 (Argon2id needs a native dep we choose
// not to ship; the passes count from the KDF opts is multiplied by 200k iterations).
// Seal/open use AES-256-GCM under a versioned `SGV2\x01` envelope so any leftover
// zero-buffer ciphertexts from the pre-A2 stub fail open instead of decrypting silently.

// AES-GCM nonce is exactly 12 bytes (96 bits) — the WebCrypto-recommended IV size.
// New blobs are sealed with 12-byte nonces (see GCM_NONCE_BYTES). Some pre-fix blobs
// were stored with a 24-byte nonce of which only the first 12 bytes ever fed AES-GCM;
// this helper takes the leading 12 bytes either way, so OLD 24-byte-nonce blobs still
// decrypt. Length-aware on read AND write — never silently truncate to a different slice.
export const GCM_NONCE_BYTES = 12;
function gcmIv(nonce: Uint8Array): Uint8Array {
  return nonce.length === GCM_NONCE_BYTES
    ? nonce
    : nonce.slice(0, GCM_NONCE_BYTES);
}

export async function sealAesGcm(
  key: Uint8Array,
  nonce: Uint8Array,
  msg: Uint8Array,
): Promise<Uint8Array> {
  const subtle = (globalThis as { crypto: Crypto }).crypto.subtle;
  const k = await subtle.importKey(
    "raw",
    key as BufferSource,
    "AES-GCM",
    false,
    ["encrypt"],
  );
  const ct = await subtle.encrypt(
    { name: "AES-GCM", iv: gcmIv(nonce) as BufferSource },
    k,
    msg as BufferSource,
  );
  // Prepend SGV2 envelope magic so the open path can reject anything not produced here.
  const ctBytes = new Uint8Array(ct);
  const out = new Uint8Array(SGV2_MAGIC.length + ctBytes.length);
  out.set(SGV2_MAGIC, 0);
  out.set(ctBytes, SGV2_MAGIC.length);
  return out;
}
export async function openAesGcm(
  key: Uint8Array,
  nonce: Uint8Array,
  enveloped: Uint8Array,
): Promise<Uint8Array | null> {
  if (enveloped.length < SGV2_MAGIC.length) return null;
  for (let i = 0; i < SGV2_MAGIC.length; i++) {
    if (enveloped[i] !== SGV2_MAGIC[i]) return null;
  }
  const ct = enveloped.slice(SGV2_MAGIC.length);
  const subtle = (globalThis as { crypto: Crypto }).crypto.subtle;
  const k = await subtle.importKey(
    "raw",
    key as BufferSource,
    "AES-GCM",
    false,
    ["decrypt"],
  );
  try {
    const pt = await subtle.decrypt(
      { name: "AES-GCM", iv: gcmIv(nonce) as BufferSource },
      k,
      ct as BufferSource,
    );
    return new Uint8Array(pt);
  } catch {
    return null;
  }
}

function makeCryptoBackend(): CryptoBackend {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto
    ?.subtle;
  if (!subtle)
    throw new Error("Web Crypto unavailable (need Electron renderer)");

  return {
    async argon2id(password, salt, opts) {
      const keyMaterial = await subtle.importKey(
        "raw",
        new TextEncoder().encode(password),
        { name: "PBKDF2" },
        false,
        ["deriveBits"],
      );
      const bits = await subtle.deriveBits(
        {
          name: "PBKDF2",
          salt: salt as BufferSource,
          iterations: 200_000 * opts.passes,
          hash: "SHA-256",
        },
        keyMaterial,
        opts.outBytes * 8,
      );
      return new Uint8Array(bits);
    },
    secretboxSeal(key, nonce, msg) {
      return sealAesGcm(key, nonce, msg);
    },
    secretboxOpen(key, nonce, ct) {
      return openAesGcm(key, nonce, ct);
    },
    randomBytes(n) {
      const out = new Uint8Array(n);
      (globalThis as { crypto?: Crypto }).crypto!.getRandomValues(out);
      return out;
    },
  };
}

async function hmacHex(key: Uint8Array, msg: string): Promise<string> {
  const subtle = (globalThis as { crypto: Crypto }).crypto.subtle;
  const k = await subtle.importKey(
    "raw",
    key as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
async function sha256Hex(s: string): Promise<string> {
  const subtle = (globalThis as { crypto: Crypto }).crypto.subtle;
  const h = await subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(h))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface V2Runtime {
  /** The LanceDB single-backend, or null when LanceDB is not yet installed
   *  (require-install mode — the install modal gates feature use). */
  lance: LanceBackend | null;
  backendKind: "lancedb" | "uninitialized";
  scopes: ScopeRegistry;
  keyVault: KeyVault | null;
  auditLog: AuditLog | null;
  /** App-wide fingerprint + signed-provenance + trace service. Null until
   *  LanceDB is installed. */
  provenance: ProvenanceService | null;
  proxy: ProxyClient;
  sync: SyncEngine;
  inference: InferenceEngine;
  /** In-flight background compaction kicked off at init, if any. teardownV2
   *  awaits it (bounded) before close() so the detached compaction can't race
   *  the connection teardown (LANCE-006). Resolves/rejects are swallowed. */
  pendingCompaction: Promise<unknown> | null;
}

export async function initV2(app: App, plugin: Plugin): Promise<V2Runtime> {
  // The plugin subclass initializes `logger` as a field default, so it is
  // always present by the time onload() calls initV2(). Route init-time
  // diagnostics through it (the base Plugin type lacks the field).
  const initLogger = (plugin as unknown as { logger?: Logger }).logger ?? null;
  const pluginId = plugin.manifest.id;
  const pluginDir = normalizePath(`${app.vault.configDir}/plugins/${pluginId}`);
  // Native LanceDB resolves paths against process.cwd() (NOT the vault) and is
  // require-installed into the plugin's own node_modules. Both need the ABSOLUTE
  // on-disk plugin dir, which the desktop FileSystemAdapter exposes via
  // getBasePath(); on mobile there is no base path (and no LanceDB anyway).
  const vaultBase =
    app.vault.adapter.getBasePath?.() ?? app.vault.adapter.basePath ?? "";
  const absPluginDir = vaultBase
    ? `${vaultBase}/${app.vault.configDir}/plugins/${pluginId}`
    : undefined;

  // Centralized, OUT-OF-VAULT home (app.data.user) for the derived store and the
  // native module — keeps LanceDB's thousands of fragment files out of the
  // watched/synced vault. Data is per-vault; the module runtime is shared.
  const pe = currentPathEnv();
  const centralDataDir = vaultBase ? lanceDataDir(pe, vaultBase) : undefined;
  // Module base: prefer the central runtime; fall back to a legacy in-plugin
  // install so existing users keep working without reinstalling.
  const moduleBase = firstExistingModuleBase([
    lanceRuntimeDir(pe),
    absPluginDir,
  ]);

  // One-time migration: move a v1 in-vault store to the central location BEFORE
  // we open it. Safe + idempotent (never clobbers a populated target).
  if (absPluginDir && centralDataDir) {
    try {
      const mig = await migrateLegacyStore(
        legacyLanceDir(absPluginDir),
        centralDataDir,
      );
      if (mig.reason === "copied-legacy-cleanup-failed") {
        // Data WAS copied to the central store — but the legacy in-vault store
        // couldn't be removed. Operator must clean it up manually (LANCE-007).
        initLogger?.warn(
          "Sauce V2: migrated LanceDB out of the vault, but manual cleanup of the legacy store is needed",
          {
            legacyDir: legacyLanceDir(absPluginDir),
            error: mig.error,
            to: centralDataDir,
          },
        );
      } else if (mig.migrated) {
        initLogger?.debug("Sauce V2: migrated LanceDB out of the vault", {
          reason: mig.reason,
          to: centralDataDir,
        });
      } else if (mig.reason === "failed") {
        initLogger?.warn(
          "Sauce V2: LanceDB migration failed; using fresh store",
          {
            error: mig.error,
          },
        );
      }
    } catch (e) {
      initLogger?.warn("Sauce V2: LanceDB migration error", {
        error: String(e),
      });
    }
  }

  // LANCE-002 guard: never fall back to a vault-relative dataDir — native
  // lancedb connect() would resolve it against process.cwd(), an unpredictable
  // location. No absolute base path ⇒ no Lance backend (graph-RAG fallback).
  const lanceDir = centralDataDir;
  const pluginSettings = (
    plugin as unknown as { settings?: { lancedb?: { embeddingDim?: number } } }
  ).settings; // Plugin subclass field; base Plugin type lacks it
  const embeddingDim = pluginSettings?.lancedb?.embeddingDim;

  // ─── Backend: LanceDB single-backend (require-install) ───────────────
  // LanceDB is the sole persistence engine. If its native binding is not yet
  // installed we leave the backend null; main.ts surfaces the install modal
  // and feature use is gated until the operator approves the install.
  let lance: LanceBackend | null = null;
  let backendKind: "lancedb" | "uninitialized" = "uninitialized";
  // Track any background compaction so teardownV2 can await it before close()
  // (LANCE-006 — detached compaction must not race the connection teardown).
  let pendingCompaction: Promise<unknown> | null = null;
  const detect = detectLanceDB(moduleBase);
  if (lanceDir && detect.state === "available") {
    try {
      // Bound init: a pathological store (e.g. thousands of un-compacted
      // versions) must NOT freeze vault load. On timeout we fall through to the
      // degraded no-backend path; the operator can rebuild/compact the index.
      lance = await withTimeout(
        initLanceBackend({
          dataDir: lanceDir,
          ...(embeddingDim !== undefined ? { embeddingDim } : {}),
          ...(moduleBase !== undefined ? { requireBase: moduleBase } : {}),
        }),
        LANCE_INIT_BUDGET_MS,
        "backend init",
      );
      backendKind = "lancedb";
      initLogger?.debug("Sauce V2 backend: LanceDB", {
        dir: lanceDir,
        version: detect.version,
        dim: lance.embeddingDim,
      });
      // Opportunistic compaction: LanceDB writes a fragment + version manifest
      // per transaction, so repeated resyncs explode the FILE COUNT (tens of
      // thousands) even when total bytes stay modest — and a vault watcher
      // choking on that file count is what surfaces as Obsidian's "watcher"
      // error. Trigger background compaction on EITHER signal (count or size)
      // so the store collapses back to a handful of files without delaying load.
      const fileProbe = dirFileCountBounded(
        lanceDir,
        LANCE_BLOAT_WARN_FILES + 1,
      );
      const sizeProbe = dirSizeBounded(lanceDir, LANCE_BLOAT_WARN_BYTES + 1);
      if (
        fileProbe > LANCE_BLOAT_WARN_FILES ||
        sizeProbe > LANCE_BLOAT_WARN_BYTES
      ) {
        const db = lance.db;
        initLogger?.warn(
          `Sauce V2 LanceDB is bloated (${fileProbe}+ files / ${Math.round(sizeProbe / 1048576)}+ MB) — compacting in background`,
        );
        pendingCompaction = compactConnection(db).then(
          (r) => initLogger?.debug("Sauce V2 LanceDB compaction done", { r }),
          (e: unknown) =>
            initLogger?.warn("Sauce V2 LanceDB compaction failed", {
              error: String(e),
            }),
        );
      }
    } catch (e) {
      initLogger?.warn("Sauce V2 LanceDB init failed; backend unavailable", {
        error: String(e),
      });
    }
  } else {
    initLogger?.debug("Sauce V2 backend: LanceDB not available", { detect });
  }

  // ─── Scopes ──────────────────────────────────────────────────────────
  const scopes = new ScopeRegistry();
  scopes.load(DEFAULT_SCOPES);

  // ─── KeyVault (locked at boot; user unlocks via Settings) ───────────
  // Secrets live in LanceDB's api_keys_enc table. Without LanceDB there is no
  // secret store (require-install) — keyVault stays null and the install modal
  // gates anything that needs it.
  let keyVault: KeyVault | null = null;
  if (lance) {
    try {
      const cb = makeCryptoBackend();
      const pluginLogger = (plugin as unknown as { logger?: Logger }).logger; // Plugin subclass field; base Plugin type lacks it
      const kvLogger: Logger | null = pluginLogger?.child("keyvault") ?? null;
      keyVault = new KeyVault(lance.secrets, cb, kvLogger ?? null);
    } catch (e) {
      initLogger?.warn("Sauce V2 KeyVault init failed", { error: String(e) });
    }
  }

  // ─── AuditLog (active only when backend present) ────────────────────
  let auditLog: AuditLog | null = null;
  if (lance) {
    auditLog = new AuditLog(lance.audit, { hmacHex }, async () => {
      if (!keyVault || keyVault.isLocked()) {
        // Use a deterministic non-secret fallback so the audit chain still works pre-unlock.
        // Once the user unlocks, subsequent rows chain with the real key — the verifier
        // accepts both spans when re-walking with the matching key.
        return new TextEncoder().encode(
          "sauce-graph-bootstrap-hmac-key-v1-padding-32b",
        );
      }
      return await keyVault.masterKeyHmacBytes();
    });
  }

  // ─── ProvenanceService (fingerprint + sign + trace; needs backend) ──
  // Shares the AuditLog's bootstrap-key fallback so tracing works pre-unlock
  // and re-verifies once the vault is unlocked. Mirrors high-level ops into
  // the AuditLog. This is the app-wide state-tracking spine (PLAN T2/T8).
  let provenance: ProvenanceService | null = null;
  if (lance) {
    const masterKey = async (): Promise<Uint8Array> => {
      if (!keyVault || keyVault.isLocked()) {
        return new TextEncoder().encode(
          "sauce-graph-bootstrap-hmac-key-v1-padding-32b",
        );
      }
      return await keyVault.masterKeyHmacBytes();
    };
    provenance = new ProvenanceService(
      lance.provenanceStore,
      { sha256Hex, hmacHex },
      masterKey,
      auditLog,
    );
  }

  // ─── ProxyClient (off by default) ───────────────────────────────────
  const proxy = new ProxyClient(
    {
      hmacHex: async (key: string, msg: string) =>
        hmacHex(new TextEncoder().encode(key), msg),
      sha256Hex,
      fetch: async (url, init) => {
        // Obsidian's requestUrl (no CORS, works on mobile) instead of global fetch.
        const r = await requestUrl({
          url,
          method: init.method,
          headers: init.headers,
          ...(init.body !== undefined ? { body: init.body } : {}),
          throw: false,
        });
        return { status: r.status, headers: r.headers, body: r.text };
      },
    },
    { enabled: false, baseUrl: "", sharedSecret: "" } as ProxyConfig,
  );

  // ─── SyncEngine + InferenceEngine ───────────────────────────────────
  const sync = new SyncEngine();
  const inference = new InferenceEngine();

  return {
    lance,
    backendKind,
    scopes,
    keyVault,
    auditLog,
    provenance,
    proxy,
    sync,
    inference,
    pendingCompaction,
  };
}

export async function teardownV2(rt: V2Runtime | null): Promise<void> {
  if (!rt) return;
  try {
    rt.sync.stop();
  } catch {
    /* */
  }
  try {
    rt.keyVault?.lock();
  } catch {
    /* */
  }
  // LANCE-006: drain any in-flight background compaction (bounded) BEFORE
  // closing the native connection, so the detached compaction can't operate on
  // a closed handle. We never reject — a slow/failed compaction must not block
  // teardown past the bound.
  if (rt.pendingCompaction) {
    try {
      await Promise.race([
        rt.pendingCompaction.catch(() => undefined),
        new Promise((resolve) =>
          setTimeout(resolve, COMPACTION_DRAIN_TIMEOUT_MS),
        ),
      ]);
    } catch {
      /* */
    }
  }
  try {
    await rt.lance?.close();
  } catch {
    /* */
  }
}

/** Upper bound (ms) teardownV2 waits for a background compaction to settle
 *  before closing the connection anyway (LANCE-006). */
const COMPACTION_DRAIN_TIMEOUT_MS = 5_000;
