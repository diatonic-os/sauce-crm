import { ContractAST } from "./ContractGrammar";
import { ContractLevel } from "../domain/Entity";
import { ExprAST, BinOp } from "./Predicate";

export class ContractParser {
  parseFromFrontmatter(fm: Record<string, any>): ContractAST {
    return {
      level: (fm.contract ?? "core") as ContractLevel,
      subtype_of: fm.subtype_of ?? "Entity",
      mutable: fm.mutable ?? [],
      predicates: this.collectPreds(fm.predicate),
      constrains: this.collectStrings(fm.constrains),
      requires: this.collectStrings(fm.requires),
      ensures: this.collectStrings(fm.ensures),
      signals: this.collectSignals(fm.signals),
    };
  }

  private collectStrings(input: any): string[] {
    if (!input) return [];
    if (typeof input === "string") return [input];
    if (Array.isArray(input)) {
      const out: string[] = [];
      for (const item of input) {
        if (typeof item === "string") out.push(item);
        else if (item && typeof item === "object") {
          for (const v of Object.values(item)) out.push(String(v));
        }
      }
      return out;
    }
    return [];
  }

  private collectPreds(input: any): { name: string; raw: string }[] {
    if (!input || !Array.isArray(input)) return [];
    return input
      .filter((i) => i && typeof i === "object")
      .map((i) => ({ name: i.name ?? "anon", raw: i.def ?? "" }));
  }

  private collectSignals(input: any): { ex: string; cond: string }[] {
    if (!input || !Array.isArray(input)) return [];
    return input
      .filter((i) => i && typeof i === "object")
      .map((i) => ({ ex: i.ex ?? "Error", cond: i.cond ?? "" }));
  }

  /**
   * Parse a single expression string into an AST. Tiny recursive-descent
   * for the propositional subset described in SPEC §6.2: literals,
   * identifiers, comparison, logic, function calls, member access, `in`.
   */
  parseExpr(src: string): ExprAST | null {
    try {
      const tokens = tokenize(src);
      const parser = new ExprParser(tokens);
      const expr = parser.parseOr();
      if (!parser.atEnd()) return null;
      return expr;
    } catch {
      return null;
    }
  }
}

type Tok =
  | { kind: "num"; value: number }
  | { kind: "str"; value: string }
  | { kind: "ident"; value: string }
  | { kind: "regex"; pattern: string; flags: string }
  | { kind: "op"; value: string }
  | { kind: "lp" } | { kind: "rp" }
  | { kind: "lb" } | { kind: "rb" }
  | { kind: "comma" }
  | { kind: "dot" };

function tokenize(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (/[0-9]/.test(c)) {
      let j = i; while (j < src.length && /[0-9.]/.test(src[j])) j++;
      out.push({ kind: "num", value: Number(src.slice(i, j)) });
      i = j; continue;
    }
    if (c === '"' || c === "'") {
      const q = c; let j = i + 1; let val = "";
      while (j < src.length && src[j] !== q) { val += src[j]; j++; }
      out.push({ kind: "str", value: val });
      i = j + 1; continue;
    }
    if (c === "/") {
      // could be regex literal /pat/flags or division — we only support regex in =~ context;
      // parser handles ambiguity by trying regex first when previous tok is =~
      let j = i + 1; let pat = "";
      while (j < src.length && src[j] !== "/") {
        if (src[j] === "\\" && j + 1 < src.length) { pat += src[j] + src[j + 1]; j += 2; continue; }
        pat += src[j]; j++;
      }
      let flags = ""; let k = j + 1;
      while (k < src.length && /[gimsuy]/.test(src[k])) { flags += src[k]; k++; }
      out.push({ kind: "regex", pattern: pat, flags });
      i = k; continue;
    }
    if (/[a-zA-Z_$]/.test(c)) {
      let j = i; while (j < src.length && /[a-zA-Z0-9_$]/.test(src[j])) j++;
      out.push({ kind: "ident", value: src.slice(i, j) });
      i = j; continue;
    }
    if (c === "(") { out.push({ kind: "lp" }); i++; continue; }
    if (c === ")") { out.push({ kind: "rp" }); i++; continue; }
    if (c === "[") { out.push({ kind: "lb" }); i++; continue; }
    if (c === "]") { out.push({ kind: "rb" }); i++; continue; }
    if (c === ",") { out.push({ kind: "comma" }); i++; continue; }
    if (c === ".") { out.push({ kind: "dot" }); i++; continue; }
    // multi-char ops
    const two = src.slice(i, i + 2);
    if (["&&","||","==","!=","<=",">=","=~"].includes(two)) {
      out.push({ kind: "op", value: two }); i += 2; continue;
    }
    if ("!<>+-*/=∈".includes(c)) {
      const op = c === "∈" ? "in" : c;
      out.push({ kind: "op", value: op }); i++; continue;
    }
    // unknown char — skip
    i++;
  }
  return out;
}

class ExprParser {
  pos = 0;
  constructor(private toks: Tok[]) {}

  atEnd(): boolean { return this.pos >= this.toks.length; }
  peek(k = 0): Tok | null { return this.toks[this.pos + k] ?? null; }
  eat(): Tok { return this.toks[this.pos++]; }

  parseOr(): ExprAST {
    let lhs = this.parseAnd();
    while (this.matchOp("||")) {
      const rhs = this.parseAnd();
      lhs = { kind: "bin", op: "||", lhs, rhs };
    }
    return lhs;
  }
  parseAnd(): ExprAST {
    let lhs = this.parseCmp();
    while (this.matchOp("&&")) {
      const rhs = this.parseCmp();
      lhs = { kind: "bin", op: "&&", lhs, rhs };
    }
    return lhs;
  }
  parseCmp(): ExprAST {
    let lhs = this.parseAdd();
    while (true) {
      const ops = ["==","!=","<","<=",">",">=","=~"];
      let matched: string | null = null;
      for (const op of ops) if (this.matchOp(op)) { matched = op; break; }
      if (!matched) {
        if (this.matchIdent("in")) {
          const haystack = this.parseAdd();
          lhs = { kind: "in", needle: lhs, haystack };
          continue;
        }
        if (this.matchOp("in")) {
          const haystack = this.parseAdd();
          lhs = { kind: "in", needle: lhs, haystack };
          continue;
        }
        break;
      }
      const rhs = this.parseAdd();
      lhs = { kind: "bin", op: matched as BinOp, lhs, rhs };
    }
    return lhs;
  }
  parseAdd(): ExprAST {
    let lhs = this.parseMul();
    while (true) {
      if (this.matchOp("+")) lhs = { kind: "bin", op: "+", lhs, rhs: this.parseMul() };
      else if (this.matchOp("-")) lhs = { kind: "bin", op: "-", lhs, rhs: this.parseMul() };
      else break;
    }
    return lhs;
  }
  parseMul(): ExprAST {
    let lhs = this.parseUn();
    while (true) {
      if (this.matchOp("*")) lhs = { kind: "bin", op: "*", lhs, rhs: this.parseUn() };
      else if (this.matchOp("/")) lhs = { kind: "bin", op: "/", lhs, rhs: this.parseUn() };
      else break;
    }
    return lhs;
  }
  parseUn(): ExprAST {
    if (this.matchOp("!")) return { kind: "un", op: "!", arg: this.parseUn() };
    if (this.matchOp("-")) return { kind: "un", op: "-", arg: this.parseUn() };
    return this.parseAtom();
  }
  parseAtom(): ExprAST {
    const t = this.peek();
    if (!t) throw new Error("unexpected end");
    if (t.kind === "num")  { this.eat(); return { kind: "lit", value: t.value }; }
    if (t.kind === "str")  { this.eat(); return { kind: "lit", value: t.value }; }
    if (t.kind === "regex"){ this.eat(); return { kind: "regex", pattern: t.pattern, flags: t.flags }; }
    if (t.kind === "lp") {
      this.eat();
      const e = this.parseOr();
      if (this.peek()?.kind !== "rp") throw new Error("expected )");
      this.eat();
      return e;
    }
    if (t.kind === "ident") {
      this.eat();
      let node: ExprAST = { kind: "ident", name: t.value };
      // call?
      if (this.peek()?.kind === "lp") {
        this.eat();
        const args: ExprAST[] = [];
        if (this.peek()?.kind !== "rp") {
          args.push(this.parseOr());
          while (this.peek()?.kind === "comma") { this.eat(); args.push(this.parseOr()); }
        }
        if (this.peek()?.kind !== "rp") throw new Error("expected )");
        this.eat();
        node = { kind: "call", name: t.value, args };
      }
      while (this.peek()?.kind === "dot") {
        this.eat();
        const m = this.peek();
        if (!m || m.kind !== "ident") throw new Error("expected member");
        this.eat();
        node = { kind: "member", obj: node, member: m.value };
      }
      return node;
    }
    throw new Error("unexpected token");
  }

  matchOp(op: string): boolean {
    const t = this.peek();
    if (t && t.kind === "op" && t.value === op) { this.eat(); return true; }
    return false;
  }
  matchIdent(id: string): boolean {
    const t = this.peek();
    if (t && t.kind === "ident" && t.value === id) { this.eat(); return true; }
    return false;
  }
}
