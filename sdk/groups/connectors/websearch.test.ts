import { describe, it, expect } from 'vitest';
import { buildSearchRequest, parseSearchResponse, search } from './websearch';

describe('connectors/websearch', () => {
  it('builds a request with URL-encoded query and Bearer auth', () => {
    const req = buildSearchRequest('solar energy', { apiKey: 'secret' });
    expect(req.url).toContain('?q=solar%20energy');
    expect(req.headers?.Authorization).toBe('Bearer secret');
    expect(req.method).toBe('GET');
  });

  it('honors a custom endpoint', () => {
    const req = buildSearchRequest('x', { apiKey: 'k', endpoint: 'https://my.api/s' });
    expect(req.url.startsWith('https://my.api/s?q=x')).toBe(true);
  });

  it('parses a results array; non-conforming input yields []', () => {
    const json = { results: [{ title: 'T', url: 'http://u', snippet: 'S' }, {}] };
    expect(parseSearchResponse(json)).toEqual([
      { title: 'T', url: 'http://u', snippet: 'S' },
      { title: '', url: '', snippet: '' },
    ]);
    expect(parseSearchResponse(null)).toEqual([]);
    expect(parseSearchResponse({ results: 'nope' })).toEqual([]);
  });

  it('search returns [] when the (stub) response carries no results', async () => {
    const out = await search('q', { apiKey: 'k' });
    expect(out).toEqual([]); // stub returns json:{} → no results
  });
});
