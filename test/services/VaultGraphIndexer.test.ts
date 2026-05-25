// CON-SAUCEBOT · B-patch — unit tests for VaultGraphIndexer.
// All Obsidian deps are stubbed via the host interface (no vault I/O).
import { describe, expect, it } from "vitest";
import { GraphService } from "../../src/services/GraphService";
import {
  VaultGraphIndexer,
  type VaultGraphIndexerHost,
} from "../../src/services/VaultGraphIndexer";

/** Build a minimal stub host from simple maps. */
function stubHost(opts: {
  paths: string[];
  links?: Record<string, string[]>;
  frontmatter?: Record<string, Record<string, unknown>>;
}): VaultGraphIndexerHost {
  return {
    getMarkdownPaths: () => opts.paths,
    resolvedLinksFor: (path) => opts.links?.[path] ?? [],
    frontmatterFor: (path) => opts.frontmatter?.[path] ?? {},
  };
}

describe("VaultGraphIndexer — node/edge build", () => {
  it("creates a node for every note path", async () => {
    const graph = new GraphService();
    const host = stubHost({ paths: ["a.md", "b.md", "c.md"] });
    const indexer = new VaultGraphIndexer(graph, host);

    const count = await indexer.rebuild();

    expect(count).toBe(3);
    expect(graph.node("a.md")).not.toBeNull();
    expect(graph.node("b.md")).not.toBeNull();
    expect(graph.node("c.md")).not.toBeNull();
  });

  it("sets node type from frontmatter or falls back to 'note'", async () => {
    const graph = new GraphService();
    const host = stubHost({
      paths: ["people/Alice.md", "notes/idea.md"],
      frontmatter: {
        "people/Alice.md": { type: "person" },
        "notes/idea.md": {}, // no type
      },
    });
    const indexer = new VaultGraphIndexer(graph, host);
    await indexer.rebuild();

    expect(graph.node("people/Alice.md")?.type).toBe("person");
    expect(graph.node("notes/idea.md")?.type).toBe("note");
  });

  it("creates bidirectional edges for resolved wikilinks", async () => {
    const graph = new GraphService();
    const host = stubHost({
      paths: ["a.md", "b.md"],
      links: { "a.md": ["b.md"] },
    });
    const indexer = new VaultGraphIndexer(graph, host);
    await indexer.rebuild();

    // Both directions should be reachable (GraphService materialises bidi edges)
    const fromA = graph.neighbors("a.md").filter((e) => e.dst === "b.md" && e.kind === "wikilink");
    const fromB = graph.neighbors("b.md").filter((e) => e.dst === "a.md" && e.kind === "wikilink");
    expect(fromA.length).toBeGreaterThan(0);
    expect(fromB.length).toBeGreaterThan(0);
  });

  it("traverse() reaches linked nodes via wikilink edges", async () => {
    const graph = new GraphService();
    const host = stubHost({
      paths: ["hub.md", "spoke1.md", "spoke2.md"],
      links: { "hub.md": ["spoke1.md", "spoke2.md"] },
    });
    const indexer = new VaultGraphIndexer(graph, host);
    await indexer.rebuild();

    const reachable = graph.traverse("hub.md", { kind: "wikilink" }).sort();
    expect(reachable).toContain("spoke1.md");
    expect(reachable).toContain("spoke2.md");
  });

  it("excludeGlobs prevents nodes and edges from excluded paths", async () => {
    const graph = new GraphService();
    const host = stubHost({
      paths: ["templates/header.md", "notes/idea.md"],
      links: { "notes/idea.md": ["templates/header.md"] },
    });
    const indexer = new VaultGraphIndexer(graph, host, {
      excludeGlobs: ["templates"],
    });
    const count = await indexer.rebuild();

    // Template node should not exist
    expect(graph.node("templates/header.md")).toBeNull();
    expect(count).toBe(1);
    // No edge to the excluded node
    const edges = graph.neighbors("notes/idea.md");
    expect(edges.some((e) => e.dst === "templates/header.md")).toBe(false);
  });

  it("rebuild() is idempotent — double call does not duplicate nodes", async () => {
    const graph = new GraphService();
    const host = stubHost({ paths: ["x.md"] });
    const indexer = new VaultGraphIndexer(graph, host);

    await indexer.rebuild();
    await indexer.rebuild();

    // GraphService deduplicates by id; querying all 'note' nodes should yield 1
    const notes = graph.query((n) => n.id === "x.md");
    expect(notes.length).toBe(1);
  });

  it("persists nodes and edges to a GraphStore when provided", async () => {
    const graph = new GraphService();
    const host = stubHost({
      paths: ["a.md", "b.md"],
      links: { "a.md": ["b.md"] },
    });

    const storedNodes: string[] = [];
    const storedEdges: string[] = [];
    const fakeStore = {
      upsertNode: async (input: { id?: string }) => {
        storedNodes.push(input.id ?? "");
        return input.id ?? "";
      },
      upsertEdge: async (src: string, dst: string, kind: string) => {
        storedEdges.push(`${src}->${dst}:${kind}`);
      },
      getNode: async () => null,
      neighbors: async () => [],
      allNodes: async () => [],
      allEdges: async () => [],
      hasEdge: async () => false,
    };

    const indexer = new VaultGraphIndexer(graph, host, { store: fakeStore });
    await indexer.rebuild();

    expect(storedNodes).toContain("a.md");
    expect(storedNodes).toContain("b.md");
    // Bidirectional: both directions should be stored
    expect(storedEdges.some((e) => e.startsWith("a.md->b.md:wikilink"))).toBe(true);
  });

  it("handles empty vault gracefully", async () => {
    const graph = new GraphService();
    const host = stubHost({ paths: [] });
    const indexer = new VaultGraphIndexer(graph, host);
    const count = await indexer.rebuild();
    expect(count).toBe(0);
  });
});
