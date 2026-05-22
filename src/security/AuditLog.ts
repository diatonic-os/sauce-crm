// SPEC §18.5 — HMAC-chained append-only audit log. Verify walks the chain.
import type { ISqliteBackend } from '../backend/ISqliteBackend';

export interface AuditRow {
  ts: number;
  op: 'read' | 'write' | 'delete' | 'integration' | 'skill' | 'export' | string;
  entityId: string | null;
  agentId: string | null;
  integration: string | null;
  beforeHash: string | null;
  afterHash: string | null;
  details: Record<string, unknown> | null;
  signature: string;
}

export interface AuditHost {
  hmacHex(key: Uint8Array, msg: string): Promise<string>;
}

export class AuditLog {
  private prevSig: string | null = null;

  constructor(
    private readonly db: ISqliteBackend,
    private readonly host: AuditHost,
    private readonly masterKey: () => Promise<Uint8Array>,
  ) {}

  private payload(r: Omit<AuditRow, 'signature'>): string {
    return [r.ts, r.op, r.entityId ?? '', r.agentId ?? '', r.integration ?? '', r.beforeHash ?? '', r.afterHash ?? '', JSON.stringify(r.details ?? null)].join('|');
  }

  async append(row: Omit<AuditRow, 'signature'>): Promise<AuditRow> {
    const key = await this.masterKey();
    if (this.prevSig === null) {
      const last = await this.db.query<{ signature: string }>(`SELECT signature FROM audit_log ORDER BY ts DESC LIMIT 1`);
      this.prevSig = last[0]?.signature ?? '';
    }
    const msg = (this.prevSig ?? '') + this.payload(row);
    const sig = await this.host.hmacHex(key, msg);
    await this.db.exec(
      `INSERT INTO audit_log (ts,op,entity_id,agent_id,integration,before_hash,after_hash,details,signature) VALUES (?,?,?,?,?,?,?,?,?)`,
      [row.ts, row.op, row.entityId, row.agentId, row.integration, row.beforeHash, row.afterHash, JSON.stringify(row.details ?? null), sig],
    );
    this.prevSig = sig;
    return { ...row, signature: sig };
  }

  async verifyChain(): Promise<{ ok: boolean; brokenAt: number | null }> {
    const key = await this.masterKey();
    const rows = await this.db.query<AuditRow & { entity_id: string | null; agent_id: string | null; before_hash: string | null; after_hash: string | null; details: string | null }>(
      `SELECT ts,op,entity_id,agent_id,integration,before_hash,after_hash,details,signature FROM audit_log ORDER BY ts ASC`,
    );
    let prev = '';
    for (const r of rows) {
      const row: Omit<AuditRow, 'signature'> = {
        ts: r.ts, op: r.op, entityId: r.entity_id, agentId: r.agent_id, integration: r.integration,
        beforeHash: r.before_hash, afterHash: r.after_hash,
        details: r.details ? JSON.parse(r.details) : null,
      };
      const sig = await this.host.hmacHex(key, prev + this.payload(row));
      if (sig !== r.signature) return { ok: false, brokenAt: r.ts };
      prev = sig;
    }
    return { ok: true, brokenAt: null };
  }
}
