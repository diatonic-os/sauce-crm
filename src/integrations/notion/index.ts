import type {
  ConnectionState,
  IIntegration,
  SyncResource,
} from "../IIntegration";
import type { OAuthFlow } from "../../security/OAuthFlow";
import type { ScopeRegistry } from "../../security/ScopeRegistry";
import type { ProxyClient } from "../../security/ProxyClient";
import { NotionClient, type FetchHost, pageTitle } from "./NotionClient";

export { NotionClient, pageTitle } from "./NotionClient";
export type { NotionPage, NotionDatabase } from "./NotionClient";

export interface NotionIntegrationHost {
  readonly oauth?: OAuthFlow;
  readonly scopes: ScopeRegistry;
  readonly proxy: ProxyClient;
  readonly fetch?: FetchHost;
  readonly token?: () => Promise<string>;
}

export class NotionIntegration implements IIntegration {
  readonly id = "notion";
  readonly label = "Notion";
  private resources: SyncResource[] = [];
  private connection: ConnectionState = { connected: false };

  constructor(protected readonly host: NotionIntegrationHost) {}

  async connect(): Promise<ConnectionState> {
    if (this.host.oauth) {
      const ts = await this.host.oauth.authorize("notion", []);
      this.connection = { connected: true, expiresAt: ts.expiresAt };
    } else {
      this.connection = { connected: true };
    }
    return this.connection;
  }

  async disconnect(): Promise<void> {
    if (this.host.oauth) await this.host.oauth.revoke("notion");
    this.connection = { connected: false };
  }

  async state(): Promise<ConnectionState> {
    return this.connection;
  }
  async listResources(): Promise<SyncResource[]> {
    return this.resources;
  }

  setResources(rs: SyncResource[]): void {
    this.resources = rs;
  }

  private _client: NotionClient | null = null;
  client(): NotionClient | null {
    if (!this.host.fetch || !this.host.token) return null;
    if (!this._client)
      this._client = new NotionClient({
        fetch: this.host.fetch,
        token: this.host.token,
      });
    return this._client;
  }

  async syncResource(
    id: string,
  ): Promise<{ pulled: number; pushed: number; errors: number }> {
    if (!this.host.fetch || !this.host.token)
      return { pulled: 0, pushed: 0, errors: 0 };
    const c = this.client()!;
    let pulled = 0,
      errors = 0;
    try {
      if (id === "databases") {
        const dbs = await c.listDatabases();
        pulled = dbs.length;
      } else if (id.startsWith("database:")) {
        const dbId = id.slice("database:".length);
        let cursor: string | undefined;
        do {
          const r = await c.queryDatabase(dbId, {
            pageSize: 100,
            startCursor: cursor,
          });
          pulled += r.pages.length;
          cursor = r.nextCursor ?? undefined;
        } while (cursor && pulled < 1000);
      }
    } catch {
      errors++;
    }
    return { pulled, pushed: 0, errors };
  }

  /** Compute a conflict shape between a local entity FM and a Notion page's properties. */
  conflictFields(
    local: Record<string, unknown>,
    page: { properties: Record<string, any> },
    fields: string[],
  ): { name: string; local: unknown; remote: unknown }[] {
    const out: { name: string; local: unknown; remote: unknown }[] = [];
    for (const f of fields) {
      const remote = extractNotionProp(page.properties[f]);
      const localVal = local[f];
      if (!shallowEqual(localVal, remote))
        out.push({ name: f, local: localVal, remote });
    }
    return out;
  }
}

function extractNotionProp(p: any): unknown {
  if (!p) return null;
  switch (p.type) {
    case "title":
      return (p.title ?? []).map((x: any) => x.plain_text).join("");
    case "rich_text":
      return (p.rich_text ?? []).map((x: any) => x.plain_text).join("");
    case "email":
      return p.email ?? null;
    case "phone_number":
      return p.phone_number ?? null;
    case "url":
      return p.url ?? null;
    case "select":
      return p.select?.name ?? null;
    case "multi_select":
      return (p.multi_select ?? []).map((x: any) => x.name);
    case "number":
      return p.number ?? null;
    case "date":
      return p.date?.start ?? null;
    case "checkbox":
      return Boolean(p.checkbox);
    default:
      return JSON.stringify(p);
  }
}

function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  return false;
}
