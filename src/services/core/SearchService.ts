// CON-OBS-INTEG-001 · T-C2-01 · CW-search — unified facade over the search core
// plugins (search, backlinks, outgoing-links, quick-switcher, random-note,
// tags-view). Returns typed results; the host is injected for testability.

export interface SearchResult {
  path: string;
  score?: number;
}

export interface SearchHost {
  search(query: string, limit?: number): SearchResult[];
  /** Lines/snippets around matches for a query in a file. */
  searchContext(path: string, query: string): string[];
  backlinks(path: string): string[];
  outlinks(path: string): string[];
  /** Links that point at non-existent notes. */
  unresolved(): string[];
  /** Notes with no backlinks and no outlinks. */
  orphans(): string[];
  /** Notes with backlinks but no outlinks (dead ends). */
  deadends(): string[];
  tagCounts(): Record<string, number>;
  random(): string | null;
}

export class SearchService {
  constructor(private readonly host: SearchHost) {}

  search(query: string, limit = 25): SearchResult[] {
    return this.host.search(query, limit);
  }
  searchContext(path: string, query: string): string[] {
    return this.host.searchContext(path, query);
  }
  backlinks(path: string): string[] {
    return this.host.backlinks(path);
  }
  outlinks(path: string): string[] {
    return this.host.outlinks(path);
  }
  unresolved(): string[] {
    return this.host.unresolved();
  }
  orphans(): string[] {
    return this.host.orphans();
  }
  deadends(): string[] {
    return this.host.deadends();
  }
  tagCounts(): Record<string, number> {
    return this.host.tagCounts();
  }
  random(): string | null {
    return this.host.random();
  }
}
