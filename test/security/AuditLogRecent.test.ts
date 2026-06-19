// AuditLog.recent — the read API the Audit Log view (S7) probes for. Returns
// the tail of the chain-ordered store, newest first.

import { describe, expect, it } from "vitest";
import {
  AuditLog,
  type IAuditStore,
  type AuditHost,
  type StoredAuditRow,
} from "../../src/security/AuditLog";

function row(ts: number): StoredAuditRow {
  return {
    ts,
    op: "skill",
    entityId: null,
    agentId: null,
    integration: null,
    beforeHash: null,
    afterHash: null,
    details: null,
    signature: `sig-${ts}`,
  };
}

function fakeStore(rows: StoredAuditRow[]): IAuditStore {
  return {
    append: async () => {},
    allAsc: async () => rows,
    lastSignature: async () => rows.at(-1)?.signature ?? null,
  };
}

const host: AuditHost = { hmacHex: async () => "x" };

describe("AuditLog.recent", () => {
  it("returns the newest n rows, newest first", async () => {
    const log = new AuditLog(
      fakeStore([row(1), row(2), row(3), row(4), row(5)]),
      host,
      async () => new Uint8Array([1]),
    );
    const recent = await log.recent(3);
    expect(recent.map((r) => r.ts)).toEqual([5, 4, 3]);
  });

  it("returns all rows (newest first) when n exceeds the count", async () => {
    const log = new AuditLog(
      fakeStore([row(10), row(20)]),
      host,
      async () => new Uint8Array([1]),
    );
    expect((await log.recent(99)).map((r) => r.ts)).toEqual([20, 10]);
  });

  it("returns an empty array for an empty store", async () => {
    const log = new AuditLog(
      fakeStore([]),
      host,
      async () => new Uint8Array([1]),
    );
    expect(await log.recent(5)).toEqual([]);
  });
});

describe("AuditLog.append — auto-filled agent id + timestamp", () => {
  function capturingStore(): { store: IAuditStore; written: StoredAuditRow[] } {
    const written: StoredAuditRow[] = [];
    return {
      written,
      store: {
        append: async (r) => {
          written.push(r);
        },
        allAsc: async () => written,
        lastSignature: async () => written.at(-1)?.signature ?? null,
      },
    };
  }

  it("auto-fills agentId from the actor when the caller passes null", async () => {
    const { store, written } = capturingStore();
    const log = new AuditLog(store, host, async () => new Uint8Array([1]));
    log.setActor(() => "sauce-crm/lmstudio:qwen3.5-9b");
    const out = await log.append({
      ts: 100,
      op: "skill",
      entityId: "people/alice.md",
      agentId: null,
      integration: null,
      beforeHash: null,
      afterHash: null,
      details: null,
    });
    expect(out.agentId).toBe("sauce-crm/lmstudio:qwen3.5-9b");
    expect(written[0]!.agentId).toBe("sauce-crm/lmstudio:qwen3.5-9b");
    expect(written[0]!.entityId).toBe("people/alice.md");
  });

  it("keeps an explicit agentId and defaults a missing timestamp", async () => {
    const { store, written } = capturingStore();
    const log = new AuditLog(store, host, async () => new Uint8Array([1]));
    log.setActor(() => "auto");
    const out = await log.append({
      ts: 0, // missing → auto-filled to now
      op: "write",
      entityId: "x",
      agentId: "explicit-agent",
      integration: null,
      beforeHash: null,
      afterHash: null,
      details: null,
    });
    expect(out.agentId).toBe("explicit-agent"); // explicit wins over actor
    expect(written[0]!.ts).toBeGreaterThan(0);
  });

  it("the signature covers the auto-filled agentId (chain verifies)", async () => {
    // Real HMAC so the chain is meaningful; agentId is part of the payload.
    const realHost: AuditHost = {
      hmacHex: async (_k, msg) => {
        let h = 0;
        for (let i = 0; i < msg.length; i++)
          h = (h * 31 + msg.charCodeAt(i)) >>> 0;
        return h.toString(16);
      },
    };
    const { store } = capturingStore();
    const log = new AuditLog(store, realHost, async () => new Uint8Array([1]));
    log.setActor(() => "sauce-crm/agent");
    await log.append({
      ts: 1,
      op: "skill",
      entityId: "e",
      agentId: null,
      integration: null,
      beforeHash: null,
      afterHash: null,
      details: null,
    });
    expect((await log.verifyChain()).ok).toBe(true);
  });
});
