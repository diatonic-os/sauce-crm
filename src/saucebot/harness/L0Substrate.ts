// ─────────────────────────────────────────────────────────────────────────────
//  L0 SUBSTRATE — the deterministic, replayable core of the SauceOM harness
// ─────────────────────────────────────────────────────────────────────────────
//
//  Per SAUCEOM_HARNESS_DIRECTIVE v0.1 @L0_substrate:
//    "state mutates ONLY by appending events; fully replayable"
//    "no cell -> resolved without a provenance event"
//
//  The thesis the directive insists on: DETERMINISM LIVES IN THE LOOP AND THE
//  EVENT LOG, NEVER IN THE MODEL. The LLM is the one stochastic component — a
//  candidate-generator whose output is validated before it becomes state. So:
//
//    • EventLog is the ONLY mutator — append-only, hash-chained, replayable.
//    • Cells are a PURE REDUCTION over events (projectCells). Replay = re-reduce.
//    • A cell never resolves without a provenance event (the invariant), so every
//      resolved value is traceable to the events that produced it.
//
//  Canonicalization (sorted-key serialization) makes event hashes byte-stable —
//  which is also the cache substrate the directive's @providers rule needs:
//  "caching = canonicalize context to byte-stable prefixes; YOU control hits."

import { encodeToon } from "../Toon";

// ═══════════════════════════════════════════════════════════════════════════
//  EVENT LOG
// ═══════════════════════════════════════════════════════════════════════════

export type HarnessEventType =
  | "user_input"
  | "intent_parse"
  | "plan"
  | "tool_call"
  | "tool_result"
  | "cell_collapse"
  | "contradiction"
  | "recap"
  | "output";

export interface HarnessEvent {
  /** Monotonic 0-based sequence — the replay order. */
  seq: number;
  /** Stable id `evt_<seq>`. */
  id: string;
  ts: number;
  type: HarnessEventType;
  actor: string;
  payload: Record<string, unknown>;
  /** Previous event's id (the chain link); absent for the genesis event. */
  parentId?: string;
  /** Hash over (parentHash | type | actor | canonical(payload)). */
  hash: string;
}

export interface AppendInput {
  type: HarnessEventType;
  actor: string;
  payload: Record<string, unknown>;
}

/** Order-independent, byte-stable serialization. Two objects that differ only by
 *  key order serialize identically — the property hashing + provider caching
 *  both rely on. */
export function canonical(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value as Record<string, unknown>).sort()) {
      out[k] = sortDeep((value as Record<string, unknown>)[k]);
    }
    return out;
  }
  return value;
}

/** Deterministic FNV-1a (32-bit) hex hash. Pure — no crypto dependency, stable
 *  across platforms, sufficient for chain integrity + cache keys. */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

function chainHash(
  parentHash: string,
  type: string,
  actor: string,
  payload: Record<string, unknown>,
): string {
  return fnv1a(`${parentHash}|${type}|${actor}|${canonical(payload)}`);
}

export class EventLog {
  private events: HarnessEvent[] = [];

  /** Inject a clock for deterministic/replayable timestamps. Default 0. */
  constructor(private readonly now: () => number = () => 0) {}

  append(input: AppendInput): HarnessEvent {
    const seq = this.events.length;
    const prev = this.events[seq - 1];
    const parentHash = prev?.hash ?? "genesis";
    const event: HarnessEvent = {
      seq,
      id: `evt_${seq}`,
      ts: this.now(),
      type: input.type,
      actor: input.actor,
      payload: input.payload,
      hash: chainHash(parentHash, input.type, input.actor, input.payload),
      ...(prev ? { parentId: prev.id } : {}),
    };
    this.events.push(event);
    return event;
  }

  all(): readonly HarnessEvent[] {
    return this.events;
  }

  /** Events strictly after `seq` — the incremental tail (cache-state diffing). */
  since(seq: number): HarnessEvent[] {
    return this.events.filter((e) => e.seq > seq);
  }

  head(): HarnessEvent | null {
    return this.events[this.events.length - 1] ?? null;
  }

  /** Recompute the chain and confirm no event was mutated out of band. */
  verifyChain(): boolean {
    let parentHash = "genesis";
    for (const e of this.events) {
      const expected = chainHash(parentHash, e.type, e.actor, e.payload);
      if (expected !== e.hash) return false;
      parentHash = e.hash;
    }
    return true;
  }

  /** TOON-encoded transport block of the whole log (token-optimized prefix). */
  toToonBlock(): string {
    return encodeToon(this.events as unknown as Parameters<typeof encodeToon>[0]);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  CELL ENGINE — candidates collapse to resolved values via events
// ═══════════════════════════════════════════════════════════════════════════

export type CellState =
  | "unresolved"
  | "resolving"
  | "resolved"
  | "contradicted";

export interface Candidate {
  value: unknown;
  confidence: number;
  /** Event id this candidate came from (the provenance link). */
  sourceEvent: string;
}

export interface Cell {
  id: string;
  state: CellState;
  candidates: Candidate[];
  resolvedValue?: unknown;
  provenance: string[];
}

// Conflicting candidates both at/above this confidence ⇒ contradiction, not a
// silent pick. Honors the directive's read_between_lines / honesty rule.
const CONTRADICTION_CONF = 0.5;

/**
 * Pure reduction of the event log into the current cell map. Candidate-bearing
 * events carry `payload.cell = { id, candidate:{value,confidence} }`;
 * `cell_collapse` carries `{ cellId, resolvedValue, provenance }`;
 * `contradiction` carries `{ cellId }`. Replaying the log reproduces state
 * exactly — the L0 invariant.
 */
export function projectCells(events: readonly HarnessEvent[]): Map<string, Cell> {
  const cells = new Map<string, Cell>();
  const ensure = (id: string): Cell => {
    let c = cells.get(id);
    if (!c) {
      c = { id, state: "unresolved", candidates: [], provenance: [] };
      cells.set(id, c);
    }
    return c;
  };

  for (const e of events) {
    const cellRef = (e.payload as { cell?: { id?: string; candidate?: Candidate } })
      .cell;
    if (cellRef?.id && cellRef.candidate) {
      const c = ensure(cellRef.id);
      c.candidates.push({
        value: cellRef.candidate.value,
        confidence: cellRef.candidate.confidence,
        sourceEvent: e.id,
      });
      if (c.state === "unresolved") c.state = "resolving";
      continue;
    }
    if (e.type === "cell_collapse") {
      const p = e.payload as {
        cellId?: string;
        resolvedValue?: unknown;
        provenance?: string[];
      };
      if (p.cellId) {
        const c = ensure(p.cellId);
        c.state = "resolved";
        c.resolvedValue = p.resolvedValue;
        c.provenance = p.provenance ?? [];
      }
      continue;
    }
    if (e.type === "contradiction") {
      const p = e.payload as { cellId?: string };
      if (p.cellId) ensure(p.cellId).state = "contradicted";
    }
  }
  return cells;
}

/**
 * Thin imperative wrapper over an EventLog: `propose` appends candidate events,
 * `collapse` reads the projected candidates and appends the resolving event.
 * All state still flows through the log — the engine holds no private state.
 */
export class CellEngine {
  constructor(private readonly log: EventLog) {}

  propose(
    cellId: string,
    candidate: { value: unknown; confidence: number },
    actor: string,
  ): HarnessEvent {
    return this.log.append({
      type: "intent_parse",
      actor,
      payload: { cell: { id: cellId, candidate } },
    });
  }

  cells(): Map<string, Cell> {
    return projectCells(this.log.all());
  }

  cell(id: string): Cell | undefined {
    return this.cells().get(id);
  }

  /**
   * Collapse a cell to its highest-confidence candidate — UNLESS two distinct
   * values both sit at/above CONTRADICTION_CONF, in which case it appends a
   * `contradiction` event instead of guessing. Returns null when the cell has
   * no candidates (cannot resolve without provenance — the invariant).
   */
  collapse(cellId: string): HarnessEvent | null {
    const c = this.cell(cellId);
    if (!c || c.candidates.length === 0) return null;

    const sorted = [...c.candidates].sort((a, b) => b.confidence - a.confidence);
    const top = sorted[0]!;
    const rivals = sorted.filter(
      (x) =>
        x.confidence >= CONTRADICTION_CONF &&
        canonical(x.value) !== canonical(top.value),
    );
    if (top.confidence >= CONTRADICTION_CONF && rivals.length > 0) {
      return this.log.append({
        type: "contradiction",
        actor: "harness",
        payload: { cellId, values: sorted.map((x) => x.value) },
      });
    }
    return this.log.append({
      type: "cell_collapse",
      actor: "harness",
      payload: {
        cellId,
        resolvedValue: top.value,
        provenance: c.candidates.map((x) => x.sourceEvent),
      },
    });
  }
}
