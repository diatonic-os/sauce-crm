// SPEC §19.4 — Maps skills to Anthropic tool-use / OpenAI function-calling schemas.
import type { ToolDef } from './ICopilotProvider';

export interface SkillLike {
  readonly id: string;
  readonly contract: { inputs: Array<{ name: string; type: string; description?: string; required?: boolean }>; level: string };
  readonly description?: string;
  execute(args: Record<string, unknown>, ctx: unknown): Promise<unknown>;
}

export class ToolUseAdapter {
  private skills = new Map<string, SkillLike>();
  register(s: SkillLike): void { this.skills.set(s.id, s); }
  unregister(id: string): void { this.skills.delete(id); }
  has(id: string): boolean { return this.skills.has(id); }

  asTools(): ToolDef[] {
    return [...this.skills.values()].map((s) => ({
      name: s.id,
      description: s.description ?? `Skill: ${s.id}`,
      inputSchema: {
        type: 'object',
        properties: Object.fromEntries(s.contract.inputs.map((i) => [i.name, { type: i.type, description: i.description ?? '' }])),
        required: s.contract.inputs.filter((i) => i.required).map((i) => i.name),
      },
    }));
  }

  async dispatch(name: string, input: unknown, ctx: unknown): Promise<unknown> {
    const skill = this.skills.get(name);
    if (!skill) throw new Error(`unknown tool: ${name}`);
    return await skill.execute((input as Record<string, unknown>) ?? {}, ctx);
  }

  /**
   * Dispatch by name without throwing; returns `{ error: 'unknown tool' }` if
   * no skill is registered for `name`. Used by CopilotRuntime's multi-turn
   * tool-use loop where unknown tools should be reported back to the model
   * rather than aborting the conversation.
   */
  async runTool(name: string, input: unknown, ctx: unknown = null): Promise<unknown> {
    const skill = this.skills.get(name);
    if (!skill) return { error: 'unknown tool' };
    try {
      return await skill.execute((input as Record<string, unknown>) ?? {}, ctx);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }
}
