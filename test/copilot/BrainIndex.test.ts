// Brain index primitives — tokenize / lexicon / taxonomy / path records.

import { describe, expect, it } from "vitest";
import {
  tokenize,
  Lexicon,
  Taxonomy,
  pathRecord,
  extractLinks,
  resolveLinkSymmetry,
  buildFolderLattice,
  type PathRecord,
} from "../../src/saucebot/BrainIndex";

function rec(links: string[], type = "person"): PathRecord {
  return { type, title: "", mtime: 0, links, linkedBy: [], tags: [] };
}

describe("tokenize", () => {
  it("lowercases, drops stopwords and short tokens, keeps domain terms", () => {
    const toks = tokenize("Alice is a Staff ML Engineer at Acme, leads ranking.");
    expect(toks).toContain("alice");
    expect(toks).toContain("staff");
    expect(toks).toContain("engineer");
    expect(toks).toContain("ranking");
    expect(toks).not.toContain("is");
    expect(toks).not.toContain("a");
    expect(toks).not.toContain("at");
  });
});

describe("Lexicon", () => {
  it("accumulates term frequency and document frequency", () => {
    const lex = new Lexicon();
    lex.addDocument(tokenize("ranking ranking embeddings"));
    lex.addDocument(tokenize("ranking models"));
    const top = lex.top(10);
    const ranking = top.find((t) => t.term === "ranking");
    expect(ranking).toEqual({ term: "ranking", freq: 3, docs: 2 });
    const emb = top.find((t) => t.term === "embeddings");
    expect(emb).toEqual({ term: "embeddings", freq: 1, docs: 1 });
  });

  it("serializes the top-N terms", () => {
    const lex = new Lexicon();
    lex.addDocument(tokenize("alpha beta beta gamma gamma gamma"));
    const j = JSON.parse(lex.toJSON(2));
    expect(j.terms).toHaveLength(2);
    expect(j.terms[0].term).toBe("gamma");
  });
});

describe("Taxonomy", () => {
  it("counts folders, types, frontmatter keys, and tags", () => {
    const tax = new Taxonomy();
    tax.addDocument("people/alice.md", { type: "person", title: "x" }, ["#warm"]);
    tax.addDocument("people/bob.md", { type: "person" }, ["warm", "lead"]);
    tax.addDocument("orgs/acme.md", { type: "org" }, []);
    const c = tax.counts();
    expect(c.folders.people).toBe(2);
    expect(c.folders.orgs).toBe(1);
    expect(c.types.person).toBe(2);
    expect(c.types.org).toBe(1);
    expect(c.frontmatterKeys.type).toBe(3);
    expect(c.tags.warm).toBe(2); // '#warm' and 'warm' normalize together
  });
});

describe("pathRecord + extractLinks", () => {
  it("extracts unique wikilink targets, stripping alias/heading", () => {
    expect(extractLinks("see [[Bob Lee|Bob]] and [[Acme#team]] and [[Bob Lee]]")).toEqual([
      "Bob Lee",
      "Acme",
    ]);
  });

  it("builds a record with type, title (frontmatter > heading), links, tags", () => {
    const r = pathRecord(
      { type: "person", name: "Alice Chen" },
      "# Heading\n\nbody with [[Bob]]",
      123,
      ["#warm"],
    );
    expect(r.type).toBe("person");
    expect(r.title).toBe("Alice Chen");
    expect(r.links).toEqual(["Bob"]);
    expect(r.tags).toEqual(["warm"]);
    expect(r.mtime).toBe(123);
  });

  it("falls back to the H1 heading for the title when frontmatter lacks one", () => {
    const r = pathRecord({ type: "note" }, "# My Note Title\n\nbody", 1, []);
    expect(r.title).toBe("My Note Title");
  });
});

describe("resolveLinkSymmetry — reciprocal link lattice", () => {
  it("adds a backlink for every resolvable out-link (perfect symmetry)", () => {
    const m = new Map<string, PathRecord>([
      ["people/alice.md", rec(["Bob"])],
      ["people/bob.md", rec([])],
    ]);
    resolveLinkSymmetry(m);
    // A links B (resolved to path) ⇒ B is linkedBy A.
    expect(m.get("people/alice.md")!.links).toEqual(["people/bob.md"]);
    expect(m.get("people/bob.md")!.linkedBy).toEqual(["people/alice.md"]);
  });

  it("is symmetric: for every A in links, A is in the target's linkedBy", () => {
    const m = new Map<string, PathRecord>([
      ["a.md", rec(["b", "c"])],
      ["b.md", rec(["c"])],
      ["c.md", rec([])],
    ]);
    resolveLinkSymmetry(m);
    for (const [path, r] of m) {
      for (const target of r.links) {
        if (m.has(target)) {
          expect(m.get(target)!.linkedBy).toContain(path);
        }
      }
    }
    expect(m.get("c.md")!.linkedBy.sort()).toEqual(["a.md", "b.md"]);
  });

  it("is idempotent (re-running does not duplicate backlinks)", () => {
    const m = new Map<string, PathRecord>([
      ["a.md", rec(["b"])],
      ["b.md", rec([])],
    ]);
    resolveLinkSymmetry(m);
    resolveLinkSymmetry(m);
    expect(m.get("b.md")!.linkedBy).toEqual(["a.md"]);
  });
});

describe("buildFolderLattice — fractal self-similarity", () => {
  it("aggregates file counts and types at every folder level", () => {
    const m = new Map<string, PathRecord>([
      ["people/alice.md", rec([], "person")],
      ["people/team/bob.md", rec([], "person")],
      ["orgs/acme.md", rec([], "org")],
    ]);
    const root = buildFolderLattice(m);
    expect(root.files).toBe(3); // vault root counts all
    const people = root.subfolders.find((s) => s.folder === "people")!;
    expect(people.files).toBe(2);
    expect(people.types.person).toBe(2);
    const team = people.subfolders.find((s) => s.folder === "people/team")!;
    expect(team.files).toBe(1);
  });
});
