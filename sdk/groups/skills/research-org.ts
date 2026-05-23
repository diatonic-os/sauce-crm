// SDK skill — source: sdk/groups/skills/research-org.md | api_version: 1.8.0 | gen_hash: hand-s004
//
// Research an organization by composing connectors/websearch.

import { search, SearchResult, WebSearchConfig } from '../connectors/websearch';

export interface OrgResearch {
  org: string;
  sources: SearchResult[];
}

/** Gather web sources about an organization. */
export async function researchOrg(org: string, config: WebSearchConfig): Promise<OrgResearch> {
  const sources = await search(`${org} company overview`, config);
  return { org, sources };
}
