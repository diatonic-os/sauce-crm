import { describe, expect, it } from "vitest";
import {
  detectLmStudioEndpoint,
  lmStudioCandidates,
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
