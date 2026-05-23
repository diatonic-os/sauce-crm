import { describe, it, expect, beforeEach } from "vitest";
import { LocalHashIndex, type IndexEntry, type IndexPersist, type VaultReader } from "./LocalHashIndex";
import { normalizeForFingerprint, type ContentHasher } from "../../contract";

// ───────────────────────── in-memory fakes ─────────────────────────

/** Deterministic hasher: tags content so we can assert without real crypto, while
 *  still proving normalization is applied (identical normalized content → same fp).
 *  Counts calls so tests can assert incremental re-hashing. */
class FakeHasher implements ContentHasher {
  calls = 0;
  async sha256Hex(data: string): Promise<string> {
    this.calls++;
    // simple stable digest over the (already-normalized) input
    let h = 5381;
    for (let i = 0; i < data.length; i++) h = ((h << 5) + h + data.charCodeAt(i)) >>> 0;
    return "fp_" + h.toString(16);
  }
}

class FakePersist implements IndexPersist {
  store: Record<string, IndexEntry> | null = null;
  saves = 0;
  async load(): Promise<Record<string, IndexEntry> | null> {
    return this.store ? JSON.parse(JSON.stringify(this.store)) : null;
  }
  async save(rows: Record<string, IndexEntry>): Promise<void> {
    this.saves++;
    this.store = JSON.parse(JSON.stringify(rows));
  }
}

class FakeVault implements VaultReader {
  files: Map<string, { mtime: number; content: string }> = new Map();
  reads = 0;
  async list(): Promise<{ path: string; mtime: number }[]> {
    return [...this.files.entries()].map(([path, f]) => ({ path, mtime: f.mtime }));
  }
  async read(path: string): Promise<string> {
    this.reads++;
    const f = this.files.get(path);
    if (!f) throw new Error("no such file " + path);
    return f.content;
  }
  meta(path: string) {
    return { title: path.replace(/\.md$/, ""), type: "note", tags: ["t"], links: [] };
  }
  set(path: string, mtime: number, content: string) {
    this.files.set(path, { mtime, content });
  }
}

function deps() {
  const hasher = new FakeHasher();
  const persist = new FakePersist();
  const vault = new FakeVault();
  const index = new LocalHashIndex({ hasher, persist, vault });
  return { hasher, persist, vault, index };
}

describe("LocalHashIndex", () => {
  let hasher: FakeHasher;
  let persist: FakePersist;
  let vault: FakeVault;
  let index: LocalHashIndex;

  beforeEach(() => {
    ({ hasher, persist, vault, index } = deps());
  });

  it("rebuild hashes all files and indexes them by path and fp", async () => {
    vault.set("a.md", 1, "alpha");
    vault.set("b.md", 1, "beta");
    await index.rebuild();

    expect(hasher.calls).toBe(2);
    expect(index.byPath("a.md")).toBeDefined();
    expect(index.byPath("b.md")).toBeDefined();

    const fpA = index.fpFor("a.md")!;
    expect(index.byFp(fpA)?.path).toBe("a.md");
    expect(Object.keys(index.all())).toHaveLength(2);
  });

  it("captures metadata from the vault meta() host", async () => {
    vault.set("person.md", 1, "x");
    await index.rebuild();
    const e = index.byPath("person.md")!;
    expect(e.title).toBe("person");
    expect(e.type).toBe("note");
    expect(e.tags).toEqual(["t"]);
    expect(e.links).toEqual([]);
    expect(e.mtime).toBe(1);
  });

  it("fp is stable for identical normalized content", async () => {
    // Same logical content, different trailing whitespace / CRLF → identical fp.
    vault.set("x.md", 1, "hello world");
    vault.set("y.md", 1, "hello world   \r\n\n\n");
    await index.rebuild();
    expect(index.fpFor("x.md")).toBe(index.fpFor("y.md"));
    // sanity: normalization actually collapses these to the same string
    expect(normalizeForFingerprint("hello world")).toBe(
      normalizeForFingerprint("hello world   \r\n\n\n"),
    );
  });

  it("update only re-hashes files whose mtime changed", async () => {
    vault.set("a.md", 1, "alpha");
    await index.rebuild();
    expect(hasher.calls).toBe(1);

    // unchanged mtime → no re-hash, no work
    await index.update("a.md");
    expect(hasher.calls).toBe(1);

    // bump mtime + content → re-hash
    vault.set("a.md", 2, "alpha-edited");
    await index.update("a.md");
    expect(hasher.calls).toBe(2);
    expect(index.byPath("a.md")?.mtime).toBe(2);
  });

  it("rebuild incrementally reuses fp for files whose mtime is unchanged", async () => {
    vault.set("a.md", 1, "alpha");
    vault.set("b.md", 1, "beta");
    await index.rebuild();
    expect(hasher.calls).toBe(2);
    const fpB = index.fpFor("b.md");

    // change only a.md's mtime; rebuild should re-hash a only
    vault.set("a.md", 2, "alpha2");
    await index.rebuild();
    expect(hasher.calls).toBe(3);
    expect(index.fpFor("b.md")).toBe(fpB); // unchanged, reused
  });

  it("update drops a file that no longer exists in the vault", async () => {
    vault.set("a.md", 1, "alpha");
    await index.rebuild();
    const fpA = index.fpFor("a.md")!;
    vault.files.delete("a.md");
    await index.update("a.md");
    expect(index.byPath("a.md")).toBeUndefined();
    expect(index.byFp(fpA)).toBeUndefined();
  });

  it("rebuild prunes files no longer present", async () => {
    vault.set("a.md", 1, "alpha");
    vault.set("b.md", 1, "beta");
    await index.rebuild();
    vault.files.delete("b.md");
    await index.rebuild();
    expect(index.byPath("b.md")).toBeUndefined();
    expect(Object.keys(index.all())).toEqual(["a.md"]);
  });

  it("persists and round-trips through a fresh index instance", async () => {
    vault.set("a.md", 1, "alpha");
    vault.set("b.md", 2, "beta");
    await index.rebuild();
    expect(persist.saves).toBeGreaterThan(0);
    const snapshot = JSON.parse(JSON.stringify(persist.store));

    // new index over the SAME persistence, empty vault — must hydrate from disk
    const vault2 = new FakeVault();
    const index2 = new LocalHashIndex({ hasher: new FakeHasher(), persist, vault: vault2 });
    await index2.load();
    expect(index2.all()).toEqual(snapshot);
    expect(index2.byFp(index.fpFor("a.md")!)?.path).toBe("a.md");
  });

  it("re-hashing changed content rotates the fp index and prunes the old fp", async () => {
    vault.set("a.md", 1, "alpha");
    await index.rebuild();
    const oldFp = index.fpFor("a.md")!;

    vault.set("a.md", 2, "totally-different");
    await index.update("a.md");
    const newFp = index.fpFor("a.md")!;

    expect(newFp).not.toBe(oldFp);
    expect(index.byFp(oldFp)).toBeUndefined();
    expect(index.byFp(newFp)?.path).toBe("a.md");
  });
});
