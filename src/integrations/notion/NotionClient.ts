// SPEC §25 — Notion REST client. Uses bearer token (integration secret).
export interface FetchHost {
  fetch(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<{ status: number; headers: Record<string, string>; body: string }>;
}

export interface NotionClientOpts {
  fetch: FetchHost;
  token: () => Promise<string>;
  version?: string; // Notion-Version header
  base?: string;
}

export interface NotionPage {
  id: string;
  object: "page";
  parent?: { type?: string; database_id?: string; page_id?: string };
  properties: Record<string, any>;
  last_edited_time?: string;
  created_time?: string;
  url?: string;
  archived?: boolean;
}

export interface NotionDatabase {
  id: string;
  object: "database";
  title?: Array<{ plain_text: string }>;
  properties?: Record<string, any>;
}

export class NotionClient {
  constructor(public opts: NotionClientOpts) {}

  private base(): string {
    return this.opts.base ?? "https://api.notion.com/v1";
  }
  private version(): string {
    return this.opts.version ?? "2022-06-28";
  }

  private async req<T>(method: string, path: string, body?: any): Promise<T> {
    const tok = await this.opts.token();
    const r = await this.opts.fetch.fetch(`${this.base()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${tok}`,
        "Notion-Version": this.version(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: body == null ? undefined : JSON.stringify(body),
    });
    if (r.status < 200 || r.status >= 300)
      throw new Error(`notion api ${r.status}: ${r.body.slice(0, 200)}`);
    return JSON.parse(r.body) as T;
  }

  async listDatabases(query = ""): Promise<NotionDatabase[]> {
    const r = await this.req<{ results: any[] }>("POST", "/search", {
      query,
      filter: { property: "object", value: "database" },
      page_size: 100,
    });
    return r.results as NotionDatabase[];
  }

  async queryDatabase(
    databaseId: string,
    opts: { pageSize?: number; startCursor?: string } = {},
  ): Promise<{ pages: NotionPage[]; nextCursor: string | null }> {
    const r = await this.req<{ results: any[]; next_cursor: string | null }>(
      "POST",
      `/databases/${encodeURIComponent(databaseId)}/query`,
      {
        page_size: opts.pageSize ?? 100,
        start_cursor: opts.startCursor,
      },
    );
    return { pages: r.results as NotionPage[], nextCursor: r.next_cursor };
  }

  async getPage(pageId: string): Promise<NotionPage> {
    return this.req<NotionPage>("GET", `/pages/${encodeURIComponent(pageId)}`);
  }

  async updatePageProperties(
    pageId: string,
    properties: Record<string, any>,
  ): Promise<NotionPage> {
    return this.req<NotionPage>(
      "PATCH",
      `/pages/${encodeURIComponent(pageId)}`,
      { properties },
    );
  }

  async createPage(
    parentDatabaseId: string,
    properties: Record<string, any>,
    children?: any[],
  ): Promise<NotionPage> {
    return this.req<NotionPage>("POST", "/pages", {
      parent: { database_id: parentDatabaseId },
      properties,
      children: children ?? [],
    });
  }
}

/**
 * Extract a plain-text title from a Notion page's properties (first title-typed prop).
 */
export function pageTitle(page: NotionPage): string {
  for (const v of Object.values(page.properties ?? {})) {
    if (v && (v as any).type === "title") {
      const parts: any[] = (v as any).title ?? [];
      return parts.map((p) => p.plain_text ?? "").join("");
    }
  }
  return "";
}
