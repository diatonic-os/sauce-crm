import { describe, expect, it } from "vitest";
import { decideRoute, resolveSauceRoute } from "../../src/saucebot/GatewayRouter";

const local = ["qwen3-coder-30b", "lfm2-1.2b"];

describe("decideRoute — local-loopback vs hosted gateway", () => {
  it("keeps a local model on the client's OWN endpoint (never the gateway)", () => {
    const r = decideRoute({
      model: "qwen3-coder-30b",
      localModels: local,
      localEndpoint: "http://localhost:1234/v1",
      gatewayUrl: "https://bifrost.vps/v1",
    });
    expect(r.target).toBe("local");
    expect(r.baseUrl).toBe("http://localhost:1234/v1");
  });

  it("routes a non-local (cloud) model through the hosted gateway", () => {
    const r = decideRoute({
      model: "claude-sonnet-4-6",
      localModels: local,
      localEndpoint: "http://localhost:1234/v1",
      gatewayUrl: "https://bifrost.vps/v1",
    });
    expect(r.target).toBe("gateway");
    expect(r.baseUrl).toBe("https://bifrost.vps/v1");
  });

  it("falls back to local when no gateway is configured", () => {
    const r = decideRoute({
      model: "claude-sonnet-4-6",
      localModels: local,
      localEndpoint: "http://localhost:1234/v1",
    });
    expect(r.target).toBe("local");
  });

  it("uses the gateway for a local-named model when the local endpoint is absent", () => {
    const r = decideRoute({
      model: "qwen3-coder-30b",
      localModels: local,
      gatewayUrl: "https://bifrost.vps/v1",
    });
    expect(r.target).toBe("gateway");
  });

  it("returns none when nothing is reachable", () => {
    const r = decideRoute({ model: "x", localModels: [] });
    expect(r.target).toBe("none");
    expect(r.baseUrl).toBe("");
  });
});

describe("resolveSauceRoute — settings adapter (autoConnectGateway guard)", () => {
  const local = {
    lmstudio: { endpoint: "http://localhost:1234/v1", model: "qwen3-coder-30b" },
    ollama: { endpoint: "http://localhost:11434", model: "" },
  };

  it("keeps a selected local model on loopback even with a gateway connected", () => {
    const r = resolveSauceRoute({
      model: "qwen3-coder-30b",
      gatewayUrl: "https://bifrost.vps/v1",
      local,
    });
    expect(r.target).toBe("local");
    expect(r.baseUrl).toBe("http://localhost:1234/v1");
  });

  it("routes a cloud model through the gateway", () => {
    const r = resolveSauceRoute({
      model: "claude-sonnet-4-6",
      gatewayUrl: "https://bifrost.vps/v1",
      local,
    });
    expect(r.target).toBe("gateway");
  });

  it("ignores local providers with no configured model", () => {
    const r = resolveSauceRoute({
      model: "anything",
      gatewayUrl: "https://bifrost.vps/v1",
      local: { ollama: { endpoint: "http://localhost:11434", model: "" } },
    });
    expect(r.target).toBe("gateway");
  });
});
