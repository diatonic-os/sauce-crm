// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { tmpLance, type TmpLance } from "./_lance-tmp";
import { TABLES } from "../../src/backend/lance/LanceSchema";
import {
  LanceEntityMirror,
  type MirrorTables,
} from "../../src/backend/lance/LanceEntityMirror";
import { LanceFtsIndex } from "../../src/backend/lance/LanceFtsIndex";

async function tables(h: TmpLance): Promise<MirrorTables> {
  return {
    entities: await h.table(TABLES.entities),
    edges: await h.table(TABLES.edges),
    tags: await h.table(TABLES.tags),
    touches: await h.table(TABLES.touches),
    embeddings: await h.table(TABLES.embeddings),
  };
}

const file = (path: string, body: string) => ({
  path,
  type: "person",
  frontmatter: { name: path },
  body,
  bodyHash: `h-${path}`,
  mtime: 1,
  ctime: 1,
  tags: [],
  edges: [],
});

describe("LanceFtsIndex", () => {
  let h: TmpLance;
  afterEach(() => h?.cleanup());

  it("full-text searches entity bodies", async () => {
    h = await tmpLance();
    const t = await tables(h);
    const m = new LanceEntityMirror(t);
    const fts = new LanceFtsIndex(t.entities);

    await m.onCreate(file("people/A.md", "the quick brown fox jumps over"));
    await m.onCreate(file("people/B.md", "lazy dogs sleep all day long"));
    await m.onCreate(file("people/C.md", "a quick clever fox returns"));
    await fts.index("", "", ""); // build/refresh index

    const hits = await fts.search("quick fox", 10);
    const ids = hits.map((x) => x.entityId);
    expect(ids).toContain("people/A.md");
    expect(ids).toContain("people/C.md");
    expect(ids).not.toContain("people/B.md");
  });
});
