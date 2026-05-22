// SPEC §34 — Append-only change feed used by SyncEngine + AuditLog hooks.
export type ChangeKind = 'create' | 'update' | 'delete' | 'rename' | 'integration-pull' | 'integration-push';
export interface Change { ts: number; kind: ChangeKind; integration?: string; resource?: string; entityId: string; meta?: Record<string, unknown>; }

export class ChangeFeed {
  private subs: ((c: Change) => void)[] = [];
  private buf: Change[] = [];
  emit(c: Change): void { this.buf.push(c); for (const s of this.subs) s(c); }
  subscribe(fn: (c: Change) => void): () => void { this.subs.push(fn); return () => { this.subs = this.subs.filter((s) => s !== fn); }; }
  drain(): Change[] { const x = this.buf; this.buf = []; return x; }
}
