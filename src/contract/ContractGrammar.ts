import { ContractLevel } from "../domain/Entity";

export interface ContractAST {
  level: ContractLevel;
  subtype_of: string;
  mutable: string[];
  predicates: { name: string; raw: string }[];
  constrains: string[];
  requires: string[];
  ensures: string[];
  signals: { ex: string; cond: string }[];
}

export const LEVELS: ContractLevel[] = ["nosubtype", "subtype", "core", "simple", "extended", "full"];

export function levelAtLeast(actual: ContractLevel, min: ContractLevel): boolean {
  return LEVELS.indexOf(actual) >= LEVELS.indexOf(min);
}
