// ApprovalGate — single chokepoint every autonomous agent action passes
// through. The operator controls the autonomy dial via 4 verdict
// outcomes per action class:
//
//   approve-once   — run THIS instance, ask again next time
//   approve-always — run this AND all future instances of the same
//                    action class without prompting (recorded in settings)
//   deny-once      — refuse THIS instance, ask again next time
//   deny-always    — refuse this and all future instances (settings)
//
// Action classes are coarse buckets, not per-call — e.g. "edit-file",
// "spawn-process", "call-llm", "send-network". A diff that touches 3
// files counts as one "edit-file" action class for approval.
//
// Settings persistence: gate.decisions[<class>] = "approve-always" | "deny-always"
// — anything else means "prompt every time."

export type ApprovalVerdict = "approve-once" | "approve-always" | "deny-once" | "deny-always";

export type ActionClass =
  | "edit-file"
  | "delete-file"
  | "spawn-process"
  | "install-package"
  | "call-llm"
  | "call-llm-cloud"
  | "send-network"
  | "execute-skill"
  | "modify-settings"
  | string; // operator-defined classes

export type PersistedDecision = "approve-always" | "deny-always";

export interface ApprovalRecord {
  /** Per-class persistent decisions. */
  decisions: Partial<Record<ActionClass, PersistedDecision>>;
}

export const DEFAULT_APPROVAL_RECORD: ApprovalRecord = { decisions: {} };

export interface ApprovalRequest {
  actionClass: ActionClass;
  /** Human-readable summary shown in the modal. */
  summary: string;
  /** Optional details (file paths, commands, etc.) displayed below the summary. */
  details?: string;
  /** Optional risk tier — surfaces a colored badge in the modal. */
  risk?: "low" | "medium" | "high";
}

export interface ApprovalResult {
  verdict: ApprovalVerdict;
  /** True iff the gate executed the action vs. blocked it. */
  approved: boolean;
}

export interface ApprovalUI {
  prompt(req: ApprovalRequest): Promise<ApprovalVerdict>;
}

/** Pluggable persistence: tests pass an in-memory implementation; the
 *  Obsidian wiring delegates to the plugin's saveSettings(). */
export interface ApprovalStore {
  read(): Promise<ApprovalRecord>;
  write(r: ApprovalRecord): Promise<void>;
}

export class ApprovalGate {
  constructor(
    private readonly store: ApprovalStore,
    private readonly ui: ApprovalUI,
  ) {}

  /** Single entry point. Resolves to a result that the caller respects:
   *  approved=true → caller proceeds; approved=false → caller aborts.
   *  The gate is idempotent: multiple concurrent calls with the same
   *  actionClass that has an "approve-always" decision all return
   *  approved=true without prompting. */
  async ask(req: ApprovalRequest): Promise<ApprovalResult> {
    const record = await this.store.read();
    const sticky = record.decisions[req.actionClass];
    if (sticky === "approve-always") {
      return { verdict: "approve-always", approved: true };
    }
    if (sticky === "deny-always") {
      return { verdict: "deny-always", approved: false };
    }
    // Prompt the user.
    const verdict = await this.ui.prompt(req);
    if (verdict === "approve-always" || verdict === "deny-always") {
      record.decisions[req.actionClass] = verdict;
      await this.store.write(record);
    }
    return {
      verdict,
      approved: verdict === "approve-once" || verdict === "approve-always",
    };
  }

  /** Reset a sticky decision so the next call prompts again. UI for this
   *  lives in the Settings → Approvals tab. */
  async clear(actionClass: ActionClass): Promise<void> {
    const record = await this.store.read();
    delete record.decisions[actionClass];
    await this.store.write(record);
  }

  /** Snapshot — read-only, used by the settings tab to list sticky
   *  decisions the operator can revoke. */
  async list(): Promise<ApprovalRecord> {
    return await this.store.read();
  }
}

/** In-memory store for tests. */
export class MemoryApprovalStore implements ApprovalStore {
  private record: ApprovalRecord = { decisions: {} };
  async read(): Promise<ApprovalRecord> { return JSON.parse(JSON.stringify(this.record)); }
  async write(r: ApprovalRecord): Promise<void> { this.record = JSON.parse(JSON.stringify(r)); }
}

/** Always-approve UI for tests; never prompts. */
export class AutoApproveUI implements ApprovalUI {
  async prompt(_req: ApprovalRequest): Promise<ApprovalVerdict> {
    return "approve-once";
  }
}

/** Always-deny UI for tests. */
export class AutoDenyUI implements ApprovalUI {
  async prompt(_req: ApprovalRequest): Promise<ApprovalVerdict> {
    return "deny-once";
  }
}
