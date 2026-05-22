import { DqlQuery } from "./DqlParser";
import { ContractParser } from "../contract/ContractParser";
import { evalExpr, BUILTIN_FUNCS } from "../contract/PropositionEvaluator";

export interface QueryRow {
  file: string;            // basename
  path: string;            // full vault path
  frontmatter: Record<string, any>;
}

export interface EvalResult {
  shape: DqlQuery["shape"];
  headers?: string[];
  rows?: QueryRow[];
  data?: any;              // path/graph/matrix payload
}

export class DqlEvaluator {
  private parser = new ContractParser();

  evaluate(q: DqlQuery, rows: QueryRow[]): EvalResult {
    let scoped = rows;
    if (q.from) scoped = rows.filter((r) => r.path.startsWith(stripQuotes(q.from!)));
    if (q.where) scoped = scoped.filter((r) => this.evalWhere(q.where!, r));
    if (q.sort) {
      scoped = [...scoped].sort((a, b) => {
        for (const s of q.sort!) {
          const av = a.frontmatter[s.field], bv = b.frontmatter[s.field];
          const cmp = av == null ? 1 : bv == null ? -1 : av > bv ? 1 : av < bv ? -1 : 0;
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
        vars: { ...row.frontmatter, self: row.frontmatter, today: new Date().toISOString().slice(0, 10) },
        funcs: { ...BUILTIN_FUNCS },
      });
      return !!v;
    } catch { return false; }
  }
}

function stripQuotes(s: string): string {
  if (!s) return s;
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    return s.slice(1, -1);
  }
  return s;
}
