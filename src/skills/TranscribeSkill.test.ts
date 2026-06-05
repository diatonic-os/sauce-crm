// CON-SAUCEBOT S8 — TranscribeSkill absent-state UX: a helpful Notice when no
// engine is configured (never a silent failure), success passthrough otherwise.

import { describe, expect, it, vi } from "vitest";
import { TranscribeSkill } from "./TranscribeSkill";
import type { SkillCtx } from "./Skill";

/** A TranscribeSkill with the Notice seam captured for assertion. */
class SpyTranscribeSkill extends TranscribeSkill {
  notices: string[] = [];
  protected override notify(message: string): void {
    this.notices.push(message);
  }
}

function ctxReturning(payload: unknown): {
  ctx: SkillCtx;
  audit: ReturnType<typeof vi.fn>;
} {
  const audit = vi.fn(async () => {});
  const ctx: SkillCtx = {
    autonomy: "propose",
    agentId: "test",
    call: async <T>() => payload as T,
    audit,
    scope: { require: () => {} },
  };
  return { ctx, audit };
}

describe("TranscribeSkill", () => {
  it("returns missing_inputs when audio_path is absent", async () => {
    const skill = new SpyTranscribeSkill();
    const { ctx } = ctxReturning({ text: "x" });
    const r = await skill.execute({}, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toMatch(/missing_inputs/);
  });

  it("surfaces a helpful Notice when the engine is not configured (pending)", async () => {
    const skill = new SpyTranscribeSkill();
    const { ctx } = ctxReturning({
      pending: "transcribe",
      reason: "no transcription engine configured (desktop only)",
    });
    const r = await skill.execute({ audio_path: "/a.m4a" }, ctx);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("transcription_not_configured");
    expect(skill.notices).toHaveLength(1);
    expect(skill.notices[0]).toMatch(/Settings/);
    expect(skill.notices[0]).toMatch(/daemon/);
  });

  it("surfaces the Notice when the engine reports 'not runnable'", async () => {
    const skill = new SpyTranscribeSkill();
    const { ctx } = ctxReturning({
      error: "whisper not runnable: binary path must be absolute",
    });
    const r = await skill.execute({ audio_path: "/a.m4a" }, ctx);
    expect(r.ok).toBe(false);
    expect(skill.notices).toHaveLength(1);
  });

  it("passes a successful transcript through unchanged (no Notice)", async () => {
    const skill = new SpyTranscribeSkill();
    const { ctx, audit } = ctxReturning({ text: "hello world" });
    const r = await skill.execute({ audio_path: "/a.m4a" }, ctx);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.payload as { text: string }).text).toBe("hello world");
    expect(skill.notices).toHaveLength(0);
    expect(audit).toHaveBeenCalled();
  });
});
