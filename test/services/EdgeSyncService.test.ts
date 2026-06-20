import { describe, it, expect } from "vitest";
import { EdgeSyncService } from "../../src/services/EdgeSyncService";

function baseName(p: string): string {
  return (p.split("/").pop() ?? p).replace(/\.md$/i, "");
}

/** Minimal in-memory Obsidian app stub: path → frontmatter. */
function makeApp(files: Record<string, Record<string, unknown>>) {
  const store = new Map<string, Record<string, unknown>>(
    Object.entries(files).map(([p, fm]) => [p, { ...fm }]),
  );
  const tfile = (path: string) => ({ path, basename: baseName(path), extension: "md" });
  return {
    store,
    app: {
      vault: {
        getMarkdownFiles: () => [...store.keys()].map(tfile),
        getAbstractFileByPath: (p: string) => (store.has(p) ? tfile(p) : null),
      },
      metadataCache: {
        getFileCache: (f: { path: string }) => ({ frontmatter: store.get(f.path) }),
      },
      fileManager: {
        processFrontMatter: async (
          f: { path: string },
          fn: (fm: Record<string, unknown>) => void,
        ) => {
          const fm = store.get(f.path);
          if (fm) fn(fm);
        },
      },
    } as never,
  };
}

const entitiesStub = { paths: { people: "people", orgs: "orgs" } } as never;

describe("EdgeSyncService.purgeNode()", () => {
  it("strips a deleted node from peers' symmetric edges, leaving others intact", async () => {
    const { app, store } = makeApp({
      "people/Alice.md": { knows: ["[[Bob]]", "[[Carol]]"], worked_with: ["[[Bob]]"] },
      "people/Carol.md": { knows: ["[[Alice]]"] },
    });
    const svc = new EdgeSyncService(app, entitiesStub);
    await svc.purgeNode("Bob");
    expect(store.get("people/Alice.md")!.knows).toEqual(["[[Carol]]"]);
    expect(store.get("people/Alice.md")!.worked_with).toEqual([]);
    expect(store.get("people/Carol.md")!.knows).toEqual(["[[Alice]]"]); // untouched
  });

  it("does not touch non-symmetric edges (intro_via)", async () => {
    const { app, store } = makeApp({
      "people/Alice.md": { intro_via: "[[Bob]]", knows: ["[[Bob]]"] },
    });
    const svc = new EdgeSyncService(app, entitiesStub);
    await svc.purgeNode("Bob");
    expect(store.get("people/Alice.md")!.intro_via).toBe("[[Bob]]"); // scalar, non-symmetric — kept
    expect(store.get("people/Alice.md")!.knows).toEqual([]);
  });
});

describe("EdgeSyncService.renameNode()", () => {
  it("rewrites the old basename to the new one in peers' symmetric edges", async () => {
    const { app, store } = makeApp({
      "people/Alice.md": { knows: ["[[Bob]]", "[[Carol]]"] },
      "people/Dave.md": { worked_with: ["[[Bob]]"] },
    });
    const svc = new EdgeSyncService(app, entitiesStub);
    await svc.renameNode("Bob", "Robert");
    expect(store.get("people/Alice.md")!.knows).toEqual(["[[Robert]]", "[[Carol]]"]);
    expect(store.get("people/Dave.md")!.worked_with).toEqual(["[[Robert]]"]);
  });

  it("is a no-op when old === new or old is empty", async () => {
    const { app, store } = makeApp({ "people/Alice.md": { knows: ["[[Bob]]"] } });
    const svc = new EdgeSyncService(app, entitiesStub);
    await svc.renameNode("Bob", "Bob");
    expect(store.get("people/Alice.md")!.knows).toEqual(["[[Bob]]"]);
  });
});
