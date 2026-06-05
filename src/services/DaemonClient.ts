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
import {
  deriveTransportKey,
  transportDecrypt,
  transportEncrypt,
} from "../bridge/crypto";
import type { MemoryBackend, TransportCipher } from "../bridge/contract";
import {
  SIG_HEADER,
  NONCE_HEADER,
  TS_HEADER,
  ENC_HEADER,
  TRANSPORT_ENC_VERSION,
  canonicalRequestString,
  type SignedRequestParts,
} from "../bridge/contract";
import type {
  TranscribeOptions,
  TranscriptionProvider,
  TranscriptionResult,
} from "./transcribe/TranscriptionProvider";

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
  /** Capability flag (Part C). When `available`, prefer POST /v1/transcribe
   *  over a local spawn. Older daemons omit it ⇒ treated as unavailable. */
  whisper?: { available: boolean };
}

/** True iff the daemon advertises a usable whisper transcription capability. */
export function daemonHasWhisper(h: DaemonHealth | null): boolean {
  return !!h?.whisper?.available;
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
  // App-layer AES-256-GCM cipher, keyed by an HKDF subkey of the pairing key
  // (info "transport-enc"), independent of the HMAC key. Lazily derives the key
  // once and reuses it; every request body is encrypted and every response is
  // decrypted (the daemon's /health stays plaintext on both ends).
  const cipher = makeTransportCipher(() =>
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
    cipher,
  });
}

/**
 * Build a {@link TransportCipher} from a pairing-key provider. The AES-256-GCM
 * key (an HKDF subkey of the pairing key) is derived ONCE on first use and the
 * resulting promise is cached, so per-request encrypt/decrypt skips re-derivation.
 * Pure of any platform import — uses the shared Web-Crypto helpers in crypto.ts.
 */
export function makeTransportCipher(
  pairingKey: () => Promise<Uint8Array>,
): TransportCipher {
  let keyP: Promise<CryptoKey> | null = null;
  const key = (): Promise<CryptoKey> => {
    if (!keyP) keyP = pairingKey().then((k) => deriveTransportKey(k));
    return keyP;
  };
  return {
    async encrypt(plaintext: string): Promise<string> {
      return transportEncrypt(await key(), plaintext);
    },
    async decrypt(wire: string): Promise<string> {
      return transportDecrypt(await key(), wire);
    },
  };
}

// ───────────────────────── daemon transcription (Part C) ─────────────────────

/** Read an audio file's bytes as base64. The plugin binds this to node:fs on
 *  desktop; mobile can read via the vault adapter. */
export type ReadAudioBase64 = (path: string) => Promise<string>;

export interface DaemonTranscriberDeps {
  baseUrl: string;
  pairingToken: string;
  requestUrl: RequestUrlLike;
  sha256Hex: (s: string) => Promise<string>;
  hmacHex: (key: Uint8Array, msg: string) => Promise<string>;
  /** Reads an audio path to base64. */
  readAudioBase64: ReadAudioBase64;
  /** Nonce source (default: crypto.randomUUID-ish). */
  nonce?: () => string;
}

const TRANSCRIBE_PATH = "/v1/transcribe";

function defaultNonce(): string {
  // 16 hex chars is sufficient for the replay LRU; avoids a crypto import here.
  return Date.now().toString(16) + Math.random().toString(16).slice(2, 10);
}

/**
 * A {@link TranscriptionProvider} that sends audio to the daemon's encrypted,
 * HMAC-signed POST /v1/transcribe and returns the transcript. No local process
 * is ever spawned — the daemon owns the whisper binary. Used when the daemon's
 * /health advertises `whisper.available` and the operator prefers the daemon.
 */
export function createDaemonTranscriber(
  deps: DaemonTranscriberDeps,
): TranscriptionProvider {
  const cipher = makeTransportCipher(() =>
    tokenToKey(deps.pairingToken, { sha256Hex: deps.sha256Hex }),
  );
  const nonceFn = deps.nonce ?? defaultNonce;

  async function postTranscribe(
    audioPath: string,
    opts: TranscribeOptions,
  ): Promise<TranscriptionResult> {
    const base64 = await deps.readAudioBase64(audioPath);
    const filename = audioPath.slice(
      Math.max(audioPath.lastIndexOf("/"), audioPath.lastIndexOf("\\")) + 1,
    );
    const payload = JSON.stringify({
      audioBase64: base64,
      filename,
      ...(opts.model ? { model: opts.model } : {}),
      ...(opts.language ? { language: opts.language } : {}),
    });
    // Encrypt the body, then sign the WIRE (envelope) bytes — matching the
    // daemon's verify-over-wire then decrypt order.
    const data = await cipher.encrypt(payload);
    const wire = JSON.stringify({ v: TRANSPORT_ENC_VERSION, data });
    const key = await tokenToKey(deps.pairingToken, {
      sha256Hex: deps.sha256Hex,
    });
    const parts: SignedRequestParts = {
      method: "POST",
      path: TRANSCRIBE_PATH,
      bodyHash: await deps.sha256Hex(wire),
      nonce: nonceFn(),
      ts: Date.now(),
    };
    const sig = await deps.hmacHex(key, canonicalRequestString(parts));
    const res = await deps.requestUrl({
      url: deps.baseUrl + TRANSCRIBE_PATH,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        [SIG_HEADER]: sig,
        [NONCE_HEADER]: parts.nonce,
        [TS_HEADER]: String(parts.ts),
        [ENC_HEADER]: TRANSPORT_ENC_VERSION,
      },
      body: wire,
      throw: false,
    });
    if (res.status !== 200) {
      throw new Error(
        `daemon transcribe failed (HTTP ${res.status}): ${res.text || "no body"}`,
      );
    }
    // Response is an encrypted envelope; decrypt then parse.
    let envelope: { v?: string; data?: string };
    try {
      envelope = JSON.parse(res.text) as { v?: string; data?: string };
    } catch {
      throw new Error("daemon transcribe: malformed response envelope");
    }
    if (!envelope.data) {
      throw new Error("daemon transcribe: empty response envelope");
    }
    const plain = await cipher.decrypt(envelope.data);
    const out = JSON.parse(plain) as { text?: string; language?: string };
    if (typeof out.text !== "string") {
      throw new Error("daemon transcribe: response missing text");
    }
    return {
      text: out.text,
      ...(out.language !== undefined ? { language: out.language } : {}),
    };
  }

  return {
    id: "whisper-daemon",
    label: "Whisper (daemon)",
    async isAvailable(): Promise<boolean> {
      return true; // caller gates on /health whisper.available before wiring this
    },
    transcribe(
      audioPath: string,
      opts: TranscribeOptions = {},
    ): Promise<TranscriptionResult> {
      return postTranscribe(audioPath, opts);
    },
  };
}
