// SDK generator — source: sdk/generator/parse-api-doc.md | api_version: 1.8.0 | gen_hash: hand-g001
//
// GENERATOR.md stage 1: parse one Obsidian TypeScript API doc into a descriptor.
// Pure (string -> descriptor); no filesystem. Deterministic.

export type ApiKind =
  | 'function'
  | 'method'
  | 'property'
  | 'class'
  | 'interface'
  | 'enum'
  | 'variable'
  | 'type'
  | 'unknown';

export interface ApiDescriptor {
  symbol: string;
  kind: ApiKind;
  signature: string;
}

const ALIASES_RE = /^aliases:\s*"([^"]+)"\s*$/m;
const HEADING_KIND_RE = /^##\s+.*\b(function|method|property|class|interface|enum|variable|type)\s*$/m;
const SIGNATURE_RE = /\*\*Signature:\*\*\s*```typescript\s*\n([\s\S]*?)```/;

/** Parse a single API-Documenter markdown doc into a normalized descriptor. */
export function parseApiDoc(markdown: string): ApiDescriptor | null {
  const alias = markdown.match(ALIASES_RE);
  if (!alias) return null;
  const symbol = alias[1]!.trim(); // safe: regex requires capture group when match succeeds

  const kindMatch = markdown.match(HEADING_KIND_RE);
  const kind = (kindMatch ? kindMatch[1]! : 'unknown') as ApiKind; // safe: regex requires group 1 on match

  const sig = markdown.match(SIGNATURE_RE);
  const signature = sig ? sig[1]!.trim() : ''; // safe: regex requires group 1 on match

  return { symbol, kind, signature };
}
