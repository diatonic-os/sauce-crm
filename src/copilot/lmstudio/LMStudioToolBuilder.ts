// SPEC §20.4 — Expose V2 Skills as LM Studio SDK tools via .act().
import type { ToolSpec } from './LMStudioActService';
import type { Skill, SkillCtx } from '../../skills/Skill';

export interface ToolBuilderOpts {
  /** Optional filter — only expose skills whose id matches. */
  include?: (skillId: string) => boolean;
  /** Build the SkillCtx for each invocation. */
  contextFactory: () => SkillCtx;
}

export class LMStudioToolBuilder {
  build(skills: Skill[], opts: ToolBuilderOpts): ToolSpec[] {
    return skills
      .filter((s) => !opts.include || opts.include(s.id))
      .map((s) => ({
        name: s.id.replace(/[^a-zA-Z0-9_]/g, '_'),
        description: s.description || `Skill: ${s.id}`,
        parameters: {
          type: 'object',
          properties: Object.fromEntries(s.contract.inputs.map((i) => [i.name, { type: i.type, description: i.description ?? '' }])),
          required: s.contract.inputs.filter((i) => i.required).map((i) => i.name),
        },
        invoke: async (args) => {
          const result = await s.execute(args as Record<string, unknown>, opts.contextFactory());
          if (!result.ok) throw new Error(`skill ${s.id} failed: ${result.reason}`);
          return result.payload;
        },
      }));
  }
}
