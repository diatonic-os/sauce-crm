// sauce-crm-daemon · server specs over REAL HTTP on 127.0.0.1:0.
//
// A fake VaultRegistry.openVault injects an in-memory MemoryBackend so no
// native LanceDB is loaded. Coverage:
//   - GET /health → exact shape, unauthenticated
//   - protected /v1 route rejected (401) with NO signature
//   - protected /v1 route ACCEPTED with a valid HMAC signature (pairing round-trip)
//   - x-sauce-vault routes to the right per-vault store
//   - graceful shutdown closes the socket AND every open Lance store

import { afterEach, describe, expect, it } from "vitest";

import { DaemonServer, VAULT_HEADER } from "./server";
import { VaultRegistry, type OpenVault } from "./vaults";
import type {
  MemoryBackend,
  MemoryHit,
  MemoryQuery,
  EmbedResult,
  SignedRequestParts,
} from "../../src/bridge/contract";
import { ROUTES, canonicalRequestString } from "../../src/bridge/contract";
import { sha256Hex, hmacHex } from "../../src/bridge/crypto";
import { tokenToKey } from "../../src/bridge/auth";
import type { ProvenanceRecord } from "../../src/services/Provenance";
import type { PathEnv } from "../../src/services/platformPaths";

const TOKEN = "a".repeat(64);
const ENV: PathEnv = { platform: "linux", env: {}, home: "/home/test" };

/** In-memory MemoryBackend recording which vault served each call. */
class FakeBackend implements MemoryBackend {
  readonly mode = "lance-desktop" as const;
  closed = false;
  constructor(public readonly tag: string) {}
  async semanticSearch(_q: MemoryQuery): Promise<MemoryHit[]> {
    return [{ path: `${this.tag}/Note.md`, score: 1, fp: "fp1" }];
  }
  async recall(_q: string): Promise<MemoryHit[]> {
    return this.semanticSearch({ query: "" });
  }
  async embed(_t: string, fp: string): Promise<EmbedResult | null> {
    return { fp, dim: 768, cached: false };
  }
  async provenance(fp: string): Promise<ProvenanceRecord[]> {
    return [{ fp, op: "embed", subject: `${this.tag}/Note.md` } as ProvenanceRecord];
  }
  async ready(): Promise<boolean> {
    return true;
  }
}

/** Registry whose openVault yields a FakeBackend + a fake closable lance. */
function fakeRegistry(): { registry: VaultRegistry; closes: string[] } {
  const closes: string[] = [];
  const registry = new VaultRegistry({
    env: ENV,
    requireBase: undefined,
    openVault: async (vaultBasePath: string): Promise<OpenVault> => {
      const memory = new FakeBackend(vaultBasePath);
      return {
        vaultBasePath,
        vaultId: registry.idFor(vaultBasePath),
        dataDir: `/fake/${vaultBasePath}`,
        memory,
        lance: {
          embeddingDim: 768,
          async close() {
            closes.push(vaultBasePath);
          },
        } as unknown as OpenVault["lance"],
      };
    },
  });
  return { registry, closes };
}

const servers: DaemonServer[] = [];
afterEach(async () => {
  while (servers.length) await servers.pop()!.stop();
});

async function startServer(
  registry: VaultRegistry,
  defaultVault: string | null = "/vault/a",
): Promise<{ server: DaemonServer; base: string }> {
  const server = new DaemonServer({
    registry,
    pairingToken: TOKEN,
    bindHost: "127.0.0.1",
    port: 0,
    version: "9.9.9",
    defaultVault: () => defaultVault,
  });
  servers.push(server);
  const addr = await server.start();
  return { server, base: `http://127.0.0.1:${addr.port}` };
}

/** Build valid HMAC headers for a request (mirrors the mobile signer). */
async function signedHeaders(
  method: string,
  path: string,
  body: string,
): Promise<Record<string, string>> {
  const key = await tokenToKey(TOKEN, { sha256Hex });
  const parts: SignedRequestParts = {
    method,
    path,
    bodyHash: await sha256Hex(body),
    nonce: `n-${Math.random()}`,
    ts: Date.now(),
  };
  const sig = await hmacHex(key, canonicalRequestString(parts));
  return {
    "x-sauce-sig": sig,
    "x-sauce-nonce": parts.nonce,
    "x-sauce-ts": String(parts.ts),
    "Content-Type": "application/json",
  };
}

describe("DaemonServer", () => {
  it("GET /health returns the exact daemon shape, unauthenticated", async () => {
    const { registry } = fakeRegistry();
    const { base } = await startServer(registry);
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({
      ok: true,
      name: "sauce-crm-daemon",
      version: "9.9.9",
      lance: { available: false, dim: null },
    });
    expect(typeof body.pid).toBe("number");
    expect(typeof body.uptimeMs).toBe("number");
    expect(body.uptimeMs).toBeGreaterThanOrEqual(0);
  });

  it("rejects a /v1 route with 401 when no signature is present", async () => {
    const { registry } = fakeRegistry();
    const { base } = await startServer(registry);
    const res = await fetch(`${base}${ROUTES.search}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "hi" }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("unauthorized");
  });

  it("accepts a /v1 route with a valid HMAC signature (pairing round-trip)", async () => {
    const { registry } = fakeRegistry();
    const { base } = await startServer(registry, "/vault/a");
    const body = JSON.stringify({ query: "hi" });
    const headers = await signedHeaders("POST", ROUTES.search, body);
    const res = await fetch(`${base}${ROUTES.search}`, {
      method: "POST",
      headers,
      body,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.hits[0].path).toBe("/vault/a/Note.md");
  });

  it("routes to the vault named by x-sauce-vault", async () => {
    const { registry } = fakeRegistry();
    const { base } = await startServer(registry, "/vault/a");
    const body = JSON.stringify({ query: "hi" });
    const headers = await signedHeaders("POST", ROUTES.search, body);
    headers[VAULT_HEADER] = "/vault/b";
    const res = await fetch(`${base}${ROUTES.search}`, {
      method: "POST",
      headers,
      body,
    });
    const json = await res.json();
    expect(json.hits[0].path).toBe("/vault/b/Note.md");
  });

  it("reports lance.available + dim once a vault store is open", async () => {
    const { registry } = fakeRegistry();
    const { server, base } = await startServer(registry, "/vault/a");
    // Force a lazy open via an authenticated request.
    const body = JSON.stringify({ query: "x" });
    const headers = await signedHeaders("POST", ROUTES.search, body);
    await fetch(`${base}${ROUTES.search}`, { method: "POST", headers, body });
    const health = server.health();
    expect(health.lance).toEqual({ available: true, dim: 768 });
  });

  it("graceful shutdown closes the socket and every open Lance store", async () => {
    const { registry, closes } = fakeRegistry();
    const { server, base } = await startServer(registry, "/vault/a");
    const body = JSON.stringify({ query: "x" });
    const headers = await signedHeaders("POST", ROUTES.search, body);
    await fetch(`${base}${ROUTES.search}`, { method: "POST", headers, body });
    expect(registry.isOpen("/vault/a")).toBe(true);

    await server.stop();
    await registry.closeAll();
    expect(closes).toContain("/vault/a");

    // Socket is closed: a follow-up fetch must fail to connect.
    await expect(fetch(`${base}/health`)).rejects.toBeTruthy();
  });
});
