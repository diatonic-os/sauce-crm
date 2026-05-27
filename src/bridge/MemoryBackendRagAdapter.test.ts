// MOB-BRIDGE-001 · S9 tests — MemoryBackendRagAdapter.
//
// Verifies that the mobile SauceBot's semantic search resolves through the
// bridge memory backend (mock): a mobile query reaches the BridgeMemoryBackend's
// semanticSearch → recall, and the output is mapped to the SemanticResult shape
// the RagAssemblerHost.semantic() contract expects.
//
// All collaborators are injected fakes. No network, no Obsidian, no LanceDB.

import { describe, it, expect } from "vitest";
import {
  MemoryBackendRagAdapter,
  type SemanticResult,
} from "./MemoryBackendRagAdapter";
import type {
  MemoryBackend,
  MemoryHit,
  MemoryQuery,
  EmbedResult,
  BackendMode,
} from "./contract";
import type { ProvenanceRecord } from "../services/Provenance";

// ── Fakes ────────────────────────────────────────────────────────────────────

interface CallLog {
  method: "semanticSearch" | "recall" | "embed" | "provenance" | "ready";
  args: unknown[];
}

/** Scriptable MemoryBackend fake. Simulates the mobile HybridMemoryBackend that
 *  delegates to a BridgeMemoryBackend when the desktop is reachable. */
function makeMockBackend(opts: {
  mode?: BackendMode;
  hits?: MemoryHit[];
  recallHits?: MemoryHit[];
  readyResult?: boolean;
  throwSearch?: boolean;
}): { backend: MemoryBackend; calls: CallLog[] } {
  const calls: CallLog[] = [];
  const hits = opts.hits ?? [];
  const recallHits = opts.recallHits ?? hits;

  const backend: MemoryBackend = {
    mode: opts.mode ?? "hybrid",

    async semanticSearch(q: MemoryQuery): Promise<MemoryHit[]> {
      calls.push({ method: "semanticSearch", args: [q] });
      if (opts.throwSearch) throw new Error("bridge unreachable");
      return hits;
    },

    async recall(q: string, k?: number): Promise<MemoryHit[]> {
      calls.push({ method: "recall", args: [q, k] });
      return recallHits;
    },

    async embed(text: string, fp: string): Promise<EmbedResult | null> {
      calls.push({ method: "embed", args: [text, fp] });
      return null;
    },

    async provenance(fp: string): Promise<ProvenanceRecord[]> {
      calls.push({ method: "provenance", args: [fp] });
      return [];
    },

    async ready(): Promise<boolean> {
      calls.push({ method: "ready", args: [] });
      return opts.readyResult ?? true;
    },
  };

  return { backend, calls };
}

/** A realistic MemoryHit as the BridgeMemoryBackend returns from the desktop. */
function makeBridgeHit(
  path: string,
  score: number,
  degraded = false,
): MemoryHit {
  return {
    path,
    score,
    fp: `fp:${path}`,
    snippet: `excerpt from ${path}`,
    degraded,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("MemoryBackendRagAdapter", () => {
  // ── Core routing ──────────────────────────────────────────────────────────

  it("semantic() delegates to backend.semanticSearch with query and topK", async () => {
    const { backend, calls } = makeMockBackend({
      hits: [makeBridgeHit("People/Alice.md", 0.9)],
    });
    const adapter = new MemoryBackendRagAdapter(backend);

    const results = await adapter.semantic("Alice CRM update", 5);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.method).toBe("semanticSearch");
    expect((calls[0]!.args[0] as MemoryQuery).query).toBe("Alice CRM update");
    expect((calls[0]!.args[0] as MemoryQuery).k).toBe(5);
    expect(results).toHaveLength(1);
  });

  it("mobile query resolves via the bridge memory backend (mock hybrid backend)", async () => {
    // Simulate the mobile HybridMemoryBackend: mode='hybrid', hits come from
    // the bridge (BridgeMemoryBackend → desktop LanceMemoryBackend).
    const bridgeHits: MemoryHit[] = [
      makeBridgeHit("Contacts/Bob.md", 0.88),
      makeBridgeHit("Companies/Acme.md", 0.74),
    ];
    const { backend, calls } = makeMockBackend({
      mode: "hybrid",
      hits: bridgeHits,
    });
    const adapter = new MemoryBackendRagAdapter(backend);

    const results = await adapter.semantic("follow up with Bob", 8);

    expect(calls[0]!.method).toBe("semanticSearch");
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject<SemanticResult>({
      path: "Contacts/Bob.md",
      score: 0.88,
      snippet: "excerpt from Contacts/Bob.md",
      degraded: false,
    });
    expect(results[1]).toMatchObject<SemanticResult>({
      path: "Companies/Acme.md",
      score: 0.74,
    });
  });

  it("maps degraded=true (lexical fallback) through to SemanticResult", async () => {
    const lexicalHits: MemoryHit[] = [
      makeBridgeHit("Notes/plain.md", 0.5, true),
    ];
    const { backend } = makeMockBackend({ hits: lexicalHits });
    const adapter = new MemoryBackendRagAdapter(backend);

    const results = await adapter.semantic("plain notes", 3);

    expect(results[0]!.degraded).toBe(true);
    expect(results[0]!.path).toBe("Notes/plain.md");
  });

  // ── Recall ────────────────────────────────────────────────────────────────

  it("recall() delegates to backend.recall and maps hits", async () => {
    const recallHits = [makeBridgeHit("Addenda/2024-01-01.md", 0.7)];
    const { backend, calls } = makeMockBackend({ recallHits });
    const adapter = new MemoryBackendRagAdapter(backend);

    const results = await adapter.recall("recent touch with Alice", 4);

    expect(calls[0]!.method).toBe("recall");
    expect(calls[0]!.args).toEqual(["recent touch with Alice", 4]);
    expect(results).toHaveLength(1);
    expect(results[0]!.path).toBe("Addenda/2024-01-01.md");
  });

  // ── Gap-safety: null backend ──────────────────────────────────────────────

  it("semantic() returns [] when backend is null (default-off safety)", async () => {
    const adapter = new MemoryBackendRagAdapter(null);
    const results = await adapter.semantic("anything", 5);
    expect(results).toEqual([]);
  });

  it("recall() returns [] when backend is null", async () => {
    const adapter = new MemoryBackendRagAdapter(null);
    const results = await adapter.recall("cue");
    expect(results).toEqual([]);
  });

  it("ready() returns false when backend is null", async () => {
    const adapter = new MemoryBackendRagAdapter(null);
    expect(await adapter.ready()).toBe(false);
  });

  // ── Gap-safety: backend throws ────────────────────────────────────────────

  it("semantic() returns [] when backend.semanticSearch throws (bridge unreachable)", async () => {
    const { backend } = makeMockBackend({ throwSearch: true });
    const adapter = new MemoryBackendRagAdapter(backend);

    const results = await adapter.semantic("query during outage", 5);

    // Should not throw; caller falls through to its own lexical path.
    expect(results).toEqual([]);
  });

  it("ready() returns false when backend.ready() throws", async () => {
    const backend: MemoryBackend = {
      mode: "bridge",
      semanticSearch: async () => [],
      recall: async () => [],
      embed: async () => null,
      provenance: async () => [],
      ready: async () => {
        throw new Error("probe failed");
      },
    };
    const adapter = new MemoryBackendRagAdapter(backend);
    expect(await adapter.ready()).toBe(false);
  });

  // ── currentBackend accessor ───────────────────────────────────────────────

  it("currentBackend exposes the injected backend", () => {
    const { backend } = makeMockBackend({});
    const adapter = new MemoryBackendRagAdapter(backend);
    expect(adapter.currentBackend).toBe(backend);
  });

  it("currentBackend is null when null is injected", () => {
    const adapter = new MemoryBackendRagAdapter(null);
    expect(adapter.currentBackend).toBeNull();
  });

  // ── SemanticResult shape ──────────────────────────────────────────────────

  it("maps all MemoryHit fields to SemanticResult: path, score, snippet, degraded", async () => {
    const hit: MemoryHit = {
      path: "Projects/Q1.md",
      score: 0.95,
      fp: "fp:abc123",
      snippet: "Q1 kickoff notes",
      degraded: false,
    };
    const { backend } = makeMockBackend({ hits: [hit] });
    const adapter = new MemoryBackendRagAdapter(backend);

    const results2 = await adapter.semantic("Q1", 1);
    const r = results2[0]!; // test sets up exactly 1 hit

    expect(r.path).toBe("Projects/Q1.md");
    expect(r.score).toBe(0.95);
    expect(r.snippet).toBe("Q1 kickoff notes");
    expect(r.degraded).toBe(false);
  });

  it("omits snippet when the hit has none", async () => {
    const hit: MemoryHit = { path: "x.md", score: 0.5, fp: "fp:x" };
    const { backend } = makeMockBackend({ hits: [hit] });
    const adapter = new MemoryBackendRagAdapter(backend);

    const r = (await adapter.semantic("x", 1))[0]!; // test sets up exactly 1 hit
    expect(r.snippet).toBeUndefined();
  });
});
