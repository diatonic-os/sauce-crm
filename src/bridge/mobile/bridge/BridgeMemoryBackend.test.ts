// MOB-BRIDGE-001 · T-D tests. All collaborators are injected fakes — no real
// network, no Obsidian, no Node builtins.
import { describe, it, expect, beforeEach } from "vitest";
import {
  BridgeMemoryBackend,
  type HttpRequestFn,
  type HttpResponse,
} from "./BridgeMemoryBackend";
import {
  BridgeError,
  BRIDGE_PROTOCOL_VERSION,
  NONCE_HEADER,
  ROUTES,
  SIG_HEADER,
  TS_HEADER,
  type AuthSigner,
  type ContentHasher,
  type ResultCache,
  type SignedRequestParts,
} from "../../contract";

// ── Fakes ──────────────────────────────────────────────────────────────────

// Mirrors the canonical HttpRequestFn param shape (headers optional per the
// transport contract); recorded verbatim from each call for assertions.
interface RecordedReq {
  url: string;
  method: string;
  headers?: Record<string, string>;
  body?: string;
}

/** Scriptable transport: returns a canned response per call, records requests,
 *  and can be told to throw (network failure). */
function makeHttp(
  responder: (req: RecordedReq, callIndex: number) => HttpResponse | Error,
): { fn: HttpRequestFn; calls: RecordedReq[] } {
  const calls: RecordedReq[] = [];
  const fn: HttpRequestFn = async (req) => {
    calls.push(req);
    const r = responder(req, calls.length - 1);
    if (r instanceof Error) throw r;
    return r;
  };
  return { fn, calls };
}

/** The bridge always sends signed headers; narrow the optional contract type
 *  (headers are optional on HttpRequestFn for probe-style GETs that omit them). */
function headersOf(req: RecordedReq): Record<string, string> {
  if (!req.headers) throw new Error("expected request to carry headers");
  return req.headers;
}

/** Records the parts it was asked to sign; returns a deterministic signature. */
function makeSigner(): { signer: AuthSigner; signed: SignedRequestParts[] } {
  const signed: SignedRequestParts[] = [];
  const signer: AuthSigner = {
    async sign(parts) {
      signed.push(parts);
      return `sig(${parts.method}:${parts.path}:${parts.bodyHash})`;
    },
  };
  return { signer, signed };
}

/** Predictable hasher: distinguishes empty vs non-empty bodies. */
const hasher: ContentHasher = {
  async sha256Hex(data: string) {
    return data === "" ? "EMPTYHASH" : `hash<${data.length}>`;
  },
};

function makeCache(): ResultCache & { store: Map<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    store,
    async get<T>(key: string) {
      return (store.has(key) ? (store.get(key) as T) : null) as T | null;
    },
    async set<T>(key: string, value: T) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}

const BASE = "http://100.64.1.5:8787";

function jsonRes(status: number, json: unknown): HttpResponse {
  return { status, json, text: JSON.stringify(json) };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("BridgeMemoryBackend", () => {
  let cache: ReturnType<typeof makeCache>;

  beforeEach(() => {
    cache = makeCache();
  });

  it("has mode 'bridge'", () => {
    const { fn } = makeHttp(() => jsonRes(200, {}));
    const { signer } = makeSigner();
    const be = new BridgeMemoryBackend({ baseUrl: BASE, request: fn, signer, hasher, cache });
    expect(be.mode).toBe("bridge");
  });

  it("carries sig/nonce/ts headers on every request", async () => {
    const { fn, calls } = makeHttp(() => jsonRes(200, { hits: [] }));
    const { signer, signed } = makeSigner();
    const be = new BridgeMemoryBackend({
      baseUrl: BASE,
      request: fn,
      signer,
      hasher,
      cache,
      nonceFn: () => "NONCE-123",
    });

    await be.semanticSearch({ query: "hello", k: 5 });

    expect(calls).toHaveLength(1);
    const req = calls[0]!; // asserted toHaveLength(1) above
    expect(req.url).toBe(BASE + ROUTES.search);
    expect(req.method).toBe("POST");
    expect(headersOf(req)[SIG_HEADER]).toBeTruthy();
    expect(headersOf(req)[NONCE_HEADER]).toBe("NONCE-123");
    expect(headersOf(req)[TS_HEADER]).toMatch(/^\d+$/);
    // Body is hashed (non-empty) and the signer saw that hash.
    expect(signed[0]!.bodyHash).toBe(`hash<${(req.body ?? "").length}>`);
    expect(signed[0]!.path).toBe(ROUTES.search);
    expect(signed[0]!.nonce).toBe("NONCE-123");
  });

  it("GET requests (health) send empty body and EMPTY body hash", async () => {
    const { fn, calls } = makeHttp(() =>
      jsonRes(200, { ok: true, version: BRIDGE_PROTOCOL_VERSION, lance: "ready" }),
    );
    const { signer, signed } = makeSigner();
    const be = new BridgeMemoryBackend({ baseUrl: BASE, request: fn, signer, hasher, cache });

    await be.ready();

    expect(calls[0]!.method).toBe("GET");
    expect(calls[0]!.body).toBeUndefined();
    expect(signed[0]!.bodyHash).toBe("EMPTYHASH");
  });

  it("embed caches by fp; a second call does NOT hit the network", async () => {
    let netCalls = 0;
    const { fn } = makeHttp(() => {
      netCalls++;
      return jsonRes(200, { fp: "FP1", dim: 768, cached: false });
    });
    const { signer } = makeSigner();
    const be = new BridgeMemoryBackend({ baseUrl: BASE, request: fn, signer, hasher, cache });

    const first = await be.embed("note body", "FP1");
    expect(first).toEqual({ fp: "FP1", dim: 768, cached: false });
    expect(netCalls).toBe(1);

    const second = await be.embed("note body", "FP1");
    expect(second).toEqual({ fp: "FP1", dim: 768, cached: false });
    // Zero-network-on-unchanged-fp: still 1.
    expect(netCalls).toBe(1);
  });

  it("provenance returns cached records on a second call (cache hit)", async () => {
    let netCalls = 0;
    const recs: import("../../../services/Provenance").ProvenanceRecord[] = [
      { fp: "FP9", op: "test", subject: "s", kind: "note", ts: 0, parentFp: "", meta: null, signature: "" },
    ];
    const { fn } = makeHttp(() => {
      netCalls++;
      return jsonRes(200, { fp: "FP9", records: recs });
    });
    const { signer } = makeSigner();
    const be = new BridgeMemoryBackend({ baseUrl: BASE, request: fn, signer, hasher, cache });

    const a = await be.provenance("FP9");
    expect(a).toEqual(recs);
    expect(netCalls).toBe(1);

    const b = await be.provenance("FP9");
    expect(b).toEqual(recs);
    expect(netCalls).toBe(1);
  });

  it("maps 401 → BridgeError 'unauthorized'", async () => {
    const { fn } = makeHttp(() => jsonRes(401, { error: "nope" }));
    const { signer } = makeSigner();
    const be = new BridgeMemoryBackend({ baseUrl: BASE, request: fn, signer, hasher, cache });

    await expect(be.semanticSearch({ query: "x" })).rejects.toMatchObject({
      name: "BridgeError",
      code: "unauthorized",
      status: 401,
    });
  });

  it("maps a transport throw → BridgeError 'unreachable'", async () => {
    const { fn } = makeHttp(() => new Error("ECONNREFUSED"));
    const { signer } = makeSigner();
    const be = new BridgeMemoryBackend({ baseUrl: BASE, request: fn, signer, hasher, cache });

    await expect(be.recall("cue")).rejects.toMatchObject({
      name: "BridgeError",
      code: "unreachable",
    });
  });

  it("maps a 5xx → BridgeError 'server-error'", async () => {
    const { fn } = makeHttp(() => jsonRes(503, { error: "down" }));
    const { signer } = makeSigner();
    const be = new BridgeMemoryBackend({ baseUrl: BASE, request: fn, signer, hasher, cache });

    await expect(be.embed("t", "FPx")).rejects.toMatchObject({
      name: "BridgeError",
      code: "server-error",
      status: 503,
    });
  });

  it("ready() returns false on protocol major mismatch", async () => {
    const { fn } = makeHttp(() => jsonRes(200, { ok: true, version: "2.0.0", lance: "ready" }));
    const { signer } = makeSigner();
    const be = new BridgeMemoryBackend({ baseUrl: BASE, request: fn, signer, hasher, cache });

    await expect(be.ready()).resolves.toBe(false);
  });

  it("ready() returns true when major matches and ok=true", async () => {
    const { fn } = makeHttp(() => jsonRes(200, { ok: true, version: "1.4.2", lance: "ready" }));
    const { signer } = makeSigner();
    const be = new BridgeMemoryBackend({ baseUrl: BASE, request: fn, signer, hasher, cache });

    await expect(be.ready()).resolves.toBe(true);
  });

  it("ready() returns false on transport throw", async () => {
    const { fn } = makeHttp(() => new Error("offline"));
    const { signer } = makeSigner();
    const be = new BridgeMemoryBackend({ baseUrl: BASE, request: fn, signer, hasher, cache });

    await expect(be.ready()).resolves.toBe(false);
  });

  it("ready() caches a positive result (does not hammer the desktop)", async () => {
    let netCalls = 0;
    const { fn } = makeHttp(() => {
      netCalls++;
      return jsonRes(200, { ok: true, version: BRIDGE_PROTOCOL_VERSION, lance: "ready" });
    });
    const { signer } = makeSigner();
    const be = new BridgeMemoryBackend({ baseUrl: BASE, request: fn, signer, hasher, cache });

    await be.ready();
    await be.ready();
    expect(netCalls).toBe(1);
  });

  it("normalizes a trailing slash in baseUrl (no double slash)", async () => {
    const { fn, calls } = makeHttp(() => jsonRes(200, { hits: [] }));
    const { signer } = makeSigner();
    const be = new BridgeMemoryBackend({
      baseUrl: BASE + "/",
      request: fn,
      signer,
      hasher,
      cache,
    });
    await be.recall("q");
    expect(calls[0]!.url).toBe(BASE + ROUTES.recall);
  });

  it("default nonceFn produces distinct hex nonces", async () => {
    const seen = new Set<string>();
    const { fn } = makeHttp((req) => {
      seen.add(headersOf(req)[NONCE_HEADER]!); // NONCE_HEADER is always present on signed requests
      return jsonRes(200, { hits: [] });
    });
    const { signer } = makeSigner();
    const be = new BridgeMemoryBackend({ baseUrl: BASE, request: fn, signer, hasher, cache });
    await be.recall("a");
    await be.recall("b");
    expect(seen.size).toBe(2);
    for (const n of seen) expect(n).toMatch(/^[0-9a-f]+$/);
  });
});
