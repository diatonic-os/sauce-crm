// Minimal ContractParser — referenced by DqlEvaluator. Parses a contract
// expression DSL into a typed AST. Real grammar lives in spec docs; this
// implementation supports the subset DqlEvaluator currently emits.

export type ContractExpr =
  | { type: "literal"; value: string | number | boolean | null }
  | { type: "ident"; name: string }
  | { type: "binary"; op: string; left: ContractExpr; right: ContractExpr }
  | { type: "call"; callee: string; args: ContractExpr[] };

export class ContractParser {
  /** Public alias matching DqlEvaluator's expected method name. */
  parseExpr(input: string): ContractExpr {
    return this.parse(input);
  }

  parse(input: string): ContractExpr {
    const trimmed = input.trim();
    if (!trimmed) {
      return { type: "literal", value: null };
    }
    // Numeric literal
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
      return { type: "literal", value: Number(trimmed) };
    }
    // Boolean literal
    if (trimmed === "true" || trimmed === "false") {
      return { type: "literal", value: trimmed === "true" };
    }
    // Quoted string
    const q = trimmed.match(/^"((?:[^"\\]|\\.)*)"$/);
    if (q) {
      return { type: "literal", value: q[1] };
    }
    // Function call: name(arg1, arg2)
    const call = trimmed.match(/^([A-Za-z_]\w*)\((.*)\)$/);
    if (call) {
      const args = call[2].trim()
        ? call[2].split(",").map((a) => this.parse(a))
        : [];
      return { type: "call", callee: call[1], args };
    }
    // Bare identifier
    if (/^[A-Za-z_][\w.]*$/.test(trimmed)) {
      return { type: "ident", name: trimmed };
    }
    // Binary op (lowest-precedence first; this is intentionally naive)
    for (const op of ["==", "!=", ">=", "<=", ">", "<", "&&", "||", "+", "-", "*", "/"]) {
      const ix = trimmed.indexOf(op);
      if (ix > 0) {
        return {
          type: "binary",
          op,
          left: this.parse(trimmed.slice(0, ix)),
          right: this.parse(trimmed.slice(ix + op.length)),
        };
      }
    }
    return { type: "ident", name: trimmed };
  }
}
