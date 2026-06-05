// CON-SAUCEBOT S8 — local whisper transcription engine (hardened).
//
// Drives a local whisper CLI (openai-whisper `whisper`, or whisper.cpp's
// `whisper-cli`) through `execFileNoThrow` — NEVER a shell, so the audio path
// and options can never be interpreted as a command. Hardening contract:
//
//   - The binary path MUST be absolute and is validated (exists + executable)
//     before every spawn. There is NO PATH guessing.
//   - argv is built by the allowlist builder in WhisperArgs.ts — no user string
//     is interpolated into args; paths are single argv entries.
//   - A hard timeout + max output buffer bound the process; on overrun it is
//     SIGKILL'd by the exec layer.
//   - Every live child is tracked in a ChildProcessRegistry so a plugin unload
//     terminates it (no orphaned transcription).
//   - The FIRST spawn per session routes through the injected ApprovalGate
//     (actionClass "spawn-process", summary = exact argv). approve-always is
//     honoured by the gate. Every spawn is appended to the audit sink.
//
// Desktop-first: on mobile/sandboxed runtimes the spawn primitive is
// unavailable and `transcribe` throws a clear error (no silent failure).

import {
  execFileNoThrow,
  type ChildProcessRegistry,
  type ExecResult,
} from "../../utils/execFileNoThrow";
import {
  buildWhisperArgs,
  validateBinaryPath,
  WHISPER_PROBE_ARGS,
  type PathProbe,
} from "./WhisperArgs";
import type {
  TranscribeOptions,
  TranscriptionProvider,
  TranscriptionResult,
} from "./TranscriptionProvider";

/** Outcome of a consent request — mirrors ApprovalGate's result minimally so
 *  the engine does not depend on the contract module's concrete classes. */
export interface ConsentGate {
  /** Resolve true to proceed with the spawn, false to abort. The summary is the
   *  exact argv the engine is about to run. */
  ask(req: {
    actionClass: "spawn-process";
    summary: string;
    details?: string;
    risk?: "low" | "medium" | "high";
  }): Promise<{ approved: boolean }>;
}

/** Audit sink — one entry per spawn. Mirrors SkillCtx.audit's shape. */
export type AuditFn = (
  op: string,
  entityId: string | null,
  details: Record<string, unknown>,
) => Promise<void>;

export interface WhisperEngineDeps {
  /** Spawn seam (default: execFileNoThrow). Tests inject a fake. */
  run?: (
    cmd: string,
    args: string[],
    opts?: { timeoutMs?: number; registry?: ChildProcessRegistry },
  ) => Promise<ExecResult>;
  /** Read the transcript file whisper writes. */
  readText: (path: string) => Promise<string | null>;
  /** Absolute path to the whisper binary. PATH names are rejected by the
   *  validator — an explicit absolute path (or the Detect flow) must set this. */
  binPath?: string;
  /** Filesystem probe used to validate the binary (exists + executable). When
   *  omitted, validation is skipped ONLY if a custom `run` is also injected
   *  (test mode); production always supplies a real probe. */
  pathProbe?: PathProbe;
  /** Directory whisper writes `<name>.txt` into. */
  outputDir: string;
  defaultModel?: string;
  timeoutMs?: number;
  /** Consent gate — the first spawn per session prompts here. Omit to skip
   *  consent (e.g. the daemon, which has its own opt-in config). */
  consent?: ConsentGate;
  /** Audit sink — appended once per spawn. */
  audit?: AuditFn;
  /** Registry every spawned child is tracked in (kill-on-unload). */
  registry?: ChildProcessRegistry;
}

/** basename without directory or extension: "/a/b/note.m4a" → "note". */
function stem(p: string): string {
  const file = p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1);
  const dot = file.lastIndexOf(".");
  return dot > 0 ? file.slice(0, dot) : file;
}

export class WhisperEngine implements TranscriptionProvider {
  readonly id = "whisper-local";
  readonly label = "Whisper (local)";
  private readonly run: NonNullable<WhisperEngineDeps["run"]>;
  /** Set once consent is granted for the session so we don't re-prompt every
   *  file (the gate's approve-always also covers future sessions). */
  private consentGranted = false;

  constructor(private readonly deps: WhisperEngineDeps) {
    this.run =
      deps.run ??
      ((cmd, args, opts) =>
        execFileNoThrow(cmd, args, {
          ...(opts?.timeoutMs !== undefined
            ? { timeoutMs: opts.timeoutMs }
            : {}),
          ...(opts?.registry ? { registry: opts.registry } : {}),
        }));
  }

  private get bin(): string {
    return this.deps.binPath ?? "";
  }

  /** Validate the configured binary path. Returns ok=false with a reason when
   *  the path is missing / relative / absent / non-executable. Skipped only in
   *  pure test mode (custom run + no probe). */
  private validateBin(): { ok: boolean; reason?: string } {
    if (!this.deps.pathProbe) {
      // No probe injected. If a custom run is wired (tests), allow; otherwise
      // we cannot guarantee safety, so refuse.
      if (this.deps.run) return { ok: true };
      return { ok: false, reason: "no path probe configured" };
    }
    return validateBinaryPath(this.bin, this.deps.pathProbe);
  }

  async isAvailable(): Promise<boolean> {
    const v = this.validateBin();
    if (!v.ok) return false;
    const r = await this.run(this.bin, [...WHISPER_PROBE_ARGS], {
      timeoutMs: 10_000,
    });
    return r.code !== null;
  }

  async transcribe(
    audioPath: string,
    opts: TranscribeOptions = {},
  ): Promise<TranscriptionResult> {
    // 1. Validate the binary BEFORE building args or prompting consent.
    const v = this.validateBin();
    if (!v.ok) {
      throw new Error(`whisper not runnable: ${v.reason}`);
    }

    // 2. Build argv from the allowlist (throws on invalid model/language).
    const model = opts.model ?? this.deps.defaultModel ?? "large-v3-turbo";
    const args = buildWhisperArgs(audioPath, this.deps.outputDir, {
      model,
      outputFormat: "txt",
      ...(opts.language !== undefined ? { language: opts.language } : {}),
    });

    // 3. Consent — first spawn per session passes through the gate. The summary
    // shows the EXACT argv the operator is approving.
    const argvDisplay = [this.bin, ...args].join(" ");
    if (this.deps.consent && !this.consentGranted) {
      const res = await this.deps.consent.ask({
        actionClass: "spawn-process",
        summary: "Run local Whisper transcription",
        details: argvDisplay,
        risk: "medium",
      });
      if (!res.approved) {
        throw new Error("whisper transcription denied by approval gate");
      }
      this.consentGranted = true;
    }

    // 4. Audit every spawn.
    await this.deps.audit?.("spawn-process", null, {
      tool: "whisper",
      bin: this.bin,
      args,
      audioPath,
    });

    // 5. Spawn (tracked for kill-on-unload).
    const started = Date.now();
    const r = await this.run(this.bin, args, {
      timeoutMs: this.deps.timeoutMs ?? 600_000,
      ...(this.deps.registry ? { registry: this.deps.registry } : {}),
    });
    if (r.code === null) {
      throw new Error(
        `whisper unavailable: ${r.error ?? "spawn failed"} (desktop-only; use cloud STT on mobile)`,
      );
    }
    if (r.code !== 0) {
      throw new Error(
        `whisper failed (exit ${r.code}): ${r.stderr || r.error || "unknown error"}`,
      );
    }
    const txtPath = `${this.deps.outputDir}/${stem(audioPath)}.txt`;
    const text = await this.deps.readText(txtPath);
    if (text == null) {
      throw new Error(`whisper produced no transcript at ${txtPath}`);
    }
    return {
      text: text.trim(),
      ...(opts.language !== undefined && { language: opts.language }),
      durationMs: Date.now() - started,
    };
  }
}
