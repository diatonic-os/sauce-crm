import { ContractAST } from "./ContractGrammar";
import { ContractParser } from "./ContractParser";
import { evalExpr, EvalCtx, BUILTIN_FUNCS } from "./PropositionEvaluator";

export interface ValidationResult {
  passed: boolean;
  violations: { invariant: string; reason: string }[];
}

export interface ValidatorOptions {
  strictness: "block" | "warn" | "log";
  enums: Record<string, string[]>;
  vaultLookup?: (wikilink: string) => Record<string, any> | null;
}

export class ContractValidator {
  private parser = new ContractParser();

  constructor(private opts: ValidatorOptions) {}

  validate(fm: Record<string, any>, ancestorContracts: ContractAST[] = []): ValidationResult {
    const own = this.parser.parseFromFrontmatter(fm);
    const merged = mergeLsp(own, ancestorContracts);

    const violations: { invariant: string; reason: string }[] = [];
    const ctx: EvalCtx = {
      vars: { ...fm, self: fm, enum: this.opts.enums, today: new Date().toISOString().slice(0, 10) },
      funcs: {
        ...BUILTIN_FUNCS,
        file: (link: string) => this.opts.vaultLookup?.(link) ?? {},
      },
    };

    for (const c of merged.constrains) {
      const ast = this.parser.parseExpr(c);
      if (!ast) { violations.push({ invariant: c, reason: "parse error" }); continue; }
      try {
        const v = evalExpr(ast, ctx);
        if (!v) violations.push({ invariant: c, reason: "predicate evaluated false" });
      } catch (e: any) {
        violations.push({ invariant: c, reason: e?.message ?? String(e) });
      }
    }
    return { passed: violations.length === 0, violations };
  }
}

/**
 * Liskov merge: ancestors' invariants must hold on the subtype.
 * Preconditions widen (∨), postconditions narrow (∧), frame shrinks, signals shrink.
 * Concretely: constrains accumulates (covariant — child preserves parent invariants).
 */
export function mergeLsp(own: ContractAST, ancestors: ContractAST[]): ContractAST {
  const all = [...ancestors, own];
  const merged: ContractAST = {
    level: own.level,
    subtype_of: own.subtype_of,
    mutable: intersect(all.map((a) => a.mutable.length ? a.mutable : own.mutable)),
    predicates: dedup(all.flatMap((a) => a.predicates), (p) => p.name),
    constrains: dedup(all.flatMap((a) => a.constrains), (s) => s),
    requires: union(all.map((a) => a.requires)),
    ensures: dedup(all.flatMap((a) => a.ensures), (s) => s),
    signals: dedup(all.flatMap((a) => a.signals), (s) => s.ex),
  };
  return merged;
}

function intersect<T>(lists: T[][]): T[] {
  if (lists.length === 0) return [];
  const first = lists[0];
  return first.filter((x) => lists.every((l) => l.includes(x)));
}

function union<T>(lists: T[][]): T[] {
  const out: T[] = [];
  const seen = new Set<T>();
  for (const l of lists) for (const x of l) if (!seen.has(x)) { seen.add(x); out.push(x); }
  return out;
}

function dedup<T>(list: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const x of list) {
    const k = key(x);
    if (!seen.has(k)) { seen.add(k); out.push(x); }
  }
  return out;
}
