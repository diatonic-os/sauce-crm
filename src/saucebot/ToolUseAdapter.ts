// SPEC §19.4 — Maps skills to Anthropic tool-use / OpenAI function-calling schemas.
import type { ToolDef } from "./ISauceBotProvider";
import type { ApprovalGate } from "../contract/ApprovalGate";

export interface SkillLike {
  readonly id: string;
  readonly contract: {
    inputs: Array<{
      name: string;
      type: string;
      description?: string;
      required?: boolean;
    }>;
    level: string;
  };
  readonly description?: string;
  /** Optional risk tier — surfaces in the approval modal so the operator
   *  knows when a tool call is dangerous (delete-file, send-network).
   *  Defaults to "low" when unset. */
  readonly risk?: "low" | "medium" | "high";
  execute(args: Record<string, unknown>, ctx: unknown): Promise<unknown>;
}

export class ToolUseAdapter {
  private skills = new Map<string, SkillLike>();
  /** Optional approval gate — when set, every tool call routes through
   *  it. Wired by main.ts at onload; tests construct without a gate so
   *  they don't have to stub the modal flow. */
  private approvalGate: ApprovalGate | null = null;

  register(s: SkillLike): void {
    this.skills.set(s.id, s);
  }
  unregister(id: string): void {
    this.skills.delete(id);
  }
  has(id: string): boolean {
    return this.skills.has(id);
  }

  /** Install the gate. Calling twice is allowed (idempotent overwrite). */
  setApprovalGate(gate: ApprovalGate | null): void {
    this.approvalGate = gate;
  }

  asTools(): ToolDef[] {
    return [...this.skills.values()].map((s) => ({
      name: s.id,
      description: s.description ?? `Skill: ${s.id}`,
      inputSchema: {
        type: "object",
        properties: Object.fromEntries(
          s.contract.inputs.map((i) => [
            i.name,
            { type: i.type, description: i.description ?? "" },
          ]),
        ),
        required: s.contract.inputs
          .filter((i) => i.required)
          .map((i) => i.name),
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
   * no skill is registered for `name`. Used by SauceBotRuntime's multi-turn
   * tool-use loop where unknown tools should be reported back to the model
   * rather than aborting the conversation.
   *
   * When an ApprovalGate is installed, every call routes through it under
   * the per-skill action class `execute-skill:<id>`. A deny verdict
   * returns `{ error: 'denied by operator', verdict }` so the model sees
   * the refusal and can adapt rather than retrying blindly.
   */
  async runTool(
    name: string,
    input: unknown,
    ctx: unknown = null,
  ): Promise<unknown> {
    const skill = this.skills.get(name);
    if (!skill) return { error: "unknown tool" };
    if (this.approvalGate) {
      const verdict = await this.approvalGate.ask({
        actionClass: `execute-skill:${skill.id}`,
        summary: skill.description ?? `Execute skill: ${skill.id}`,
        details:
          `Input:\n${this.stringifyInput(input)}\n\n` +
          `Skill contract level: ${skill.contract.level}`,
        risk: skill.risk ?? "low",
      });
      if (!verdict.approved) {
        return {
          error: `denied by operator (${verdict.verdict})`,
          verdict: verdict.verdict,
        };
      }
    }
    try {
      return await skill.execute((input as Record<string, unknown>) ?? {}, ctx);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  private stringifyInput(input: unknown): string {
    try {
      return JSON.stringify(input, null, 2).slice(0, 1000);
    } catch {
      return String(input).slice(0, 1000);
    }
  }
}
