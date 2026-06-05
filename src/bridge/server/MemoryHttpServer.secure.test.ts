// Secure-listener specs for MemoryHttpServer: app-layer AES-256-GCM body
// encryption, replay protection, rate limiting, body-cap, bind safety, and
// legacy plaintext back-compat. Drives the server over REAL HTTP with the REAL
// HMAC verifier, the REAL Web-Crypto cipher, and the REAL BridgeMemoryBackend
// client — so this is a true end-to-end of both ends of the wire.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MemoryHttpServer } from "./MemoryHttpServer";
import { TokenBucketRateLimiter } from "./RateLimiter";
import { HmacAuthVerifier, tokenToKey } from "../auth";
import {
  sha256Hex,
  hmacHex,
  deriveTransportKey,
  transportEncrypt,
  transportDecrypt,
} from "../crypto";
import { BridgeMemoryBackend } from "../mobile/bridge/BridgeMemoryBackend";
import { HmacAuthSigner } from "../auth";
import { InMemoryResultCache } from "../wiring";
import {
  ROUTES,
  ENC_HEADER,
  TRANSPORT_ENC_VERSION,
  isEncEnvelope,
  type MemoryBackend,
  type MemoryHit,
  type MemoryQuery,
  type EmbedResult,
  type TransportCipher,
  type HttpRequestFn,
  type HttpResponse,
} from "../contract";
import type { ProvenanceRecord } from "../../services/Provenance";

const TOKEN = "f".repeat(64);

const HIT: MemoryHit = { path: "people/Jane.md", score: 0.9, fp: "abc" };

class FakeBackend implements MemoryBackend {
  readonly mode = "lance-desktop" as const;
  lastSearch: MemoryQuery | null = null;
  async semanticSearch(q: MemoryQuery): Promise<MemoryHit[]> {
    this.lastSearch = q;
    return [HIT];
  }
  async recall(): Promise<MemoryHit[]> {
    return [HIT];
  }
  async embed(_t: string, fp: string): Promise<EmbedResult | null> {
    return { fp, dim: 768, cached: false };
  }
  async provenance(): Promise<ProvenanceRecord[]> {
    return [];
  }
  async ready(): Promise<boolean> {
    return true;
  }
}

/** Real cipher from the pairing token (server + client share it by derivation). */
async function makeCipher(): Promise<TransportCipher> {
  const key = await tokenToKey(TOKEN, { sha256Hex });
  const aes = await deriveTransportKey(key);
  return {
    encrypt: (pt) => transportEncrypt(aes, pt),
    decrypt: (wire) => transportDecrypt(aes, wire),
  };
}

/** fetch → HttpRequestFn adapter for the client. */
const fetchRequest: HttpRequestFn = async (req): Promise<HttpResponse> => {
  const r = await fetch(req.url, {
    method: req.method,
    ...(req.headers ? { headers: req.headers } : {}),
    ...(req.body !== undefined ? { body: req.body } : {}),
  });
  const text = await r.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: r.status, json, text };
};

let server: MemoryHttpServer;
let backend: FakeBackend;
let base: string;
let cipher: TransportCipher;
let logs: Record<string, unknown>[];

async function startServer(
  extra?: Partial<ConstructorParameters<typeof MemoryHttpServer>[0]> & {
    noCipher?: boolean;
  },
): Promise<void> {
  const key = await tokenToKey(TOKEN, { sha256Hex });
  const verifier = new HmacAuthVerifier({ hmacHex }, async () => key);
  const { noCipher, ...rest } = extra ?? {};
  server = new MemoryHttpServer({
    backend,
    verifier,
    ...(noCipher ? {} : { cipher }),
    bindHost: "127.0.0.1",
    port: 0,
    lanceStatus: () => "ready",
    log: (e) => logs.push(e),
    ...rest,
  });
  await server.start();
  const addr = server.address();
  if (!addr) throw new Error("no bind");
  base = `http://127.0.0.1:${addr.port}`;
}

/** A real encrypting client bound to this server. */
function makeClient(opts?: { withCipher?: boolean }): BridgeMemoryBackend {
  const signer = new HmacAuthSigner({ hmacHex }, () =>
    tokenToKey(TOKEN, { sha256Hex }),
  );
  return new BridgeMemoryBackend({
    baseUrl: base,
    request: fetchRequest,
    signer,
    hasher: { sha256Hex },
    cache: new InMemoryResultCache(),
    ...(opts?.withCipher === false ? {} : { cipher }),
  });
}

beforeEach(async () => {
  backend = new FakeBackend();
  logs = [];
  cipher = await makeCipher();
});

afterEach(async () => {
  await server?.stop();
});

describe("MemoryHttpServer · encrypted transport", () => {
  it("round-trips an encrypted store/search through the real client", async () => {
    await startServer();
    const client = makeClient();
    const hits = await client.semanticSearch({ query: "who is jane", k: 3 });
    expect(hits).toEqual([HIT]);
    expect(backend.lastSearch).toEqual({ query: "who is jane", k: 3 });
  });

  it("request and response bodies are ciphertext on the wire", async () => {
    await startServer();
    // Hand-build an encrypted request and inspect the raw response.
    const plain = JSON.stringify({ query: "TOPSECRETQUERY", k: 1 });
    const data = await cipher.encrypt(plain);
    const body = JSON.stringify({ v: TRANSPORT_ENC_VERSION, data });
    const bodyHash = await sha256Hex(body);
    const key = await tokenToKey(TOKEN, { sha256Hex });
    const ts = Date.now();
    const nonce = "nonce-wire";
    const sig = await hmacHex(
      key,
      ["POST", ROUTES.search, bodyHash, nonce, String(ts)].join("\n"),
    );
    const res = await fetch(`${base}${ROUTES.search}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sauce-sig": sig,
        "x-sauce-nonce": nonce,
        "x-sauce-ts": String(ts),
        [ENC_HEADER]: TRANSPORT_ENC_VERSION,
      },
      body,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get(ENC_HEADER)).toBe(TRANSPORT_ENC_VERSION);
    const text = await res.text();
    expect(text).not.toContain("Jane"); // response is encrypted
    const env = JSON.parse(text);
    expect(isEncEnvelope(env)).toBe(true);
    const dec = await cipher.decrypt(env.data);
    expect(JSON.parse(dec)).toEqual({ hits: [HIT] });
  });

  it("rejects a tampered ciphertext body with 400", async () => {
    await startServer();
    const plain = JSON.stringify({ query: "x", k: 1 });
    const good = await cipher.encrypt(plain);
    // Corrupt the ciphertext.
    const mid = Math.floor(good.length / 2);
    const bad =
      good.slice(0, mid) +
      (good[mid] === "A" ? "B" : "A") +
      good.slice(mid + 1);
    const body = JSON.stringify({ v: TRANSPORT_ENC_VERSION, data: bad });
    const bodyHash = await sha256Hex(body);
    const key = await tokenToKey(TOKEN, { sha256Hex });
    const ts = Date.now();
    const nonce = "nonce-tamper";
    const sig = await hmacHex(
      key,
      ["POST", ROUTES.search, bodyHash, nonce, String(ts)].join("\n"),
    );
    const res = await fetch(`${base}${ROUTES.search}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sauce-sig": sig,
        "x-sauce-nonce": nonce,
        "x-sauce-ts": String(ts),
        [ENC_HEADER]: TRANSPORT_ENC_VERSION,
      },
      body,
    });
    expect(res.status).toBe(400);
    expect(backend.lastSearch).toBeNull();
  });

  it("rejects an encrypted request when the server has NO cipher (400)", async () => {
    await startServer({ noCipher: true });
    const data = "doesntmatter";
    const body = JSON.stringify({ v: TRANSPORT_ENC_VERSION, data });
    const bodyHash = await sha256Hex(body);
    const key = await tokenToKey(TOKEN, { sha256Hex });
    const ts = Date.now();
    const nonce = "n-nocipher";
    const sig = await hmacHex(
      key,
      ["POST", ROUTES.search, bodyHash, nonce, String(ts)].join("\n"),
    );
    const res = await fetch(`${base}${ROUTES.search}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sauce-sig": sig,
        "x-sauce-nonce": nonce,
        "x-sauce-ts": String(ts),
        [ENC_HEADER]: TRANSPORT_ENC_VERSION,
      },
      body,
    });
    expect(res.status).toBe(400);
  });
});

describe("MemoryHttpServer · replay protection", () => {
  it("rejects a replayed nonce (same signed request twice)", async () => {
    await startServer();
    const plain = JSON.stringify({ query: "x", k: 1 });
    const data = await cipher.encrypt(plain);
    const body = JSON.stringify({ v: TRANSPORT_ENC_VERSION, data });
    const bodyHash = await sha256Hex(body);
    const key = await tokenToKey(TOKEN, { sha256Hex });
    const ts = Date.now();
    const nonce = "replay-me";
    const sig = await hmacHex(
      key,
      ["POST", ROUTES.search, bodyHash, nonce, String(ts)].join("\n"),
    );
    const headers = {
      "content-type": "application/json",
      "x-sauce-sig": sig,
      "x-sauce-nonce": nonce,
      "x-sauce-ts": String(ts),
      [ENC_HEADER]: TRANSPORT_ENC_VERSION,
    };
    const first = await fetch(`${base}${ROUTES.search}`, {
      method: "POST",
      headers,
      body,
    });
    expect(first.status).toBe(200);
    const second = await fetch(`${base}${ROUTES.search}`, {
      method: "POST",
      headers,
      body,
    });
    expect(second.status).toBe(401);
    const j = await second.json();
    expect(j.reason).toBe("replayed-nonce");
  });
});

describe("MemoryHttpServer · rate limiting", () => {
  it("returns 429 once the per-addr bucket is empty", async () => {
    await startServer({
      rateLimiter: new TokenBucketRateLimiter({
        capacity: 2,
        refillPerSec: 0.001,
        now: () => 0,
      }),
    });
    const client = makeClient();
    // Two allowed…
    await client.semanticSearch({ query: "a" });
    await client.semanticSearch({ query: "b" });
    // …third throttled → BridgeError(server-error) from the 429.
    await expect(client.semanticSearch({ query: "c" })).rejects.toMatchObject({
      status: 429,
    });
  });

  it("/health is exempt from rate limiting", async () => {
    await startServer({
      rateLimiter: new TokenBucketRateLimiter({
        capacity: 1,
        refillPerSec: 0.001,
        now: () => 0,
      }),
    });
    // Drain the bucket with one gated call's worth, then health still answers.
    await fetch(`${base}${ROUTES.health}`);
    const r1 = await fetch(`${base}${ROUTES.health}`);
    const r2 = await fetch(`${base}${ROUTES.health}`);
    expect(r1.status).toBe(200);
    expect(r2.status).toBe(200);
  });
});

describe("MemoryHttpServer · body cap", () => {
  it("rejects a body over the cap with 413 (early, before auth)", async () => {
    await startServer({ maxBodyBytes: 128 });
    const res = await fetch(`${base}${ROUTES.search}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "x".repeat(2000),
    });
    expect(res.status).toBe(413);
  });
});

describe("MemoryHttpServer · legacy plaintext back-compat", () => {
  it("accepts an unencrypted HMAC-only request and logs the deprecation once", async () => {
    await startServer();
    const client = makeClient({ withCipher: false }); // plaintext client
    const hits = await client.semanticSearch({ query: "legacy", k: 1 });
    expect(hits).toEqual([HIT]);
    const warned = logs.filter((l) => l.ev === "bridge-legacy-plaintext");
    expect(warned.length).toBe(1);
    // A second legacy call must NOT log again (latched once).
    await client.semanticSearch({ query: "legacy2" });
    expect(logs.filter((l) => l.ev === "bridge-legacy-plaintext").length).toBe(
      1,
    );
  });
});

describe("MemoryHttpServer · bind safety", () => {
  it("logs the resolved bind address on start", async () => {
    await startServer();
    const bind = logs.find((l) => l.ev === "bridge-bind");
    expect(bind).toMatchObject({
      host: "127.0.0.1",
      loopback: true,
      allInterfaces: false,
      encryption: "available",
    });
  });

  it("refuses 0.0.0.0 unless allowNonLoopback is set", () => {
    expect(
      () =>
        new MemoryHttpServer({
          backend,
          verifier: { verify: async () => ({ ok: true }) },
          bindHost: "0.0.0.0",
          port: 0,
          lanceStatus: () => "ready",
        }),
    ).toThrow(/refuses to bind all interfaces/);
  });

  it("permits 0.0.0.0 when allowNonLoopback:true (and logs a warn)", async () => {
    await startServer({ bindHost: "0.0.0.0", allowNonLoopback: true });
    const bind = logs.find((l) => l.ev === "bridge-bind");
    expect(bind).toMatchObject({
      allInterfaces: true,
      allowNonLoopback: true,
      level: "warn",
    });
  });
});
