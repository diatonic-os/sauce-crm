// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { tmpLance, type TmpLance } from "./_lance-tmp";
import { TABLES } from "../../src/backend/lance/LanceSchema";
import { LanceAuditStore } from "../../src/backend/lance/LanceAuditStore";
import { AuditLog, type AuditHost } from "../../src/security/AuditLog";

const host: AuditHost = {
  async hmacHex(key, msg) {
    return createHmac("sha256", Buffer.from(key)).update(msg).digest("hex");
  },
};
const key = () => Promise.resolve(new Uint8Array([1, 2, 3, 4]));

describe("LanceAuditStore + AuditLog chain", () => {
  let h: TmpLance;
  afterEach(() => h?.cleanup());

  it("appends rows and verifies an intact HMAC chain", async () => {
    h = await tmpLance();
    const log = new AuditLog(
      new LanceAuditStore(await h.table(TABLES.auditLog)),
      host,
      key,
    );

    await log.append({
      ts: 1000,
      op: "write",
      entityId: "people/A.md",
      agentId: null,
      integration: null,
      beforeHash: null,
      afterHash: "h1",
      details: { field: "name" },
    });
    await log.append({
      ts: 2000,
      op: "delete",
      entityId: "people/B.md",
      agentId: "copilot",
      integration: null,
      beforeHash: "h0",
      afterHash: null,
      details: null,
    });
    await log.append({
      ts: 3000,
      op: "integration",
      entityId: null,
      agentId: null,
      integration: "google",
      beforeHash: null,
      afterHash: null,
      details: { synced: 5 },
    });

    const v = await log.verifyChain();
    expect(v.ok).toBe(true);
    expect(v.brokenAt).toBeNull();
  });

  it("verifies across a fresh AuditLog instance (chain rebuilt from storage)", async () => {
    h = await tmpLance();
    const store = new LanceAuditStore(await h.table(TABLES.auditLog));
    const log1 = new AuditLog(store, host, key);
    await log1.append({
      ts: 100,
      op: "write",
      entityId: "x",
      agentId: null,
      integration: null,
      beforeHash: null,
      afterHash: "a",
      details: null,
    });

    // New instance: prevSig is seeded via lastSignature() from storage.
    const log2 = new AuditLog(store, host, key);
    await log2.append({
      ts: 200,
      op: "write",
      entityId: "y",
      agentId: null,
      integration: null,
      beforeHash: null,
      afterHash: "b",
      details: null,
    });

    expect((await log2.verifyChain()).ok).toBe(true);
    expect((await store.allAsc()).map((r) => r.ts)).toEqual([100, 200]);
  });

  it("detects tampering (a flipped stored signature breaks the chain)", async () => {
    h = await tmpLance();
    const table = await h.table(TABLES.auditLog);
    const log = new AuditLog(new LanceAuditStore(table), host, key);
    await log.append({
      ts: 10,
      op: "write",
      entityId: "x",
      agentId: null,
      integration: null,
      beforeHash: null,
      afterHash: "a",
      details: null,
    });
    await log.append({
      ts: 20,
      op: "write",
      entityId: "y",
      agentId: null,
      integration: null,
      beforeHash: null,
      afterHash: "b",
      details: null,
    });

    // Tamper: overwrite the first row's signature with garbage.
    await table.update({ where: "ts = 10", values: { signature: "deadbeef" } });

    const v = await log.verifyChain();
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(10);
  });
});
