import { describe, expect, it } from "vitest";
import {
  detectLmStudioEndpoint,
  lmStudioCandidates,
  subnetHostsFromIPs,
  scanLanForLmStudio,
  LM_STUDIO_PORT,
} from "../../src/copilot/detectLmStudioEndpoint";
import type { ProviderTestResult } from "../../src/copilot/testProviderConnection";

const ok: ProviderTestResult = {
  ok: true,
  detail: "Connected · 30 models",
  modelCount: 30,
  live: true,
};
const fail: ProviderTestResult = {
  ok: false,
  detail: "ECONNREFUSED",
  modelCount: 0,
  live: true,
};

describe("lmStudioCandidates", () => {
  it("always probes 127.0.0.1 then localhost on the LM Studio port", () => {
    const c = lmStudioCandidates();
    expect(c[0]).toBe(`http://127.0.0.1:${LM_STUDIO_PORT}`);
    expect(c).toContain(`http://localhost:${LM_STUDIO_PORT}`);
    // de-duped
    expect(new Set(c).size).toBe(c.length);
  });
});

describe("detectLmStudioEndpoint", () => {
  it("returns the first reachable candidate as localhost", async () => {
    const r = await detectLmStudioEndpoint({
      candidates: ["http://127.0.0.1:1234", "http://192.168.1.5:1234"],
      test: async ({ endpoint }) =>
        endpoint === "http://127.0.0.1:1234" ? ok : fail,
    });
    expect(r.endpoint).toBe("http://127.0.0.1:1234");
    expect(r.source).toBe("localhost");
  });

  it("falls through to a LAN address when localhost is down", async () => {
    const r = await detectLmStudioEndpoint({
      candidates: ["http://127.0.0.1:1234", "http://192.168.1.5:1234"],
      test: async ({ endpoint }) =>
        endpoint === "http://192.168.1.5:1234" ? ok : fail,
    });
    expect(r.endpoint).toBe("http://192.168.1.5:1234");
    expect(r.source).toBe("lan");
    expect(r.tried).toEqual([
      "http://127.0.0.1:1234",
      "http://192.168.1.5:1234",
    ]);
  });

  it("returns null + the tried list when nothing responds", async () => {
    const r = await detectLmStudioEndpoint({
      candidates: ["http://127.0.0.1:1234"],
      test: async () => fail,
    });
    expect(r.endpoint).toBeNull();
    expect(r.source).toBeNull();
    expect(r.tried).toEqual(["http://127.0.0.1:1234"]);
  });
});

describe("subnetHostsFromIPs", () => {
  it("enumerates the /24 for each distinct subnet, starting at .1", () => {
    const hosts = subnetHostsFromIPs(["192.168.1.50"]);
    expect(hosts).toHaveLength(254);
    expect(hosts[0]).toBe("192.168.1.1");
    expect(hosts[253]).toBe("192.168.1.254");
    expect(hosts).not.toContain("192.168.1.0");
  });

  it("dedupes subnets and caps the host count", () => {
    const hosts = subnetHostsFromIPs(["10.0.0.4", "10.0.0.9", "172.16.5.2"], 300);
    // two distinct /24s (10.0.0 and 172.16.5), capped at 300
    expect(hosts.length).toBe(300);
    expect(hosts).toContain("10.0.0.1");
    expect(hosts).toContain("172.16.5.1");
  });

  it("ignores malformed addresses", () => {
    expect(subnetHostsFromIPs(["not-an-ip", ""])).toEqual([]);
  });
});

describe("scanLanForLmStudio", () => {
  it("returns the first host whose probe confirms LM Studio", async () => {
    const r = await scanLanForLmStudio({
      hosts: ["10.0.0.1", "10.0.0.2", "10.0.0.3"],
      concurrency: 1, // deterministic order
      probe: async (base) => base === "http://10.0.0.2:1234",
    });
    expect(r.endpoint).toBe("http://10.0.0.2:1234");
  });

  it("reports total + scanned and returns null when nothing matches", async () => {
    const progress: number[] = [];
    const r = await scanLanForLmStudio({
      hosts: ["10.0.0.1", "10.0.0.2"],
      concurrency: 2,
      probe: async () => false,
      onProgress: (p) => progress.push(p.scanned),
    });
    expect(r.endpoint).toBeNull();
    expect(r.total).toBe(2);
    expect(r.scanned).toBe(2);
    expect(progress.length).toBe(2);
  });
});
