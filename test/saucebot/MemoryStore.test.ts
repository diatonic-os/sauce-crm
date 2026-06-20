// ─────────────────────────────────────────────────────────────────────────────
//  MEMORY STORE TESTS
// ─────────────────────────────────────────────────────────────────────────────
//  Validates: upsert create+replace, recall ranking & zero-score exclusion,
//  recall limit, and forget removal. Uses an in-memory MemoryHost so the suite
//  is pure (no FS, no Obsidian, no lancedb).

import { describe, expect, it } from "vitest";
import type { MemoryHost, MemoryRecord } from "../../src/saucebot/harness/MemoryStore";
import { MemoryStore } from "../../src/saucebot/harness/MemoryStore";

/** Simple in-memory MemoryHost — no persistence, just an array. */
class InMemoryHost implements MemoryHost {
  private records: MemoryRecord[] = [];
  async read(): Promise<MemoryRecord[]> {
    return [...this.records];
  }
  async write(records: MemoryRecord[]): Promise<void> {
    this.records = [...records];
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function makeStore(tick = 0) {
  let t = tick;
  const host = new InMemoryHost();
  const store = new MemoryStore(host, () => t++);
  return { store, host, advanceClock: (n = 1) => { t += n; } };
}

// ── upsert ────────────────────────────────────────────────────────────────────

describe("MemoryStore.upsert", () => {
  it("creates a new record with a generated id when none is provided", async () => {
    const { store } = makeStore();
    const id = await store.upsert({ text: "hello world" });
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);

    const all = await store.all();
    expect(all).toHaveLength(1);
    expect(all[0]?.text).toBe("hello world");
    expect(all[0]?.id).toBe(id);
  });

  it("creates a record with explicit id and tags, and sets ts=now()", async () => {
    const { store } = makeStore(42);
    const id = await store.upsert({ id: "my-id", text: "tagged note", tags: ["alpha", "beta"] });
    expect(id).toBe("my-id");

    const all = await store.all();
    expect(all).toHaveLength(1);
    const rec = all[0]!;
    expect(rec.ts).toBe(42);
    expect(rec.tags).toEqual(["alpha", "beta"]);
  });

  it("replaces an existing record when the same id is upserted again", async () => {
    const { store } = makeStore(10);
    // first insert
    await store.upsert({ id: "dup", text: "original text", tags: ["old"] });
    // second insert with same id but different content
    const id2 = await store.upsert({ id: "dup", text: "updated text", tags: ["new"] });

    expect(id2).toBe("dup");
    const all = await store.all();
    // exactly one record remains
    expect(all).toHaveLength(1);
    expect(all[0]?.text).toBe("updated text");
    expect(all[0]?.tags).toEqual(["new"]);
    // ts should be the second now() value (11 after clock advanced)
    expect(all[0]?.ts).toBe(11);
  });

  it("accumulates multiple distinct records", async () => {
    const { store } = makeStore();
    await store.upsert({ id: "a", text: "apple" });
    await store.upsert({ id: "b", text: "banana" });
    await store.upsert({ id: "c", text: "cherry" });
    const all = await store.all();
    expect(all).toHaveLength(3);
  });
});

// ── recall ─────────────────────────────────────────────────────────────────────

describe("MemoryStore.recall", () => {
  it("ranks results by token overlap and excludes zero-score records", async () => {
    const { store } = makeStore();
    await store.upsert({ id: "low",  text: "the quick brown fox" });
    await store.upsert({ id: "mid",  text: "quick brown" });
    await store.upsert({ id: "high", text: "quick brown dog jumps quick" });
    await store.upsert({ id: "none", text: "completely unrelated zebra" });

    const results = await store.recall("quick brown", 10);

    // "none" must not appear (zero overlap with "quick" or "brown")
    expect(results.map(r => r.id)).not.toContain("none");

    // "high" has the most overlap and should rank first
    expect(results[0]?.id).toBe("high");
    // "low" and "mid" both have 2 overlapping tokens but "low" was inserted
    // at a lower ts; "mid" was inserted later so with equal score mid > low
    expect(results[1]?.id).toBe("mid");
    expect(results[2]?.id).toBe("low");
  });

  it("matches tokens in tags as well as text (case-insensitive)", async () => {
    const { store } = makeStore();
    await store.upsert({ id: "tag-match", text: "unrelated content", tags: ["QUICK", "BROWN"] });
    await store.upsert({ id: "no-match",  text: "totally different stuff" });

    const results = await store.recall("quick brown");
    expect(results.map(r => r.id)).toContain("tag-match");
    expect(results.map(r => r.id)).not.toContain("no-match");
  });

  it("respects the limit parameter", async () => {
    const { store } = makeStore();
    for (let i = 0; i < 10; i++) {
      await store.upsert({ text: `item alpha beta ${i}` });
    }

    const results = await store.recall("alpha beta", 3);
    expect(results).toHaveLength(3);
  });

  it("returns empty array when nothing matches", async () => {
    const { store } = makeStore();
    await store.upsert({ text: "hello world" });
    const results = await store.recall("zzz nonexistent");
    expect(results).toHaveLength(0);
  });

  it("breaks ties by ts descending (most recent first)", async () => {
    const { store } = makeStore(0);
    // Both have exactly 1 token overlap with "apple"
    await store.upsert({ id: "older", text: "apple pie",  tags: [] }); // ts=0
    await store.upsert({ id: "newer", text: "apple juice", tags: [] }); // ts=1

    const results = await store.recall("apple", 2);
    expect(results[0]?.id).toBe("newer");
    expect(results[1]?.id).toBe("older");
  });
});

// ── forget ─────────────────────────────────────────────────────────────────────

describe("MemoryStore.forget", () => {
  it("removes a record by id and returns true", async () => {
    const { store } = makeStore();
    await store.upsert({ id: "to-delete", text: "bye bye" });

    const removed = await store.forget("to-delete");
    expect(removed).toBe(true);

    const all = await store.all();
    expect(all.map(r => r.id)).not.toContain("to-delete");
  });

  it("returns false when the id does not exist", async () => {
    const { store } = makeStore();
    const removed = await store.forget("ghost");
    expect(removed).toBe(false);
  });

  it("leaves other records intact after forget", async () => {
    const { store } = makeStore();
    await store.upsert({ id: "keep", text: "keeper" });
    await store.upsert({ id: "drop", text: "goner" });

    await store.forget("drop");
    const all = await store.all();
    expect(all).toHaveLength(1);
    expect(all[0]?.id).toBe("keep");
  });
});
