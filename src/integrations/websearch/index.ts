import type { ProxyClient } from '../../security/ProxyClient';

export interface SearchOpts { count?: number; lang?: string; safesearch?: 'off' | 'moderate' | 'strict'; }
export interface SearchResult { url: string; title: string; snippet: string; publishedTs: number | null; fetchedTs: number; hash: string; }
export interface FetchOpts { markdown?: boolean; }

export interface IWebSearchProvider {
  readonly id: string;
  search(q: string, opts: SearchOpts): Promise<SearchResult[]>;
  fetch(url: string, opts: FetchOpts): Promise<string>;
}

export interface WebSearchHost { proxy: ProxyClient; sha256Hex(s: string): Promise<string>; markdownExtract(html: string): string; }

export class BraveSearch implements IWebSearchProvider {
  readonly id = 'brave';
  constructor(private readonly host: WebSearchHost, private readonly apiKey: () => Promise<string>) {}
  async search(q: string, opts: SearchOpts): Promise<SearchResult[]> {
    const key = await this.apiKey();
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=${opts.count ?? 10}`;
    const r = await this.host.proxy.fetch(url, { method: 'GET', headers: { 'X-Subscription-Token': key, Accept: 'application/json' } });
    if (r.status >= 400) return [];
    const j = JSON.parse(r.body) as { web?: { results?: Array<{ url: string; title: string; description: string; age?: string }> } };
    const results = j.web?.results ?? [];
    const now = Date.now();
    const out: SearchResult[] = [];
    for (const it of results) {
      out.push({ url: it.url, title: it.title, snippet: it.description, publishedTs: null, fetchedTs: now, hash: await this.host.sha256Hex(it.url) });
    }
    return out;
  }
  async fetch(url: string, opts: FetchOpts): Promise<string> {
    const r = await this.host.proxy.fetch(url, { method: 'GET', headers: { Accept: 'text/html,application/xhtml+xml' } });
    if (r.status >= 400) throw new Error(`fetch failed: ${r.status}`);
    return opts.markdown ? this.host.markdownExtract(r.body) : r.body;
  }
}

export class TavilySearch implements IWebSearchProvider {
  readonly id = 'tavily';
  constructor(private readonly host: WebSearchHost, private readonly apiKey: () => Promise<string>) {}
  async search(q: string, opts: SearchOpts): Promise<SearchResult[]> {
    const key = await this.apiKey();
    const r = await this.host.proxy.fetch('https://api.tavily.com/search', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ api_key: key, query: q, max_results: opts.count ?? 10 }),
    });
    if (r.status >= 400) return [];
    const j = JSON.parse(r.body) as { results: Array<{ url: string; title: string; content: string; published_date?: string }> };
    const now = Date.now();
    const out: SearchResult[] = [];
    for (const it of j.results) {
      out.push({ url: it.url, title: it.title, snippet: it.content, publishedTs: it.published_date ? Date.parse(it.published_date) : null, fetchedTs: now, hash: await this.host.sha256Hex(it.url) });
    }
    return out;
  }
  async fetch(url: string, opts: FetchOpts): Promise<string> {
    const r = await this.host.proxy.fetch(url, { method: 'GET', headers: { Accept: 'text/html' } });
    return opts.markdown ? this.host.markdownExtract(r.body) : r.body;
  }
}

export class SearXNGSearch implements IWebSearchProvider {
  readonly id = 'searxng';
  constructor(private readonly host: WebSearchHost, private readonly endpoint: () => Promise<string>) {}
  async search(q: string, opts: SearchOpts): Promise<SearchResult[]> {
    const base = await this.endpoint();
    const url = `${base.replace(/\/$/, '')}/search?q=${encodeURIComponent(q)}&format=json`;
    const r = await this.host.proxy.fetch(url, { method: 'GET', headers: { Accept: 'application/json' } });
    if (r.status >= 400) return [];
    const j = JSON.parse(r.body) as { results: Array<{ url: string; title: string; content: string; publishedDate?: string }> };
    const now = Date.now();
    const out: SearchResult[] = [];
    for (const it of j.results.slice(0, opts.count ?? 10)) {
      out.push({ url: it.url, title: it.title, snippet: it.content, publishedTs: it.publishedDate ? Date.parse(it.publishedDate) : null, fetchedTs: now, hash: await this.host.sha256Hex(it.url) });
    }
    return out;
  }
  async fetch(url: string, opts: FetchOpts): Promise<string> {
    const r = await this.host.proxy.fetch(url, { method: 'GET', headers: { Accept: 'text/html' } });
    return opts.markdown ? this.host.markdownExtract(r.body) : r.body;
  }
}
