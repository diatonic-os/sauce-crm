// SDK connector — source: sdk/groups/connectors/google.md | api_version: 1.8.0 | gen_hash: hand-con001
//
// Google connector: pure builder/parser + thin orchestrator over requesturl-fetch.

import { fetchUrl, FetchRequest } from '../tools/requesturl-fetch';

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface GoogleConfig {
  accessToken: string;
  endpoint?: string;
}

const DEFAULT_ENDPOINT = 'https://www.googleapis.com/customsearch/v1';

/** Build the (pure) Google search request: URL-encoded query + Bearer auth. */
export function buildGoogleRequest(query: string, config: GoogleConfig): FetchRequest {
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  return {
    url: `${endpoint}?q=${encodeURIComponent(query)}&key=${config.accessToken}`,
    method: 'GET',
    headers: { Authorization: `Bearer ${config.accessToken}` },
  };
}

/** Parse a Google search API response (pure); non-conforming input yields []. */
export function parseGoogleResponse(json: unknown): SearchResult[] {
  const items = (json as { items?: unknown } | null)?.items;
  if (!Array.isArray(items)) return [];
  return items.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return {
      title: String(o.title ?? ''),
      url: String(o.link ?? ''),
      snippet: String(o.snippet ?? ''),
    };
  });
}

/** Run a Google search; returns [] on non-200. */
export async function searchGoogle(query: string, config: GoogleConfig): Promise<SearchResult[]> {
  const res = await fetchUrl(buildGoogleRequest(query, config));
  if (res.status !== 200) return [];
  return parseGoogleResponse(res.json);
}
