import { describe, expect, it } from "vitest";
import { testProviderConnection } from "../../src/saucebot/testProviderConnection";
import type { ModelCatalog, CatalogModel } from "../../src/saucebot/ModelCatalog";

function fakeCatalog(impl: () => Promise<CatalogModel[]>): ModelCatalog {
  return { list: impl } as unknown as ModelCatalog;
}

describe("testProviderConnection", () => {
  it("reports a live success for a local provider that lists models", async () => {
    const catalog = fakeCatalog(async () => [
      { id: "llama3", label: "llama3" },
      { id: "qwen3", label: "qwen3" },
    ]);
    const r = await testProviderConnection({
      provider: "ollama",
      endpoint: "http://localhost:11434",
      catalog,
    });
    expect(r.ok).toBe(true);
    expect(r.live).toBe(true);
    expect(r.modelCount).toBe(2);
    expect(r.detail).toContain("Connected");
  });

  it("flags a reached-but-empty local endpoint as not ok", async () => {
    const r = await testProviderConnection({
      provider: "lmstudio",
      catalog: fakeCatalog(async () => []),
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("no models");
  });

  it("treats cloud providers as non-live and notes key-on-first-use", async () => {
    const r = await testProviderConnection({
      provider: "anthropic",
      catalog: fakeCatalog(async () => [
        { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
      ]),
    });
    expect(r.ok).toBe(true);
    expect(r.live).toBe(false);
    expect(r.detail).toContain("verified on first use");
  });

  it("surfaces the error message when listing throws", async () => {
    const r = await testProviderConnection({
      provider: "ollama",
      catalog: fakeCatalog(async () => {
        throw new Error("ECONNREFUSED 127.0.0.1:11434");
      }),
    });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("ECONNREFUSED");
  });
});
