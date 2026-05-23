import {
  Skill,
  validateInputs,
  type SkillArgs,
  type SkillContract,
  type SkillCtx,
  type SkillResult,
} from "./Skill";

export class SummarizeWeekSkill extends Skill {
  readonly id = "summarize-week";
  readonly description = "Weekly briefing of overdue + recent";
  readonly contract: SkillContract = {
    level: "simple",
    inputs: [{ name: "week_iso", type: "string", required: false }],
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
