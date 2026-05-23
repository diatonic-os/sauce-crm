// Minimal PropositionEvaluator — referenced by DqlEvaluator. Evaluates
// a parsed ContractExpr against a context dictionary.

import type { ContractExpr } from "./ContractParser";

export type EvalContext = Record<string, unknown>;

/** Built-in functions available to evaluated expressions. Exported so
 *  callers (DqlEvaluator) can extend the set or introspect. */
export const BUILTIN_FUNCS: ReadonlyArray<string> = Object.freeze([
  "len", "not", "and", "or", "eq",
]);

/** Module-level evaluator helper — convenience wrapper around an
 *  instance. Lets call sites use `evalExpr(expr, ctx)` without manually
 *  constructing a PropositionEvaluator. */
export function evalExpr(expr: ContractExpr, ctx: EvalContext): unknown {
  return new PropositionEvaluator().evaluate(expr, ctx);
}

export class PropositionEvaluator {
  evaluate(expr: ContractExpr, ctx: EvalContext): unknown {
    switch (expr.type) {
      case "literal":
        return expr.value;
      case "ident":
        return this.resolveIdent(expr.name, ctx);
      case "binary":
        return this.evalBinary(expr.op, this.evaluate(expr.left, ctx), this.evaluate(expr.right, ctx));
      case "call":
        return this.evalCall(expr.callee, expr.args.map((a) => this.evaluate(a, ctx)));
    }
  }

  // Keys that would let an attacker-controlled identifier reach
  // Object.prototype slots and trigger prototype-pollution (CWE-915).
  // We refuse to walk into any of these even if they exist as own
  // properties of the context, since the safety rule applies uniformly
  // and the swarm uses Object.create(null)-shaped contexts anyway.
  private static readonly _BLOCKED_KEYS: ReadonlySet<string> = new Set([
    "__proto__", "constructor", "prototype",
  ]);

  private resolveIdent(name: string, ctx: EvalContext): unknown {
    if (!name.includes(".")) {
      if (PropositionEvaluator._BLOCKED_KEYS.has(name)) return undefined;
      return Object.prototype.hasOwnProperty.call(ctx, name) ? ctx[name] : undefined;
    }
    const parts = name.split(".");
    let cur: unknown = ctx;
    for (const p of parts) {
      if (cur === null || cur === undefined) return undefined;
      if (PropositionEvaluator._BLOCKED_KEYS.has(p)) return undefined;
      const rec = cur as Record<string, unknown>;
      if (!Object.prototype.hasOwnProperty.call(rec, p)) return undefined;
      cur = rec[p];
    }
    return cur;
  }

  private evalBinary(op: string, l: unknown, r: unknown): unknown {
    switch (op) {
      case "==": return l === r;
      case "!=": return l !== r;
      case ">":  return (l as number) >  (r as number);
      case "<":  return (l as number) <  (r as number);
      case ">=": return (l as number) >= (r as number);
      case "<=": return (l as number) <= (r as number);
      case "&&": return Boolean(l) && Boolean(r);
      case "||": return Boolean(l) || Boolean(r);
      case "+":  return (l as number) + (r as number);
      case "-":  return (l as number) - (r as number);
      case "*":  return (l as number) * (r as number);
      case "/":  return (l as number) / (r as number);
      default:   throw new Error(`PropositionEvaluator: unknown operator ${op}`);
    }
  }

  private evalCall(callee: string, args: unknown[]): unknown {
    // Only a small library of built-ins. Extensible by subclassing.
    switch (callee) {
      case "len":  return Array.isArray(args[0]) ? args[0].length : String(args[0]).length;
      case "not":  return !args[0];
      case "and":  return args.every(Boolean);
      case "or":   return args.some(Boolean);
      case "eq":   return args[0] === args[1];
      default:     throw new Error(`PropositionEvaluator: unknown function ${callee}`);
    }
  }
}
