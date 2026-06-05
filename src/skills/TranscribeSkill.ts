import { Notice } from "obsidian";
import {
  Skill,
  validateInputs,
  type SkillArgs,
  type SkillContract,
  type SkillCtx,
  type SkillResult,
} from "./Skill";

/** Message shown when no local engine is configured and the daemon route is
 *  unavailable. Points at the two ways to enable transcription — never silent. */
const NOT_CONFIGURED_NOTICE =
  "Transcription is not configured. Set an absolute Whisper binary path in " +
  "Settings → Skills → Transcription (or use Detect), or enable the " +
  "sauce-crm daemon with Whisper.";

/** Detect the "no engine" payload shape returned by the runtime dispatch. */
function isNotConfigured(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const p = payload as Record<string, unknown>;
  if (p.pending === "transcribe") return true;
  const reason = typeof p.error === "string" ? p.error : "";
  return (
    reason.includes("not configured") ||
    reason.includes("not runnable") ||
    reason.includes("no transcription engine")
  );
}

export class TranscribeSkill extends Skill {
  readonly id = "transcribe";
  override readonly description = "Transcribe an audio file";
  readonly contract: SkillContract = {
    level: "simple",
    inputs: [{ name: "audio_path", type: "string", required: true }],
    mutable: [],
    requires: [],
    ensures: [],
    signals: [],
    costEstimate: { tokensIn: 0, tokensOut: 0, apiCalls: 1, wallClockMs: 2000 },
  };

  /** Notice emitter seam (tests inject a spy; prod uses Obsidian's Notice). */
  protected notify(message: string): void {
    new Notice(message);
  }

  async execute(args: SkillArgs, ctx: SkillCtx): Promise<SkillResult> {
    const v = validateInputs(args, this.contract);
    if (!v.ok)
      return { ok: false, reason: "missing_inputs: " + v.missing.join(",") };
    try {
      const payload = await ctx.call<unknown>(this.id, args);
      await ctx.audit("skill", null, { skill: this.id, args });
      // Absent-state UX: surface a helpful Notice (never a silent failure)
      // when no engine is wired, and return a structured "not configured"
      // result the caller can branch on.
      if (isNotConfigured(payload)) {
        this.notify(NOT_CONFIGURED_NOTICE);
        return { ok: false, reason: "transcription_not_configured" };
      }
      return { ok: true, mutated: [], payload };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
}
