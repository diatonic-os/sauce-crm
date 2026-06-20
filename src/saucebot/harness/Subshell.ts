// ─────────────────────────────────────────────────────────────────────────────
//  SUBSHELL — background shell task executor
//  Per SAUCEOM_HARNESS_DIRECTIVE @L3_execution:
//    "background shell tasks whose output pipes back as a tool_result-shaped
//     harvest; pure over an injected executor so it is unit-testable with fakes"
//
//  Real impl will wire `exec` to Electron child_process on desktop.
//  Tests inject a fake that returns pre-canned Harvest values.
//
//  Pure module: NO imports of obsidian or lancedb.
// ─────────────────────────────────────────────────────────────────────────────

// ═══════════════════════════════════════════════════════════════════════════
//  TYPES
// ═══════════════════════════════════════════════════════════════════════════

/** Specification for a shell command to spawn. */
export interface SpawnSpec {
  /** The executable to run. */
  cmd: string;
  /** Positional arguments. */
  args?: string[];
  /** Working directory for the child process. */
  cwd: string;
  /**
   * When true the SubshellManager's `approve` gate must pass before the
   * command is executed.  Absent or false = no gate.
   */
  approvalRequired?: boolean;
}

/** Raw output captured from a completed child process. */
export interface Harvest {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Injected capability: runs a shell command and returns its Harvest.
 * Real impl: Electron child_process / Node execFile.
 * Test impl: synchronous fake returning pre-canned data.
 */
export type ShellExecutor = (spec: SpawnSpec) => Promise<Harvest>;

/** Result returned from SubshellManager.run(). */
export interface SubshellResult {
  /** True only when the process ran and exited with code 0. */
  ok: boolean;
  /** Present when the process ran (exit code 0 or nonzero). */
  harvest?: Harvest;
  /** True when approvalRequired was set and the approve gate denied the run. */
  blocked?: boolean;
  /** Human-readable error string when the executor threw. */
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  SUBSHELL MANAGER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Manages background shell task dispatch.
 *
 * @example
 * ```ts
 * const mgr = new SubshellManager(electronExec, (spec) => userConfirmed(spec));
 * const result = await mgr.run({ cmd: "git", args: ["status"], cwd: "/repo" });
 * ```
 */
export class SubshellManager {
  private readonly exec: ShellExecutor;
  private readonly approve: ((spec: SpawnSpec) => boolean) | undefined;

  constructor(exec: ShellExecutor, approve?: (spec: SpawnSpec) => boolean) {
    this.exec = exec;
    this.approve = approve;
  }

  /**
   * Run a shell command, subject to the approval gate.
   *
   * - If `spec.approvalRequired` is true and `approve` is absent or returns
   *   false → `{ ok: false, blocked: true }` (executor is never called).
   * - If the executor throws → `{ ok: false, error: <message> }`.
   * - Otherwise → `{ ok: harvest.exitCode === 0, harvest }`.
   */
  async run(spec: SpawnSpec): Promise<SubshellResult> {
    // Approval gate
    if (spec.approvalRequired === true) {
      const granted = this.approve !== undefined && this.approve(spec);
      if (!granted) {
        return { ok: false, blocked: true };
      }
    }

    // Execute
    try {
      const harvest = await this.exec(spec);
      return { ok: harvest.exitCode === 0, harvest };
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  TOOL RESULT SHAPING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Shape a SubshellResult into a `tool_result`-event-compatible record that
 * can be appended to the harness EventLog.
 *
 * Successful run fields: type, ok, cmd, cwd, [args], stdout, stderr, exitCode.
 * Blocked run fields:    type, ok, blocked, cmd, cwd, [args].
 * Error run fields:      type, ok, error, cmd, cwd, [args].
 */
export function toToolResultPayload(
  spec: SpawnSpec,
  r: SubshellResult,
): Record<string, unknown> {
  const base: Record<string, unknown> = {
    type: "tool_result",
    ok: r.ok,
    cmd: spec.cmd,
    cwd: spec.cwd,
    ...(spec.args !== undefined ? { args: spec.args } : {}),
  };

  if (r.blocked === true) {
    return { ...base, blocked: true };
  }

  if (r.error !== undefined) {
    return { ...base, error: r.error };
  }

  if (r.harvest !== undefined) {
    return {
      ...base,
      stdout: r.harvest.stdout,
      stderr: r.harvest.stderr,
      exitCode: r.harvest.exitCode,
    };
  }

  return base;
}
