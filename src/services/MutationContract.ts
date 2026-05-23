// CON-OBS-INTEG-001 · T-D-04 · R-007 / G-004 / G-009 — the mutation contract.
//
// Every canonized-entity write goes through here. The contract:
//   1. redacts secrets out of the recorded delta (G-004/G-009 — pre-write),
//   2. computes the ENT-ledger hash chain  hash = sha256(prevHash + delta_json) (R-007),
//   3. performs the actual write (`apply`),
//   4. appends the immutable ledger entry,
//   5. emits an `ev-<ulid>` Event (post-write).
//
// All collaborators are injected (crypto, ledger sink, event emitter, redactor,
// clock, ulid) so the contract is pure-logic and unit-testable. The crypto
// shape mirrors src/services/Provenance.ts (`sha256Hex`).

/** ENT-ledger row (append-only; prevHash chain). */
export interface LedgerEntry {
  ts: string;
  actor: string;
  action: "insert" | "update" | "delete";
  entityId: string;
  entityType: string;
  delta_json: string;
  prevHash: string;
  hash: string;
}

export interface LedgerSink {
  /** Hash of the chain tip ("" when empty). */
  lastHash(): Promise<string>;
  append(entry: LedgerEntry): Promise<void>;
}

export interface ContractEvent {
  id: string; // ev-<ulid>
  ts: string;
  type: string; // entity.insert | entity.update | entity.delete
  payload_json: string;
  emittedBy: string;
  correlationId?: string;
}

export interface Sha256 {
  sha256Hex(data: string): Promise<string>;
}

export interface Redactor {
  redact(text: string): string;
}

/** Secret patterns scrubbed from any recorded delta. Conservative + additive.
 *  (G-004 names src/security/ as the canonical home for this set; kept here so
 *  T-D-04 stays within its declared `out` — migrate in a later integration pass.) */
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9]{16,}/g, // OpenAI-style keys
  /\bBearer\s+[A-Za-z0-9._-]{8,}/gi, // bearer tokens
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack tokens
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  /\b[A-Za-z0-9._%+-]+:[^@\s/]{6,}@/g, // user:password@ in URLs
];

export const defaultRedactor: Redactor = {
  redact(text: string): string {
    return SECRET_PATTERNS.reduce(
      (acc, re) => acc.replace(re, "‹redacted›"),
      text,
    );
  },
};

// ── ULID (Crockford base32, 48-bit time + 80-bit randomness, monotonic) ──
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
let lastTime = 0;
let lastRand: number[] = [];

function randByte(): number {
  const g = (
    globalThis as {
      crypto?: { getRandomValues?: (a: Uint8Array) => Uint8Array };
    }
  ).crypto;
  if (g?.getRandomValues) return g.getRandomValues(new Uint8Array(1))[0];
  return Math.floor(Math.random() * 256);
}

function encodeTime(time: number): string {
  let out = "";
  for (let i = 9; i >= 0; i--) {
    out = CROCKFORD[time % 32] + out;
    time = Math.floor(time / 32);
  }
  return out;
}

/** A 26-char ULID. Monotonic within the same millisecond. */
export function ulid(now = Date.now()): string {
  if (now === lastTime) {
    // increment the random component for monotonicity
    for (let i = lastRand.length - 1; i >= 0; i--) {
      if (lastRand[i] < 31) {
        lastRand[i]++;
        break;
      }
      lastRand[i] = 0;
    }
  } else {
    lastTime = now;
    lastRand = Array.from({ length: 16 }, () => randByte() % 32);
  }
  return encodeTime(now) + lastRand.map((n) => CROCKFORD[n]).join("");
}

export interface MutationContractDeps {
  ledger: LedgerSink;
  crypto: Sha256;
  emitEvent: (event: ContractEvent) => void | Promise<void>;
  actor: string;
  redactor?: Redactor;
  now?: () => string;
  ulid?: () => string;
}

export interface WriteParams {
  entityId: string;
  entityType: string;
  action: "insert" | "update" | "delete";
  delta: unknown;
  /** Performs the real file/store write. Runs after redact+hash, before ledger. */
  apply: () => Promise<void>;
}

export class MutationContract {
  private readonly redactor: Redactor;
  private readonly now: () => string;
  private readonly mkUlid: () => string;

  constructor(private readonly deps: MutationContractDeps) {
    this.redactor = deps.redactor ?? defaultRedactor;
    this.now = deps.now ?? (() => new Date().toISOString());
    this.mkUlid = deps.ulid ?? (() => ulid());
  }

  async write(params: WriteParams): Promise<LedgerEntry> {
    const ts = this.now();
    const delta_json = this.redactor.redact(JSON.stringify(params.delta ?? {}));
    const prevHash = await this.deps.ledger.lastHash();
    const hash = await this.deps.crypto.sha256Hex(prevHash + delta_json);

    // The actual write happens before we commit the ledger row.
    await params.apply();

    const entry: LedgerEntry = {
      ts,
      actor: this.deps.actor,
      action: params.action,
      entityId: params.entityId,
      entityType: params.entityType,
      delta_json,
      prevHash,
      hash,
    };
    await this.deps.ledger.append(entry);

    await this.deps.emitEvent({
      id: `ev-${this.mkUlid()}`,
      ts,
      type: `entity.${params.action}`,
      payload_json: delta_json,
      emittedBy: "MutationContract",
      correlationId: params.entityId,
    });

    return entry;
  }
}
