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
    const log = new AuditLog(fakeStore([]), host, async () => new Uint8Array([1]));
    expect(await log.recent(5)).toEqual([]);
  });
});
