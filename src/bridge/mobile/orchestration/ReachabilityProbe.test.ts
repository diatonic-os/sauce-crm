import { describe, it, expect, vi } from "vitest";
import { ROUTES } from "../../contract";
import {
  TailscaleReachabilityProbe,
  type HttpRequestFn,
} from "./ReachabilityProbe";

const BASE = "http://desktop.ts.net:7777";

function okResponse(ok = true) {
  return {
    status: 200,
    json: { ok, version: "1.0.0", lance: "ready" },
    text: "",
  };
}

describe("TailscaleReachabilityProbe", () => {
  it("returns true when /health answers 2xx with {ok:true}", async () => {
    const request: HttpRequestFn = vi.fn(async () => okResponse(true));
    const probe = new TailscaleReachabilityProbe({ baseUrl: BASE, request });

    expect(await probe.isReachable()).toBe(true);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ url: BASE + ROUTES.health, method: "GET" }),
    );
  });

  it("returns false on non-2xx status", async () => {
    const request: HttpRequestFn = vi.fn(async () => ({
      status: 503,
      json: { ok: true },
      text: "",
    }));
    const probe = new TailscaleReachabilityProbe({ baseUrl: BASE, request });
    expect(await probe.isReachable()).toBe(false);
  });

  it("returns false when body is not {ok:true}", async () => {
    const request: HttpRequestFn = vi.fn(async () => okResponse(false));
    const probe = new TailscaleReachabilityProbe({ baseUrl: BASE, request });
    expect(await probe.isReachable()).toBe(false);
  });

  it("swallows a thrown request error to false (never throws out)", async () => {
    const request: HttpRequestFn = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const probe = new TailscaleReachabilityProbe({ baseUrl: BASE, request });
    await expect(probe.isReachable()).resolves.toBe(false);
  });

  it("caches the result within ttl (no re-probe)", async () => {
    const request: HttpRequestFn = vi.fn(async () => okResponse(true));
    const probe = new TailscaleReachabilityProbe({
      baseUrl: BASE,
      request,
      ttlMs: 10_000,
    });

    expect(await probe.isReachable()).toBe(true);
    expect(await probe.isReachable()).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("re-probes after ttl expires", async () => {
    let toggle = true;
    const request: HttpRequestFn = vi.fn(async () => okResponse(toggle));
    const probe = new TailscaleReachabilityProbe({
      baseUrl: BASE,
      request,
      ttlMs: 5,
    });

    expect(await probe.isReachable()).toBe(true);
    await new Promise((r) => setTimeout(r, 10));
    toggle = false;
    expect(await probe.isReachable()).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("lastKnown is null before first probe, cached boolean after", async () => {
    const request: HttpRequestFn = vi.fn(async () => okResponse(true));
    const probe = new TailscaleReachabilityProbe({ baseUrl: BASE, request });

    expect(probe.lastKnown()).toBeNull();
    await probe.isReachable();
    expect(probe.lastKnown()).toBe(true);
  });

  it("strips a trailing slash from baseUrl so the health url is well-formed", async () => {
    const request: HttpRequestFn = vi.fn(async () => okResponse(true));
    const probe = new TailscaleReachabilityProbe({
      baseUrl: BASE + "/",
      request,
    });

    await probe.isReachable();
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ url: BASE + ROUTES.health }),
    );
  });
});
