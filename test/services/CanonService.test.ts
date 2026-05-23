import { describe, expect, it, vi } from "vitest";
import { CanonService, type CanonHost } from "../../src/services/CanonService";
import {
  MutationContract,
  type LedgerEntry,
  type LedgerSink,
} from "../../src/services/MutationContract";
import type { CanonGuard } from "../../src/services/core/FilesService";

function memHost(
  files: Record<string, { fm: Record<string, unknown> | null; body: string }>,
): CanonHost & { files: typeof files } {
  return {
    files,
    getFrontmatter: (p) => files[p]?.fm ?? null,
    listPaths: () => Object.keys(files),
    read: async (p) => files[p]?.body ?? "",
    write: async (p, c) => {
      files[p] = { fm: files[p]?.fm ?? null, body: c };
    },
    setCanonized: async (p, v, type) => {
      files[p] = {
        fm: { sauce: { canonized: v, type } },
        body: files[p]?.body ?? "",
      };
    },
  };
}

const noopMutation = { write: vi.fn(async () => ({}) as LedgerEntry) };

describe("CanonService — detection", () => {
  it("isCanonized reads nested + flat sauce.canonized markers", () => {
    const host = memHost({
      "person/A.md": {
        fm: { sauce: { canonized: true, type: "ENT-people" } },
        body: "",
      },
      "person/B.md": { fm: { "sauce.canonized": true }, body: "" },
      "notes/C.md": { fm: { sauce: { canonized: false } }, body: "" },
      "notes/D.md": { fm: null, body: "" },
    });
    const svc = new CanonService(host, noopMutation);
    expect(svc.isCanonized("person/A.md")).toBe(true);
    expect(svc.isCanonized("person/B.md")).toBe(true);
    expect(svc.isCanonized("notes/C.md")).toBe(false);
    expect(svc.isCanonized("notes/D.md")).toBe(false);
  });

  it("registerCanonRule auto-canonizes by predicate", () => {
    const host = memHost({
      "people/X.md": { fm: null, body: "" },
      "scratch/Y.md": { fm: null, body: "" },
    });
    const svc = new CanonService(host, noopMutation);
    svc.registerCanonRule((path) => path.startsWith("people/"));
    expect(svc.isCanonized("people/X.md")).toBe(true);
    expect(svc.isCanonized("scratch/Y.md")).toBe(false);
  });

  it("getCanonizedPaths lists every canonized file", () => {
    const host = memHost({
      "a.md": { fm: { sauce: { canonized: true } }, body: "" },
      "b.md": { fm: null, body: "" },
    });
    const svc = new CanonService(host, noopMutation);
    expect(svc.getCanonizedPaths()).toEqual(["a.md"]);
  });
});

describe("CanonService — lock/unlock", () => {
  it("lock/unlock write the frontmatter marker", async () => {
    const host = memHost({ "a.md": { fm: null, body: "" } });
    const svc = new CanonService(host, noopMutation);
    await svc.lock("a.md", "ENT-notes");
    expect(svc.isCanonized("a.md")).toBe(true);
    await svc.unlock("a.md");
    expect(svc.isCanonized("a.md")).toBe(false);
  });
});

describe("CanonService — mutateViaContract", () => {
  it("routes the write through the MutationContract (ledger entry recorded)", async () => {
    const entries: LedgerEntry[] = [];
    const ledger: LedgerSink = {
      lastHash: async () => entries.at(-1)?.hash ?? "",
      append: async (e) => void entries.push(e),
    };
    const mc = new MutationContract({
      ledger,
      crypto: { sha256Hex: async (s) => `h${s.length}` },
      emitEvent: () => {},
      actor: "tester",
      ulid: () => "TESTULID0000000000000000TT",
    });
    const host = memHost({
      "person/A.md": {
        fm: { sauce: { canonized: true, type: "ENT-people" } },
        body: "old",
      },
    });
    const svc = new CanonService(host, mc);

    await svc.mutateViaContract("person/A.md", (prev) => prev + " +mutated");

    expect(host.files["person/A.md"].body).toBe("old +mutated");
    expect(entries).toHaveLength(1);
    expect(entries[0].entityType).toBe("ENT-people");
    expect(entries[0].entityId).toBe("person/A.md");
  });

  it("structurally satisfies the CanonGuard seam (SH-C consumes this)", () => {
    const host = memHost({});
    const svc = new CanonService(host, noopMutation);
    const guard: CanonGuard = svc; // compile-time proof the shapes match
    expect(typeof guard.isCanonized).toBe("function");
    expect(typeof guard.mutateViaContract).toBe("function");
  });
});
