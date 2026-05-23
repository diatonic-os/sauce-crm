// SPEC §20.1 — Skill as LSP-typed contract base class. Subclasses must obey LSP per §16.2.

export type AutonomyLevel =
  | "propose"
  | "confirm-each"
  | "confirm-bulk"
  | "autonomous";
export type ContractLevel = "core" | "simple" | "extended" | "full";

export interface ParamDescriptor {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  description?: string;
  required?: boolean;
  default?: unknown;
}
export interface ExprAST {
  kind: "predicate";
  name: string;
  args?: unknown[];
}
export interface SignalDescriptor {
  exception: string;
  condition: ExprAST;
}
export interface CostModel {
  tokensIn: number;
  tokensOut: number;
  apiCalls: number;
  wallClockMs: number;
}

export interface SkillContract {
  level: ContractLevel;
  inputs: ParamDescriptor[];
  mutable: string[];
  requires: ExprAST[];
  ensures: ExprAST[];
  signals: SignalDescriptor[];
  costEstimate: CostModel;
}

export interface SkillCtx {
  readonly autonomy: AutonomyLevel;
  readonly agentId: string;
  readonly providerHint?: string;
  call<T>(serviceId: string, args: unknown): Promise<T>;
  audit(
    op: string,
    entityId: string | null,
    details: Record<string, unknown>,
  ): Promise<void>;
  scope: { require(integration: string, scope: string): void };
}

export type SkillArgs = Record<string, unknown>;
export type SkillResult =
  | { ok: true; mutated: string[]; payload: unknown }
  | { ok: false; reason: string; signal?: string };

export abstract class Skill {
  abstract readonly id: string;
  abstract readonly contract: SkillContract;
  readonly description: string = "";
  abstract execute(args: SkillArgs, ctx: SkillCtx): Promise<SkillResult>;
  rollback?(): Promise<void>;
}

export function validateInputs(
  args: SkillArgs,
  contract: SkillContract,
): { ok: boolean; missing: string[] } {
  const missing = contract.inputs
    .filter((i) => i.required && !(i.name in args))
    .map((i) => i.name);
  return { ok: missing.length === 0, missing };
}
