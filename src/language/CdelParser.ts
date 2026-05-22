// SPEC §32.2 — Parser for at_directive | natural.
import type { Token } from './CdelLexer';

export type Verb = 'person' | 'org' | 'touch' | 'addendum' | 'intro' | 'tag' | 'relation' | 'sub-vault';
export interface CdelDirective {
  kind: 'directive';
  verb: Verb | string;
  subject: { ident?: string; wikilink?: string };
  target?: { ident?: string; wikilink?: string };
  metadata: Record<string, string | string[] | number>;
  body?: string;
}
export interface CdelNatural { kind: 'natural'; text: string; }
export type CdelNode = CdelDirective | CdelNatural;

export function parse(tokens: Token[]): CdelNode[] {
  const out: CdelNode[] = [];
  let i = 0;
  const peek = () => tokens[i];
  const eat = () => tokens[i++];
  while (peek().kind !== 'EOF') {
    if (peek().kind === 'NEWLINE') { eat(); continue; }
    if (peek().kind === 'AT') {
      eat();
      const verbTok = eat();
      const node: CdelDirective = { kind: 'directive', verb: verbTok.value, subject: {}, metadata: {} };
      // subject (ident or wikilink, may be multi-word until colon/arrow/newline)
      const subjParts: string[] = [];
      while (peek().kind !== 'NEWLINE' && peek().kind !== 'EOF' && peek().kind !== 'COLON' && peek().kind !== 'ARROW' && peek().kind !== 'PIPE') {
        if (peek().kind === 'WIKILINK') { node.subject.wikilink = eat().value; break; }
        subjParts.push(eat().value);
      }
      if (subjParts.length) node.subject.ident = subjParts.join(' ');
      if (peek().kind === 'ARROW') {
        eat();
        const targetParts: string[] = [];
        while (peek().kind !== 'NEWLINE' && peek().kind !== 'EOF' && peek().kind !== 'COLON' && peek().kind !== 'PIPE') {
          if (peek().kind === 'WIKILINK') { node.target = { wikilink: eat().value }; break; }
          targetParts.push(eat().value);
        }
        if (!node.target && targetParts.length) node.target = { ident: targetParts.join(' ') };
      }
      // metadata + body — process subsequent indented lines treated as same statement
      while (peek().kind !== 'EOF') {
        if (peek().kind === 'NEWLINE') { eat(); continue; }
        if (peek().kind === 'PIPE') { eat(); if (peek().kind === 'TEXT') node.body = eat().value; continue; }
        if (peek().kind === 'IDENT') {
          const key = eat().value;
          if (peek().kind === 'COLON') {
            eat();
            const valParts: string[] = [];
            while (peek().kind !== 'NEWLINE' && peek().kind !== 'EOF' && peek().kind !== 'PIPE') {
              if (peek().kind === 'WIKILINK') valParts.push(`[[${eat().value}]]`);
              else if (peek().kind === 'COMMA') { eat(); continue; }
              else valParts.push(eat().value);
            }
            const raw = valParts.join(' ').trim();
            node.metadata[key] = raw.includes(',') ? raw.split(',').map((s) => s.trim()) : raw;
          } else break;
        } else break;
      }
      out.push(node);
      continue;
    }
    // fallback: gather text
    const textParts: string[] = [];
    while (peek().kind !== 'NEWLINE' && peek().kind !== 'EOF') textParts.push(eat().value);
    if (textParts.length) out.push({ kind: 'natural', text: textParts.join(' ') });
  }
  return out;
}
