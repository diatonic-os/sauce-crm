import { describe, it, expect } from 'vitest';
import { parseApiDoc } from './parse-api-doc';

const FUNCTION_DOC = `---
aliases: "requestUrl"
cssclasses: hide-title
---

[\`requestUrl\`](requestUrl)

## requestUrl() function

Similar to fetch().

**Signature:**

\`\`\`typescript
export function requestUrl(request: RequestUrlParam | string): RequestUrlResponsePromise;
\`\`\`

## Parameters
`;

const METHOD_DOC = `---
aliases: "Vault.create"
cssclasses: hide-title
---

## Vault.create() method

Create a new plaintext file inside the vault.

**Signature:**

\`\`\`typescript
create(path: string, data: string, options?: DataWriteOptions): Promise<TFile>;
\`\`\`
`;

describe('generator/parse-api-doc', () => {
  it('parses a function doc', () => {
    expect(parseApiDoc(FUNCTION_DOC)).toEqual({
      symbol: 'requestUrl',
      kind: 'function',
      signature:
        'export function requestUrl(request: RequestUrlParam | string): RequestUrlResponsePromise;',
    });
  });

  it('parses a method doc with a dotted symbol', () => {
    const d = parseApiDoc(METHOD_DOC)!;
    expect(d.symbol).toBe('Vault.create');
    expect(d.kind).toBe('method');
    expect(d.signature).toContain('create(path: string');
  });

  it('returns null for non-API docs (no aliases)', () => {
    expect(parseApiDoc('# Just a page\n\nNo frontmatter.')).toBeNull();
  });

  it('tolerates a missing signature block', () => {
    const d = parseApiDoc('---\naliases: "Empty"\n---\n\n## Empty property\n')!;
    expect(d).toEqual({ symbol: 'Empty', kind: 'property', signature: '' });
  });

  it('is deterministic', () => {
    expect(parseApiDoc(FUNCTION_DOC)).toEqual(parseApiDoc(FUNCTION_DOC));
  });
});
