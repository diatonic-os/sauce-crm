import { ExprAST } from "./Predicate";

// Contract grammar's `=~` operator is intentionally NOT a regex — it is a tiny
// glob matcher supporting only `.+` (one-or-more anything) as a metasequence.
// Everything else is treated as a literal substring requirement. This keeps the
// surface inside the contract grammar safe (no dynamic RegExp from frontmatter
// input → no ReDoS attack surface). Sufficient for SPEC §2.2's documented use
// (`company =~ /\[\[.+\]\]/`).
function globMatch(input: string, pattern: string): boolean {
  if (typeof input !== "string" || typeof pattern !== "string") return false;
  if (pattern.length > 200) return false;
  // Strip leading/trailing slashes if author wrote /pat/ literal form
  if (pattern.startsWith("/") && pattern.lastIndexOf("/") > 0) {
    pattern = pattern.slice(1, pattern.lastIndexOf("/"));
  }
  return matchGlobLiteral(input, pattern, 0, 0);
}

function matchGlobLiteral(s: string, p: string, si: number, pi: number): boolean {
  while (pi < p.length) {
    // honor escaped literal `\X` — consume backslash and next char as literal
    if (p[pi] === "\\" && pi + 1 < p.length) {
      if (si >= s.length || s[si] !== p[pi + 1]) return false;
      si++; pi += 2; continue;
    }
    // `.+` star
    if (p[pi] === "." && p[pi + 1] === "+") {
      pi += 2;
      if (pi >= p.length) return si < s.length;
      // try each split point ≥ 1
      for (let k = si + 1; k <= s.length; k++) {
        if (matchGlobLiteral(s, p, k, pi)) return true;
      }
      return false;
    }
    if (si >= s.length) return false;
    if (s[si] !== p[pi]) return false;
    si++; pi++;
  }
  return si === s.length;
}

export interface EvalCtx {
  vars: Record<string, any>;
  funcs: Record<string, (...args: any[]) => any>;
}

export function evalExpr(ast: ExprAST, ctx: EvalCtx): any {
  switch (ast.kind) {
    case "lit": return ast.value;
    case "regex": return { __pattern: ast.pattern };   // opaque pattern handle
    case "ident": {
      if (ast.name === "true") return true;
      if (ast.name === "false") return false;
      if (ast.name === "null") return null;
      return ctx.vars[ast.name];
    }
    case "member": {
      const obj = evalExpr(ast.obj, ctx);
      return obj == null ? null : obj[ast.member];
    }
    case "call": {
      const fn = ctx.funcs[ast.name];
      if (!fn) throw new Error(`unknown function ${ast.name}`);
      return fn(...ast.args.map((a) => evalExpr(a, ctx)));
    }
    case "un": {
      const v = evalExpr(ast.arg, ctx);
      return ast.op === "!" ? !v : -v;
    }
    case "in": {
      const needle = evalExpr(ast.needle, ctx);
      const hay = evalExpr(ast.haystack, ctx);
      if (Array.isArray(hay)) return hay.includes(needle);
      if (typeof hay === "string") return hay.includes(String(needle));
      if (hay && typeof hay === "object") return needle in hay;
      return false;
    }
    case "bin": {
      const l = evalExpr(ast.lhs, ctx);
      const r = evalExpr(ast.rhs, ctx);
      switch (ast.op) {
        case "&&": return l && r;
        case "||": return l || r;
        case "==": return l === r || (l == null && r == null);
        case "!=": return l !== r;
        case "<":  return l < r;
        case "<=": return l <= r;
        case ">":  return l > r;
        case ">=": return l >= r;
        case "+":  return l + r;
        case "-":  return l - r;
        case "*":  return l * r;
        case "/":  return l / r;
        case "=~": {
          // r is either a {__pattern} handle from a regex literal, or a plain string
          const pat = (r && typeof r === "object" && "__pattern" in r) ? r.__pattern as string : String(r);
          return globMatch(String(l), pat);
        }
      }
    }
  }
}

export const BUILTIN_FUNCS: Record<string, (...args: any[]) => any> = {
  today: () => new Date().toISOString().slice(0, 10),
  len: (a: any) => Array.isArray(a) || typeof a === "string" ? a.length : 0,
  count: (a: any) => Array.isArray(a) ? a.length : 0,
  date: (s: any) => new Date(String(s)).toISOString().slice(0, 10),
  upper: (s: any) => String(s).toUpperCase(),
  lower: (s: any) => String(s).toLowerCase(),
  has: (arr: any, x: any) => Array.isArray(arr) && arr.includes(x),
  isnull: (x: any) => x == null,
  not_null: (x: any) => x != null,
  closure: (..._args: any[]) => [],   // wired by Validator with vault context
  file: (..._args: any[]) => ({}),    // wired by Validator
};
