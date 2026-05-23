// Shared voter-side contract — every voter (LocalFast, LocalDeep,
// CloudMaverick, Operator, CodeReviewer) implements VoterAgent.
//
// Voters return a typed VoterDecision. Errors and timeouts MUST be
// translated into abstain decisions with a rationale string — no silent
// failures, no thrown exceptions reaching QuorumCouncil.

import type { RoundtableProposal, Vote, Voter } from "../types";

export interface VoterContext {
  // Free-form diff / patch / artifact under review, surfaced verbatim to
  // every voter. Keep this stable across the council so deterministic
  // voters (CodeReviewer) produce reproducible results.
  diff?: string;
  // Optional structured metadata voters may inspect.
  metadata?: Record<string, unknown>;
}

export interface VoterDecision {
  voter: Voter;
  vote: Vote;
  // Required regardless of outcome. For abstain/nay this is the failure
  // mode; for aye it is the recommendation summary.
  rationale: string;
  // Wall-clock latency in ms for telemetry.
  latencyMs: number;
}

export interface VoterAgent {
  voter: Voter;
  // Default per-voter weight. QuorumCouncil may override.
  weight: number;
  vote(proposal: RoundtableProposal, ctx: VoterContext): Promise<VoterDecision>;
}

/**
 * Parse JSON out of a model response that may include prose, code fences,
 * or trailing commentary. Returns null when no JSON object can be located.
 * Shared across the LLM-backed voters.
 */
export function parseJsonWithProseTolerance(text: string): unknown {
  if (!text) return null;
  // Strip ```json fences if present.
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenceMatch ? fenceMatch[1] : text;
  // Find first { and matching last }.
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first < 0 || last < 0 || last <= first) return null;
  const slice = candidate.slice(first, last + 1);
  try {
    return JSON.parse(slice) as unknown;
  } catch {
    return null;
  }
}

/**
 * Narrow an unknown value to a Vote, defaulting to abstain.
 */
export function coerceVote(v: unknown): Vote {
  if (v === "aye" || v === "nay" || v === "abstain") return v;
  if (typeof v === "string") {
    const lo = v.toLowerCase();
    if (lo === "yes" || lo === "approve" || lo === "pass") return "aye";
    if (lo === "no" || lo === "reject" || lo === "block") return "nay";
  }
  return "abstain";
}
