// SDK skill — source: sdk/groups/skills/summarize-thread.md | api_version: 1.8.0 | gen_hash: hand-s002
//
// Summarize a thread via an LLM endpoint: pure builder/parser + thin call.

import { fetchUrl, FetchRequest } from '../tools/requesturl-fetch';

export interface SummarizeConfig {
  apiKey: string;
  endpoint?: string;
  model?: string;
}

const DEFAULT_ENDPOINT = 'https://api.llm.example/v1/chat';

/** Build the (pure) summarize request: POST JSON, Bearer auth. */
export function buildSummarizeRequest(thread: string, config: SummarizeConfig): FetchRequest {
  return {
    url: config.endpoint ?? DEFAULT_ENDPOINT,
    method: 'POST',
    headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: config.model ?? 'default', task: 'summarize', input: thread }),
  };
}

/** Parse the summary out of the response (pure). */
export function parseSummary(json: unknown): string {
  const o = (json ?? {}) as Record<string, unknown>;
  return String(o.summary ?? '');
}

/** Summarize a thread; returns "" on non-200. */
export async function summarizeThread(thread: string, config: SummarizeConfig): Promise<string> {
  const res = await fetchUrl(buildSummarizeRequest(thread, config));
  if (res.status !== 200) return '';
  return parseSummary(res.json);
}
