// MOB-BRIDGE-001 · T-A — unit specs for the desktop LanceDB adapter. All deps
// are plain fakes; NO real LanceDB is ever instantiated.

import { describe, expect, it, vi } from "vitest";
import {
  LanceMemoryBackend,
  type LanceMemoryBackendDeps,
  type VectorIndexLike,
} from "./LanceMemoryBackend";
import type { VectorHit } from "../../backend/lance/LanceVectorIndex";
import type { ProvenanceRecord } from "../../services/Provenance";

function fakeVectorIndex(opts: {
  hits?: VectorHit[];
  empty?: boolean;
  emptyThrows?: boolean;
}): VectorIndexLike & {
  queryCalls: Array<{ vector: number[]; limit: number }>;
} {
  const queryCalls: Array<{ vector: number[]; limit: number }> = [];
  return {
    queryCalls,
    async query(vector, limit) {
      queryCalls.push({ vector, limit });
      return opts.hits ?? [];
    },
    async isEmpty() {
      if (opts.emptyThrows) throw new Error("store unavailable");
      return opts.empty ?? false;
    },
  };
}

function makeBackend(
  overrides: Partial<LanceMemoryBackendDeps> = {},
): LanceMemoryBackend {
  const deps: LanceMemoryBackendDeps = {
    vectorIndex: fakeVectorIndex({}),
    provenanceStore: { byFingerprint: async () => [] },
    embedFn: async () => [0.1, 0.2, 0.3],
    ...overrides,
  };
  return new LanceMemoryBackend(deps);
}

describe("LanceMemoryBackend", () => {
  it("reports mode lance-desktop", () => {
    expect(makeBackend().mode).toBe("lance-desktop");
  });

  describe("semanticSearch", () => {
    it("returns [] and does not query when embed yields null", async () => {
      const vectorIndex = fakeVectorIndex({
        hits: [{ id: "a", distance: 0.1 }],
      });
      const backend = makeBackend({ vectorIndex, embedFn: async () => null });
      const hits = await backend.semanticSearch({ query: "anything" });
      expect(hits).toEqual([]);
      expect(vectorIndex.queryCalls).toHaveLength(0);
    });

    it("maps VectorHit → MemoryHit using the raw id when no resolver is given", async () => {
      const vectorIndex = fakeVectorIndex({
        hits: [
          { id: "entity-1", distance: 0.05 },
          { id: "entity-2", distance: 0.42 },
        ],
      });
      const backend = makeBackend({ vectorIndex });
      const hits = await backend.semanticSearch({ query: "find me" });
      expect(hits).toEqual([
        {
          path: "entity-1",
          fp: "entity-1",
          score: 0.05,
          snippet: undefined,
          degraded: false,
        },
        {
          path: "entity-2",
          fp: "entity-2",
          score: 0.42,
          snippet: undefined,
          degraded: false,
        },
      ]);
    });

    it("uses resolveHit to fill path/fp/snippet when provided", async () => {
      const vectorIndex = fakeVectorIndex({
        hits: [{ id: "entity-1", distance: 0.9 }],
      });
      const backend = makeBackend({
        vectorIndex,
        resolveHit: (id) =>
          id === "entity-1"
            ? {
                path: "People/Alice.md",
                fp: "fp-alice",
                snippet: "hello world",
              }
            : null,
      });
      const hits = await backend.semanticSearch({ query: "alice" });
      expect(hits).toEqual([
        {
          path: "People/Alice.md",
          fp: "fp-alice",
          score: 0.9,
          snippet: "hello world",
          degraded: false,
        },
      ]);
    });

    it("falls back to raw id when resolveHit returns null", async () => {
      const vectorIndex = fakeVectorIndex({
        hits: [{ id: "orphan", distance: 0.3 }],
      });
      const backend = makeBackend({ vectorIndex, resolveHit: () => null });
      const hits = await backend.semanticSearch({ query: "q" });
      expect(hits[0]!.path).toBe("orphan");
      expect(hits[0]!.fp).toBe("orphan");
      expect(hits[0]!.degraded).toBe(false);
    });

    it("passes k through to the vector index as the limit (default 10)", async () => {
      const withK = fakeVectorIndex({});
      await makeBackend({ vectorIndex: withK }).semanticSearch({
        query: "q",
        k: 3,
      });
      expect(withK.queryCalls[0]!.limit).toBe(3);

      const noK = fakeVectorIndex({});
      await makeBackend({ vectorIndex: noK }).semanticSearch({ query: "q" });
      expect(noK.queryCalls[0]!.limit).toBe(10);
    });
  });

  describe("recall", () => {
    it("aliases semanticSearch with the same query and k", async () => {
      const vectorIndex = fakeVectorIndex({
        hits: [{ id: "x", distance: 0.2 }],
      });
      const backend = makeBackend({ vectorIndex });
      const hits = await backend.recall("cue text", 5);
      expect(vectorIndex.queryCalls[0]!.limit).toBe(5);
      expect(hits[0]!.path).toBe("x");
    });
  });

  describe("embed", () => {
    it("returns null when embedFn yields null", async () => {
      const backend = makeBackend({ embedFn: async () => null });
      expect(await backend.embed("text", "fp-1")).toBeNull();
    });

    it("reports {fp, dim, cached:false} with dim from the vector length", async () => {
      const backend = makeBackend({ embedFn: async () => [1, 2, 3, 4, 5] });
      const res = await backend.embed("some text", "fp-7");
      expect(res).toEqual({ fp: "fp-7", dim: 5, cached: false });
    });
  });

  describe("provenance", () => {
    it("passes through to provenanceStore.byFingerprint", async () => {
      const records: ProvenanceRecord[] = [
        {
          fp: "fp-9",
          op: "embed",
          subject: "People/Bob.md",
          kind: "note",
          ts: 123,
          parentFp: "",
          meta: null,
          signature: "sig",
        },
      ];
      const byFingerprint = vi.fn(async () => records);
      const backend = makeBackend({ provenanceStore: { byFingerprint } });
      const out = await backend.provenance("fp-9");
      expect(byFingerprint).toHaveBeenCalledWith("fp-9");
      expect(out).toBe(records);
    });
  });

  describe("ready", () => {
    it("is true when the index is non-empty", async () => {
      const backend = makeBackend({
        vectorIndex: fakeVectorIndex({ empty: false }),
      });
      expect(await backend.ready()).toBe(true);
    });

    it("is false when the index is empty", async () => {
      const backend = makeBackend({
        vectorIndex: fakeVectorIndex({ empty: true }),
      });
      expect(await backend.ready()).toBe(false);
    });

    it("is true (defensive) when isEmpty throws", async () => {
      const backend = makeBackend({
        vectorIndex: fakeVectorIndex({ emptyThrows: true }),
      });
      expect(await backend.ready()).toBe(true);
    });
  });
});
