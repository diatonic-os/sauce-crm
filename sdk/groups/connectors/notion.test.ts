import { describe, it, expect } from 'vitest';
import { buildRequest, parseResponse, fetchPage } from './notion';

describe('connectors/notion', () => {
  it('builds a request with URL and Bearer auth', () => {
    const req = buildRequest('page123', { apiKey: 'secret' });
    expect(req.url).toBe('https://api.notion.com/v1/pages/page123');
    expect(req.headers?.Authorization).toBe('Bearer secret');
    expect(req.method).toBe('GET');
  });

  it('honors a custom endpoint', () => {
    const req = buildRequest('page456', { apiKey: 'k', endpoint: 'https://my.api/s' });
    expect(req.url).toBe('https://my.api/s/page456');
  });

  it('parses a results array; non-conforming input yields []', () => {
    const json = {
      results: [
        {
          properties: {
            title: { title: [{ plain_text: 'Page Title' }] },
          },
          url: 'http://page.url',
        },
        {},
      ],
    };
    expect(parseResponse(json)).toEqual([
      { title: 'Page Title', url: 'http://page.url' },
      { title: '', url: '' },
    ]);
    expect(parseResponse(null)).toEqual([]);
    expect(parseResponse({ results: 'nope' })).toEqual([]);
  });

  it('fetchPage returns [] when the (stub) response carries no results', async () => {
    const out = await fetchPage('page789', { apiKey: 'k' });
    expect(out).toEqual([]); // stub returns json:{} → no results
  });
});
