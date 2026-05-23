// SPEC §18.5 — HMAC-chained append-only audit log. Verify walks the chain.
//
// Storage is abstracted behind IAuditStore (implemented by LanceAuditStore on
// the LanceDB single-backend). The HMAC chaining is storage-agnostic: each row
// signs `prevSignature + payload(row)`, so verify re-walks rows in ts order and
// recomputes the chain.

export interface AuditRow {
  ts: number;
  op: "read" | "write" | "delete" | "integration" | "skill" | "export" | string;
  entityId: string | null;
  agentId: string | null;
  integration: string | null;
  beforeHash: string | null;
  afterHash: string | null;
  details: Record<string, unknown> | null;
  signature: string;
}

/** Storage-level row: `details` serialized to a JSON string, nulls preserved. */
export interface StoredAuditRow {
  ts: number;
  op: string;
  entityId: string | null;
  agentId: string | null;
  integration: string | null;
  beforeHash: string | null;
  afterHash: string | null;
  details: string | null;
  signature: string;
}

/** Append-only audit storage. Implemented by LanceAuditStore. */
export interface IAuditStore {
  append(row: StoredAuditRow): Promise<void>;
  /** All rows ordered by ts ascending (chain order). */
  allAsc(): Promise<StoredAuditRow[]>;
  /** Signature of the most-recent row (ts desc), or null if empty. */
  lastSignature(): Promise<string | null>;
}

export interface AuditHost {
  hmacHex(key: Uint8Array, msg: string): Promise<string>;
}

export class AuditLog {
  private prevSig: string | null = null;

  constructor(
    private readonly store: IAuditStore,
    private readonly host: AuditHost,
    private readonly masterKey: () => Promise<Uint8Array>,
  ) {}

  private payload(r: Omit<AuditRow, "signature">): string {
    return [
      r.ts,
      r.op,
      r.entityId ?? "",
      r.agentId ?? "",
      r.integration ?? "",
      r.beforeHash ?? "",
      r.afterHash ?? "",
      JSON.stringify(r.details ?? null),
    ].join("|");
  }

  async append(row: Omit<AuditRow, "signature">): Promise<AuditRow> {
    const key = await this.masterKey();
    if (this.prevSig === null) {
      this.prevSig = (await this.store.lastSignature()) ?? "";
    }
    const msg = (this.prevSig ?? "") + this.payload(row);
    const sig = await this.host.hmacHex(key, msg);
    await this.store.append({
      ts: row.ts,
      op: row.op,
      entityId: row.entityId,
      agentId: row.agentId,
      integration: row.integration,
      beforeHash: row.beforeHash,
      afterHash: row.afterHash,
      details: JSON.stringify(row.details ?? null),
      signature: sig,
    });
    this.prevSig = sig;
    return { ...row, signature: sig };
  }

  async verifyChain(): Promise<{ ok: boolean; brokenAt: number | null }> {
    const key = await this.masterKey();
    const rows = await this.store.allAsc();
    let prev = "";
    for (const r of rows) {
      const row: Omit<AuditRow, "signature"> = {
        ts: r.ts,
        op: r.op,
        entityId: r.entityId,
        agentId: r.agentId,
        integration: r.integration,
        beforeHash: r.beforeHash,
        afterHash: r.afterHash,
        details: r.details ? JSON.parse(r.details) : null,
      };
      const sig = await this.host.hmacHex(key, prev + this.payload(row));
      if (sig !== r.signature) return { ok: false, brokenAt: r.ts };
      prev = sig;
    }
    return { ok: true, brokenAt: null };
  }
}
