import { describe, expect, it, vi } from "vitest";
import {
  FilesService,
  type FilesHost,
  type CanonGuard,
  type TemplateHost,
} from "../../../src/services/core/FilesService";

function memFs(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const host: FilesHost & { files: Map<string, string> } = {
    files,
    exists: (p) => files.has(p),
    read: async (p) => files.get(p) ?? "",
    create: async (p, c) => void files.set(p, c),
    modify: async (p, c) => void files.set(p, c),
    rename: async (o, n) => {
      files.set(n, files.get(o) ?? "");
      files.delete(o);
    },
    trash: async (p) => void files.delete(p),
    restoreFromHistory: async (p, c) => void files.set(p, c),
  };
  return host;
}

function canon(
  canonized: Set<string>,
): CanonGuard & { contractCalls: string[] } {
  const contractCalls: string[] = [];
  return {
    contractCalls,
    isCanonized: (p) => canonized.has(p),
    mutateViaContract: async (p) => void contractCalls.push(p),
  };
}

const templates: TemplateHost = {
  applyTemplate: vi.fn(async () => {}),
  compose: vi.fn(async () => {}),
  uniqueNote: vi.fn(async (folder: string) => `${folder}/Untitled 1.md`),
};

describe("FilesService", () => {
  it("create/read/move/rename/trash delegate to the host", async () => {
    const host = memFs();
    const svc = new FilesService(host, canon(new Set()), templates);
    await svc.create("a.md", "hello");
    expect(await svc.read("a.md")).toBe("hello");
    await svc.move("a.md", "b.md");
    expect(host.exists("a.md")).toBe(false);
    expect(await svc.read("b.md")).toBe("hello");
    await svc.trash("b.md");
    expect(host.exists("b.md")).toBe(false);
  });

  it("updateViaContract directly modifies a NON-canonized file", async () => {
    const host = memFs({ "n.md": "x" });
    const g = canon(new Set());
    const svc = new FilesService(host, g, templates);
    await svc.updateViaContract("n.md", (prev) => prev + "y");
    expect(await svc.read("n.md")).toBe("xy");
    expect(g.contractCalls).toHaveLength(0);
  });

  it("G-003: updateViaContract on a CANONIZED file routes through the contract, never raw modify", async () => {
    const host = memFs({ "person/Alice.md": "frozen" });
    const modifySpy = vi.spyOn(host, "modify");
    const g = canon(new Set(["person/Alice.md"]));
    const svc = new FilesService(host, g, templates);
    await svc.updateViaContract("person/Alice.md", (prev) => prev + " mutated");
    expect(g.contractCalls).toEqual(["person/Alice.md"]);
    expect(modifySpy).not.toHaveBeenCalled(); // raw Vault.modify forbidden on canonized
  });

  it("template ops delegate to the template host", async () => {
    const svc = new FilesService(memFs(), canon(new Set()), templates);
    await svc.applyTemplate("_templates/person.md", "people/Bob.md");
    expect(templates.applyTemplate).toHaveBeenCalledWith(
      "_templates/person.md",
      "people/Bob.md",
    );
    expect(await svc.uniqueNote("inbox")).toBe("inbox/Untitled 1.md");
  });
});
