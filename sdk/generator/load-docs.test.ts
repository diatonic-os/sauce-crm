import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { resolveDocsRoot, loadApiDescriptors, loadCssTokens } from './load-docs';

const tmpDirs: string[] = [];
function makeTree(): { base: string; nested: string; docs: string } {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-docs-')); // nosemgrep -- test temp dir
  tmpDirs.push(base);
  const docs = path.join(base, 'reference', 'obsidian-developer-docs', 'en'); // nosemgrep -- test fixture
  fs.mkdirSync(path.join(docs, 'Reference'), { recursive: true }); // nosemgrep -- test fixture
  const nested = path.join(base, 'a', 'b', 'c'); // nosemgrep -- test fixture
  fs.mkdirSync(nested, { recursive: true });
  return { base, nested, docs };
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
  delete process.env.SAUCE_OBSIDIAN_DOCS;
});

describe('generator/load-docs', () => {
  it('resolves docs root by walking up from a nested dir', () => {
    const { nested, docs } = makeTree();
    expect(resolveDocsRoot(nested)).toBe(fs.realpathSync(docs));
  });

  it('returns null when no docs root exists above startDir', () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'sdk-empty-')); // nosemgrep -- test temp dir
    tmpDirs.push(empty);
    // walk stops at filesystem root without finding the docs tree
    expect(resolveDocsRoot(empty)).toBeNull();
  });

  it('honors the SAUCE_OBSIDIAN_DOCS override', () => {
    const { docs } = makeTree();
    process.env.SAUCE_OBSIDIAN_DOCS = docs;
    expect(resolveDocsRoot('/nonexistent/start')).toBe(docs);
  });

  // Integration against the vendored docs, guarded so CI without docs still passes.
  it('loads real API descriptors and CSS tokens when docs are present', () => {
    const root = resolveDocsRoot();
    if (!root) return; // docs not vendored in this environment — skip assertion
    const api = loadApiDescriptors(root);
    expect(api.some((d) => d.symbol === 'requestUrl')).toBe(true);
    expect(api).toEqual(stableBySymbol(api));
    const css = loadCssTokens(root);
    expect(css.length).toBeGreaterThan(0);
    expect(css.every((t) => t.token.startsWith('--'))).toBe(true);
  });
});

function stableBySymbol<T extends { symbol: string }>(arr: T[]): T[] {
  return [...arr].sort((a, b) => (a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0));
}
