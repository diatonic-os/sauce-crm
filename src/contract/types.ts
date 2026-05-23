// Contract types for LSP gate and quorum council

// Unique identifier for a contract
export type ContractId = string;

// State of a contract lock
export enum LockState {
  OPEN = "OPEN",
  LOCKED = "LOCKED",
  FROZEN = "FROZEN",
}

// Vote cast by a voter
export type Vote = "aye" | "nay" | "abstain";

// Information about a voter
export interface Voter {
  id: string;
  name: string;
}

// Record of a vote cast
export interface VoteCast {
  voter: Voter;
  vote: Vote;
  timestamp: number;
}

// Session data for a roundtable discussion
export interface RoundtableSession {
  id: string;
  contractId: ContractId;
  voters: Voter[];
  votes: VoteCast[];
}

// Proposal data for a roundtable discussion
export interface RoundtableProposal {
  id: string;
  sessionId: string;
  proposal: string;
}

// Contract interface for LSP
export interface LSPContract<I> {
  id: ContractId;
  interface: I;
}

// Method contract for LSP
export interface MethodContract {
  method: string;
  params: unknown[];
  returns: unknown;
}

// Report on subtype relationships
export interface SubtypeReport {
  supertype: string;
  subtypes: string[];
}

// LSP violation record. `invariant` is the human-readable label modals
// surface to operators (e.g. "person.name must be non-empty"); `details`
// is the diagnostic body.
export interface LSPViolation {
  kind: LSPViolationKind;
  contract: ContractId;
  invariant: string;
  details: string;
}

// Kinds of LSP violations
export enum LSPViolationKind {
  PRECONDITION_STRENGTHENED = "PRECONDITION_STRENGTHENED",
  POSTCONDITION_WEAKENED = "POSTCONDITION_WEAKENED",
  LSP_SUBTYPE_VIOLATION = "LSP_SUBTYPE_VIOLATION",
}
