// OperatorVoter — surfaces the proposal in an Obsidian Modal and lets
// the human pick aye/nay/abstain. Resolves on click; abstains on timeout
// per VoterAgent contract (timeout itself is enforced by QuorumCouncil's
// per-voter race; we expose a soft `awaitMs` here for in-modal countdowns).

import { Modal, App } from "obsidian";
import type { RoundtableProposal, Vote, Voter } from "../types";
import type { VoterAgent, VoterContext, VoterDecision } from "./types";

export interface OperatorVoterConfig {
  app: App;
  voter?: Voter;
  weight?: number;
  // Optional inactivity timeout. If unset, the voter waits indefinitely
  // and the council's per-voter race becomes the only deadline.
  inactivityMs?: number;
}

const DEFAULT_VOTER: Voter = {
  id: "voter.operator",
  name: "Operator",
};

class OperatorVoteModal extends Modal {
  private chosen: Vote | null = null;
  private rationale = "";
  constructor(
    app: App,
    private readonly proposal: RoundtableProposal,
    private readonly ctx: VoterContext,
    private readonly onDone: (vote: Vote, rationale: string) => void,
  ) {
    super(app);
  }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty?.();
    const title = document.createElement("h2");
    title.textContent = `Roundtable: ${this.proposal.id}`;
    contentEl.appendChild(title);

    const body = document.createElement("pre");
    body.style.whiteSpace = "pre-wrap";
    body.textContent = this.proposal.proposal;
    contentEl.appendChild(body);

    if (this.ctx.diff) {
      const diffHeader = document.createElement("h3");
      diffHeader.textContent = "Diff";
      contentEl.appendChild(diffHeader);
      const diffPre = document.createElement("pre");
      diffPre.style.whiteSpace = "pre-wrap";
      diffPre.textContent = this.ctx.diff;
      contentEl.appendChild(diffPre);
    }

    const note = document.createElement("textarea");
    note.placeholder = "Rationale (optional)";
    note.rows = 3;
    note.style.width = "100%";
    note.addEventListener("input", () => {
      this.rationale = note.value;
    });
    contentEl.appendChild(note);

    const row = document.createElement("div");
    row.style.display = "flex";
    row.style.gap = "8px";
    row.style.marginTop = "8px";
    for (const v of ["aye", "nay", "abstain"] as const) {
      const b = document.createElement("button");
      b.textContent = v;
      b.addEventListener("click", () => {
        this.chosen = v;
        this.close();
      });
      row.appendChild(b);
    }
    contentEl.appendChild(row);
  }
  onClose(): void {
    const vote = this.chosen ?? "abstain";
    const rationale = this.rationale.trim().length
      ? this.rationale.trim()
      : this.chosen === null
        ? "modal closed without selection"
        : `operator chose ${vote}`;
    this.onDone(vote, rationale);
  }
  // Test helpers — let tests drive the modal without a DOM event loop.
  _testSelect(v: Vote, rationale?: string): void {
    this.chosen = v;
    if (rationale !== undefined) this.rationale = rationale;
    this.close();
  }
}

// Re-exported so tests can construct/drive the modal.
export { OperatorVoteModal };

export class OperatorVoter implements VoterAgent {
  readonly voter: Voter;
  readonly weight: number;
  private readonly app: App;
  private readonly inactivityMs?: number;

  constructor(cfg: OperatorVoterConfig) {
    this.app = cfg.app;
    this.voter = cfg.voter ?? DEFAULT_VOTER;
    this.weight = cfg.weight ?? 3;
    this.inactivityMs = cfg.inactivityMs;
  }

  async vote(
    proposal: RoundtableProposal,
    ctx: VoterContext,
  ): Promise<VoterDecision> {
    const start = Date.now();
    return await new Promise<VoterDecision>((resolve) => {
      let settled = false;
      const modal = new OperatorVoteModal(
        this.app,
        proposal,
        ctx,
        (vote, rationale) => {
          if (settled) return;
          settled = true;
          resolve({
            voter: this.voter,
            vote,
            rationale,
            latencyMs: Date.now() - start,
          });
        },
      );
      let timer: ReturnType<typeof setTimeout> | null = null;
      if (this.inactivityMs && this.inactivityMs > 0) {
        timer = setTimeout(() => {
          if (settled) return;
          settled = true;
          try {
            modal.close();
          } catch {
            // close failures are non-fatal — the timeout outcome stands.
          }
          resolve({
            voter: this.voter,
            vote: "abstain",
            rationale: `inactivity timeout after ${this.inactivityMs}ms`,
            latencyMs: Date.now() - start,
          });
        }, this.inactivityMs);
      }
      try {
        modal.open();
      } catch (err) {
        if (timer) clearTimeout(timer);
        if (settled) return;
        settled = true;
        resolve({
          voter: this.voter,
          vote: "abstain",
          rationale: `modal failed to open: ${err instanceof Error ? err.message : String(err)}`,
          latencyMs: Date.now() - start,
        });
      }
    });
  }
}
