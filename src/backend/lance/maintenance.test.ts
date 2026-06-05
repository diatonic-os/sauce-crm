import { describe, it, expect } from "vitest";
import { writeFileSync, mkdtempSync, mkdirSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { withTimeout, dirSizeBounded, compactConnection } from "./maintenance";
import type { LanceConnection } from "./LanceConnection";

describe("withTimeout", () => {
  it("resolves when the promise settles before the deadline", async () => {
    await expect(withTimeout(Promise.resolve(42), 1000, "x")).resolves.toBe(42);
  });

  it("rejects with a timeout error when the promise hangs", async () => {
    const never = new Promise<number>(() => {});
    await expect(withTimeout(never, 20, "hang")).rejects.toThrow(
      /lance hang: timed out after 20ms/,
    );
  });

  it("propagates the original rejection (not the timeout)", async () => {
    await expect(
      withTimeout(Promise.reject(new Error("boom")), 1000, "x"),
    ).rejects.toThrow("boom");
  });
});

describe("dirSizeBounded", () => {
  it("sums file sizes under a directory tree", () => {
    const dir = mkdtempSync(join(tmpdir(), "lance-size-"));
    writeFileSync(join(dir, "a.bin"), Buffer.alloc(1000));
    mkdirSync(join(dir, "sub"));
    writeFileSync(join(dir, "sub", "b.bin"), Buffer.alloc(500));
    expect(dirSizeBounded(dir, 1024 * 1024)).toBe(1500);
  });

  it("short-circuits once the cap is reached (returns >= cap)", () => {
    const dir = mkdtempSync(join(tmpdir(), "lance-cap-"));
    for (let i = 0; i < 5; i++)
      writeFileSync(join(dir, `f${i}.bin`), Buffer.alloc(1000));
    const total = dirSizeBounded(dir, 2500);
    expect(total).toBeGreaterThanOrEqual(2500); // stopped early, didn't sum all 5000
  });

  it("returns 0 for a missing directory (no throw)", () => {
    expect(dirSizeBounded("/nonexistent/path/xyz", 1000)).toBe(0);
  });
});

describe("compactConnection", () => {
  function fakeDb(
    tableNames: string[],
    behavior: (name: string) => Promise<unknown> = () => Promise.resolve({}),
  ): { db: LanceConnection; optimized: string[] } {
    const optimized: string[] = [];
    const db = {
      tableNames: async () => tableNames,
      openTable: async (name: string) => ({
        optimize: async (_opts?: unknown) => {
          await behavior(name);
          optimized.push(name);
          return {};
        },
      }),
    } as unknown as LanceConnection;
    return { db, optimized };
  }

  it("optimizes every table and reports counts", async () => {
    const { db, optimized } = fakeDb(["entities", "edges", "tags"]);
    const r = await compactConnection(db, { perTableTimeoutMs: 1000 });
    expect(r).toEqual({ optimized: 3, failed: 0, tables: 3 });
    expect(optimized.sort()).toEqual(["edges", "entities", "tags"]);
  });

  it("counts a failing table as failed without aborting the rest", async () => {
    const { db } = fakeDb(["good1", "bad", "good2"], (name) =>
      name === "bad" ? Promise.reject(new Error("nope")) : Promise.resolve({}),
    );
    const r = await compactConnection(db, { perTableTimeoutMs: 1000 });
    expect(r).toEqual({ optimized: 2, failed: 1, tables: 3 });
  });

  it("returns zeroes when the table list itself is unavailable", async () => {
    const db = {
      tableNames: async () => {
        throw new Error("conn dead");
      },
    } as unknown as LanceConnection;
    const r = await compactConnection(db);
    expect(r).toEqual({ optimized: 0, failed: 0, tables: 0 });
  });
});
