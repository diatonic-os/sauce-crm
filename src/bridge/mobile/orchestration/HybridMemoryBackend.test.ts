import { describe, it, expect, vi } from "vitest";
import {
  BridgeError,
  type BackendMode,
  type EmbedResult,
  type MemoryBackend,
  type MemoryHit,
  type MemoryQuery,
  type ReachabilityProbe,
} from "../../contract";
import type { ProvenanceRecord } from "../../../services/Provenance";
import { HybridMemoryBackend } from "./HybridMemoryBackend";

// ── fakes ────────────────────────────────────────────────────────────────

class FakeBackend implements MemoryBackend {
  constructor(
    readonly mode: BackendMode,
    private readonly impl: Partial<MemoryBackend> = {},
    private readyVal = true,
  ) {}
  semanticSearch(q: MemoryQuery): Promise<MemoryHit[]> {
    return this.impl.semanticSearch ? this.impl.semanticSearch(q) : Promise.resolve([]);
  }
  recall(q: string, k?: number): Promise<MemoryHit[]> {
    return this.impl.recall ? this.impl.recall(q, k) : Promise.resolve([]);
  }
  embed(text: string, fp: string): Promise<EmbedResult | null> {
    return this.impl.embed ? this.impl.embed(text, fp) : Promise.resolve(null);
  }
  provenance(fp: string): Promise<ProvenanceRecord[]> {
    return this.impl.provenance ? this.impl.provenance(fp) : Promise.resolve([]);
  }
  ready(): Promise<boolean> {
    return Promise.resolve(this.readyVal);
  }
}

class FakeProbe implements ReachabilityProbe {
  constructor(private reachable: boolean) {}
  isReachable(): Promise<boolean> {
    return Promise.resolve(this.reachable);
  }
  lastKnown(): boolean | null {
    return this.reachable;
  }
}

const bridgeHit: MemoryHit = { path: "b.md", score: 0.9, fp: "fp-b" };
const localHit: MemoryHit = { path: "l.md", score: 0.5, fp: "fp-l", degraded: true };

// ── tests ────────────────────────────────────────────────────────────────

describe("HybridMemoryBackend", () => {
  it("has mode 'hybrid'", () => {
    const h = new HybridMemoryBackend({
      bridge: new FakeBackend("bridge"),
      local: new FakeBackend("local"),
      probe: new FakeProbe(true),
    });
    expect(h.mode).toBe("hybrid");
  });

  it("uses bridge when reachable AND bridge.ready()", async () => {
    const bridge = new FakeBackend(
      "bridge",
      { semanticSearch: async () => [bridgeHit], recall: async () => [bridgeHit] },
      true,
    );
    const local = new FakeBackend(
      "local",
      { semanticSearch: async () => [localHit] },
      true,
    );
    const localSpy = vi.spyOn(local, "semanticSearch");

    const h = new HybridMemoryBackend({ bridge, local, probe: new FakeProbe(true) });

    expect(await h.semanticSearch({ query: "x" })).toEqual([bridgeHit]);
    expect(localSpy).not.toHaveBeenCalled();
  });

  it("falls back to local when bridge throws a transient BridgeError (unreachable)", async () => {
    const bridge = new FakeBackend(
      "bridge",
      {
        semanticSearch: async () => {
          throw new BridgeError("unreachable", "no route");
        },
      },
      true,
    );
    const local = new FakeBackend("local", { semanticSearch: async () => [localHit] }, true);

    const h = new HybridMemoryBackend({ bridge, local, probe: new FakeProbe(true) });

    const hits = await h.semanticSearch({ query: "x" });
    expect(hits).toEqual([localHit]);
    expect(hits[0]!.degraded).toBe(true); // degraded flag preserved
  });

  it("falls back on timeout and server-error too", async () => {
    for (const code of ["timeout", "server-error"] as const) {
      const bridge = new FakeBackend(
        "bridge",
        {
          recall: async () => {
            throw new BridgeError(code, code);
          },
        },
        true,
      );
      const local = new FakeBackend("local", { recall: async () => [localHit] }, true);
      const h = new HybridMemoryBackend({ bridge, local, probe: new FakeProbe(true) });
      expect(await h.recall("q")).toEqual([localHit]);
    }
  });

  it("propagates a non-transient BridgeError (does NOT fall back)", async () => {
    const bridge = new FakeBackend(
      "bridge",
      {
        semanticSearch: async () => {
          throw new BridgeError("unauthorized", "bad sig");
        },
      },
      true,
    );
    const local = new FakeBackend("local", { semanticSearch: async () => [localHit] }, true);
    const localSpy = vi.spyOn(local, "semanticSearch");

    const h = new HybridMemoryBackend({ bridge, local, probe: new FakeProbe(true) });

    await expect(h.semanticSearch({ query: "x" })).rejects.toThrow(BridgeError);
    expect(localSpy).not.toHaveBeenCalled();
  });

  it("goes straight to local when not reachable (bridge untouched)", async () => {
    const bridge = new FakeBackend("bridge", { semanticSearch: async () => [bridgeHit] }, true);
    const local = new FakeBackend("local", { semanticSearch: async () => [localHit] }, true);
    const bridgeSpy = vi.spyOn(bridge, "semanticSearch");

    const h = new HybridMemoryBackend({ bridge, local, probe: new FakeProbe(false) });

    expect(await h.semanticSearch({ query: "x" })).toEqual([localHit]);
    expect(bridgeSpy).not.toHaveBeenCalled();
  });

  it("uses local when reachable but bridge NOT ready", async () => {
    const bridge = new FakeBackend("bridge", { recall: async () => [bridgeHit] }, false);
    const local = new FakeBackend("local", { recall: async () => [localHit] }, true);
    const bridgeSpy = vi.spyOn(bridge, "recall");

    const h = new HybridMemoryBackend({ bridge, local, probe: new FakeProbe(true) });

    expect(await h.recall("q")).toEqual([localHit]);
    expect(bridgeSpy).not.toHaveBeenCalled();
  });

  it("embed via local returns null when offline (passed through)", async () => {
    const bridge = new FakeBackend("bridge", {}, true);
    const local = new FakeBackend("local", { embed: async () => null }, true);
    const h = new HybridMemoryBackend({ bridge, local, probe: new FakeProbe(false) });
    expect(await h.embed("text", "fp1")).toBeNull();
  });

  it("provenance routes through bridge when reachable+ready", async () => {
    const rec: ProvenanceRecord[] = [
      { fp: "fp1", op: "test", subject: "", kind: "note", ts: 0, parentFp: "", meta: null, signature: "" },
    ];
    const bridge = new FakeBackend("bridge", { provenance: async () => rec }, true);
    const local = new FakeBackend("local", { provenance: async () => [] }, true);
    const h = new HybridMemoryBackend({ bridge, local, probe: new FakeProbe(true) });
    expect(await h.provenance("fp1")).toBe(rec);
  });

  it("ready() is true if EITHER backend is ready", async () => {
    const h1 = new HybridMemoryBackend({
      bridge: new FakeBackend("bridge", {}, false),
      local: new FakeBackend("local", {}, true),
      probe: new FakeProbe(false),
    });
    expect(await h1.ready()).toBe(true);

    const h2 = new HybridMemoryBackend({
      bridge: new FakeBackend("bridge", {}, true),
      local: new FakeBackend("local", {}, false),
      probe: new FakeProbe(true),
    });
    expect(await h2.ready()).toBe(true);
  });

  it("ready() is false only when BOTH backends are not ready", async () => {
    const h = new HybridMemoryBackend({
      bridge: new FakeBackend("bridge", {}, false),
      local: new FakeBackend("local", {}, false),
      probe: new FakeProbe(false),
    });
    expect(await h.ready()).toBe(false);
  });
});
