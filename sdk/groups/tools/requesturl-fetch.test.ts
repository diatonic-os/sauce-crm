import { describe, it, expect } from 'vitest';
import { fetchUrl } from './requesturl-fetch';
import { hasApiSymbol } from '../../generated/api-catalog';

describe('tools/requesturl-fetch', () => {
  it('returns a normalized FetchResponse', async () => {
    const r = await fetchUrl({ url: 'https://example.com/api' });
    expect(r.status).toBe(200);
    expect(typeof r.text).toBe('string');
    expect(r.headers).toBeTypeOf('object');
  });

  it('passes url and method through to requestUrl', async () => {
    const r = await fetchUrl({ url: 'https://example.com/x', method: 'POST' });
    expect(r.headers['x-echo-url']).toBe('https://example.com/x');
    expect(r.headers['x-echo-method']).toBe('POST');
  });

  it('catalog-validation gate: requestUrl exists in the generated catalog', () => {
    expect(hasApiSymbol('requestUrl')).toBe(true);
  });
});
