// SDK connector — source: sdk/groups/connectors/websearch.md | api_version: 1.8.0 | gen_hash: hand-con001
//
// Web-search connector: pure builder/parser + thin orchestrator over requesturl-fetch.

import { fetchUrl, FetchRequest } from '../tools/requesturl-fetch';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface WebSearchConfig {
  apiKey: string;
  endpoint?: string;
}

const DEFAULT_ENDPOINT = 'https://api.search.example/v1/search';

/** Build the (pure) search request: URL-encoded query + Bearer auth. */
export function buildSearchRequest(query: string, config: WebSearchConfig): FetchRequest {
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  return {
    url: `${endpoint}?q=${encodeURIComponent(query)}`,
    method: 'GET',
    headers: { Authorization: `Bearer ${config.apiKey}` },
  };
}

/** Parse a search API response (pure); non-conforming input yields []. */
export function parseSearchResponse(json: unknown): SearchResult[] {
  const results = (json as { results?: unknown } | null)?.results;
  if (!Array.isArray(results)) return [];
  return results.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return {
      title: String(o.title ?? ''),
      url: String(o.url ?? ''),
      snippet: String(o.snippet ?? ''),
    };
  });
}

/** Run a web search; returns [] on non-200. */
export async function search(query: string, config: WebSearchConfig): Promise<SearchResult[]> {
  const res = await fetchUrl(buildSearchRequest(query, config));
  if (res.status !== 200) return [];
  return parseSearchResponse(res.json);
}
