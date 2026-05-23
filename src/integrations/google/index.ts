import type {
  ConnectionState,
  IIntegration,
  SyncResource,
} from "../IIntegration";
import type { OAuthFlow } from "../../security/OAuthFlow";
import type { ScopeRegistry } from "../../security/ScopeRegistry";
import type { ProxyClient } from "../../security/ProxyClient";
import type { FetchHost, TokenResolver } from "./types";
import { GCalendarClient } from "./GCalendarClient";
import { GMailClient } from "./GMailClient";
import { GContactsClient } from "./GContactsClient";
import { GDriveClient } from "./GDriveClient";

export * from "./types";
export { GCalendarClient } from "./GCalendarClient";
export { GMailClient, headersMap, parseAddressHeader } from "./GMailClient";
export { GContactsClient } from "./GContactsClient";
export { GDriveClient } from "./GDriveClient";

export interface GoogleWorkspaceIntegrationHost {
  readonly oauth?: OAuthFlow;
  readonly scopes: ScopeRegistry;
  readonly proxy: ProxyClient;
  readonly fetch?: FetchHost;
  readonly token?: TokenResolver;
}

export class GoogleWorkspaceIntegration implements IIntegration {
  readonly id = "google_workspace";
  readonly label = "Google Workspace";
  private resources: SyncResource[] = [];
  private connection: ConnectionState = { connected: false };

  constructor(protected readonly host: GoogleWorkspaceIntegrationHost) {}

  async connect(): Promise<ConnectionState> {
    if (this.host.oauth) {
      const ts = await this.host.oauth.authorize("google_workspace", []);
      this.connection = { connected: true, expiresAt: ts.expiresAt };
    } else {
      this.connection = { connected: true };
    }
    return this.connection;
  }

  async disconnect(): Promise<void> {
    if (this.host.oauth) await this.host.oauth.revoke("google_workspace");
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

  /** Lazily-constructed sub-clients; require host.fetch + host.token. */
  private _cal: GCalendarClient | null = null;
  private _mail: GMailClient | null = null;
  private _contacts: GContactsClient | null = null;
  private _drive: GDriveClient | null = null;

  calendar(): GCalendarClient | null {
    if (!this.host.fetch || !this.host.token) return null;
    if (!this._cal)
      this._cal = new GCalendarClient({
        fetch: this.host.fetch,
        token: this.host.token,
      });
    return this._cal;
  }
  gmail(): GMailClient | null {
    if (!this.host.fetch || !this.host.token) return null;
    if (!this._mail)
      this._mail = new GMailClient({
        fetch: this.host.fetch,
        token: this.host.token,
      });
    return this._mail;
  }
  contacts(): GContactsClient | null {
    if (!this.host.fetch || !this.host.token) return null;
    if (!this._contacts)
      this._contacts = new GContactsClient({
        fetch: this.host.fetch,
        token: this.host.token,
      });
    return this._contacts;
  }
  drive(): GDriveClient | null {
    if (!this.host.fetch || !this.host.token) return null;
    if (!this._drive)
      this._drive = new GDriveClient({
        fetch: this.host.fetch,
        token: this.host.token,
      });
    return this._drive;
  }

  async syncResource(
    id: string,
  ): Promise<{ pulled: number; pushed: number; errors: number }> {
    if (!this.host.fetch || !this.host.token)
      return { pulled: 0, pushed: 0, errors: 0 };
    let pulled = 0,
      errors = 0;
    try {
      switch (id) {
        case "calendar": {
          this.host.scopes.require("google_workspace", "calendar.read");
          const cal = this.calendar()!;
          const now = new Date();
          const tMin = new Date(now.getTime() - 7 * 86400_000).toISOString();
          const tMax = new Date(now.getTime() + 7 * 86400_000).toISOString();
          const r = await cal.listEvents("primary", {
            timeMin: tMin,
            timeMax: tMax,
            maxResults: 250,
          });
          pulled = r.events.length;
          break;
        }
        case "gmail": {
          this.host.scopes.require("google_workspace", "gmail.read");
          const m = this.gmail()!;
          const r = await m.listMessages({
            q: "newer_than:7d",
            maxResults: 100,
          });
          pulled = r.messages.length;
          break;
        }
        case "contacts": {
          this.host.scopes.require("google_workspace", "contacts.read");
          const c = this.contacts()!;
          const r = await c.listConnections({ pageSize: 200 });
          pulled = r.connections.length;
          break;
        }
        case "drive": {
          this.host.scopes.require("google_workspace", "drive.read");
          const d = this.drive()!;
          const r = await d.listFiles({ pageSize: 50 });
          pulled = r.files.length;
          break;
        }
      }
    } catch {
      errors++;
    }
    return { pulled, pushed: 0, errors };
  }
}
