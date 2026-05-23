// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import type { App, TFile } from "obsidian";
import { tmpLance, type TmpLance } from "./_lance-tmp";
import { TABLES } from "../../src/backend/lance/LanceSchema";
import { LanceEntityMirror, type MirrorTables } from "../../src/backend/lance/LanceEntityMirror";
import { LanceVectorIndex } from "../../src/backend/lance/LanceVectorIndex";
import { MirrorSync } from "../../src/services/MirrorSync";

const DIM = 4;

/** Minimal fake of the Obsidian surface MirrorSync touches. */
function fakeApp(opts: {
  frontmatter: Record<string, Record<string, unknown>>;
  content: Record<string, string>;
  links?: Record<string, string>; // linkpath -> dest path
}): App {
  const files: TFile[] = Object.keys(opts.content).map(
    (path) => ({ path, extension: "md", stat: { mtime: 1, ctime: 1 } }) as unknown as TFile,
  );
  return {
    vault: {
      cachedRead: async (f: TFile) => opts.content[f.path] ?? "",
      getMarkdownFiles: () => files,
    },
    metadataCache: {
      getFileCache: (f: TFile) => ({ frontmatter: opts.frontmatter[f.path] }),
      getFirstLinkpathDest: (link: string) =>
        opts.links?.[link] ? ({ path: opts.links[link] } as unknown as TFile) : null,
    },
  } as unknown as App;
}

const tfile = (path: string) => ({ path, extension: "md", stat: { mtime: 1, ctime: 1 } }) as unknown as TFile;

async function tables(h: TmpLance): Promise<MirrorTables> {
  return {
    entities: await h.table(TABLES.entities, DIM),
    edges: await h.table(TABLES.edges, DIM),
    tags: await h.table(TABLES.tags, DIM),
    touches: await h.table(TABLES.touches, DIM),
    embeddings: await h.table(TABLES.embeddings, DIM),
  };
}

describe("MirrorSync", () => {
  let h: TmpLance;
  afterEach(() => h?.cleanup());

  it("syncs a typed entity with tags + resolved edges and embeds it", async () => {
    h = await tmpLance();
    const t = await tables(h);
    const mirror = new LanceEntityMirror(t);
    const vectors = new LanceVectorIndex(t.embeddings, DIM);
    const app = fakeApp({
      frontmatter: {
        "people/Alice.md": { type: "person", tags: ["vip"], knows: ["[[Bob]]"] },
      },
      content: { "people/Alice.md": "---\ntype: person\n---\nAlice bio text" },
      links: { Bob: "people/Bob.md" },
    });
    const embed = async () => [1, 0, 0, 0];
    const sync = new MirrorSync(app, mirror, vectors, ["knows", "worked_with"], embed);

    await expect(sync.syncFile(tfile("people/Alice.md"))).resolves.toBe(true);

    const e = await mirror.getEntity("people/Alice.md");
    expect(e?.type).toBe("person");
    expect(await t.tags.countRows()).toBe(1);
    const edges = await mirror.neighbors("people/Alice.md");
    expect(edges.map((x) => x.to_id)).toContain("people/Bob.md");
    // Embedding stored + queryable
    const hits = await vectors.query([1, 0, 0, 0], 1);
    expect(hits[0]?.id).toBe("people/Alice.md");
  });

  it("skips files with no entity type", async () => {
    h = await tmpLance();
    const t = await tables(h);
    const mirror = new LanceEntityMirror(t);
    const app = fakeApp({
      frontmatter: { "notes/loose.md": { tags: ["x"] } }, // no `type`
      content: { "notes/loose.md": "just a note" },
    });
    const sync = new MirrorSync(app, mirror, null, [], null);
    await expect(sync.syncFile(tfile("notes/loose.md"))).resolves.toBe(false);
    expect(await mirror.getEntity("notes/loose.md")).toBeNull();
  });

  it("skips embedding on dimension mismatch (no throw, mirror still written)", async () => {
    h = await tmpLance();
    const t = await tables(h);
    const mirror = new LanceEntityMirror(t);
    const vectors = new LanceVectorIndex(t.embeddings, DIM);
    const app = fakeApp({
      frontmatter: { "people/C.md": { type: "person" } },
      content: { "people/C.md": "body" },
    });
    const wrongDim = async () => [1, 2, 3]; // dim 3 != table dim 4
    const sync = new MirrorSync(app, mirror, vectors, [], wrongDim);
    await sync.syncFile(tfile("people/C.md"));

    expect(await mirror.getEntity("people/C.md")).not.toBeNull();
    expect(await vectors.isEmpty()).toBe(true);
  });

  it("fullResync walks all markdown entities", async () => {
    h = await tmpLance();
    const t = await tables(h);
    const mirror = new LanceEntityMirror(t);
    const app = fakeApp({
      frontmatter: {
        "people/A.md": { type: "person" },
        "orgs/B.md": { type: "org" },
        "notes/x.md": {}, // skipped (no type)
      },
      content: { "people/A.md": "a", "orgs/B.md": "b", "notes/x.md": "x" },
    });
    const sync = new MirrorSync(app, mirror, null, [], null);
    const n = await sync.fullResync();
    expect(n).toBe(2); // synced 2 typed entities; skipped loose markdown
    expect(await mirror.listByType("person")).toHaveLength(1);
    expect(await mirror.listByType("org")).toHaveLength(1);
  });

  it("honors realtime embedding toggle but still embeds on manual full resync", async () => {
    h = await tmpLance();
    const t = await tables(h);
    const mirror = new LanceEntityMirror(t);
    const vectors = new LanceVectorIndex(t.embeddings, DIM);
    const app = fakeApp({
      frontmatter: { "people/A.md": { type: "person" } },
      content: { "people/A.md": "body" },
    });
    const sync = new MirrorSync(app, mirror, vectors, [], async () => [1, 0, 0, 0], null, {
      realtimeEmbeddings: () => false,
    });

    expect(await sync.syncFile(tfile("people/A.md"))).toBe(true);
    expect(await vectors.isEmpty()).toBe(true);

    await sync.fullResync({ embed: true });
    expect(await vectors.isEmpty()).toBe(false);
  });
});
