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
  /** Notion property values are structurally opaque and API-version-dependent. */
  properties: Record<string, unknown>;
  last_edited_time?: string;
  created_time?: string;
  url?: string;
  archived?: boolean;
}

export interface NotionDatabase {
  id: string;
  object: "database";
  title?: Array<{ plain_text: string }>;
  /** Notion property schemas are structurally opaque and API-version-dependent. */
  properties?: Record<string, unknown>;
}

export class NotionClient {
  constructor(public opts: NotionClientOpts) {}

  private base(): string {
    return this.opts.base ?? "https://api.notion.com/v1";
  }
  private version(): string {
    return this.opts.version ?? "2022-06-28";
  }

  private async req<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const tok = await this.opts.token();
    const bodyStr = body == null ? undefined : JSON.stringify(body);
    const r = await this.opts.fetch.fetch(`${this.base()}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${tok}`,
        "Notion-Version": this.version(),
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      ...(bodyStr !== undefined ? { body: bodyStr } : {}),
    });
    if (r.status < 200 || r.status >= 300)
      throw new Error(`notion api ${r.status}: ${r.body.slice(0, 200)}`);
    return JSON.parse(r.body) as T;
  }

  async listDatabases(query = ""): Promise<NotionDatabase[]> {
    const r = await this.req<{ results: unknown[] }>("POST", "/search", {
      query,
      filter: { property: "object", value: "database" },
      page_size: 100,
    });
    // Notion /search guarantees items matching the filter shape; cast is safe here.
    return r.results as NotionDatabase[];
  }

  async queryDatabase(
    databaseId: string,
    opts: { pageSize?: number; startCursor?: string } = {},
  ): Promise<{ pages: NotionPage[]; nextCursor: string | null }> {
    const r = await this.req<{
      results: unknown[];
      next_cursor: string | null;
    }>("POST", `/databases/${encodeURIComponent(databaseId)}/query`, {
      page_size: opts.pageSize ?? 100,
      start_cursor: opts.startCursor,
    });
    // Notion /databases/:id/query guarantees page-shaped results.
    return { pages: r.results as NotionPage[], nextCursor: r.next_cursor };
  }

  async getPage(pageId: string): Promise<NotionPage> {
    return this.req<NotionPage>("GET", `/pages/${encodeURIComponent(pageId)}`);
  }

  async updatePageProperties(
    pageId: string,
    properties: Record<string, unknown>,
  ): Promise<NotionPage> {
    return this.req<NotionPage>(
      "PATCH",
      `/pages/${encodeURIComponent(pageId)}`,
      { properties },
    );
  }

  async createPage(
    parentDatabaseId: string,
    properties: Record<string, unknown>,
    children?: unknown[],
  ): Promise<NotionPage> {
    return this.req<NotionPage>("POST", "/pages", {
      parent: { database_id: parentDatabaseId },
      properties,
      children: children ?? [],
    });
  }
}

/** Notion title-type property shape (narrow subset we actually read). */
interface NotionTitleProp {
  type: "title";
  title: Array<{ plain_text?: string }>;
}

function isNotionTitleProp(v: unknown): v is NotionTitleProp {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as Record<string, unknown>).type === "title" &&
    Array.isArray((v as Record<string, unknown>).title)
  );
}

/**
 * Extract a plain-text title from a Notion page's properties (first title-typed prop).
 */
export function pageTitle(page: NotionPage): string {
  for (const v of Object.values(page.properties ?? {})) {
    if (isNotionTitleProp(v)) {
      return v.title.map((p) => p.plain_text ?? "").join("");
    }
  }
  return "";
}
