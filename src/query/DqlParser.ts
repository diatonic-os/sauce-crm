import { DqlTok, lexDql } from "./DqlLexer";

export interface DqlQuery {
  shape: "TABLE" | "LIST" | "TASK" | "PATH" | "COMPATIBLE" | "GRAPH" | "HEATMAP" | "MATRIX";
  columns?: string[];        // for TABLE
  from?: string;             // folder source
  where?: string;            // raw filter expr, passed to PropositionEvaluator
  sort?: { field: string; dir: "ASC" | "DESC" }[];
  groupBy?: string;
  limit?: number;
  // PATH ...
  pathFrom?: string;
  pathTo?: string;
  pathOver?: string[];
  pathObjective?: { mode: "MAXIMIZE" | "MINIMIZE"; metric: string };
  // COMPATIBLE WITH ...
  compatWith?: string;
  compatOver?: string[];
  compatDensity?: number;
  // GRAPH ...
  graphNodes?: string[];
  graphEdges?: string[];
  graphColor?: string;
  // HEATMAP ...
  heatmapField?: string;
  heatmapBucket?: string;
  // MATRIX
  matrixOp?: string;
  matrixOver?: string[];
}

export class DqlParser {
  toks: DqlTok[] = [];
  pos = 0;

  parse(src: string): DqlQuery {
    this.toks = lexDql(src);
    this.pos = 0;
    const first = this.peek();
    if (!first || first.kind !== "kw") throw new Error("expected query keyword");
    switch (first.value) {
      case "TABLE":      return this.parseTabular("TABLE");
      case "LIST":       return this.parseTabular("LIST");
      case "TASK":       return this.parseTabular("TASK");
      case "PATH":       return this.parsePath();
      case "COMPATIBLE": return this.parseCompat();
      case "GRAPH":      return this.parseGraph();
      case "HEATMAP":    return this.parseHeatmap();
      case "MATRIX":     return this.parseMatrix();
      default: throw new Error(`unknown query shape: ${first.value}`);
    }
  }

  private peek(k = 0): DqlTok | null { return this.toks[this.pos + k] ?? null; }
  private eat(): DqlTok { return this.toks[this.pos++]; }
  private matchKw(k: string): boolean {
    const t = this.peek();
    if (t && t.kind === "kw" && t.value === k) { this.eat(); return true; }
    return false;
  }
  private expectKw(k: string): void { if (!this.matchKw(k)) throw new Error(`expected ${k}`); }

  private parseTabular(shape: "TABLE" | "LIST" | "TASK"): DqlQuery {
    this.eat(); // shape keyword
    const cols: string[] = [];
    if (shape === "TABLE") {
      while (this.peek() && !(this.peek()!.kind === "kw" && (this.peek() as any).value === "FROM")) {
        const t = this.eat();
        if (t.kind === "ident" || t.kind === "str") cols.push(t.value);
        if (t.kind === "punct" && t.value === ",") continue;
      }
    }
    const q: DqlQuery = { shape, columns: cols };
    this.parseCommonClauses(q);
    return q;
  }

  private parsePath(): DqlQuery {
    this.eat(); // PATH
    this.matchKw("FROM");
    const from = this.eatLiteralOrLink();
    this.expectKw("TO");
    const to = this.eatLiteralOrLink();
    const q: DqlQuery = { shape: "PATH", pathFrom: from, pathTo: to, pathOver: [] };
    if (this.matchKw("OVER")) q.pathOver = this.eatIdentList();
    if (this.matchKw("MAXIMIZE")) q.pathObjective = { mode: "MAXIMIZE", metric: this.eatIdent() };
    else if (this.matchKw("MINIMIZE")) q.pathObjective = { mode: "MINIMIZE", metric: this.eatIdent() };
    if (this.matchKw("LIMIT")) q.limit = this.eatNumber();
    return q;
  }

  private parseCompat(): DqlQuery {
    this.eat(); // COMPATIBLE
    this.expectKw("WITH");
    const target = this.eatLiteralOrLink();
    const q: DqlQuery = { shape: "COMPATIBLE", compatWith: target, compatOver: [] };
    if (this.matchKw("OVER")) q.compatOver = this.eatIdentList();
    if (this.matchKw("WHERE")) {
      // expect: DENSITY > N
      if (this.matchKw("DENSITY")) {
        const op = this.eat(); // op
        const n = this.eatNumber();
        q.compatDensity = n;
        void op;
      }
    }
    if (this.matchKw("SORT")) q.sort = [{ field: this.eatIdent(), dir: this.matchKw("DESC") ? "DESC" : "ASC" }];
    return q;
  }

  private parseGraph(): DqlQuery {
    this.eat();
    const q: DqlQuery = { shape: "GRAPH", graphNodes: [], graphEdges: [] };
    if (this.matchKw("NODES")) {
      this.matchKw("FROM");
      q.graphNodes = this.eatStringList();
    }
    if (this.matchKw("EDGES")) q.graphEdges = this.eatIdentList();
    if (this.matchKw("COLOR")) q.graphColor = this.eatIdent();
    return q;
  }

  private parseHeatmap(): DqlQuery {
    this.eat();
    const field = this.eatIdent();
    this.matchKw("BY");
    const bucket = this.eatIdent();
    const q: DqlQuery = { shape: "HEATMAP", heatmapField: field, heatmapBucket: bucket };
    this.parseCommonClauses(q);
    return q;
  }

  private parseMatrix(): DqlQuery {
    this.eat();
    const op = this.eatIdent();
    const q: DqlQuery = { shape: "MATRIX", matrixOp: op, matrixOver: [] };
    if (this.matchKw("OVER")) q.matrixOver = this.eatIdentList();
    this.parseCommonClauses(q);
    return q;
  }

  private parseCommonClauses(q: DqlQuery): void {
    if (this.matchKw("FROM")) q.from = this.eatLiteralOrLink();
    if (this.matchKw("WHERE")) {
      // consume until next clause keyword
      const buf: string[] = [];
      while (this.peek()) {
        const t = this.peek()!;
        if (t.kind === "kw" && ["SORT","GROUP","FLATTEN","LIMIT"].includes(t.value)) break;
        this.eat();
        if (t.kind === "str") buf.push(`"${t.value}"`);
        else if (t.kind === "wikilink") buf.push(`"[[${t.target}]]"`);
        else if (t.kind === "num") buf.push(String(t.value));
        else if ("value" in t) buf.push(String((t as any).value));
        else buf.push("");
      }
      q.where = buf.join(" ");
    }
    if (this.matchKw("SORT")) {
      q.sort = [];
      while (this.peek() && this.peek()!.kind === "ident") {
        const f = this.eatIdent();
        const dir = this.matchKw("DESC") ? "DESC" : (this.matchKw("ASC") ? "ASC" : "ASC");
        q.sort.push({ field: f, dir });
        if (!this.matchPunct(",")) break;
      }
    }
    if (this.matchKw("LIMIT")) q.limit = this.eatNumber();
  }

  private matchPunct(p: string): boolean {
    const t = this.peek();
    if (t && t.kind === "punct" && t.value === p) { this.eat(); return true; }
    return false;
  }
  private eatLiteralOrLink(): string {
    const t = this.eat();
    if (t.kind === "str") return t.value;
    if (t.kind === "wikilink") return t.target;
    if (t.kind === "ident") return t.value;
    throw new Error("expected literal or wikilink");
  }
  private eatIdent(): string {
    const t = this.eat();
    if (t.kind !== "ident") throw new Error("expected identifier");
    return t.value;
  }
  private eatNumber(): number {
    const t = this.eat();
    if (t.kind !== "num") throw new Error("expected number");
    return t.value;
  }
  private eatIdentList(): string[] {
    const ids: string[] = [];
    while (this.peek() && this.peek()!.kind === "ident") {
      ids.push(this.eatIdent());
      if (!this.matchPunct(",")) break;
    }
    return ids;
  }
  private eatStringList(): string[] {
    const out: string[] = [];
    while (this.peek() && (this.peek()!.kind === "str" || this.peek()!.kind === "ident")) {
      const t = this.eat();
      out.push((t as any).value);
      if (!this.matchPunct(",")) break;
    }
    return out;
  }
}
