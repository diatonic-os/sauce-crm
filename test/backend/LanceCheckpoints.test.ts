// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { tmpLance, type TmpLance } from "./_lance-tmp";
import { TABLES } from "../../src/backend/lance/LanceSchema";
import { LanceEntityMirror, type MirrorTables } from "../../src/backend/lance/LanceEntityMirror";
import { LanceCheckpoints } from "../../src/backend/lance/LanceCheckpoints";

async function mirrorTables(h: TmpLance): Promise<MirrorTables> {
  return {
    entities: await h.table(TABLES.entities),
    edges: await h.table(TABLES.edges),
    tags: await h.table(TABLES.tags),
    touches: await h.table(TABLES.touches),
    embeddings: await h.table(TABLES.embeddings),
  };
}

const file = (path: string, hash: string) => ({
  path, type: "person", frontmatter: { name: path }, body: path, bodyHash: hash,
  mtime: 1, ctime: 1, tags: [], edges: [],
});

describe("LanceCheckpoints", () => {
  let h: TmpLance;
  afterEach(() => h?.cleanup());

  it("checkpoints and restores entity state (time-travel)", async () => {
    h = await tmpLance();
    const t = await mirrorTables(h);
    const m = new LanceEntityMirror(t);
    const ckpt = new LanceCheckpoints(h.db);

    await m.onCreate(file("people/A.md", "h1"));
    await ckpt.checkpoint("before-bulk");

    await m.onCreate(file("people/B.md", "h2"));
    await m.onCreate(file("people/C.md", "h3"));
    expect(await m.listByType("person")).toHaveLength(3);

    await ckpt.restore("before-bulk");
    const after = await m.listByType("person");
    expect(after.map((e) => e.id)).toEqual(["people/A.md"]);
  });

  it("lists checkpoint labels", async () => {
    h = await tmpLance();
    const t = await mirrorTables(h);
    const m = new LanceEntityMirror(t);
    const ckpt = new LanceCheckpoints(h.db);
    await m.onCreate(file("people/A.md", "h1"));
    await ckpt.checkpoint("v1");
    const labels = (await ckpt.list()).map((c) => c.label);
    expect(labels).toContain("v1");
  });
});
