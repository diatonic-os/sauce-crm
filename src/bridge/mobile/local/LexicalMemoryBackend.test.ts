import { describe, it, expect, beforeEach } from "vitest";
import { LexicalMemoryBackend, type LexicalHost } from "./LexicalMemoryBackend";
import { LocalHashIndex, type IndexEntry, type IndexPersist, type VaultReader } from "./LocalHashIndex";
import type { ContentHasher } from "../../contract";

// ───────────────────────── in-memory fakes ─────────────────────────

class FakeHasher implements ContentHasher {
  async sha256Hex(data: string): Promise<string> {
    let h = 5381;
    for (let i = 0; i < data.length; i++) h = ((h << 5) + h + data.charCodeAt(i)) >>> 0;
    return "fp_" + h.toString(16);
  }
}

class FakePersist implements IndexPersist {
  store: Record<string, IndexEntry> | null = null;
  async load() {
    return this.store ? JSON.parse(JSON.stringify(this.store)) : null;
  }
  async save(rows: Record<string, IndexEntry>) {
    this.store = JSON.parse(JSON.stringify(rows));
  }
}

class FakeVault implements VaultReader {
  files = new Map<string, { mtime: number; content: string }>();
  async list() {
    return [...this.files.entries()].map(([path, f]) => ({ path, mtime: f.mtime }));
  }
  async read(path: string) {
    return this.files.get(path)!.content;
  }
  meta(path: string) {
    return { title: path, type: "note", tags: [], links: [] };
  }
  set(path: string, mtime: number, content: string) {
    this.files.set(path, { mtime, content });
  }
}

class FakeLexicalHost implements LexicalHost {
  lastQuery?: string;
  lastLimit?: number;
  results: { path: string; score: number; snippet?: string }[] = [];
  search(query: string, limit: number) {
    this.lastQuery = query;
    this.lastLimit = limit;
    return this.results;
  }
}

async function setup() {
  const vault = new FakeVault();
  vault.set("a.md", 1, "alpha");
  vault.set("b.md", 1, "beta");
  const index = new LocalHashIndex({ hasher: new FakeHasher(), persist: new FakePersist(), vault });
  await index.rebuild();
  const host = new FakeLexicalHost();
  const backend = new LexicalMemoryBackend({ host, index });
  return { vault, index, host, backend };
}

describe("LexicalMemoryBackend", () => {
  let host: FakeLexicalHost;
  let index: LocalHashIndex;
  let backend: LexicalMemoryBackend;

  beforeEach(async () => {
    ({ host, index, backend } = await setup());
  });

  it("reports local mode", () => {
    expect(backend.mode).toBe("local");
  });

  it("semanticSearch maps host results → MemoryHit with degraded:true and fp from index", async () => {
    host.results = [{ path: "a.md", score: 0.9, snippet: "…alpha…" }];
    const hits = await backend.semanticSearch({ query: "alpha" });
    expect(hits).toHaveLength(1);
    const hit = hits[0];
    expect(hit.path).toBe("a.md");
    expect(hit.score).toBe(0.9);
    expect(hit.snippet).toBe("…alpha…");
    expect(hit.degraded).toBe(true);
    expect(hit.fp).toBe(index.fpFor("a.md"));
    expect(hit.fp).not.toBe("");
  });

  it("recall delegates to the same lexical mapping", async () => {
    host.results = [{ path: "b.md", score: 0.5 }];
    const hits = await backend.recall("beta");
    expect(hits[0].path).toBe("b.md");
    expect(hits[0].degraded).toBe(true);
    expect(hits[0].fp).toBe(index.fpFor("b.md"));
  });

  it("falls back to fp='' when the path is not in the index", async () => {
    host.results = [{ path: "unknown.md", score: 0.1 }];
    const hits = await backend.semanticSearch({ query: "x" });
    expect(hits[0].fp).toBe("");
    expect(hits[0].degraded).toBe(true);
  });

  it("passes k to the host as the search limit, defaulting to 25", async () => {
    await backend.semanticSearch({ query: "x", k: 7 });
    expect(host.lastLimit).toBe(7);
    await backend.recall("y");
    expect(host.lastLimit).toBe(25);
  });

  it("embed returns null (offline cannot embed)", async () => {
    expect(await backend.embed("text", "fp_x")).toBeNull();
  });

  it("provenance returns []", async () => {
    expect(await backend.provenance("fp_x")).toEqual([]);
  });

  it("ready returns true", async () => {
    expect(await backend.ready()).toBe(true);
  });
});
