import {
  Skill,
  validateInputs,
  type SkillArgs,
  type SkillContract,
  type SkillCtx,
  type SkillResult,
} from "./Skill";

export class DraftTouchSkill extends Skill {
  readonly id = "draft-touch";
  override readonly description = "Compose a Touch from a calendar event or thread";
  readonly contract: SkillContract = {
    level: "simple",
    inputs: [
      { name: "source", type: "string", required: true },
      { name: "contact_id", type: "string", required: true },
    ],
    mutable: [],
    requires: [],
    ensures: [],
    signals: [],
    costEstimate: { tokensIn: 0, tokensOut: 0, apiCalls: 1, wallClockMs: 2000 },
  };

  async execute(args: SkillArgs, ctx: SkillCtx): Promise<SkillResult> {
    const v = validateInputs(args, this.contract);
    if (!v.ok)
      return { ok: false, reason: "missing_inputs: " + v.missing.join(",") };
    try {
      const payload = await ctx.call<unknown>(this.id, args);
      await ctx.audit("skill", null, { skill: this.id, args });
      return { ok: true, mutated: [], payload };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }
}
