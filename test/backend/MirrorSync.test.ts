// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import type { App, TFile } from "obsidian";
import { tmpLance, type TmpLance } from "./_lance-tmp";
import { TABLES } from "../../src/backend/lance/LanceSchema";
import {
  LanceEntityMirror,
  type MirrorTables,
} from "../../src/backend/lance/LanceEntityMirror";
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
    (path) =>
      ({
        path,
        extension: "md",
        stat: { mtime: 1, ctime: 1 },
      }) as unknown as TFile,
  );
  return {
    vault: {
      cachedRead: async (f: TFile) => opts.content[f.path] ?? "",
      getMarkdownFiles: () => files,
    },
    metadataCache: {
      getFileCache: (f: TFile) => ({ frontmatter: opts.frontmatter[f.path] }),
      getFirstLinkpathDest: (link: string) =>
        opts.links?.[link]
          ? ({ path: opts.links[link] } as unknown as TFile)
          : null,
    },
  } as unknown as App;
}

const tfile = (path: string) =>
  ({ path, extension: "md", stat: { mtime: 1, ctime: 1 } }) as unknown as TFile;

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
        "people/Alice.md": {
          type: "person",
          tags: ["vip"],
          knows: ["[[Bob]]"],
        },
      },
      content: { "people/Alice.md": "---\ntype: person\n---\nAlice bio text" },
      links: { Bob: "people/Bob.md" },
    });
    const embed = async () => [1, 0, 0, 0];
    const sync = new MirrorSync(
      app,
      mirror,
      vectors,
      ["knows", "worked_with"],
      embed,
    );

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

  it("fullResyncDetailed batches and yields between batches (fake scheduler)", async () => {
    h = await tmpLance();
    const t = await tables(h);
    const mirror = new LanceEntityMirror(t);
    const fm: Record<string, Record<string, unknown>> = {};
    const content: Record<string, string> = {};
    for (let i = 0; i < 5; i++) {
      fm[`people/P${i}.md`] = { type: "person" };
      content[`people/P${i}.md`] = `body ${i}`;
    }
    const app = fakeApp({ frontmatter: fm, content });
    // Counting scheduler: each inter-batch yield resolves on a microtask, and we
    // count them — 5 files / batchSize 2 ⇒ 3 batches ⇒ exactly 2 yields.
    let yields = 0;
    const sync = new MirrorSync(app, mirror, null, [], null, null, {
      scheduleYield: (resume) => {
        yields += 1;
        void Promise.resolve().then(resume);
      },
    });

    const r = await sync.fullResyncDetailed({ embed: false, batchSize: 2 });
    expect(r.synced).toBe(5);
    expect(r.total).toBe(5);
    expect(r.cursor).toBe(5);
    expect(r.cancelled).toBe(false);
    expect(yields).toBe(2); // proves the resync yielded between batches
    expect(await mirror.listByType("person")).toHaveLength(5);
  });

  it("fullResyncDetailed cancels mid-run via signal and reports a resumable cursor", async () => {
    h = await tmpLance();
    const t = await tables(h);
    const mirror = new LanceEntityMirror(t);
    const fm: Record<string, Record<string, unknown>> = {};
    const content: Record<string, string> = {};
    for (let i = 0; i < 6; i++) {
      fm[`people/Q${i}.md`] = { type: "person" };
      content[`people/Q${i}.md`] = `b${i}`;
    }
    const app = fakeApp({ frontmatter: fm, content });
    const signal = { aborted: false };
    let yields = 0;
    const sync = new MirrorSync(app, mirror, null, [], null, null, {
      // Abort on the first inter-batch yield ⇒ second batch must not run.
      scheduleYield: (resume) => {
        yields += 1;
        signal.aborted = true;
        resume();
      },
    });

    const r = await sync.fullResyncDetailed({
      embed: false,
      batchSize: 2,
      signal,
    });
    expect(r.cancelled).toBe(true);
    expect(r.cursor).toBe(2); // only the first batch of 2 ran
    expect(r.synced).toBe(2);
    expect(r.drift).toBeNull(); // no reconciliation on a cancelled run
    expect(yields).toBe(1);
  });

  it("fullResyncDetailed resumes from startIndex (cursor)", async () => {
    h = await tmpLance();
    const t = await tables(h);
    const mirror = new LanceEntityMirror(t);
    const fm: Record<string, Record<string, unknown>> = {};
    const content: Record<string, string> = {};
    for (let i = 0; i < 4; i++) {
      fm[`people/R${i}.md`] = { type: "person" };
      content[`people/R${i}.md`] = `b${i}`;
    }
    const app = fakeApp({ frontmatter: fm, content });
    const sync = new MirrorSync(app, mirror, null, [], null, null, {
      scheduleYield: (resume) => resume(),
    });

    // Resume from index 2 ⇒ only the last 2 files are processed.
    const r = await sync.fullResyncDetailed({
      embed: false,
      batchSize: 10,
      startIndex: 2,
    });
    expect(r.synced).toBe(2);
    expect(r.cursor).toBe(4);
    expect(r.total).toBe(4);
  });

  it("fullResyncDetailed reports monotonic progress with correct counts", async () => {
    h = await tmpLance();
    const t = await tables(h);
    const mirror = new LanceEntityMirror(t);
    const fm: Record<string, Record<string, unknown>> = {};
    const content: Record<string, string> = {};
    for (let i = 0; i < 3; i++) {
      fm[`people/S${i}.md`] = { type: "person" };
      content[`people/S${i}.md`] = `b${i}`;
    }
    const app = fakeApp({ frontmatter: fm, content });
    const ticks: Array<{ done: number; total: number; phase: string }> = [];
    const sync = new MirrorSync(app, mirror, null, [], null, null, {
      scheduleYield: (resume) => resume(),
    });

    await sync.fullResyncDetailed({
      embed: false,
      batchSize: 1,
      onProgress: (p) => ticks.push({ ...p }),
    });

    // Every tick has total === 3 and done never decreases.
    expect(ticks.every((p) => p.total === 3)).toBe(true);
    for (let i = 1; i < ticks.length; i++) {
      expect(ticks[i]!.done).toBeGreaterThanOrEqual(ticks[i - 1]!.done);
    }
    // Indexing phase reaches done === total; a reconciling + done phase follow.
    expect(ticks.some((p) => p.phase === "indexing" && p.done === 3)).toBe(
      true,
    );
    expect(ticks.some((p) => p.phase === "reconciling")).toBe(true);
    expect(ticks.at(-1)?.phase).toBe("done");
  });

  it("reconciliation reports zero drift when mirror count matches vault entities", async () => {
    h = await tmpLance();
    const t = await tables(h);
    const mirror = new LanceEntityMirror(t);
    const app = fakeApp({
      frontmatter: {
        "people/A.md": { type: "person" },
        "orgs/B.md": { type: "org" },
      },
      content: { "people/A.md": "a", "orgs/B.md": "b" },
    });
    const sync = new MirrorSync(app, mirror, null, [], null, null, {
      scheduleYield: (resume) => resume(),
      // Real mirror row count — the entities table holds exactly what we synced.
      countMirrorRows: () => t.entities.countRows(),
    });

    const r = await sync.fullResyncDetailed({ embed: false });
    expect(r.synced).toBe(2);
    expect(r.mirrorRows).toBe(2);
    expect(r.drift).toBe(0);
  });

  it("reconciliation surfaces drift when mirror count diverges", async () => {
    h = await tmpLance();
    const t = await tables(h);
    const mirror = new LanceEntityMirror(t);
    const app = fakeApp({
      frontmatter: { "people/A.md": { type: "person" } },
      content: { "people/A.md": "a" },
    });
    const sync = new MirrorSync(app, mirror, null, [], null, null, {
      scheduleYield: (resume) => resume(),
      countMirrorRows: async () => 5, // injected divergent count
    });
    const r = await sync.fullResyncDetailed({ embed: false });
    expect(r.synced).toBe(1);
    expect(r.mirrorRows).toBe(5);
    expect(r.drift).toBe(4);
  });

  it("reconciliation drift is null when the mirror count is unavailable", async () => {
    h = await tmpLance();
    const t = await tables(h);
    const mirror = new LanceEntityMirror(t);
    const app = fakeApp({
      frontmatter: { "people/A.md": { type: "person" } },
      content: { "people/A.md": "a" },
    });
    const sync = new MirrorSync(app, mirror, null, [], null, null, {
      scheduleYield: (resume) => resume(),
      countMirrorRows: async () => {
        throw new Error("count failed");
      },
    });
    const r = await sync.fullResyncDetailed({ embed: false });
    expect(r.mirrorRows).toBeNull();
    expect(r.drift).toBeNull();
  });

  it("fullResyncDetailed halts at the next batch boundary once closed()", async () => {
    h = await tmpLance();
    const t = await tables(h);
    const mirror = new LanceEntityMirror(t);
    const fm: Record<string, Record<string, unknown>> = {};
    const content: Record<string, string> = {};
    for (let i = 0; i < 4; i++) {
      fm[`people/C${i}.md`] = { type: "person" };
      content[`people/C${i}.md`] = `b${i}`;
    }
    const app = fakeApp({ frontmatter: fm, content });
    const sync = new MirrorSync(app, mirror, null, [], null, null, {
      scheduleYield: (resume) => {
        sync.close(); // teardown begins mid-resync
        resume();
      },
    });
    const r = await sync.fullResyncDetailed({ embed: false, batchSize: 2 });
    expect(r.cancelled).toBe(true);
    expect(r.cursor).toBe(2);
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
    const sync = new MirrorSync(
      app,
      mirror,
      vectors,
      [],
      async () => [1, 0, 0, 0],
      null,
      {
        realtimeEmbeddings: () => false,
      },
    );

    expect(await sync.syncFile(tfile("people/A.md"))).toBe(true);
    expect(await vectors.isEmpty()).toBe(true);

    await sync.fullResync({ embed: true });
    expect(await vectors.isEmpty()).toBe(false);
  });
});
