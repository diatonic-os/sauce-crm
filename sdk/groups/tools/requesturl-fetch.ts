// SDK tool — source: sdk/groups/tools/requesturl-fetch.md | api_version: 1.8.0 | gen_hash: hand-t002
//
// Typed, CORS-free HTTP via Obsidian requestUrl. Only network egress for the SDK.

import { requestUrl, RequestUrlParam } from 'obsidian';

export interface FetchRequest {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface FetchResponse {
  status: number;
  text: string;
  json: unknown;
  headers: Record<string, string>;
}

/** Fetch via Obsidian requestUrl; never throws on HTTP status (throw:false). */
export async function fetchUrl(req: FetchRequest): Promise<FetchResponse> {
  const param: RequestUrlParam = {
    url: req.url,
    ...(req.method !== undefined ? { method: req.method } : {}),
    ...(req.headers !== undefined ? { headers: req.headers } : {}),
    ...(req.body !== undefined ? { body: req.body } : {}),
    throw: false,
  };
  const r = await requestUrl(param);
  return { status: r.status, text: r.text, json: r.json, headers: r.headers };
}
