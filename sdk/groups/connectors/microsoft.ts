// SDK connector — source: sdk/groups/connectors/microsoft.md | api_version: none | gen_hash: hand-con002
//
// Microsoft 365 connector: pure request builder + parser over requesturl-fetch; OAuth bearer from caller.

import { fetchUrl, FetchRequest } from '../tools/requesturl-fetch';

export interface MicrosoftSearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface MicrosoftSearchConfig {
  accessToken: string;
  endpoint?: string;
}

const DEFAULT_ENDPOINT = 'https://graph.microsoft.com/v1.0/search/query';

/** Build the (pure) search request: URL-encoded query + Bearer auth. */
export function buildMicrosoftSearchRequest(query: string, config: MicrosoftSearchConfig): FetchRequest {
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  return {
    url: `${endpoint}`,
    method: 'POST',
    headers: { 
      Authorization: `Bearer ${config.accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      requests: [
        {
          entityTypes: ["listItem"],
          query: {
            queryString: query
          }
        }
      ]
    })
  };
}

/** Parse a Microsoft search API response (pure); non-conforming input yields []. */
export function parseMicrosoftSearchResponse(json: unknown): MicrosoftSearchResult[] {
  const results = (json as { value?: unknown } | null)?.value;
  if (!Array.isArray(results)) return [];
  return results.map((r) => {
    const o = (r ?? {}) as Record<string, unknown>;
    return {
      title: String(o.title ?? ''),
      url: String(o.webUrl ?? ''),
      snippet: String(o.snippet ?? '')
    };
  });
}

/** Run a Microsoft search; returns [] on non-200. */
export async function microsoftSearch(query: string, config: MicrosoftSearchConfig): Promise<MicrosoftSearchResult[]> {
  const res = await fetchUrl(buildMicrosoftSearchRequest(query, config));
  if (res.status !== 200) return [];
  return parseMicrosoftSearchResponse(res.json);
}
