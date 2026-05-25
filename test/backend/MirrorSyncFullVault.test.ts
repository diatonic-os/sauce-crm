// @vitest-environment node
// B-patch tests for MirrorSync whole-vault-index feature (CON-SAUCEBOT).
// Tests: untyped-note fallback type, excludeGlobs, interaction with typed notes.
import { afterEach, describe, expect, it } from "vitest";
import type { App, TFile } from "obsidian";
import { tmpLance, type TmpLance } from "./_lance-tmp";
import { TABLES } from "../../src/backend/lance/LanceSchema";
import { LanceEntityMirror, type MirrorTables } from "../../src/backend/lance/LanceEntityMirror";
import { MirrorSync } from "../../src/services/MirrorSync";

const DIM = 4;

function fakeApp(opts: {
  frontmatter: Record<string, Record<string, unknown>>;
  content: Record<string, string>;
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
      getFileCache: (f: TFile) => {
        const fm = opts.frontmatter[f.path];
        return fm ? { frontmatter: fm } : null;
      },
      getFirstLinkpathDest: () => null,
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

describe("MirrorSync — full-vault index (B-patch)", () => {
  let h: TmpLance;
  afterEach(() => h?.cleanup());

  it("mirrors an untyped note with fallback type 'note' when fullVaultIndex is true", async () => {
    h = await tmpLance();
    const t = await tables(h);
    const mirror = new LanceEntityMirror(t);
    const app = fakeApp({
      frontmatter: { "notes/meeting.md": { tags: ["work"] } }, // no `type:`
      content: { "notes/meeting.md": "Meeting notes body" },
    });
    const sync = new MirrorSync(app, mirror, null, [], null, null, {
      fullVaultIndex: true,
    });

    const synced = await sync.syncFile(tfile("notes/meeting.md"));
    expect(synced).toBe(true);

    const entity = await mirror.getEntity("notes/meeting.md");
    expect(entity).not.toBeNull();
    expect(entity?.type).toBe("note");
  });

  it("does NOT mirror untyped notes when fullVaultIndex is false (legacy behaviour)", async () => {
    h = await tmpLance();
    const t = await tables(h);
    const mirror = new LanceEntityMirror(t);
    const app = fakeApp({
      frontmatter: { "notes/meeting.md": {} },
      content: { "notes/meeting.md": "just a note" },
    });
    const sync = new MirrorSync(app, mirror, null, [], null, null, {
      fullVaultIndex: false,
    });

    const synced = await sync.syncFile(tfile("notes/meeting.md"));
    expect(synced).toBe(false);
    expect(await mirror.getEntity("notes/meeting.md")).toBeNull();
  });

  it("preserves the explicit type from frontmatter when fullVaultIndex is true", async () => {
    h = await tmpLance();
    const t = await tables(h);
    const mirror = new LanceEntityMirror(t);
    const app = fakeApp({
      frontmatter: { "people/Alice.md": { type: "person" } },
      content: { "people/Alice.md": "Alice content" },
    });
    const sync = new MirrorSync(app, mirror, null, [], null, null, {
      fullVaultIndex: true,
    });

    await sync.syncFile(tfile("people/Alice.md"));
    const entity = await mirror.getEntity("people/Alice.md");
    expect(entity?.type).toBe("person"); // should NOT be overridden to "note"
  });

  it("skips files matching excludeGlobs even when fullVaultIndex is true", async () => {
    h = await tmpLance();
    const t = await tables(h);
    const mirror = new LanceEntityMirror(t);
    const app = fakeApp({
      frontmatter: {
        "templates/weekly.md": {},
        "notes/regular.md": {},
      },
      content: {
        "templates/weekly.md": "template body",
        "notes/regular.md": "regular note",
      },
    });
    const sync = new MirrorSync(app, mirror, null, [], null, null, {
      fullVaultIndex: true,
      excludeGlobs: ["templates"],
    });

    // Template should be excluded
    const skipped = await sync.syncFile(tfile("templates/weekly.md"));
    expect(skipped).toBe(false);
    expect(await mirror.getEntity("templates/weekly.md")).toBeNull();

    // Regular note should be indexed
    const included = await sync.syncFile(tfile("notes/regular.md"));
    expect(included).toBe(true);
    expect(await mirror.getEntity("notes/regular.md")).not.toBeNull();
  });

  it("fullResync with fullVaultIndex counts untyped notes", async () => {
    h = await tmpLance();
    const t = await tables(h);
    const mirror = new LanceEntityMirror(t);
    const app = fakeApp({
      frontmatter: {
        "people/Alice.md": { type: "person" },
        "notes/idea.md": {}, // untyped
        "notes/another.md": {}, // untyped
      },
      content: {
        "people/Alice.md": "a",
        "notes/idea.md": "idea",
        "notes/another.md": "another",
      },
    });
    const sync = new MirrorSync(app, mirror, null, [], null, null, {
      fullVaultIndex: true,
    });

    const n = await sync.fullResync({ embed: false });
    expect(n).toBe(3); // all three should be indexed
  });

  it("excludeGlobs with nested path prefix is matched correctly", async () => {
    h = await tmpLance();
    const t = await tables(h);
    const mirror = new LanceEntityMirror(t);
    const app = fakeApp({
      frontmatter: {
        "archive/2020/old.md": {},
        "archive-notes/keep.md": {}, // should NOT be excluded by "archive" pattern
      },
      content: {
        "archive/2020/old.md": "old stuff",
        "archive-notes/keep.md": "keep this",
      },
    });
    const sync = new MirrorSync(app, mirror, null, [], null, null, {
      fullVaultIndex: true,
      excludeGlobs: ["archive"],
    });

    expect(await sync.syncFile(tfile("archive/2020/old.md"))).toBe(false);
    // "archive-notes" does NOT start with "archive/" so it should pass through
    expect(await sync.syncFile(tfile("archive-notes/keep.md"))).toBe(true);
  });
});
