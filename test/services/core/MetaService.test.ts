import { describe, expect, it, vi } from "vitest";
import {
  MetaService,
  type MetaHost,
} from "../../../src/services/core/MetaService";
import type { CanonGuard } from "../../../src/services/core/FilesService";

function host(): MetaHost {
  return {
    readProperty: vi.fn(async () => "value"),
    setPropertyRaw: vi.fn(async () => {}),
    removePropertyRaw: vi.fn(async () => {}),
    bookmark: vi.fn(async () => {}),
    daily: vi.fn(async () => "_events/daily/2026-05-23.md"),
    executeCommand: vi.fn(async () => {}),
    loadWorkspace: vi.fn(async () => {}),
    saveWorkspace: vi.fn(async () => {}),
  };
}

function canon(canonized: Set<string>): CanonGuard & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    isCanonized: (p) => canonized.has(p),
    mutateViaContract: async (p) => void calls.push(p),
  };
}

describe("MetaService", () => {
  it("writes a NON-canonized file's property directly", async () => {
    const h = host();
    const g = canon(new Set());
    const s = new MetaService(h, g);
    await s.setProperty("n.md", "k", "v");
    expect(h.setPropertyRaw).toHaveBeenCalledWith("n.md", "k", "v");
    expect(g.calls).toHaveLength(0);
  });

  it("G-003: a CANONIZED file's property write routes through the contract, never raw", async () => {
    const h = host();
    const g = canon(new Set(["person/Alice.md"]));
    const s = new MetaService(h, g);
    await s.setProperty("person/Alice.md", "tags", ["x"]);
    await s.removeProperty("person/Alice.md", "old");
    expect(h.setPropertyRaw).not.toHaveBeenCalled();
    expect(h.removePropertyRaw).not.toHaveBeenCalled();
    expect(g.calls).toEqual(["person/Alice.md", "person/Alice.md"]);
  });

  it("delegates bookmark/daily/command/workspace ops", async () => {
    const h = host();
    const s = new MetaService(h, canon(new Set()));
    expect(await s.daily()).toBe("_events/daily/2026-05-23.md");
    await s.executeCommand("app:reload");
    expect(h.executeCommand).toHaveBeenCalledWith("app:reload");
    await s.saveWorkspace("focus");
    expect(h.saveWorkspace).toHaveBeenCalledWith("focus");
  });
});
