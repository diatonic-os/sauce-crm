import { describe, expect, it } from "vitest";
import {
  resolveAgentModel,
  AGENT_ROLES,
  type AgentModelSettings,
} from "../../src/saucebot/harness/AgentModelRegistry";

const base: AgentModelSettings = {
  defaults: { provider: "lmstudio", model: "qwen3-coder-30b" },
  roles: {
    enrichment: { provider: "lmstudio", model: "lfm2-1.2b" }, // cheap local
    verify: { model: "qwen3.6-27b" }, // partial: model only, keep default provider
    socratic: { auto: true },
  },
};

describe("resolveAgentModel — per-role model routing", () => {
  it("uses a full role override when configured", () => {
    const r = resolveAgentModel("enrichment", base);
    expect(r.provider).toBe("lmstudio");
    expect(r.model).toBe("lfm2-1.2b");
    expect(r.source).toBe("role");
  });

  it("partial override keeps the default provider, swaps the model", () => {
    const r = resolveAgentModel("verify", base);
    expect(r.provider).toBe("lmstudio"); // from defaults
    expect(r.model).toBe("qwen3.6-27b"); // from role
    expect(r.source).toBe("role");
  });

  it("falls back to defaults when a role has no override", () => {
    const r = resolveAgentModel("chat", base);
    expect(r.provider).toBe("lmstudio");
    expect(r.model).toBe("qwen3-coder-30b");
    expect(r.source).toBe("default");
  });

  it("carries the auto flag (smallest-local routing) through", () => {
    expect(resolveAgentModel("socratic", base).auto).toBe(true);
    expect(resolveAgentModel("chat", base).auto).toBe(false);
  });

  it("tolerates absent roles map entirely", () => {
    const r = resolveAgentModel("planner", { defaults: base.defaults });
    expect(r.model).toBe("qwen3-coder-30b");
    expect(r.source).toBe("default");
  });

  it("exposes the canonical role list for the settings UI", () => {
    expect(AGENT_ROLES).toContain("chat");
    expect(AGENT_ROLES).toContain("enrichment");
    expect(AGENT_ROLES).toContain("verify");
    expect(new Set(AGENT_ROLES).size).toBe(AGENT_ROLES.length);
  });
});
