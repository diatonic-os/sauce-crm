// SPEC §32.2 — Tokenizer for `@verb identifier metadata? body?` and natural-language pass-through.
export type TokenKind = 'AT' | 'IDENT' | 'WIKILINK' | 'STRING' | 'NUMBER' | 'COLON' | 'PIPE' | 'ARROW' | 'COMMA' | 'NEWLINE' | 'TEXT' | 'EOF';
export interface Token { kind: TokenKind; value: string; pos: number; }

export function lex(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const push = (kind: TokenKind, value: string) => tokens.push({ kind, value, pos: i - value.length });
  while (i < input.length) {
    const c = input[i];
    if (c === '@') { push('AT', '@'); i++; continue; }
    if (c === ':') { push('COLON', ':'); i++; continue; }
    if (c === ',') { push('COMMA', ','); i++; continue; }
    if (c === '|') { push('PIPE', '|'); i++; const rest = input.slice(i).replace(/^\s+/, ''); push('TEXT', rest); i = input.length; continue; }
    if (c === '\n') { push('NEWLINE', '\n'); i++; continue; }
    if (c === ' ' || c === '\t') { i++; continue; }
    if (c === '-' && input[i + 1] === '>') { push('ARROW', '->'); i += 2; continue; }
    if (c === '"' || c === "'") {
      const q = c; i++;
      let s = '';
      while (i < input.length && input[i] !== q) { s += input[i]; i++; }
      i++; push('STRING', s); continue;
    }
    if (c === '[' && input[i + 1] === '[') {
      i += 2;
      let s = '';
      while (i < input.length && !(input[i] === ']' && input[i + 1] === ']')) { s += input[i]; i++; }
      i += 2; push('WIKILINK', s); continue;
    }
    if (/[0-9]/.test(c)) {
      let n = '';
      while (i < input.length && /[0-9.-]/.test(input[i])) { n += input[i]; i++; }
      push('NUMBER', n); continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let s = '';
      while (i < input.length && /[A-Za-z0-9_.\-]/.test(input[i])) { s += input[i]; i++; }
      push('IDENT', s); continue;
    }
    // fallback — treat as text
    let s = '';
    while (i < input.length && !/[\n@|:,"'\[]/.test(input[i])) { s += input[i]; i++; }
    if (s.trim()) push('TEXT', s);
    else i++;
  }
  tokens.push({ kind: 'EOF', value: '', pos: i });
  return tokens;
}
