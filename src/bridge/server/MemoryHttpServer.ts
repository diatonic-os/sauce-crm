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
  canonicalRequestString,
  BridgeError,
} from "../contract";
import type {
  MemoryBackend,
  AuthVerifier,
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
  /** Request body cap in bytes. Default 1_000_000. */
  maxBodyBytes?: number;
}

const DEFAULT_MAX_BODY_BYTES = 1_000_000;

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
    // Secure-by-default: refuse to ever silently bind every interface.
    if (deps.bindHost === "0.0.0.0" || deps.bindHost === "::") {
      throw new Error(
        `MemoryHttpServer refuses to bind all interfaces (${deps.bindHost}); supply the Tailscale interface address`,
      );
    }
    this.maxBodyBytes = deps.maxBodyBytes ?? DEFAULT_MAX_BODY_BYTES;
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

  // ───────────────────────── request pipeline ─────────────────────────

  private async handle(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    const method = (req.method ?? "GET").toUpperCase();
    // Strip query string; routing keys off pathname only.
    const rawUrl = req.url ?? "/";
    const path = rawUrl.split("?")[0]!; // split always yields ≥1 element

    // /health is public — no auth, no body needed.
    if (method === "GET" && path === ROUTES.health) {
      const body: HealthResponse = {
        ok: true,
        version: BRIDGE_PROTOCOL_VERSION,
        lance: this.deps.lanceStatus(),
      };
      this.ok(res, 200, body);
      return;
    }

    // Read + cap the body before doing anything else (auth hashes it).
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

    // Authenticate every non-health route.
    const auth = await this.authenticate(method, path, raw, req);
    if (!auth.ok) {
      this.fail(res, 401, "unauthorized", auth.reason);
      return;
    }

    try {
      await this.route(method, path, raw, res);
    } catch (err) {
      if (err instanceof BridgeError) {
        this.fail(
          res,
          err.status ?? statusForBridgeError(err.code),
          err.code,
          err.message,
        );
        return;
      }
      // Never leak a non-BridgeError's message/stack.
      this.fail(res, 500, "server-error", "internal error");
    }
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
   *  client-facing failures; the caller maps it. */
  private async route(
    method: string,
    path: string,
    raw: string,
    res: ServerResponse,
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
      this.ok(res, known ? 200 : 404, body);
      return;
    }

    // GET /v1/provenance/:fp
    if (method === "GET" && path.startsWith(provPrefix)) {
      const fp = decodeURIComponent(path.slice(provPrefix.length));
      const records = await this.deps.backend.provenance(fp);
      const body: ProvenanceResponse = { fp, records };
      this.ok(res, 200, body);
      return;
    }

    // POST /v1/memory/embed
    if (method === "POST" && path === ROUTES.embed) {
      const reqBody = this.parseJson<EmbedRequest>(raw, res);
      if (reqBody === undefined) return; // parseJson already responded 400
      const result: EmbedResult | null = await this.deps.backend.embed(
        reqBody.text,
        reqBody.fp,
      );
      if (result === null) {
        this.ok(res, 404, { known: false });
        return;
      }
      this.ok(res, 200, result);
      return;
    }

    // POST /v1/memory/search
    if (method === "POST" && path === ROUTES.search) {
      const reqBody = this.parseJson<SearchRequest>(raw, res);
      if (reqBody === undefined) return;
      const hits = await this.deps.backend.semanticSearch({
        query: reqBody.query,
        ...(reqBody.k !== undefined ? { k: reqBody.k } : {}),
      });
      const body: SearchResponse = { hits };
      this.ok(res, 200, body);
      return;
    }

    // POST /v1/memory/recall
    if (method === "POST" && path === ROUTES.recall) {
      const reqBody = this.parseJson<RecallRequest>(raw, res);
      if (reqBody === undefined) return;
      const hits = await this.deps.backend.recall(reqBody.q, reqBody.k);
      const body: SearchResponse = { hits };
      this.ok(res, 200, body);
      return;
    }

    // No route matched.
    this.fail(res, 404, "bad-response", "no such route");
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

  /** Guarded JSON parse. On failure responds 400 and returns undefined so the
   *  caller can early-return. Empty body parses as {} (lenient for no-arg POSTs
   *  is not needed here, but an empty string is treated as a 400). */
  private parseJson<T>(raw: string, res: ServerResponse): T | undefined {
    try {
      return JSON.parse(raw) as T;
    } catch {
      this.fail(res, 400, "bad-response", "invalid JSON body");
      return undefined;
    }
  }

  // ───────────────────────── responses ─────────────────────────

  private ok(res: ServerResponse, status: number, body: unknown): void {
    this.send(res, status, body);
  }

  private fail(
    res: ServerResponse,
    status: number,
    code: BridgeErrorCode,
    reason: string,
  ): void {
    this.send(res, status, { error: code, reason });
  }

  private send(res: ServerResponse, status: number, body: unknown): void {
    if (res.writableEnded || res.headersSent) return;
    const payload = JSON.stringify(body);
    res.writeHead(status, { "Content-Type": "application/json" });
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
