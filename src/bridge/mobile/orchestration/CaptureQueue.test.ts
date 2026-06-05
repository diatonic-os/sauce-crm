import { describe, it, expect, vi } from "vitest";
import {
  CaptureQueue,
  type QueueStore,
  type QueuedCapture,
  type VaultWriter,
} from "./CaptureQueue";

// ── in-memory fakes ────────────────────────────────────────────────────────

function makeVault(existing: Set<string> = new Set()): VaultWriter & {
  files: Map<string, string>;
} {
  const files = new Map<string, string>();
  for (const p of existing) files.set(p, "");
  return {
    files,
    async write(path: string, contents: string) {
      files.set(path, contents);
    },
    async exists(path: string) {
      return files.has(path);
    },
  };
}

function makeStore(initial: QueuedCapture[] = []): QueueStore & {
  current: QueuedCapture[];
} {
  let current = initial;
  return {
    get current() {
      return current;
    },
    async load() {
      // return a copy so callers mutate their own array, like a real store
      return current.map((c) => ({ ...c }));
    },
    async save(q: QueuedCapture[]) {
      current = q.map((c) => ({ ...c }));
    },
  };
}

// ── tests ───────────────────────────────────────────────────────────────

describe("CaptureQueue", () => {
  it("enqueue writes the markdown to the vault AND records a pending capture", async () => {
    const vault = makeVault();
    const store = makeStore();
    const q = new CaptureQueue({
      vault,
      store,
      now: () => 1000,
      genId: () => "id-1",
    });

    const rec = await q.enqueue("inbox/note.md", "# hi");

    expect(vault.files.get("inbox/note.md")).toBe("# hi");
    expect(rec).toMatchObject({
      id: "id-1",
      path: "inbox/note.md",
      markdown: "# hi",
      ts: 1000,
      synced: false,
    });

    const pending = await q.pending();
    expect(pending).toHaveLength(1);
    expect(pending[0]!.id).toBe("id-1");
  });

  it("writes to the vault BEFORE recording in the store", async () => {
    const order: string[] = [];
    const vault: VaultWriter = {
      async write() {
        order.push("write");
      },
      async exists() {
        return true;
      },
    };
    const store: QueueStore = {
      async load() {
        return [];
      },
      async save() {
        order.push("save");
      },
    };
    const q = new CaptureQueue({ vault, store });
    await q.enqueue("a.md", "x");
    expect(order).toEqual(["write", "save"]);
  });

  it("reconcile marks a capture synced when the file still exists", async () => {
    const vault = makeVault(new Set(["inbox/note.md"]));
    const store = makeStore([
      {
        id: "id-1",
        path: "inbox/note.md",
        markdown: "x",
        ts: 1000,
        synced: false,
      },
    ]);
    const q = new CaptureQueue({ vault, store, now: () => 2000 });

    const kept = await q.reconcile();
    expect(kept[0]!.synced).toBe(true);
    expect(await q.pending()).toHaveLength(0);
  });

  it("reconcile leaves a capture pending when the file is missing", async () => {
    const vault = makeVault(); // empty
    const store = makeStore([
      { id: "id-1", path: "gone.md", markdown: "x", ts: 1000, synced: false },
    ]);
    const q = new CaptureQueue({ vault, store, now: () => 2000 });

    await q.reconcile();
    expect(await q.pending()).toHaveLength(1);
  });

  it("reconcile prunes synced items older than the retention window", async () => {
    const now = 10_000_000_000;
    const retentionMs = 7 * 24 * 60 * 60 * 1000;
    const vault = makeVault(new Set(["old.md", "fresh.md"]));
    const store = makeStore([
      // already synced + old → pruned
      {
        id: "old",
        path: "old.md",
        markdown: "x",
        ts: now - retentionMs - 1,
        synced: true,
      },
      // synced but fresh → kept
      {
        id: "fresh",
        path: "fresh.md",
        markdown: "x",
        ts: now - 1000,
        synced: true,
      },
    ]);
    const q = new CaptureQueue({ vault, store, now: () => now, retentionMs });

    const kept = await q.reconcile();
    expect(kept.map((c) => c.id)).toEqual(["fresh"]);
  });

  it("reconcile does NOT prune an unsynced item even if it is old", async () => {
    const now = 10_000_000_000;
    const retentionMs = 1000;
    const vault = makeVault(); // file missing → stays unsynced
    const store = makeStore([
      {
        id: "old-unsynced",
        path: "gone.md",
        markdown: "x",
        ts: 0,
        synced: false,
      },
    ]);
    const q = new CaptureQueue({ vault, store, now: () => now, retentionMs });

    const kept = await q.reconcile();
    expect(kept.map((c) => c.id)).toEqual(["old-unsynced"]);
  });

  it("pending excludes synced items", async () => {
    const vault = makeVault();
    const store = makeStore([
      { id: "a", path: "a.md", markdown: "x", ts: 1, synced: true },
      { id: "b", path: "b.md", markdown: "y", ts: 2, synced: false },
    ]);
    const q = new CaptureQueue({ vault, store });

    const pending = await q.pending();
    expect(pending.map((c) => c.id)).toEqual(["b"]);
  });

  it("generates unique ids across multiple enqueues by default", async () => {
    const vault = makeVault();
    const store = makeStore();
    const q = new CaptureQueue({ vault, store });

    const r1 = await q.enqueue("a.md", "1");
    const r2 = await q.enqueue("b.md", "2");
    expect(r1.id).not.toBe(r2.id);
    expect(await q.pending()).toHaveLength(2);
  });
});
