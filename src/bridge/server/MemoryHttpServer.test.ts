// MOB-BRIDGE-001 · T-B — MemoryHttpServer specs. The server is spun on an
// ephemeral port (127.0.0.1:0) with a FAKE backend and a FAKE verifier whose
// verdict is toggleable per test, then driven over real HTTP with fetch.
//
// Coverage: health is unauthenticated; protected routes 401 when the verifier
// rejects (and when auth headers are missing); happy paths return backend data
// (search/recall/embed/by-fp/provenance, including 404 paths); oversized body
// → 413; malformed JSON → 400; non-BridgeError throw → generic 500 with no
// leaked internals.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";

import { MemoryHttpServer } from "./MemoryHttpServer";
import {
  BRIDGE_PROTOCOL_VERSION,
  ROUTES,
  SIG_HEADER,
  NONCE_HEADER,
  TS_HEADER,
  BridgeError,
} from "../contract";
import type {
  MemoryBackend,
  MemoryHit,
  EmbedResult,
  MemoryQuery,
  AuthVerifier,
  AuthResult,
  SignedRequestParts,
} from "../contract";
import type { ProvenanceRecord } from "../../services/Provenance";

// ───────────────────────── fakes ─────────────────────────

class FakeVerifier implements AuthVerifier {
  verdict: AuthResult = { ok: true };
  lastParts: SignedRequestParts | null = null;
  lastSig: string | null = null;
  async verify(parts: SignedRequestParts, signature: string): Promise<AuthResult> {
    this.lastParts = parts;
    this.lastSig = signature;
    return this.verdict;
  }
}

const HIT: MemoryHit = { path: "people/Jane.md", score: 0.91, fp: "abc123", snippet: "hi" };

const PROV: ProvenanceRecord = {
  fp: "abc123",
  op: "embed",
  subject: "people/Jane.md",
  kind: "note",
  ts: 1,
  parentFp: "",
  meta: null,
  signature: "sig",
};

class FakeBackend implements MemoryBackend {
  readonly mode = "lance-desktop" as const;
  searchHits: MemoryHit[] = [HIT];
  recallHits: MemoryHit[] = [HIT];
  embedResult: EmbedResult | null = { fp: "abc123", dim: 768, cached: false };
  provenanceRecords: ProvenanceRecord[] = [PROV];
  throwOnSearch: Error | null = null;

  lastSearch: MemoryQuery | null = null;
  lastRecall: { q: string; k?: number } | null = null;
  lastEmbed: { text: string; fp: string } | null = null;
  lastProvenance: string | null = null;

  async semanticSearch(q: MemoryQuery): Promise<MemoryHit[]> {
    this.lastSearch = q;
    if (this.throwOnSearch) throw this.throwOnSearch;
    return this.searchHits;
  }
  async recall(q: string, k?: number): Promise<MemoryHit[]> {
    this.lastRecall = { q, ...(k !== undefined ? { k } : {}) };
    return this.recallHits;
  }
  async embed(text: string, fp: string): Promise<EmbedResult | null> {
    this.lastEmbed = { text, fp };
    return this.embedResult;
  }
  async provenance(fp: string): Promise<ProvenanceRecord[]> {
    this.lastProvenance = fp;
    return this.provenanceRecords;
  }
  async ready(): Promise<boolean> {
    return true;
  }
}

// ───────────────────────── harness ─────────────────────────

let server: MemoryHttpServer;
let backend: FakeBackend;
let verifier: FakeVerifier;
let base: string;

beforeEach(async () => {
  backend = new FakeBackend();
  verifier = new FakeVerifier();
  server = new MemoryHttpServer({
    backend,
    verifier,
    bindHost: "127.0.0.1",
    port: 0,
    lanceStatus: () => "ready",
    maxBodyBytes: 256, // small cap so the oversize test is cheap
  });
  await server.start();
  const addr = server.address();
  if (!addr) throw new Error("server did not bind");
  base = `http://127.0.0.1:${addr.port}`;
});

afterEach(async () => {
  await server.stop();
});

/** Build the auth headers the server expects. Signature value is opaque to the
 *  server (the FAKE verifier decides ok/not-ok), so any string works. */
function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    [SIG_HEADER]: "deadbeef",
    [NONCE_HEADER]: "nonce-1",
    [TS_HEADER]: String(Date.now()),
    ...extra,
  };
}

describe("MemoryHttpServer", () => {
  it("rejects bind to 0.0.0.0 at construction", () => {
    expect(
      () =>
        new MemoryHttpServer({
          backend,
          verifier,
          bindHost: "0.0.0.0",
          port: 0,
          lanceStatus: () => "ready",
        }),
    ).toThrow(/refuses to bind all interfaces/);
  });

  it("requires an explicit bindHost", () => {
    expect(
      () =>
        new MemoryHttpServer({
          backend,
          verifier,
          bindHost: "",
          port: 0,
          lanceStatus: () => "ready",
        }),
    ).toThrow(/explicit bindHost/);
  });

  it("serves /health with NO auth", async () => {
    verifier.verdict = { ok: false, reason: "bad-signature" }; // would fail any gated route
    const res = await fetch(`${base}${ROUTES.health}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ ok: true, version: BRIDGE_PROTOCOL_VERSION, lance: "ready" });
    // verifier never consulted for health
    expect(verifier.lastParts).toBeNull();
  });

  it("reflects lanceStatus in /health", async () => {
    const installing = new MemoryHttpServer({
      backend,
      verifier,
      bindHost: "127.0.0.1",
      port: 0,
      lanceStatus: () => "installing",
    });
    await installing.start();
    try {
      const addr = installing.address()!;
      const res = await fetch(`http://127.0.0.1:${addr.port}${ROUTES.health}`);
      const body = await res.json();
      expect(body.lance).toBe("installing");
    } finally {
      await installing.stop();
    }
  });

  it("returns 401 when the verifier rejects", async () => {
    verifier.verdict = { ok: false, reason: "stale-timestamp" };
    const res = await fetch(`${base}${ROUTES.search}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ query: "hello", k: 3 }),
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.reason).toBe("stale-timestamp");
  });

  it("returns 401 when auth headers are missing", async () => {
    const res = await fetch(`${base}${ROUTES.search}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "hello" }),
    });
    expect(res.status).toBe(401);
    // backend never touched
    expect(backend.lastSearch).toBeNull();
  });

  it("hashes the raw body into the verified parts", async () => {
    const raw = JSON.stringify({ query: "hello", k: 2 });
    await fetch(`${base}${ROUTES.search}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: raw,
    });
    const expected = createHash("sha256").update(raw, "utf8").digest("hex");
    expect(verifier.lastParts?.bodyHash).toBe(expected);
    expect(verifier.lastParts?.method).toBe("POST");
    expect(verifier.lastParts?.path).toBe(ROUTES.search);
  });

  it("happy path: POST /search returns backend hits", async () => {
    const res = await fetch(`${base}${ROUTES.search}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ query: "hello", k: 5 }),
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body).toEqual({ hits: [HIT] });
    expect(backend.lastSearch).toEqual({ query: "hello", k: 5 });
  });

  it("happy path: POST /recall returns backend hits", async () => {
    const res = await fetch(`${base}${ROUTES.recall}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ q: "who is jane", k: 4 }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ hits: [HIT] });
    expect(backend.lastRecall).toEqual({ q: "who is jane", k: 4 });
  });

  it("happy path: POST /embed returns EmbedResult", async () => {
    const res = await fetch(`${base}${ROUTES.embed}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ fp: "abc123", text: "body" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ fp: "abc123", dim: 768, cached: false });
    expect(backend.lastEmbed).toEqual({ text: "body", fp: "abc123" });
  });

  it("POST /embed returns 404 {known:false} when backend cannot embed", async () => {
    backend.embedResult = null;
    const res = await fetch(`${base}${ROUTES.embed}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ fp: "unknown", text: "x" }),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ known: false });
  });

  it("GET /memory/by-fp/:fp → known when provenance exists", async () => {
    const res = await fetch(`${base}${ROUTES.byFp("abc123")}`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ fp: "abc123", known: true });
    expect(backend.lastProvenance).toBe("abc123");
  });

  it("GET /memory/by-fp/:fp → 404 known:false when unknown", async () => {
    backend.provenanceRecords = [];
    const res = await fetch(`${base}${ROUTES.byFp("nope")}`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ fp: "nope", known: false });
  });

  it("GET /provenance/:fp returns records", async () => {
    const res = await fetch(`${base}${ROUTES.provenance("abc123")}`, {
      headers: authHeaders(),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ fp: "abc123", records: [PROV] });
  });

  it("oversized body → 413", async () => {
    const big = "x".repeat(2000); // > 256 byte cap
    const res = await fetch(`${base}${ROUTES.search}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ query: big }),
    });
    expect(res.status).toBe(413);
    expect(backend.lastSearch).toBeNull();
  });

  it("malformed JSON → 400", async () => {
    const res = await fetch(`${base}${ROUTES.search}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: "{not json",
    });
    expect(res.status).toBe(400);
    expect(backend.lastSearch).toBeNull();
  });

  it("BridgeError from backend maps to its status", async () => {
    backend.throwOnSearch = new BridgeError("unreachable", "down", 503);
    const res = await fetch(`${base}${ROUTES.search}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ query: "hi" }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("unreachable");
  });

  it("non-BridgeError throw → generic 500 with no leaked internals", async () => {
    backend.throwOnSearch = new Error("SECRET stack details");
    const res = await fetch(`${base}${ROUTES.search}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ query: "hi" }),
    });
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain("SECRET");
    expect(JSON.parse(text)).toEqual({ error: "server-error", reason: "internal error" });
  });

  it("unknown route → 404", async () => {
    const res = await fetch(`${base}/v1/does/not/exist`, { headers: authHeaders() });
    expect(res.status).toBe(404);
  });
});
