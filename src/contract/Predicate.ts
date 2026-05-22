export type ExprAST =
  | { kind: "lit"; value: number | string | boolean | null }
  | { kind: "ident"; name: string }
  | { kind: "regex"; pattern: string; flags: string }
  | { kind: "bin"; op: BinOp; lhs: ExprAST; rhs: ExprAST }
  | { kind: "un"; op: "!" | "-"; arg: ExprAST }
  | { kind: "call"; name: string; args: ExprAST[] }
  | { kind: "member"; obj: ExprAST; member: string }
  | { kind: "in"; needle: ExprAST; haystack: ExprAST };

export type BinOp = "&&" | "||" | "==" | "!=" | "<" | "<=" | ">" | ">=" | "+" | "-" | "*" | "/" | "=~";

export interface PredicateDef {
  name: string;
  expr: ExprAST | null;
  raw: string;
}
