// @vitest-environment node
import { afterEach, describe, expect, it } from "vitest";
import { createHash, createHmac } from "node:crypto";
import { tmpLance, type TmpLance } from "./_lance-tmp";
import { TABLES } from "../../src/backend/lance/LanceSchema";
import { LanceProvenanceStore } from "../../src/backend/lance/LanceProvenanceStore";
import { ProvenanceService, type ProvenanceCrypto } from "../../src/services/Provenance";

const crypto: ProvenanceCrypto = {
  async sha256Hex(data) { return createHash("sha256").update(data).digest("hex"); },
  async hmacHex(key, msg) { return createHmac("sha256", Buffer.from(key)).update(msg).digest("hex"); },
};
const key = () => Promise.resolve(new Uint8Array([7, 7, 7, 7]));

describe("ProvenanceService + LanceProvenanceStore", () => {
  let h: TmpLance;
  afterEach(() => h?.cleanup());

  async function svc(audit: Parameters<typeof ProvenanceService.prototype.constructor>[3] = null) {
    h = await tmpLance();
    const store = new LanceProvenanceStore(await h.table(TABLES.provenance));
    return { store, prov: new ProvenanceService(store, crypto, key, audit ?? null) };
  }

  it("fingerprints deterministically (SHA-256 hex)", async () => {
    const { prov } = await svc();
    const a = await prov.fingerprint("hello world");
    const b = await prov.fingerprint("hello world");
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it("records a signed provenance row and verifies it", async () => {
    const { prov } = await svc();
    const rec = await prov.record("ingest", "people/A.md", "entity", "Alice profile body");
    expect(rec.fp).toHaveLength(64);
    expect(rec.signature).toHaveLength(64);
    expect(await prov.verify(rec.fp)).toBe(true);
  });

  it("links lineage via parentFp (chunk ← document)", async () => {
    const { prov } = await svc();
    const doc = await prov.record("harvest", "doc:report.pdf", "document", "full document text");
    const chunk = await prov.record("embed", "chunk:report.pdf#0", "chunk", "chunk text", { parentFp: doc.fp });

    const chain = await prov.lineage(chunk.fp);
    expect(chain.map((r) => r.kind)).toEqual(["chunk", "document"]);
    expect(chain[0].parentFp).toBe(doc.fp);
  });

  it("returns all provenance for a subject in ts order", async () => {
    const { prov } = await svc();
    await prov.record("ingest", "people/B.md", "entity", "v1");
    await prov.record("index", "people/B.md", "entity", "v1");
    const rows = await prov.bySubject("people/B.md");
    expect(rows.map((r) => r.op)).toEqual(["ingest", "index"]);
  });

  it("verify() fails when a stored signature is tampered", async () => {
    h = await tmpLance();
    const table = await h.table(TABLES.provenance);
    const prov = new ProvenanceService(new LanceProvenanceStore(table), crypto, key, null);
    const rec = await prov.record("query", "q:who-knows-bob", "query", "who knows bob?");

    await table.update({ where: `fp = '${rec.fp}'`, values: { signature: "tampered" } });
    expect(await prov.verify(rec.fp)).toBe(false);
  });

  it("mirrors high-level ops to the AuditLog sink when provided", async () => {
    const calls: { op: string; afterHash: string | null }[] = [];
    const auditSink = { append: async (row: { op: string; afterHash: string | null }) => { calls.push(row); } };
    const { prov } = await svc(auditSink as never);
    const rec = await prov.record("enrich", "people/C.md", "entity", "enriched body");
    expect(calls).toHaveLength(1);
    expect(calls[0].op).toBe("provenance");
    expect(calls[0].afterHash).toBe(rec.fp);
  });
});
