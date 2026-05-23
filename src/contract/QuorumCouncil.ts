// QuorumCouncil — fans a RoundtableProposal out to a fleet of voters in
// parallel, tallies weighted ayes, and (on PASSED) unlocks the contract
// on the bound LSPGate. Timeouts and voter errors become typed abstains
// (per VoterAgent contract); the council never throws on voter failure.

import type { LSPGate } from "./LSPGate";
import type {
  ContractId,
  RoundtableProposal,
  RoundtableSession,
  VoteCast,
} from "./types";
import type { VoterAgent, VoterContext, VoterDecision } from "./voters/types";

export type CouncilOutcome = "PASSED" | "REJECTED" | "NO_QUORUM";

export interface QuorumCouncilConfig {
  voters: VoterAgent[];
  // Sum of weighted ayes required to PASS.
  quorum: number;
  // Per-voter max wall time. Defaults to 30_000.
  perVoterTimeoutMs?: number;
  // Contract id to unlock on PASSED. Required.
  contractId: ContractId;
  // Optional override of UUID factory for tests.
  uuid?: () => string;
}

export interface CouncilResult {
  session: RoundtableSession;
  outcome: CouncilOutcome;
  ayeWeight: number;
  nayWeight: number;
  abstainWeight: number;
  decisions: VoterDecision[];
}

function defaultUuid(): string {
  // Obsidian's runtime exposes crypto.randomUUID; node 20 likewise. The
  // jsdom test env provides it too. Guarded for older runtimes.
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback: timestamp + random.
  return `sess-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export class QuorumCouncil {
  private readonly gate: LSPGate;
  private readonly cfg: QuorumCouncilConfig;

  constructor(gate: LSPGate, cfg: QuorumCouncilConfig) {
    if (!cfg.voters.length) throw new Error("QuorumCouncil: voters[] empty");
    if (cfg.quorum <= 0) throw new Error("QuorumCouncil: quorum must be > 0");
    this.gate = gate;
    this.cfg = cfg;
  }

  /**
   * Run a roundtable. Returns the session + outcome. PASSED unlocks the
   * gate's contract. REJECTED and NO_QUORUM leave the contract in its
   * current state (caller decides whether to freeze).
   */
  async propose(
    proposal: RoundtableProposal,
    ctx: VoterContext = {},
  ): Promise<CouncilResult> {
    const sessionId = (this.cfg.uuid ?? defaultUuid)();
    const perTimeout = this.cfg.perVoterTimeoutMs ?? 30_000;

    const decisions = await Promise.all(
      this.cfg.voters.map((v) => this.runOne(v, proposal, ctx, perTimeout)),
    );

    let ayeWeight = 0;
    let nayWeight = 0;
    let abstainWeight = 0;
    for (let i = 0; i < decisions.length; i++) {
      const w = this.cfg.voters[i].weight;
      const d = decisions[i];
      if (d.vote === "aye") ayeWeight += w;
      else if (d.vote === "nay") nayWeight += w;
      else abstainWeight += w;
    }

    const totalWeight = this.cfg.voters.reduce((s, v) => s + v.weight, 0);
    const remaining = 0; // all settled
    let outcome: CouncilOutcome;
    if (ayeWeight >= this.cfg.quorum) {
      outcome = "PASSED";
    } else if (ayeWeight + remaining < this.cfg.quorum) {
      // Could not reach quorum even with remaining undecided (none left).
      // Disambiguate NO_QUORUM vs REJECTED: if nays exceed abstains,
      // it's a substantive REJECTED; if abstains dominate, NO_QUORUM.
      outcome = nayWeight > abstainWeight ? "REJECTED" : "NO_QUORUM";
      // Edge: when no voters voted nay and weighted ayes were nonzero
      // but below quorum (e.g. small fleet), call it REJECTED only if
      // there is a clear nay signal. Otherwise NO_QUORUM.
      if (nayWeight === 0) outcome = "NO_QUORUM";
      // touch totalWeight to silence unused warnings under noUnused.
      void totalWeight;
    } else {
      outcome = "REJECTED";
    }

    const votes: VoteCast[] = decisions.map((d) => ({
      voter: d.voter,
      vote: d.vote,
      timestamp: Date.now(),
    }));

    const session: RoundtableSession = {
      id: sessionId,
      contractId: this.cfg.contractId,
      voters: this.cfg.voters.map((v) => v.voter),
      votes,
    };

    if (outcome === "PASSED") {
      try {
        this.gate.unlock(this.cfg.contractId);
      } catch {
        // Contract may not be locked, may be frozen, or unknown. Swallow
        // — the outcome is still PASSED; gate hygiene is the caller's
        // responsibility to inspect via gate.snapshot().
      }
    }

    return { session, outcome, ayeWeight, nayWeight, abstainWeight, decisions };
  }

  private async runOne(
    v: VoterAgent,
    proposal: RoundtableProposal,
    ctx: VoterContext,
    timeoutMs: number,
  ): Promise<VoterDecision> {
    const start = Date.now();
    const timeoutPromise = new Promise<VoterDecision>((resolve) => {
      setTimeout(() => {
        resolve({
          voter: v.voter,
          vote: "abstain",
          rationale: `timeout after ${timeoutMs}ms`,
          latencyMs: Date.now() - start,
        });
      }, timeoutMs);
    });
    const votePromise = (async (): Promise<VoterDecision> => {
      try {
        return await v.vote(proposal, ctx);
      } catch (err) {
        return {
          voter: v.voter,
          vote: "abstain",
          rationale: `voter error: ${err instanceof Error ? err.message : String(err)}`,
          latencyMs: Date.now() - start,
        };
      }
    })();
    return await Promise.race([votePromise, timeoutPromise]);
  }
}
