// LanceDB-backed IAuditStore. The HMAC chain ordering is by `ts`; we sort in
// JS rather than relying on storage order (LanceDB scans are unordered). Audit
// volumes are small (one row per mutating op) so a full scan + sort is fine.

import type { IAuditStore, StoredAuditRow } from "../../security/AuditLog";
import { type AuditRowStored } from "./LanceSchema";
import type { LanceTable } from "./LanceConnection";

function toStored(r: StoredAuditRow): AuditRowStored {
  return {
    ts: r.ts,
    op: r.op,
    entity_id: r.entityId ?? "",
    agent_id: r.agentId ?? "",
    integration: r.integration ?? "",
    before_hash: r.beforeHash ?? "",
    after_hash: r.afterHash ?? "",
    details: r.details ?? "null",
    signature: r.signature,
  };
}

function fromStored(r: AuditRowStored): StoredAuditRow {
  // Empty strings are how we encode SQL NULL on the wire; map back to null so
  // the HMAC payload (which uses `?? ''`) reproduces the original signature.
  const orNull = (s: string): string | null => (s === "" ? null : s);
  return {
    ts: r.ts,
    op: r.op,
    entityId: orNull(r.entity_id),
    agentId: orNull(r.agent_id),
    integration: orNull(r.integration),
    beforeHash: orNull(r.before_hash),
    afterHash: orNull(r.after_hash),
    details: r.details === "null" ? null : r.details,
    signature: r.signature,
  };
}

export class LanceAuditStore implements IAuditStore {
  constructor(private readonly table: LanceTable) {}

  async append(row: StoredAuditRow): Promise<void> {
    await this.table.add([toStored(row)] as unknown as Record<string, unknown>[]);
  }

  async allAsc(): Promise<StoredAuditRow[]> {
    const rows = (await this.table
      .query()
      .toArray()) as AuditRowStored[];
    return rows.map(fromStored).sort((a, b) => a.ts - b.ts);
  }

  async lastSignature(): Promise<string | null> {
    const rows = await this.allAsc();
    return rows.length ? rows[rows.length - 1]!.signature : null; // rows.length > 0 confirmed above
  }
}
