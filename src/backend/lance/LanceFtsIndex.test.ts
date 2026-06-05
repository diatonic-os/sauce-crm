// LANCE-005: ensureIndex must run at most once on success, must not reset
// `ensured` on every call, must not optimize() on every write, and must warn
// at most once per session on repeated failure.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { LanceFtsIndex } from "./LanceFtsIndex";
import type { LanceTable } from "./LanceConnection";

// Mock the lazy LanceConnection import so createIndex's config call works
// without the native module.
vi.mock("./LanceConnection", () => ({
  loadLance: () => ({ Index: { fts: () => ({}) } }),
}));

interface FakeTable {
  listIndices: ReturnType<typeof vi.fn>;
  createIndex: ReturnType<typeof vi.fn>;
  optimize: ReturnType<typeof vi.fn>;
}

function makeTable(opts?: {
  hasIndex?: boolean;
  listThrows?: boolean;
}): FakeTable {
  return {
    listIndices: vi.fn(async () => {
      if (opts?.listThrows) throw new Error("table empty");
      return opts?.hasIndex ? [{ columns: ["body_md"] }] : [];
    }),
    createIndex: vi.fn(async () => undefined),
    optimize: vi.fn(async () => undefined),
  };
}

describe("LanceFtsIndex (LANCE-005)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ensures the index once, not on every write", async () => {
    const t = makeTable({ hasIndex: false });
    const fts = new LanceFtsIndex(t as unknown as LanceTable);

    await fts.index("a", "A", "body a");
    await fts.index("b", "B", "body b");
    await fts.index("c", "C", "body c");

    // listIndices/createIndex happen exactly once (ensured stays true).
    expect(t.listIndices).toHaveBeenCalledTimes(1);
    expect(t.createIndex).toHaveBeenCalledTimes(1);
    // optimize() only after createIndex — NOT per write.
    expect(t.optimize).toHaveBeenCalledTimes(1);
  });

  it("does not optimize() on remove()", async () => {
    const t = makeTable({ hasIndex: true });
    const fts = new LanceFtsIndex(t as unknown as LanceTable);
    await fts.remove("a");
    await fts.remove("b");
    expect(t.optimize).not.toHaveBeenCalled();
  });

  it("does not optimize() when the index already exists", async () => {
    const t = makeTable({ hasIndex: true });
    const fts = new LanceFtsIndex(t as unknown as LanceTable);
    await fts.index("a", "A", "body");
    expect(t.createIndex).not.toHaveBeenCalled();
    expect(t.optimize).not.toHaveBeenCalled();
  });

  it("warns at most once across repeated ensure failures", async () => {
    const t = makeTable({ listThrows: true });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fts = new LanceFtsIndex(t as unknown as LanceTable);

    await fts.index("a", "A", "body");
    await fts.index("b", "B", "body");
    await fts.index("c", "C", "body");

    // retries the ensure (ensured never became true) but warns only once.
    expect(t.listIndices).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
