// SPEC §18.5 — HMAC-chained append-only audit log. Verify walks the chain.
//
// Storage is abstracted behind IAuditStore (implemented by LanceAuditStore on
// the LanceDB single-backend). The HMAC chaining is storage-agnostic: each row
// signs `prevSignature + payload(row)`, so verify re-walks rows in ts order and
// recomputes the chain.
//
// SEC-08 — The HMAC key supplied via the `masterKey` closure is NO LONGER the
// raw AES master key. KeyVault.deriveAuditHmacKey() returns an HKDF-SHA256
// subkey (info="audit-hmac") derived deterministically from the master key, so
// the same password yields the same audit key every session and chains stay
// verifiable across unlocks. This file is agnostic to how the key is derived;
// it just signs and re-walks with whatever `masterKey()` returns.

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
  /** Resolves the acting agent id (AI provider:model, user, integration), so
   *  every entry records WHO/WHAT made the change even when the caller omits it. */
  private actor: (() => string | null) | null = null;

  constructor(
    private readonly store: IAuditStore,
    private readonly host: AuditHost,
    private readonly masterKey: () => Promise<Uint8Array>,
  ) {}

  /** Install the actor resolver (called once the copilot/agent identity exists).
   *  Used to auto-populate `agentId` on append when the caller passes null. */
  setActor(fn: () => string | null): void {
    this.actor = fn;
  }

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
    // Auto-fill the fields the audit was missing: a real agent id (the acting
    // AI agent / user / integration) and a timestamp. Filled BEFORE signing so
    // the HMAC chain covers them and verify stays consistent.
    const filled: Omit<AuditRow, "signature"> = {
      ...row,
      ts: row.ts || Date.now(),
      agentId: row.agentId ?? this.actor?.() ?? null,
    };
    const msg = (this.prevSig ?? "") + this.payload(filled);
    const sig = await this.host.hmacHex(key, msg);
    await this.store.append({
      ts: filled.ts,
      op: filled.op,
      entityId: filled.entityId,
      agentId: filled.agentId,
      integration: filled.integration,
      beforeHash: filled.beforeHash,
      afterHash: filled.afterHash,
      details: JSON.stringify(filled.details ?? null),
      signature: sig,
    });
    this.prevSig = sig;
    return { ...filled, signature: sig };
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

  /** Most-recent `n` rows (ts descending) for the Audit Log view (S7). Reads
   *  the chain-ordered store and returns the tail, newest first. */
  async recent(n: number): Promise<StoredAuditRow[]> {
    const rows = await this.store.allAsc();
    return rows.slice(Math.max(0, rows.length - n)).reverse();
  }
}
