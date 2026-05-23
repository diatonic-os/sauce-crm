import { describe, it, expect } from 'vitest';
import { buildGoogleRequest, parseGoogleResponse, searchGoogle } from './google';

describe('connectors/google', () => {
  it('builds a request with URL-encoded query and Bearer auth', () => {
    const req = buildGoogleRequest('solar energy', { accessToken: 'secret' });
    expect(req.url).toContain('?q=solar%20energy');
    expect(req.headers?.Authorization).toBe('Bearer secret');
    expect(req.method).toBe('GET');
  });

  it('honors a custom endpoint', () => {
    const req = buildGoogleRequest('x', { accessToken: 'k', endpoint: 'https://my.api/s' });
    expect(req.url.startsWith('https://my.api/s?q=x')).toBe(true);
  });

  it('parses a results array; non-conforming input yields []', () => {
    const json = { items: [{ title: 'T', link: 'http://u', snippet: 'S' }, {}] };
    expect(parseGoogleResponse(json)).toEqual([
      { title: 'T', url: 'http://u', snippet: 'S' },
      { title: '', url: '', snippet: '' },
    ]);
    expect(parseGoogleResponse(null)).toEqual([]);
    expect(parseGoogleResponse({ items: 'nope' })).toEqual([]);
  });

  it('search returns [] when the (stub) response carries no results', async () => {
    const out = await searchGoogle('q', { accessToken: 'k' });
    expect(out).toEqual([]); // stub returns json:{} → no results
  });
});
