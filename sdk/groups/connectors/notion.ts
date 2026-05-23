// SDK connector — source: sdk/groups/connectors/notion.md | api_version: 1.8.0 | gen_hash: hand-con001
//
// Notion connector: pure builder/parser + thin orchestrator over requesturl-fetch.

import { fetchUrl, FetchRequest } from '../tools/requesturl-fetch';

export interface NotionPage {
  title: string;
  url: string;
}

export interface NotionConfig {
  apiKey: string;
  endpoint?: string;
}

const DEFAULT_ENDPOINT = 'https://api.notion.com/v1/pages';

/** Build the (pure) request for fetching a Notion page: URL + Bearer auth. */
export function buildRequest(pageId: string, config: NotionConfig): FetchRequest {
  const endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
  return {
    url: `${endpoint}/${pageId}`,
    method: 'GET',
    headers: { 
      Authorization: `Bearer ${config.apiKey}`,
      'Notion-Version': '2021-08-16' // Example version, adjust as needed
    },
  };
}

/** Parse a Notion API response (pure); non-conforming input yields []. */
export function parseResponse(json: unknown): NotionPage[] {
  const pages = (json as { results?: unknown } | null)?.results;
  if (!Array.isArray(pages)) return [];
  return pages.map((p) => {
    const o = (p ?? {}) as Record<string, unknown>;
    const properties = (o.properties ?? {}) as Record<string, unknown>;
    const titleProperty = properties.title as { title: Array<{ plain_text: string }> } | undefined;
    const title = titleProperty?.title.map(t => t.plain_text).join('') || '';
    return {
      title,
      url: String(o.url ?? ''),
    };
  });
}

/** Fetch a Notion page; returns [] on non-200. */
export async function fetchPage(pageId: string, config: NotionConfig): Promise<NotionPage[]> {
  const res = await fetchUrl(buildRequest(pageId, config));
  if (res.status !== 200) return [];
  return parseResponse(res.json);
}
