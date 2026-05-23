// SDK skill — source: sdk/groups/skills/research-person.md | api_version: 1.8.0 | gen_hash: hand-s003
//
// Research a person by composing connectors/websearch.

import { search, SearchResult, WebSearchConfig } from '../connectors/websearch';

export interface PersonResearch {
  name: string;
  sources: SearchResult[];
}

/** Gather web sources about a person. */
export async function researchPerson(name: string, config: WebSearchConfig): Promise<PersonResearch> {
  const sources = await search(`${name} professional background`, config);
  return { name, sources };
}
