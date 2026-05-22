// V2 initialization layer. Full mount: backend + security + sync + inference + scopes.
// Each mount step is best-effort — V2 stays functional under partial init (e.g. no SQLite).

import { App, Plugin, normalizePath } from "obsidian";
import {
  ISqliteBackend, BackendKind, selectBackend, describeBackend,
} from "./backend";
import {
  KeyVault, JsonSecretStore, SqliteSecretStore,
  AuditLog, ScopeRegistry, ProxyClient, DEFAULT_SCOPES,
  type CryptoBackend, type ProxyConfig,
} from "./security";
import { SGV2_MAGIC } from "./security/KeyVault";
import { SyncEngine } from "./sync";
import { InferenceEngine } from "./inference";

// Web Crypto-backed CryptoBackend. Obsidian runs in Electron's renderer which exposes
// window.crypto.subtle. KDF is PBKDF2-SHA256 (Argon2id needs a native dep we choose
// not to ship; the passes count from the KDF opts is multiplied by 200k iterations).
// Seal/open use AES-256-GCM under a versioned `SGV2\x01` envelope so any leftover
// zero-buffer ciphertexts from the pre-A2 stub fail open instead of decrypting silently.
async function sealAesGcm(key: Uint8Array, nonce: Uint8Array, msg: Uint8Array): Promise<Uint8Array> {
  const subtle = (globalThis as { crypto: Crypto }).crypto.subtle;
  const k = await subtle.importKey("raw", key as BufferSource, "AES-GCM", false, ["encrypt"]);
  const ct = await subtle.encrypt({ name: "AES-GCM", iv: nonce.slice(0, 12) as BufferSource }, k, msg as BufferSource);
  // Prepend SGV2 envelope magic so the open path can reject anything not produced here.
  const ctBytes = new Uint8Array(ct);
  const out = new Uint8Array(SGV2_MAGIC.length + ctBytes.length);
  out.set(SGV2_MAGIC, 0);
  out.set(ctBytes, SGV2_MAGIC.length);
  return out;
}
async function openAesGcm(key: Uint8Array, nonce: Uint8Array, enveloped: Uint8Array): Promise<Uint8Array | null> {
  if (enveloped.length < SGV2_MAGIC.length) return null;
  for (let i = 0; i < SGV2_MAGIC.length; i++) {
    if (enveloped[i] !== SGV2_MAGIC[i]) return null;
  }
  const ct = enveloped.slice(SGV2_MAGIC.length);
  const subtle = (globalThis as { crypto: Crypto }).crypto.subtle;
  const k = await subtle.importKey("raw", key as BufferSource, "AES-GCM", false, ["decrypt"]);
  try {
    const pt = await subtle.decrypt({ name: "AES-GCM", iv: nonce.slice(0, 12) as BufferSource }, k, ct as BufferSource);
    return new Uint8Array(pt);
  } catch { return null; }
}

function makeCryptoBackend(): CryptoBackend {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (!subtle) throw new Error("Web Crypto unavailable (need Electron renderer)");

  return {
    async argon2id(password, salt, opts) {
      const keyMaterial = await subtle.importKey(
        "raw", new TextEncoder().encode(password),
        { name: "PBKDF2" }, false, ["deriveBits"],
      );
      const bits = await subtle.deriveBits(
        { name: "PBKDF2", salt: salt as BufferSource, iterations: 200_000 * opts.passes, hash: "SHA-256" },
        keyMaterial, opts.outBytes * 8,
      );
      return new Uint8Array(bits);
    },
    secretboxSeal(key, nonce, msg) { return sealAesGcm(key, nonce, msg); },
    secretboxOpen(key, nonce, ct) { return openAesGcm(key, nonce, ct); },
    randomBytes(n) {
      const out = new Uint8Array(n);
      (globalThis as { crypto?: Crypto }).crypto!.getRandomValues(out);
      return out;
    },
  };
}

async function hmacHex(key: Uint8Array, msg: string): Promise<string> {
  const subtle = (globalThis as { crypto: Crypto }).crypto.subtle;
  const k = await subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await subtle.sign("HMAC", k, new TextEncoder().encode(msg));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function sha256Hex(s: string): Promise<string> {
  const subtle = (globalThis as { crypto: Crypto }).crypto.subtle;
  const h = await subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(h)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export interface V2Runtime {
  backend: ISqliteBackend | null;
  backendKind: BackendKind | "uninitialized";
  scopes: ScopeRegistry;
  keyVault: KeyVault | null;
  auditLog: AuditLog | null;
  proxy: ProxyClient;
  sync: SyncEngine;
  inference: InferenceEngine;
}

export async function initV2(app: App, plugin: Plugin): Promise<V2Runtime> {
  const pluginDir = normalizePath(`${app.vault.configDir}/plugins/sauce-graph`);
  const dbPath = `${pluginDir}/sauce.db`;

  // ─── Backend (best-effort) ───────────────────────────────────────────
  let backend: ISqliteBackend | null = null;
  let backendKind: BackendKind | "uninitialized" = "uninitialized";
  try {
    const r = await selectBackend({ dbPath, preferNative: true });
    backend = r.backend;
    backendKind = r.kind;
    if (backend) {
      const info = await describeBackend(backend, backendKind);
      console.log("Sauce V2 backend", { kind: backendKind, caps: info.capabilities, rows: info.rowCounts });
    }
  } catch (e) {
    console.warn("Sauce V2 backend init failed; running without SQLite mirror", { error: String(e) });
  }

  // ─── Scopes ──────────────────────────────────────────────────────────
  const scopes = new ScopeRegistry();
  scopes.load(DEFAULT_SCOPES);

  // ─── KeyVault (locked at boot; user unlocks via Settings) ───────────
  let keyVault: KeyVault | null = null;
  try {
    const cb = makeCryptoBackend();
    const kvLogger = (plugin as unknown as { logger?: { child: (n: string) => unknown } }).logger?.child("keyvault") as unknown as ConstructorParameters<typeof KeyVault>[2];
    if (backend) {
      keyVault = new KeyVault(new SqliteSecretStore(backend), cb, kvLogger ?? null);
    } else {
      // Fallback to data.json blob
      const store = new JsonSecretStore(
        async () => ((await plugin.loadData()) ?? {}).secrets ?? {},
        async (d) => {
          const cur = (await plugin.loadData()) ?? {};
          await plugin.saveData({ ...cur, secrets: d });
        },
      );
      keyVault = new KeyVault(store, cb, kvLogger ?? null);
    }
  } catch (e) {
    console.warn("Sauce V2 KeyVault init failed", { error: String(e) });
  }

  // ─── AuditLog (active only when backend present) ────────────────────
  let auditLog: AuditLog | null = null;
  if (backend) {
    auditLog = new AuditLog(
      backend,
      { hmacHex },
      async () => {
        if (!keyVault || keyVault.isLocked()) {
          // Use a deterministic non-secret fallback so the audit chain still works pre-unlock.
          // Once the user unlocks, subsequent rows chain with the real key — the verifier
          // accepts both spans when re-walking with the matching key.
          return new TextEncoder().encode("sauce-graph-bootstrap-hmac-key-v1-padding-32b");
        }
        return await keyVault.masterKeyHmacBytes();
      },
    );
  }

  // ─── ProxyClient (off by default) ───────────────────────────────────
  const proxy = new ProxyClient(
    {
      hmacHex: async (key: string, msg: string) => hmacHex(new TextEncoder().encode(key), msg),
      sha256Hex,
      fetch: async (url, init) => {
        const r = await fetch(url, { method: init.method, headers: init.headers, body: init.body });
        const text = await r.text();
        const h: Record<string, string> = {};
        r.headers.forEach((v, k) => { h[k] = v; });
        return { status: r.status, headers: h, body: text };
      },
    },
    { enabled: false, baseUrl: "", sharedSecret: "" } as ProxyConfig,
  );

  // ─── SyncEngine + InferenceEngine ───────────────────────────────────
  const sync = new SyncEngine();
  const inference = new InferenceEngine();

  return { backend, backendKind, scopes, keyVault, auditLog, proxy, sync, inference };
}

export async function teardownV2(rt: V2Runtime | null): Promise<void> {
  if (!rt) return;
  try { rt.sync.stop(); } catch { /* */ }
  try { rt.keyVault?.lock(); } catch { /* */ }
  try { await rt.backend?.close(); } catch { /* */ }
}
