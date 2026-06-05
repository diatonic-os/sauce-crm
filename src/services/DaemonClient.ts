// sauce-crm-daemon · plugin-side client.
//
// Two responsibilities, both pure-by-construction (no Obsidian import):
//   1. probeDaemon() — unauthenticated GET /health against the loopback daemon
//      with a short timeout. Returns the parsed health shape or null. Used by
//      the boot path (single-writer detection) and the settings status row.
//   2. createDaemonBackend() — wire the EXISTING BridgeMemoryBackend (the same
//      HMAC-signed client the mobile bridge uses) against the daemon base URL +
//      pairing token, injecting the per-request `x-sauce-vault` header so the
//      daemon's RoutingMemoryBackend targets this vault's store.
//
// Single-writer rule (CRITICAL): when probeDaemon() succeeds, the plugin uses
// this remote backend and SKIPS its local initLanceBackend — the daemon is the
// sole opener of the vault's Lance store.

import { HmacAuthSigner, tokenToKey } from "../bridge/auth";
import {
  makeContentHasher,
  makeHttpRequestFn,
  InMemoryResultCache,
  type RequestUrlLike,
} from "../bridge/wiring";
import { BridgeMemoryBackend } from "../bridge/mobile/bridge/BridgeMemoryBackend";
import type { MemoryBackend } from "../bridge/contract";

/** Header the daemon reads to select the vault store (absolute vault base path).
 *  Mirrors daemon/src/server.ts VAULT_HEADER — kept as a literal here so the
 *  plugin bundle never imports daemon/** (out of the plugin's compile root). */
export const DAEMON_VAULT_HEADER = "x-sauce-vault";

/** Default loopback host + port for the daemon (design constants). */
export const DAEMON_DEFAULT_HOST = "127.0.0.1";
export const DAEMON_DEFAULT_PORT = 8788;

/** Default probe timeout (ms). Short — the daemon is loopback so a healthy one
 *  answers in single-digit ms; a missing one must not stall boot. */
export const DAEMON_PROBE_TIMEOUT_MS = 250;

/** The daemon's unauthenticated GET /health body. Mirrors daemon HealthBody. */
export interface DaemonHealth {
  ok: boolean;
  name: string;
  version: string;
  pid: number;
  uptimeMs: number;
  lance: { available: boolean; dim: number | null };
}

/** Minimal fetch surface the probe needs. The plugin binds this to a fetch that
 *  supports an abort/timeout; tests inject a fake. Returns status + text so the
 *  probe can parse JSON itself and never throws across the boundary. */
export type DaemonFetch = (
  url: string,
  opts: { timeoutMs: number },
) => Promise<{ status: number; text: string } | null>;

/** Build the daemon base URL from a port (and optional host). No trailing slash. */
export function daemonBaseUrl(
  port: number = DAEMON_DEFAULT_PORT,
  host: string = DAEMON_DEFAULT_HOST,
): string {
  return `http://${host}:${port}`;
}

/** Type guard: is the parsed value a well-formed DaemonHealth from OUR daemon? */
function isDaemonHealth(v: unknown): v is DaemonHealth {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    o.ok === true &&
    o.name === "sauce-crm-daemon" &&
    typeof o.version === "string" &&
    typeof o.lance === "object" &&
    o.lance !== null
  );
}

/**
 * Probe the daemon's GET /health. Resolves to the health shape on a 200 with a
 * recognizable body, or null on any failure (timeout, refused, non-200, foreign
 * server). Never throws.
 */
export async function probeDaemon(
  fetchFn: DaemonFetch,
  opts?: { port?: number; host?: string; timeoutMs?: number },
): Promise<DaemonHealth | null> {
  const url = daemonBaseUrl(opts?.port, opts?.host) + "/health";
  const timeoutMs = opts?.timeoutMs ?? DAEMON_PROBE_TIMEOUT_MS;
  let res: { status: number; text: string } | null;
  try {
    res = await fetchFn(url, { timeoutMs });
  } catch {
    return null;
  }
  if (!res || res.status !== 200) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(res.text);
  } catch {
    return null;
  }
  return isDaemonHealth(parsed) ? parsed : null;
}

/**
 * A DaemonFetch backed by the platform `fetch` with an AbortController timeout.
 * Returns null on any thrown error (refused/timeout) so probeDaemon stays
 * exception-free. Only used on desktop where the daemon lives; mobile never
 * calls this.
 */
export function makeDaemonFetch(fetchImpl: typeof fetch = fetch): DaemonFetch {
  return async (url, { timeoutMs }) => {
    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;
    try {
      const r = await fetchImpl(url, {
        method: "GET",
        ...(controller ? { signal: controller.signal } : {}),
      });
      const text = await r.text();
      return { status: r.status, text };
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  };
}

export interface DaemonBackendDeps {
  /** Loopback base URL, e.g. http://127.0.0.1:8788. */
  baseUrl: string;
  /** Daemon pairing token (hex) — derives the shared HMAC key (tokenToKey). */
  pairingToken: string;
  /** Absolute vault base path; sent as `x-sauce-vault` so the daemon routes to
   *  this vault's store. Empty ⇒ daemon uses its configured defaultVault. */
  vaultBasePath: string;
  /** Obsidian requestUrl (or compatible) — the HMAC client's transport. */
  requestUrl: RequestUrlLike;
  /** Web-Crypto sha256Hex (body hashing + key derivation). */
  sha256Hex: (s: string) => Promise<string>;
  /** Web-Crypto hmacHex (request signing). */
  hmacHex: (key: Uint8Array, msg: string) => Promise<string>;
}

/**
 * Build a MemoryBackend that talks to the daemon over the EXISTING HMAC-signed
 * bridge client. Every request carries the `x-sauce-vault` header (so the daemon
 * opens the right per-vault store) plus the same signing the mobile bridge uses.
 */
export function createDaemonBackend(deps: DaemonBackendDeps): MemoryBackend {
  const hasher = makeContentHasher(deps.sha256Hex);
  const signer = new HmacAuthSigner({ hmacHex: deps.hmacHex }, () =>
    tokenToKey(deps.pairingToken, { sha256Hex: deps.sha256Hex }),
  );
  // Wrap the transport to inject the vault-selection header on every call.
  const baseRequest = makeHttpRequestFn(deps.requestUrl);
  const request: typeof baseRequest = (req) =>
    baseRequest({
      ...req,
      headers: {
        ...(req.headers ?? {}),
        ...(deps.vaultBasePath
          ? { [DAEMON_VAULT_HEADER]: deps.vaultBasePath }
          : {}),
      },
    });
  return new BridgeMemoryBackend({
    baseUrl: deps.baseUrl,
    request,
    signer,
    hasher,
    cache: new InMemoryResultCache(),
  });
}
