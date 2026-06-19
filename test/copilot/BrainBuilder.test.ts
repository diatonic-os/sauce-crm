// BrainBuilder — full build + incremental + persistence, over a fake store.

import { describe, expect, it } from "vitest";
import {
  BrainBuilder,
  type BrainPersistence,
  type BrainFile,
} from "../../src/saucebot/BrainBuilder";

class FakeStore implements BrainPersistence {
  files = new Map<string, string>();
  dirs = new Set<string>();
  async read(p: string): Promise<string> {
    const v = this.files.get(p);
    if (v == null) throw new Error("ENOENT " + p);
    return v;
  }
  async write(p: string, d: string): Promise<void> {
    this.files.set(p, d);
  }
  async exists(p: string): Promise<boolean> {
    return this.files.has(p) || this.dirs.has(p);
  }
  async mkdir(p: string): Promise<void> {
    this.dirs.add(p);
  }
}

function file(
  path: string,
  body: string,
  fm: Record<string, unknown> = {},
  tags: string[] = [],
): BrainFile {
  return { path, mtime: 1, read: async () => body, frontmatter: fm, tags };
}

const FILES: BrainFile[] = [
  file(
    "people/alice.md",
    "---\ntype: person\n---\n# Alice\nranking lead, links [[Bob]]",
    { type: "person", title: "Alice" },
    ["#warm"],
  ),
  file("people/bob.md", "# Bob\nworks on ranking", { type: "person" }, [
    "#warm",
  ]),
  file("orgs/acme.md", "# Acme\nan org", { type: "org" }, []),
];

describe("BrainBuilder.buildAll", () => {
  it("writes lexicon, taxonomy, lattice, paths, and a manifest", async () => {
    const store = new FakeStore();
    const b = new BrainBuilder(store, "_brain", () => 1234);
    const manifest = await b.buildAll(FILES);

    expect(store.files.has("_brain/brain-lexicon.json")).toBe(true);
    expect(store.files.has("_brain/brain-taxonomy.json")).toBe(true);
    expect(store.files.has("_brain/brain-lattice.json")).toBe(true);
    expect(store.files.has("_brain/brain-paths.json")).toBe(true);
    expect(store.files.has("_brain/brain.json")).toBe(true);

    expect(manifest.files).toBe(3);
    expect(manifest.pathCount).toBe(3);
    expect(manifest.builtAt).toBe(1234);
    expect(manifest.stale).toBe(false);

    // Symmetric link lattice persisted into the path matrix.
    const paths = JSON.parse(store.files.get("_brain/brain-paths.json")!).paths;
    expect(paths["people/alice.md"].links).toContain("people/bob.md");
    expect(paths["people/bob.md"].linkedBy).toContain("people/alice.md");

    // Lexicon carries domain terms.
    const lex = JSON.parse(store.files.get("_brain/brain-lexicon.json")!).terms;
    expect(lex.some((t: { term: string }) => t.term === "ranking")).toBe(true);
  });
});

describe("BrainBuilder incremental", () => {
  it("updateFile refreshes one path record in realtime and marks the brain stale", async () => {
    const store = new FakeStore();
    const b = new BrainBuilder(store, "_brain", () => 1);
    await b.buildAll(FILES);
    expect(JSON.parse(store.files.get("_brain/brain.json")!).stale).toBe(false);

    await b.updateFile(
      file("people/carol.md", "# Carol\nnew person", { type: "person" }, []),
    );
    const paths = JSON.parse(store.files.get("_brain/brain-paths.json")!).paths;
    expect(paths["people/carol.md"]).toBeDefined();
    expect(paths["people/carol.md"].title).toBe("Carol");
    // Aggregate indexes flagged stale; path matrix stays current.
    expect(JSON.parse(store.files.get("_brain/brain.json")!).stale).toBe(true);
  });

  it("removeFile drops a deleted note from the path matrix", async () => {
    const store = new FakeStore();
    const b = new BrainBuilder(store, "_brain", () => 1);
    await b.buildAll(FILES);
    await b.removeFile("orgs/acme.md");
    const paths = JSON.parse(store.files.get("_brain/brain-paths.json")!).paths;
    expect(paths["orgs/acme.md"]).toBeUndefined();
    expect(b.pathCount).toBe(2);
  });

  it("isIntact() is true after a full build and false when an artifact is wiped", async () => {
    const store = new FakeStore();
    const b = new BrainBuilder(store, "_brain", () => 1);
    await b.buildAll(FILES);
    expect(await b.isIntact()).toBe(true);
    // Simulate a wiped index (e.g. _brain folder deleted / sync dropped a file).
    store.files.delete("_brain/brain-paths.json");
    expect(await b.isIntact()).toBe(false);
  });

  it("load() restores the path matrix so incremental builds resume", async () => {
    const store = new FakeStore();
    const b1 = new BrainBuilder(store, "_brain", () => 1);
    await b1.buildAll(FILES);
    const b2 = new BrainBuilder(store, "_brain", () => 2);
    await b2.load();
    expect(b2.pathCount).toBe(3);
    expect(await b2.isBuilt()).toBe(true);
  });
});
