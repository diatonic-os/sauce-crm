import { DqlQuery } from "./DqlParser";
import { ContractParser } from "../contract/ContractParser";
import { evalExpr, BUILTIN_FUNCS } from "../contract/PropositionEvaluator";

export interface QueryRow {
  file: string; // basename
  path: string; // full vault path
  frontmatter: Record<string, unknown>;
}

export interface EvalResult {
  shape: DqlQuery["shape"];
  headers?: string[];
  rows?: QueryRow[];
  data?: unknown; // path/graph/matrix payload
}

export class DqlEvaluator {
  private parser = new ContractParser();

  evaluate(q: DqlQuery, rows: QueryRow[]): EvalResult {
    let scoped = rows;
    if (q.from)
      scoped = rows.filter((r) => r.path.startsWith(stripQuotes(q.from!)));
    if (q.where) scoped = scoped.filter((r) => this.evalWhere(q.where!, r));
    if (q.sort) {
      scoped = [...scoped].sort((a, b) => {
        for (const s of q.sort!) {
          const av = a.frontmatter[s.field],
            bv = b.frontmatter[s.field];
          // Nulls always sort last, independent of direction (the old code
          // applied -cmp under DESC, which flipped nulls to the front).
          const aNull = av == null,
            bNull = bv == null;
          if (aNull && bNull) continue;
          if (aNull) return 1;
          if (bNull) return -1;
          const cmp = compareValues(av, bv);
          if (cmp !== 0) return s.dir === "DESC" ? -cmp : cmp;
        }
        return 0;
      });
    }
    if (q.limit) scoped = scoped.slice(0, q.limit);
    return { shape: q.shape, headers: q.columns ?? ["file"], rows: scoped };
  }

  private evalWhere(src: string, row: QueryRow): boolean {
    const ast = this.parser.parseExpr(src);
    if (!ast) return true;
    try {
      const v = evalExpr(ast, {
        vars: {
          ...row.frontmatter,
          self: row.frontmatter,
          today: new Date().toISOString().slice(0, 10),
        },
        funcs: { ...BUILTIN_FUNCS },
      });
      return !!v;
    } catch {
      return false;
    }
  }
}

/**
 * Deterministic comparison for heterogeneous frontmatter values. Raw JS `>`/`<`
 * returns false both ways for non-comparable pairs (e.g. number vs non-numeric
 * string), yielding cmp=0 and unstable order. Compare like-typed values
 * natively; otherwise fall back to a stable string form (ISO dates sort
 * correctly as strings).
 */
function compareValues(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number")
    return a < b ? -1 : a > b ? 1 : 0;
  if (typeof a === "boolean" && typeof b === "boolean")
    return a === b ? 0 : a ? 1 : -1;
  const as = a instanceof Date ? a.toISOString() : String(a);
  const bs = b instanceof Date ? b.toISOString() : String(b);
  return as < bs ? -1 : as > bs ? 1 : 0;
}

function stripQuotes(s: string): string {
  if (!s) return s;
  if (
    (s.startsWith('"') && s.endsWith('"')) ||
    (s.startsWith("'") && s.endsWith("'"))
  ) {
    return s.slice(1, -1);
  }
  return s;
}
