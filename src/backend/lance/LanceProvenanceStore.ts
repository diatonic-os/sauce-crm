// LanceDB-backed IProvenanceStore. Append-only; rows are content-addressed by
// `fp` (not unique — the same content may be recorded under multiple ops), so
// reads filter + sort in JS. Provenance volume can grow; subject/fp lookups use
// `where` predicates so LanceDB scans are pushed down where possible.

import type {
  IProvenanceStore,
  ProvenanceRecord,
} from "../../services/Provenance";
import type { ProvenanceRow } from "./LanceSchema";
import { sqlStr, type LanceTable } from "./LanceConnection";

function toRow(r: ProvenanceRecord): ProvenanceRow {
  return {
    fp: r.fp,
    op: r.op,
    subject: r.subject,
    kind: r.kind,
    ts: r.ts,
    parent_fp: r.parentFp,
    meta: JSON.stringify(r.meta ?? null),
    signature: r.signature,
  };
}

function fromRow(r: ProvenanceRow): ProvenanceRecord {
  return {
    fp: r.fp,
    op: r.op,
    subject: r.subject,
    kind: r.kind,
    ts: r.ts,
    parentFp: r.parent_fp,
    meta: r.meta === "null" ? null : JSON.parse(r.meta),
    signature: r.signature,
  };
}

export class LanceProvenanceStore implements IProvenanceStore {
  constructor(private readonly table: LanceTable) {}

  async append(r: ProvenanceRecord): Promise<void> {
    await this.table.add([toRow(r)] as unknown as Record<string, unknown>[]);
  }

  async bySubject(subject: string): Promise<ProvenanceRecord[]> {
    const rows = (await this.table
      .query()
      .where(`subject = ${sqlStr(subject)}`)
      .toArray()) as ProvenanceRow[];
    return rows.map(fromRow).sort((a, b) => a.ts - b.ts);
  }

  async byFingerprint(fp: string): Promise<ProvenanceRecord[]> {
    const rows = (await this.table
      .query()
      .where(`fp = ${sqlStr(fp)}`)
      .toArray()) as ProvenanceRow[];
    return rows.map(fromRow).sort((a, b) => a.ts - b.ts);
  }

  async all(): Promise<ProvenanceRecord[]> {
    const rows = (await this.table
      .query()
      .toArray()) as ProvenanceRow[];
    return rows.map(fromRow).sort((a, b) => a.ts - b.ts);
  }
}
