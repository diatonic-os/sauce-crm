import { describe, it, expect } from 'vitest';
import { buildMicrosoftSearchRequest, parseMicrosoftSearchResponse, microsoftSearch } from './microsoft';

describe('sdk/groups/connectors/microsoft', () => {
  it('builds a request with URL-encoded query and Bearer auth', () => {
    const req = buildMicrosoftSearchRequest('solar energy', { accessToken: 'secret' });
    expect(req.url).toBe('https://graph.microsoft.com/v1.0/search/query');
    expect(req.headers?.Authorization).toBe('Bearer secret');
    expect(req.method).toBe('POST');
    expect(req.body).toBe(JSON.stringify({
      requests: [
        {
          entityTypes: ["listItem"],
          query: {
            queryString: 'solar energy'
          }
        }
      ]
    }));
  });

  it('honors a custom endpoint', () => {
    const req = buildMicrosoftSearchRequest('x', { accessToken: 'k', endpoint: 'https://my.api/s' });
    expect(req.url).toBe('https://my.api/s');
    expect(req.headers?.Authorization).toBe('Bearer k');
    expect(req.method).toBe('POST');
    expect(req.body).toBe(JSON.stringify({
      requests: [
        {
          entityTypes: ["listItem"],
          query: {
            queryString: 'x'
          }
        }
      ]
    }));
  });

  it('parses a results array; non-conforming input yields []', () => {
    const json = { value: [{ title: 'T', webUrl: 'http://u', snippet: 'S' }, {}] };
    expect(parseMicrosoftSearchResponse(json)).toEqual([
      { title: 'T', url: 'http://u', snippet: 'S' },
      { title: '', url: '', snippet: '' },
    ]);
    expect(parseMicrosoftSearchResponse(null)).toEqual([]);
    expect(parseMicrosoftSearchResponse({ value: 'nope' })).toEqual([]);
  });

  it('search returns [] when the (stub) response carries no results', async () => {
    const out = await microsoftSearch('q', { accessToken: 'k' });
    expect(out).toEqual([]); // stub returns json:{} → no results
  });
});
