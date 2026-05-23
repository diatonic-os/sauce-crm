// Content-addressed fingerprinting + signed provenance + crypto trace.
//
// Every meaningful data movement in the app (ingest, index, query, embed,
// enrich, harvest, transfer, export) can be recorded here: the content is
// SHA-256 fingerprinted, the record is HMAC-signed with the KeyVault master
// key, persisted to the LanceDB `provenance` table (backend metadata — never
// markdown frontmatter), and optionally mirrored into the HMAC-chained
// AuditLog. Records link via `parentFp` to form lineage chains.
//
// Storage and crypto are injected so the service is host-agnostic and unit
// testable (tests inject node:crypto; production injects Web Crypto).

export interface ProvenanceRecord {
  fp: string;
  op: string;
  subject: string;
  kind: string;
  ts: number;
  parentFp: string;
  meta: Record<string, unknown> | null;
  signature: string;
}

/** Append-only provenance storage. Implemented by LanceProvenanceStore. */
export interface IProvenanceStore {
  append(r: ProvenanceRecord): Promise<void>;
  bySubject(subject: string): Promise<ProvenanceRecord[]>;
  byFingerprint(fp: string): Promise<ProvenanceRecord[]>;
  all(): Promise<ProvenanceRecord[]>;
}

export interface ProvenanceCrypto {
  sha256Hex(data: string): Promise<string>;
  hmacHex(key: Uint8Array, msg: string): Promise<string>;
}

/** Returns the signing key — KeyVault master key when unlocked, else a
 *  deterministic bootstrap key (mirrors AuditLog) so tracing works pre-unlock
 *  and re-verifies once the real key is available. */
export type MasterKeyProvider = () => Promise<Uint8Array>;

/** Minimal AuditLog shape — provenance optionally mirrors high-level ops here. */
export interface ProvenanceAuditSink {
  append(row: {
    ts: number; op: string; entityId: string | null; agentId: string | null;
    integration: string | null; beforeHash: string | null; afterHash: string | null;
    details: Record<string, unknown> | null;
  }): Promise<unknown>;
}

export interface RecordOpts {
  parentFp?: string;
  meta?: Record<string, unknown> | null;
  /** Pre-computed fingerprint (skip hashing — e.g. when content is large and
   *  already hashed upstream). */
  fp?: string;
}

export class ProvenanceService {
  constructor(
    private readonly store: IProvenanceStore,
    private readonly crypto: ProvenanceCrypto,
    private readonly masterKey: MasterKeyProvider,
    private readonly audit: ProvenanceAuditSink | null = null,
  ) {}

  /** SHA-256 hex of arbitrary content. The canonical fingerprint. */
  fingerprint(content: string): Promise<string> {
    return this.crypto.sha256Hex(content);
  }

  private payload(r: Pick<ProvenanceRecord, "fp" | "op" | "subject" | "kind" | "ts" | "parentFp">): string {
    return [r.fp, r.op, r.subject, r.kind, r.ts, r.parentFp].join("|");
  }

  /** Fingerprint + sign + persist + (optionally) trace to AuditLog. */
  async record(op: string, subject: string, kind: string, content: string, opts: RecordOpts = {}): Promise<ProvenanceRecord> {
    const fp = opts.fp ?? (await this.fingerprint(content));
    const ts = Date.now();
    const parentFp = opts.parentFp ?? "";
    const meta = opts.meta ?? null;
    const key = await this.masterKey();
    const signature = await this.crypto.hmacHex(key, this.payload({ fp, op, subject, kind, ts, parentFp }));
    const rec: ProvenanceRecord = { fp, op, subject, kind, ts, parentFp, meta, signature };
    await this.store.append(rec);
    if (this.audit) {
      try {
        await this.audit.append({
          ts, op: "provenance", entityId: subject, agentId: null, integration: null,
          beforeHash: parentFp || null, afterHash: fp, details: { op, kind },
        });
      } catch {
        /* audit is best-effort; provenance row is the source of truth */
      }
    }
    return rec;
  }

  /** Re-verify every stored record carrying `fp` against the current key.
   *  Returns false if any signature fails or no record exists. */
  async verify(fp: string): Promise<boolean> {
    const key = await this.masterKey();
    const rows = await this.store.byFingerprint(fp);
    if (!rows.length) return false;
    for (const r of rows) {
      const sig = await this.crypto.hmacHex(key, this.payload(r));
      if (sig !== r.signature) return false;
    }
    return true;
  }

  /** Walk the parent_fp lineage from `fp` back toward the root. */
  async lineage(fp: string): Promise<ProvenanceRecord[]> {
    const chain: ProvenanceRecord[] = [];
    const seen = new Set<string>();
    let cur = fp;
    while (cur && !seen.has(cur)) {
      seen.add(cur);
      const rows = await this.store.byFingerprint(cur);
      if (!rows.length) break;
      const r = rows.sort((a, b) => a.ts - b.ts)[0];
      chain.push(r);
      cur = r.parentFp;
    }
    return chain;
  }

  bySubject(subject: string): Promise<ProvenanceRecord[]> {
    return this.store.bySubject(subject);
  }
}
