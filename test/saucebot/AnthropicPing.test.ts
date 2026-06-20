import { describe, expect, it } from "vitest";
import { pingAnthropic, interpretAnthropicStatus } from "../../src/saucebot/AnthropicPing";

describe("interpretAnthropicStatus", () => {
  it("200 → authenticated", () => {
    expect(interpretAnthropicStatus(200).ok).toBe(true);
  });
  it("400 → key valid, request got past auth", () => {
    expect(interpretAnthropicStatus(400).ok).toBe(true);
  });
  it("401/403 → invalid key", () => {
    expect(interpretAnthropicStatus(401).ok).toBe(false);
    expect(interpretAnthropicStatus(401).error).toMatch(/key/i);
    expect(interpretAnthropicStatus(403).ok).toBe(false);
  });
  it("429 → rate-limited but key valid", () => {
    expect(interpretAnthropicStatus(429).ok).toBe(true);
  });
  it("500 → reachable, surfaced as not-ok with status", () => {
    const r = interpretAnthropicStatus(500);
    expect(r.ok).toBe(false);
    expect(r.error).toContain("500");
  });
});

describe("pingAnthropic", () => {
  it("returns ok for a 200 from the injected fetch", async () => {
    const r = await pingAnthropic("sk-ant-good", async () => ({ status: 200 }));
    expect(r.ok).toBe(true);
  });
  it("flags an empty key without calling the network", async () => {
    let called = false;
    const r = await pingAnthropic("", async () => {
      called = true;
      return { status: 200 };
    });
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });
  it("surfaces a network/transport error", async () => {
    const r = await pingAnthropic("k", async () => {
      throw new Error("offline");
    });
    expect(r.ok).toBe(false);
    expect(r.error).toContain("offline");
  });
});
