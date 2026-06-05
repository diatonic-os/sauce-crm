// MOB-BRIDGE-001 · T-B — desktop-only HTTP server exposing the bridge RPC
// surface (MOBILE-BRIDGE-SPEC §3.1/§3.2). Pure Node `http` + manual routing,
// no third-party web framework. Everything it depends on is INJECTED so it
// news up nothing it can't test: the MemoryBackend, the AuthVerifier, the
// lance-status probe, and the bind host/port.
//
// Hardening (spec §3.2):
//   - bind to an explicit Tailscale interface address — NEVER 0.0.0.0.
//   - every route except /health is HMAC-gated via the injected AuthVerifier.
//   - body size cap (maxBodyBytes) with 413 + socket destroy on overflow.
//   - JSON.parse guarded → 400 on malformed bodies.
//   - thrown BridgeError → mapped status; anything else → 500 generic (the
//     server NEVER leaks a stack or internal message to the client).
//
// This module imports ONLY from the keystone contract + Node builtins, so it
// stays decoupled from sibling tasks. It is desktop-only: constructing it on a
// platform without `process` throws immediately.

import type { IncomingMessage, ServerResponse, Server } from "node:http";

import {
  BRIDGE_PROTOCOL_VERSION,
  ROUTES,
  SIG_HEADER,
  NONCE_HEADER,
  TS_HEADER,
  ENC_HEADER,
  TRANSPORT_ENC_VERSION,
  isEncEnvelope,
  BridgeError,
} from "../contract";
import type {
  MemoryBackend,
  AuthVerifier,
  TransportCipher,
  EncEnvelope,
  HealthResponse,
  ByFpResponse,
  EmbedRequest,
  EmbedResult,
  SearchRequest,
  SearchResponse,
  RecallRequest,
  ProvenanceResponse,
  SignedRequestParts,
  BridgeErrorCode,
} from "../contract";
import type { TokenBucketRateLimiter } from "./RateLimiter";

export type LanceStatus = HealthResponse["lance"];

export interface MemoryHttpServerDeps {
  /** Authoritative backend (desktop = LanceMemoryBackend from T-A). */
  backend: MemoryBackend;
  /** HMAC verifier (real one built by T-C). */
  verifier: AuthVerifier;
  /** Tailscale interface address. NEVER 0.0.0.0 — required, no default. */
  bindHost: string;
  /** Port to listen on. 0 = ephemeral (tests). */
  port: number;
  /** Synchronous probe of LanceDB readiness for /health. */
  lanceStatus: () => LanceStatus;
  /** Request body cap in bytes. Default 10_000_000 (10 MB). */
  maxBodyBytes?: number;
  /** App-layer AES-256-GCM cipher (built from the pairing key via
   *  crypto.deriveTransportKey). When present, requests carrying `X-Sauce-Enc:
   *  v1` are decrypted before routing and their responses are encrypted. When
   *  absent, the server is plaintext+HMAC only and rejects encrypted requests
   *  with 400. */
  cipher?: TransportCipher;
  /** Per-remote-address token-bucket rate limiter. When present, a throttled
   *  caller gets 429 before any body read / auth / crypto work. */
  rateLimiter?: TokenBucketRateLimiter;
  /** Escape hatch: permit binding a non-loopback / non-explicit interface. The
   *  constructor refuses 0.0.0.0 / :: unless this is explicitly true. Default
   *  (absent) = secure: loopback/explicit interface only. */
  allowNonLoopback?: boolean;
  /** Optional structured logger for bind-assertion + legacy-client warnings. */
  log?: (entry: Record<string, unknown>) => void;
  /** Optional unauthenticated route hook, consulted BEFORE body-read and auth.
   *  Pure extension seam (added for the sauce-crm-daemon's GET /health): return
   *  an `ExtraRouteResult` to short-circuit the request, or `null` to fall
   *  through to the standard pipeline. When omitted, behavior is unchanged.
   *  The hook MUST be side-effect-free w.r.t. the response (the server writes
   *  the JSON); it only decides status + body. Use for INFO-only localhost
   *  routes — never expose authenticated capability through it. */
  extraRoutes?: (
    method: string,
    path: string,
  ) => ExtraRouteResult | null | undefined;
}

/** Result of a matched {@link MemoryHttpServerDeps.extraRoutes} hook. */
export interface ExtraRouteResult {
  status: number;
  body: unknown;
}

const DEFAULT_MAX_BODY_BYTES = 10_000_000;

/** Map a BridgeError code → HTTP status. Anything unmapped falls through to
 *  500 in the caller. */
function statusForBridgeError(code: BridgeErrorCode): number {
  switch (code) {
    case "unauthorized":
    case "not-paired":
      return 401;
    case "protocol-mismatch":
    case "bad-response":
      return 400;
    case "unreachable":
    case "timeout":
      return 503;
    case "server-error":
    default:
      return 500;
  }
}

/** sha256 hex of the raw request body — server side uses node:crypto directly
 *  (the contract's ContentHasher is for the portable mobile path). Lazy-loaded
 *  so this module imports no Node builtin at top level beyond a type. */
function sha256Hex(raw: string): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require("crypto") as typeof import("node:crypto");
  return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
}

export class MemoryHttpServer {
  private server: Server | null = null;
  private readonly maxBodyBytes: number;
  /** Latched so the "legacy plaintext client accepted" deprecation note is
   *  logged at most once per process, not once per request. */
  private legacyWarned = false;

  constructor(private readonly deps: MemoryHttpServerDeps) {
    // Desktop-only gate: mobile (Capacitor WebView) has no `process`.
    if (typeof process === "undefined") {
      throw new Error(
        "MemoryHttpServer is desktop-only (no `process` on this platform)",
      );
    }
    if (!deps.bindHost || typeof deps.bindHost !== "string") {
      throw new Error(
        "MemoryHttpServer requires an explicit bindHost (Tailscale interface address)",
      );
    }
    // Secure-by-default: refuse to ever silently bind every interface. The ONLY
    // way past this is an explicit allowNonLoopback:true (logged loudly below).
    if (
      (deps.bindHost === "0.0.0.0" || deps.bindHost === "::") &&
      deps.allowNonLoopback !== true
    ) {
      throw new Error(
        `MemoryHttpServer refuses to bind all interfaces (${deps.bindHost}); supply the Tailscale interface address or set allowNonLoopback`,
      );
    }
    this.maxBodyBytes = deps.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
  }

  /** Assert + log the resolved bind address. Loopback / explicit addresses log
   *  at info; a non-loopback bind (only reachable via allowNonLoopback) logs a
   *  loud warning so the exposure is auditable. Public so a composing host (the
   *  daemon, which owns its own socket and calls handleRequest) can emit the
   *  same assertion even though it does not call this server's start(). */
  logBind(): void {
    const host = this.deps.bindHost;
    const loopback =
      host === "127.0.0.1" || host === "::1" || host === "localhost";
    const allInterfaces = host === "0.0.0.0" || host === "::";
    this.deps.log?.({
      ev: "bridge-bind",
      host,
      port: this.deps.port,
      loopback,
      allInterfaces,
      allowNonLoopback: this.deps.allowNonLoopback === true,
      encryption: this.deps.cipher ? "available" : "off",
      level: allInterfaces ? "warn" : "info",
    });
  }

  /** The address the server is actually listening on (host + resolved port).
   *  Useful for tests that bind to ephemeral port 0. */
  address(): { host: string; port: number } | null {
    if (!this.server) return null;
    const addr = this.server.address();
    if (addr && typeof addr === "object") {
      return { host: this.deps.bindHost, port: addr.port };
    }
    return null;
  }

  async start(): Promise<void> {
    if (this.server) return;
    this.logBind();
    // Lazy require keeps the top-level import map free of Node builtins.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const http = require("http") as typeof import("node:http");
    // Security (CWE-319): plain HTTP is intentional and safe here. The server
    // binds the Tailscale interface ONLY (constructor refuses 0.0.0.0/::), and
    // Tailscale (WireGuard) encrypts all tailnet traffic end-to-end — it is the
    // transport-encryption layer, so app-level TLS would add cert-management
    // burden with no security gain. Requests are additionally HMAC-signed
    // (auth + integrity + replay protection). Do NOT expose this off-tailnet.
    // nosemgrep
    const server = http.createServer((req, res) => {
      this.handle(req, res).catch((err) => {
        // Last-resort guard: a handler should never throw, but if it does,
        // emit a generic 500 without leaking internals.
        this.fail(res, 500, "server-error", "internal error");
        void err;
      });
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => {
        this.server = null;
        reject(err);
      };
      server.once("error", onError);
      server.listen(this.deps.port, this.deps.bindHost, () => {
        server.removeListener("error", onError);
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  /** Run the full request pipeline on an externally-owned socket WITHOUT this
   *  instance listening itself. Composition seam for the sauce-crm-daemon,
   *  which owns the Node http.Server (so it can set per-vault request context
   *  and serve its own GET /health) and delegates the /v1/* surface here.
   *  Mirrors the internal handler's last-resort 500 guard. `start()` is
   *  unaffected — this is purely additive. */
  async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    try {
      await this.handle(req, res);
    } catch {
      this.fail(res, 500, "server-error", "internal error");
    }
  }

  // ───────────────────────── request pipeline ─────────────────────────

  private async handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const method = (req.method ?? "GET").toUpperCase();
    // Strip query string; routing keys off pathname only.
    const rawUrl = req.url ?? "/";
    const path = rawUrl.split("?")[0]!; // split always yields ≥1 element

    // (2) Abuse control: token-bucket rate limit per remote addr, BEFORE any
    // body read / auth / crypto so a flood is cheap to shed. 429 on empty
    // bucket. /health is exempt (info-only, no secrets, used for liveness).
    if (
      this.deps.rateLimiter &&
      !(method === "GET" && path === ROUTES.health) &&
      !this.deps.rateLimiter.allow(remoteAddr(req))
    ) {
      this.fail(res, 429, "server-error", "rate limited");
      return;
    }

    // Pure extension seam: consult the injected extraRoutes hook first. It runs
    // BEFORE body-read and auth, so it must only serve unauthenticated info
    // routes (e.g. the daemon's GET /health). No hook → unchanged behavior.
    const extra = this.deps.extraRoutes?.(method, path);
    if (extra) {
      await this.send(res, extra.status, extra.body, null);
      return;
    }

    // /health is public — no auth, no body needed, ALWAYS plaintext (no secrets).
    if (method === "GET" && path === ROUTES.health) {
      const body: HealthResponse = {
        ok: true,
        version: BRIDGE_PROTOCOL_VERSION,
        lance: this.deps.lanceStatus(),
      };
      await this.send(res, 200, body, null);
      return;
    }

    // Read + cap the body before doing anything else (auth hashes the WIRE
    // bytes, encrypted or not).
    let raw: string;
    try {
      raw = await this.readBody(req, res);
    } catch (err) {
      if (err instanceof BodyTooLarge) {
        // readBody already destroyed the socket + responded.
        return;
      }
      this.fail(res, 400, "bad-response", "could not read request body");
      return;
    }

    // (1) Detect the app-layer encryption header. When present we will decrypt
    // the request body and encrypt the response. `encrypt` is the per-request
    // cipher used for the RESPONSE (null ⇒ plaintext response).
    const encHeader = header(req, ENC_HEADER);
    let encrypt: TransportCipher | null = null;
    if (encHeader) {
      if (encHeader !== TRANSPORT_ENC_VERSION) {
        this.fail(res, 400, "bad-response", "unsupported encryption version");
        return;
      }
      if (!this.deps.cipher) {
        // Client asked for encryption but this listener has none configured.
        this.fail(res, 400, "bad-response", "encryption not available");
        return;
      }
      encrypt = this.deps.cipher;
    } else if (!this.legacyWarned) {
      // Backward compat: legacy plaintext+HMAC clients are still accepted this
      // release. Log ONCE so the deprecation is visible without log spam.
      this.legacyWarned = true;
      this.deps.log?.({
        ev: "bridge-legacy-plaintext",
        level: "warn",
        note: "accepted an unencrypted (HMAC-only) bridge request; X-Sauce-Enc:v1 is the supported transport — plaintext is deprecated",
      });
    }

    // Authenticate every non-health route over the RAW WIRE body (the bytes the
    // client actually signed — ciphertext envelope when encrypted).
    const auth = await this.authenticate(method, path, raw, req);
    if (!auth.ok) {
      this.fail(res, 401, "unauthorized", auth.reason);
      return;
    }

    // Decrypt the wire body to the plaintext the router consumes. A tampered or
    // malformed envelope → 400 (GCM tag failure throws inside decrypt).
    let plain = raw;
    if (encrypt) {
      try {
        plain = await this.decryptBody(raw, encrypt);
      } catch {
        this.fail(res, 400, "bad-response", "could not decrypt request body");
        return;
      }
    }

    try {
      await this.route(method, path, plain, res, encrypt);
    } catch (err) {
      if (err instanceof BridgeError) {
        await this.send(
          res,
          err.status ?? statusForBridgeError(err.code),
          { error: err.code, reason: err.message },
          encrypt,
        );
        return;
      }
      // Never leak a non-BridgeError's message/stack.
      this.fail(res, 500, "server-error", "internal error");
    }
  }

  /** Decrypt a wire body. Expects a JSON {@link EncEnvelope}; an empty wire body
   *  decrypts to empty (no-arg requests). Throws on malformed/tampered input. */
  private async decryptBody(
    raw: string,
    cipher: TransportCipher,
  ): Promise<string> {
    if (raw.length === 0) return "";
    const env = JSON.parse(raw) as unknown;
    if (!isEncEnvelope(env) || env.v !== TRANSPORT_ENC_VERSION) {
      throw new Error("bad envelope");
    }
    return cipher.decrypt(env.data);
  }

  /** Verify HMAC headers via the injected verifier. Missing headers → reject. */
  private async authenticate(
    method: string,
    path: string,
    raw: string,
    req: IncomingMessage,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const sig = header(req, SIG_HEADER);
    const nonce = header(req, NONCE_HEADER);
    const tsRaw = header(req, TS_HEADER);
    if (!sig || !nonce || !tsRaw) {
      return { ok: false, reason: "missing-auth-headers" };
    }
    const ts = Number(tsRaw);
    if (!Number.isFinite(ts)) {
      return { ok: false, reason: "bad-timestamp" };
    }
    const parts: SignedRequestParts = {
      method,
      path,
      bodyHash: sha256Hex(raw),
      nonce,
      ts,
    };
    const result = await this.deps.verifier.verify(parts, sig);
    if (result.ok) return { ok: true };
    return { ok: false, reason: result.reason };
  }

  /** Dispatch an authenticated request to the backend. Throws BridgeError for
   *  client-facing failures; the caller maps it. `enc` (when non-null) encrypts
   *  every response body produced here. */
  private async route(
    method: string,
    path: string,
    raw: string,
    res: ServerResponse,
    enc: TransportCipher | null,
  ): Promise<void> {
    // The :fp routes are built from the contract route helpers. Calling them
    // with an empty fp yields the exact static prefix, so the server and the
    // client (T-D) can never drift on the path shape.
    const byFpPrefix = ROUTES.byFp(""); // ".../v1/memory/by-fp/"
    const provPrefix = ROUTES.provenance(""); // ".../v1/provenance/"

    // GET /v1/memory/by-fp/:fp
    if (method === "GET" && path.startsWith(byFpPrefix)) {
      const fp = decodeURIComponent(path.slice(byFpPrefix.length));
      const records = await this.deps.backend.provenance(fp);
      const known = records.length > 0;
      const body: ByFpResponse = { fp, known };
      await this.send(res, known ? 200 : 404, body, enc);
      return;
    }

    // GET /v1/provenance/:fp
    if (method === "GET" && path.startsWith(provPrefix)) {
      const fp = decodeURIComponent(path.slice(provPrefix.length));
      const records = await this.deps.backend.provenance(fp);
      const body: ProvenanceResponse = { fp, records };
      await this.send(res, 200, body, enc);
      return;
    }

    // POST /v1/memory/embed
    if (method === "POST" && path === ROUTES.embed) {
      const reqBody = this.parseJson<EmbedRequest>(raw);
      if (reqBody === undefined) {
        await this.send(
          res,
          400,
          { error: "bad-response", reason: "invalid JSON body" },
          enc,
        );
        return;
      }
      const result: EmbedResult | null = await this.deps.backend.embed(
        reqBody.text,
        reqBody.fp,
      );
      if (result === null) {
        await this.send(res, 404, { known: false }, enc);
        return;
      }
      await this.send(res, 200, result, enc);
      return;
    }

    // POST /v1/memory/search
    if (method === "POST" && path === ROUTES.search) {
      const reqBody = this.parseJson<SearchRequest>(raw);
      if (reqBody === undefined) {
        await this.send(
          res,
          400,
          { error: "bad-response", reason: "invalid JSON body" },
          enc,
        );
        return;
      }
      const hits = await this.deps.backend.semanticSearch({
        query: reqBody.query,
        ...(reqBody.k !== undefined ? { k: reqBody.k } : {}),
      });
      const body: SearchResponse = { hits };
      await this.send(res, 200, body, enc);
      return;
    }

    // POST /v1/memory/recall
    if (method === "POST" && path === ROUTES.recall) {
      const reqBody = this.parseJson<RecallRequest>(raw);
      if (reqBody === undefined) {
        await this.send(
          res,
          400,
          { error: "bad-response", reason: "invalid JSON body" },
          enc,
        );
        return;
      }
      const hits = await this.deps.backend.recall(reqBody.q, reqBody.k);
      const body: SearchResponse = { hits };
      await this.send(res, 200, body, enc);
      return;
    }

    // No route matched.
    await this.send(
      res,
      404,
      { error: "bad-response", reason: "no such route" },
      enc,
    );
  }

  // ───────────────────────── body + json ─────────────────────────

  /** Accumulate the request body, enforcing maxBodyBytes. On overflow: respond
   *  413, destroy the socket, and throw BodyTooLarge so the caller stops. */
  private readBody(req: IncomingMessage, res: ServerResponse): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let aborted = false;
      req.on("data", (chunk: Buffer) => {
        if (aborted) return;
        size += chunk.length;
        if (size > this.maxBodyBytes) {
          aborted = true;
          this.fail(res, 413, "bad-response", "request body too large");
          req.destroy();
          reject(new BodyTooLarge());
          return;
        }
        chunks.push(chunk);
      });
      req.on("end", () => {
        if (aborted) return;
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
      req.on("error", (err) => {
        if (aborted) return;
        reject(err);
      });
    });
  }

  /** Guarded JSON parse. Returns undefined on failure (caller responds 400). */
  private parseJson<T>(raw: string): T | undefined {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  // ───────────────────────── responses ─────────────────────────

  /** Plaintext error responder for the pre-route pipeline (rate limit, body
   *  read, auth, encryption-handshake). These never carry secrets and always
   *  go out in the clear so a client can read the failure even pre-handshake. */
  private fail(
    res: ServerResponse,
    status: number,
    code: BridgeErrorCode,
    reason: string,
  ): void {
    if (res.writableEnded || res.headersSent) return;
    const payload = JSON.stringify({ error: code, reason });
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(payload);
  }

  /** Write a response body, encrypting it into an {@link EncEnvelope} when `enc`
   *  is non-null. The status is NEVER encrypted (it must be readable on the
   *  wire); only the JSON body is. On encryption failure we degrade to a generic
   *  plaintext 500 rather than leak the cleartext. */
  private async send(
    res: ServerResponse,
    status: number,
    body: unknown,
    enc: TransportCipher | null,
  ): Promise<void> {
    if (res.writableEnded || res.headersSent) return;
    let payload: string;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (enc) {
      try {
        const data = await enc.encrypt(JSON.stringify(body));
        const env: EncEnvelope = { v: TRANSPORT_ENC_VERSION, data };
        payload = JSON.stringify(env);
        headers[ENC_HEADER] = TRANSPORT_ENC_VERSION;
      } catch {
        if (res.writableEnded || res.headersSent) return;
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: "server-error", reason: "internal error" }),
        );
        return;
      }
    } else {
      payload = JSON.stringify(body);
    }
    if (res.writableEnded || res.headersSent) return;
    res.writeHead(status, headers);
    res.end(payload);
  }
}

class BodyTooLarge extends Error {
  constructor() {
    super("request body too large");
    this.name = "BodyTooLarge";
  }
}

/** Case-insensitive header read (Node lowercases header names already, but be
 *  defensive about array-valued headers). */
function header(req: IncomingMessage, name: string): string | null {
  const v = req.headers[name.toLowerCase()];
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

/** Best-effort remote address for rate-limiting. Falls back to a constant so a
 *  socket without an address (rare, e.g. unix-socket test harness) still buckets
 *  consistently rather than throwing. We do NOT trust X-Forwarded-* here — this
 *  listener is loopback/tailnet-only, so the kernel socket peer is authoritative. */
function remoteAddr(req: IncomingMessage): string {
  return req.socket?.remoteAddress ?? "unknown";
}
