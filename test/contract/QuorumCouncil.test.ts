import { describe, it, expect } from "vitest";
import { LSPGate } from "../../src/contract/LSPGate";
import { QuorumCouncil } from "../../src/contract/QuorumCouncil";
import { LockState, type LSPContract, type RoundtableProposal, type Vote, type Voter } from "../../src/contract/types";
import type { VoterAgent, VoterContext, VoterDecision } from "../../src/contract/voters/types";

const contract: LSPContract<unknown> = { id: "test.ct", interface: {} };

const proposal: RoundtableProposal = {
  id: "prop-1",
  sessionId: "outer-1",
  proposal: "Add a new invariant",
};

class StubVoter implements VoterAgent {
  voter: Voter;
  weight: number;
  constructor(
    id: string,
    weight: number,
    private readonly v: Vote,
    private readonly delay = 0,
  ) {
    this.voter = { id, name: id };
    this.weight = weight;
  }
  async vote(_p: RoundtableProposal, _c: VoterContext): Promise<VoterDecision> {
    if (this.delay) await new Promise((r) => setTimeout(r, this.delay));
    return { voter: this.voter, vote: this.v, rationale: `stub:${this.v}`, latencyMs: this.delay };
  }
}

class HangingVoter implements VoterAgent {
  voter: Voter = { id: "hang", name: "hang" };
  weight = 1;
  async vote(): Promise<VoterDecision> {
    await new Promise(() => {
      /* never resolves */
    });
    return { voter: this.voter, vote: "aye", rationale: "x", latencyMs: 0 };
  }
}

class ThrowingVoter implements VoterAgent {
  voter: Voter = { id: "throw", name: "throw" };
  weight = 1;
  async vote(): Promise<VoterDecision> {
    throw new Error("boom");
  }
}

function setupGate(): LSPGate {
  const g = new LSPGate();
  g.registerContract(contract, []);
  g.lock(contract.id, "council", "vote in progress");
  return g;
}

describe("QuorumCouncil", () => {
  it("PASSED unlocks the contract when ayes meet quorum", async () => {
    const g = setupGate();
    const council = new QuorumCouncil(g, {
      voters: [
        new StubVoter("a", 2, "aye"),
        new StubVoter("b", 1, "aye"),
        new StubVoter("c", 1, "nay"),
      ],
      quorum: 3,
      contractId: contract.id,
    });
    const r = await council.propose(proposal);
    expect(r.outcome).toBe("PASSED");
    expect(r.ayeWeight).toBe(3);
    expect(g.state(contract.id)).toBe(LockState.OPEN);
    expect(r.session.id).toBeTruthy();
    expect(r.session.votes).toHaveLength(3);
  });

  it("REJECTED when nays dominate and quorum not met", async () => {
    const g = setupGate();
    const council = new QuorumCouncil(g, {
      voters: [
        new StubVoter("a", 1, "aye"),
        new StubVoter("b", 2, "nay"),
        new StubVoter("c", 2, "nay"),
      ],
      quorum: 3,
      contractId: contract.id,
    });
    const r = await council.propose(proposal);
    expect(r.outcome).toBe("REJECTED");
    expect(g.state(contract.id)).toBe(LockState.LOCKED);
  });

  it("NO_QUORUM when abstains dominate", async () => {
    const g = setupGate();
    const council = new QuorumCouncil(g, {
      voters: [
        new StubVoter("a", 1, "aye"),
        new StubVoter("b", 2, "abstain"),
        new StubVoter("c", 2, "abstain"),
      ],
      quorum: 3,
      contractId: contract.id,
    });
    const r = await council.propose(proposal);
    expect(r.outcome).toBe("NO_QUORUM");
    expect(g.state(contract.id)).toBe(LockState.LOCKED);
  });

  it("treats per-voter timeout as abstain", async () => {
    const g = setupGate();
    const council = new QuorumCouncil(g, {
      voters: [
        new StubVoter("a", 2, "aye"),
        new HangingVoter(),
      ],
      quorum: 2,
      perVoterTimeoutMs: 30,
      contractId: contract.id,
    });
    const r = await council.propose(proposal);
    const hangDecision = r.decisions.find((d) => d.voter.id === "hang");
    expect(hangDecision?.vote).toBe("abstain");
    expect(hangDecision?.rationale).toMatch(/timeout/);
    expect(r.outcome).toBe("PASSED");
  });

  it("translates voter thrown error into abstain", async () => {
    const g = setupGate();
    const council = new QuorumCouncil(g, {
      voters: [new StubVoter("a", 1, "aye"), new ThrowingVoter()],
      quorum: 2,
      contractId: contract.id,
    });
    const r = await council.propose(proposal);
    const thrown = r.decisions.find((d) => d.voter.id === "throw");
    expect(thrown?.vote).toBe("abstain");
    expect(thrown?.rationale).toMatch(/voter error|boom/);
  });
});
