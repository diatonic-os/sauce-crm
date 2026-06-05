import { describe, it, expect } from "vitest";
import {
  makeContentHasher,
  makeHttpRequestFn,
  InMemoryResultCache,
  createDesktopMemory,
  createMobileMemory,
  type RequestUrlLike,
} from "./wiring";
import type { LocalHashIndex } from "./mobile/local";

describe("wiring adapters", () => {
  it("makeContentHasher forwards to the sha256 fn", async () => {
    const h = makeContentHasher(async (s) => `h(${s})`);
    expect(await h.sha256Hex("x")).toBe("h(x)");
  });

  it("makeHttpRequestFn passes throw:false and parses text when json absent", async () => {
    let sawThrowFalse = false;
    const requestUrl: RequestUrlLike = async (req) => {
      sawThrowFalse = req.throw === false;
      return { status: 200, text: '{"ok":true}' }; // no .json field
    };
    const fn = makeHttpRequestFn(requestUrl);
    const r = await fn({ url: "u", method: "GET", headers: {} });
    expect(sawThrowFalse).toBe(true);
    expect(r.json).toEqual({ ok: true });
    expect(r.status).toBe(200);
  });

  it("makeHttpRequestFn tolerates non-JSON text", async () => {
    const fn = makeHttpRequestFn(async () => ({ status: 500, text: "boom" }));
    const r = await fn({ url: "u", method: "GET", headers: {} });
    expect(r.json).toBeNull();
    expect(r.text).toBe("boom");
  });

  it("InMemoryResultCache get/set/delete round-trips", async () => {
    const c = new InMemoryResultCache();
    expect(await c.get("k")).toBeNull();
    await c.set("k", { v: 1 });
    expect(await c.get<{ v: number }>("k")).toEqual({ v: 1 });
    await c.delete("k");
    expect(await c.get("k")).toBeNull();
  });
});

describe("platform factories", () => {
  it("createDesktopMemory yields a lance-desktop backend", () => {
    const b = createDesktopMemory({
      vectors: { query: async () => [], isEmpty: async () => true },
      provenanceStore: { byFingerprint: async () => [] },
      embedFn: async () => null,
    });
    expect(b.mode).toBe("lance-desktop");
  });

  it("createMobileMemory yields a hybrid backend", () => {
    const b = createMobileMemory({
      baseUrl: "http://desk:8787",
      request: async () => ({ status: 200, json: { ok: true }, text: "" }),
      signer: { sign: async () => "sig" },
      hasher: { sha256Hex: async (s) => s },
      cache: new InMemoryResultCache(),
      probe: { isReachable: async () => false, lastKnown: () => null },
      lexicalHost: { search: () => [] },
      // LocalHashIndex has private fields; minimal stub satisfies runtime needs.
      localIndex: {
        fpFor: (_path: string): string | undefined => "",
      } as unknown as LocalHashIndex,
    });
    expect(b.mode).toBe("hybrid");
  });
});
