// sauce-crm-daemon · HTTP composition.
//
// Thin composition over EXISTING plugin modules — nothing is forked:
//   - MemoryHttpServer (src/bridge/server) runs the /v1/* RPC surface, gated by
//     the real HmacAuthVerifier (src/bridge/auth) over Web-Crypto HMAC
//     (src/bridge/crypto).
//   - The daemon OWNS the Node http.Server so it can (a) serve an
//     unauthenticated GET /health and (b) select the per-request vault from the
//     `x-sauce-vault` header before delegating into MemoryHttpServer.handleRequest.
//   - A RoutingMemoryBackend resolves the active vault per request via
//     AsyncLocalStorage, so the single injected backend the server holds always
//     targets the right vault store.

import type { IncomingMessage, ServerResponse, Server } from "node:http";
import { AsyncLocalStorage } from "node:async_hooks";

import {
  MemoryHttpServer,
} from "../../src/bridge/server/MemoryHttpServer";
import { HmacAuthVerifier, tokenToKey } from "../../src/bridge/auth";
import { hmacHex, sha256Hex } from "../../src/bridge/crypto";
import type {
  MemoryBackend,
  MemoryQuery,
  MemoryHit,
  EmbedResult,
} from "../../src/bridge/contract";
import type { ProvenanceRecord } from "../../src/services/Provenance";
import { VaultRegistry } from "./vaults";

/** Header a client uses to select its vault (absolute vault base path). */
export const VAULT_HEADER = "x-sauce-vault";
/** Unauthenticated health route (localhost-only, info-only). */
export const HEALTH_ROUTE = "/health";

export interface HealthBody {
  ok: boolean;
  name: "sauce-crm-daemon";
  version: string;
  pid: number;
  uptimeMs: number;
  lance: { available: boolean; dim: number | null };
}

interface RequestCtx {
  vaultBasePath: string;
}

/** A MemoryBackend that dispatches each call to the vault store named by the
 *  ambient AsyncLocalStorage context, opening it lazily via the registry. */
class RoutingMemoryBackend implements MemoryBackend {
  readonly mode = "lance-desktop" as const;
  constructor(
    private readonly registry: VaultRegistry,
    private readonly als: AsyncLocalStorage<RequestCtx>,
    private readonly defaultVault: () => string | null,
  ) {}

  private async target(): Promise<MemoryBackend> {
    const ctx = this.als.getStore();
    const vault = ctx?.vaultBasePath ?? this.defaultVault();
    if (!vault) {
      throw new Error("no vault selected and no defaultVault configured");
    }
    return this.registry.memoryFor(vault);
  }

  async semanticSearch(q: MemoryQuery): Promise<MemoryHit[]> {
    return (await this.target()).semanticSearch(q);
  }
  async recall(q: string, k?: number): Promise<MemoryHit[]> {
    return (await this.target()).recall(q, k);
  }
  async embed(text: string, fp: string): Promise<EmbedResult | null> {
    return (await this.target()).embed(text, fp);
  }
  async provenance(fp: string): Promise<ProvenanceRecord[]> {
    return (await this.target()).provenance(fp);
  }
  async ready(): Promise<boolean> {
    return (await this.target()).ready();
  }
}

export interface DaemonServerDeps {
  registry: VaultRegistry;
  /** Shared pairing token (hex) — derives the HMAC verification key. */
  pairingToken: string;
  bindHost: string;
  port: number;
  version: string;
  /** Default vault base path served when a request omits the vault header. */
  defaultVault: () => string | null;
  /** Optional structured logger (JSONL). */
  log?: (entry: Record<string, unknown>) => void;
}

/** The daemon HTTP server: owns the socket, serves /health, delegates /v1/*. */
export class DaemonServer {
  private httpServer: Server | null = null;
  private readonly als = new AsyncLocalStorage<RequestCtx>();
  private readonly startedAt = Date.now();
  private inner: MemoryHttpServer | null = null;
  private activeRequests = 0;

  constructor(private readonly deps: DaemonServerDeps) {}

  /** Build the inner MemoryHttpServer with the real HMAC verifier. */
  private async buildInner(): Promise<MemoryHttpServer> {
    const key = await tokenToKey(this.deps.pairingToken, { sha256Hex });
    const verifier = new HmacAuthVerifier({ hmacHex }, async () => key);
    const backend = new RoutingMemoryBackend(
      this.deps.registry,
      this.als,
      this.deps.defaultVault,
    );
    return new MemoryHttpServer({
      backend,
      verifier,
      bindHost: this.deps.bindHost,
      port: this.deps.port,
      // /v1/health uses this; report ready when any vault store is open.
      lanceStatus: () =>
        this.deps.registry.anyOpenDim() !== null ? "ready" : "missing",
    });
  }

  health(): HealthBody {
    const dim = this.deps.registry.anyOpenDim();
    return {
      ok: true,
      name: "sauce-crm-daemon",
      version: this.deps.version,
      pid: process.pid,
      uptimeMs: Date.now() - this.startedAt,
      lance: { available: dim !== null, dim },
    };
  }

  async start(): Promise<{ host: string; port: number }> {
    if (this.httpServer) {
      const a = this.httpServer.address();
      const port =
        a && typeof a === "object" ? a.port : this.deps.port;
      return { host: this.deps.bindHost, port };
    }
    this.inner = await this.buildInner();
    const http = await import("node:http");
    // Security (CWE-319): plain HTTP is intentional. The daemon binds loopback
    // ONLY (127.0.0.1) and every /v1/* route is HMAC-signed (auth + integrity +
    // replay protection). /health is info-only and localhost-bound. nosemgrep
    const server = http.createServer((req, res) => {
      void this.dispatch(req, res);
    });
    this.httpServer = server;
    await new Promise<void>((resolve, reject) => {
      const onErr = (e: Error) => {
        this.httpServer = null;
        reject(e);
      };
      server.once("error", onErr);
      server.listen(this.deps.port, this.deps.bindHost, () => {
        server.removeListener("error", onErr);
        resolve();
      });
    });
    const addr = server.address();
    const port = addr && typeof addr === "object" ? addr.port : this.deps.port;
    return { host: this.deps.bindHost, port };
  }

  private async dispatch(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    this.activeRequests++;
    const t0 = Date.now();
    const method = (req.method ?? "GET").toUpperCase();
    const path = (req.url ?? "/").split("?")[0] ?? "/";
    try {
      if (method === "GET" && path === HEALTH_ROUTE) {
        const body = this.health();
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(body));
        return;
      }
      // Select the vault from the header (or default) and run the /v1 pipeline
      // inside that ALS context so the RoutingMemoryBackend targets it.
      const headerVal = req.headers[VAULT_HEADER];
      const vault =
        (Array.isArray(headerVal) ? headerVal[0] : headerVal) ??
        this.deps.defaultVault() ??
        "";
      await this.als.run({ vaultBasePath: vault }, async () => {
        await this.inner!.handleRequest(req, res);
      });
    } finally {
      this.activeRequests--;
      this.deps.log?.({
        ts: new Date().toISOString(),
        ev: "request",
        method,
        path,
        ms: Date.now() - t0,
      });
    }
  }

  /** Number of in-flight requests (for drain on shutdown). */
  pending(): number {
    return this.activeRequests;
  }

  /** Stop accepting connections and resolve once the socket is closed. */
  async stop(): Promise<void> {
    const server = this.httpServer;
    if (!server) return;
    this.httpServer = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }

  address(): { host: string; port: number } | null {
    const a = this.httpServer?.address();
    if (a && typeof a === "object") {
      return { host: this.deps.bindHost, port: a.port };
    }
    return null;
  }
}
