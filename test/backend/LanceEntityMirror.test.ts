// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { tmpLance, type TmpLance } from "./_lance-tmp";
import { TABLES } from "../../src/backend/lance/LanceSchema";
import { LanceEntityMirror, type MirrorFile, type MirrorTables } from "../../src/backend/lance/LanceEntityMirror";

async function tables(h: TmpLance): Promise<MirrorTables> {
  return {
    entities: await h.table(TABLES.entities),
    edges: await h.table(TABLES.edges),
    tags: await h.table(TABLES.tags),
    touches: await h.table(TABLES.touches),
    embeddings: await h.table(TABLES.embeddings),
  };
}

function file(path: string, over: Partial<MirrorFile> = {}): MirrorFile {
  return {
    path, type: "person", primaryType: "warm_contact",
    frontmatter: { name: path }, body: `body of ${path}`, bodyHash: `hash-${path}`,
    mtime: 1, ctime: 1, tags: ["vip"], edges: [], ...over,
  };
}

describe("LanceEntityMirror", () => {
  let h: TmpLance;
  afterEach(() => h?.cleanup());

  it("upserts an entity with tags and edges", async () => {
    h = await tmpLance();
    const t = await tables(h);
    const m = new LanceEntityMirror(t);
    await m.onCreate(file("people/Alice.md", {
      tags: ["vip", "founder"],
      edges: [{ to: "orgs/Acme.md", edgeType: "works_at", directed: true }],
    }));

    const e = await m.getEntity("people/Alice.md");
    expect(e?.type).toBe("person");
    expect(JSON.parse(e!.frontmatter).name).toBe("people/Alice.md");
    expect(await t.tags.countRows()).toBe(2);
    const edges = await m.neighbors("people/Alice.md");
    expect(edges.map((x) => x.to_id)).toContain("orgs/Acme.md");
  });

  it("re-derives tags on modify (no stale tags)", async () => {
    h = await tmpLance();
    const t = await tables(h);
    const m = new LanceEntityMirror(t);
    await m.onCreate(file("people/Bob.md", { tags: ["a", "b", "c"] }));
    await m.onModify(file("people/Bob.md", { tags: ["x"], bodyHash: "hash2" }));
    expect(await t.tags.countRows()).toBe(1);
  });

  it("deletes an entity and its derived rows", async () => {
    h = await tmpLance();
    const t = await tables(h);
    const m = new LanceEntityMirror(t);
    await m.onCreate(file("people/Carol.md", {
      tags: ["x"], edges: [{ to: "orgs/Z.md", edgeType: "knows", directed: false }],
    }));
    await m.onDelete("people/Carol.md");
    expect(await m.getEntity("people/Carol.md")).toBeNull();
    expect(await t.tags.countRows()).toBe(0);
    expect(await t.edges.countRows()).toBe(0);
  });

  it("renames an entity across entities + edges", async () => {
    h = await tmpLance();
    const t = await tables(h);
    const m = new LanceEntityMirror(t);
    await m.onCreate(file("people/Old.md", {
      edges: [{ to: "orgs/Z.md", edgeType: "knows", directed: true }],
    }));
    await m.onRename("people/Old.md", "people/New.md");

    expect(await m.getEntity("people/Old.md")).toBeNull();
    expect(await m.getEntity("people/New.md")).not.toBeNull();
    const edges = await m.neighbors("people/New.md");
    expect(edges[0].from_id).toBe("people/New.md");
  });

  it("listByType filters by entity type", async () => {
    h = await tmpLance();
    const t = await tables(h);
    const m = new LanceEntityMirror(t);
    await m.onCreate(file("people/A.md", { type: "person" }));
    await m.onCreate(file("orgs/B.md", { type: "org" }));
    const people = await m.listByType("person");
    expect(people.map((e) => e.id)).toEqual(["people/A.md"]);
  });
});
