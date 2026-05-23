import type {
  ConnectionState,
  IIntegration,
  SyncResource,
} from "../IIntegration";
import type { OAuthFlow } from "../../security/OAuthFlow";
import type { ScopeRegistry } from "../../security/ScopeRegistry";
import type { ProxyClient } from "../../security/ProxyClient";
import type { FetchHost, AppleAuth } from "./types";
import { CalDAVClient } from "./CalDAVClient";
import { CardDAVClient } from "./CardDAVClient";

export * from "./types";
export { CalDAVClient } from "./CalDAVClient";
export { CardDAVClient } from "./CardDAVClient";

export interface AppleIntegrationHost {
  readonly oauth?: OAuthFlow;
  readonly scopes: ScopeRegistry;
  readonly proxy: ProxyClient;
  readonly fetch?: FetchHost;
  readonly auth?: () => Promise<AppleAuth>;
}

export class AppleIntegration implements IIntegration {
  readonly id = "apple";
  readonly label = "Apple (iCloud)";
  private resources: SyncResource[] = [];
  private connection: ConnectionState = { connected: false };

  constructor(protected readonly host: AppleIntegrationHost) {}

  async connect(): Promise<ConnectionState> {
    if (this.host.oauth) {
      const ts = await this.host.oauth.authorize("apple", []);
      this.connection = { connected: true, expiresAt: ts.expiresAt };
    } else {
      this.connection = { connected: true };
    }
    return this.connection;
  }

  async disconnect(): Promise<void> {
    if (this.host.oauth) await this.host.oauth.revoke("apple");
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

  private _caldav: CalDAVClient | null = null;
  private _carddav: CardDAVClient | null = null;
  private daysWindow = 30;

  caldav(): CalDAVClient | null {
    if (!this.host.fetch || !this.host.auth) return null;
    if (!this._caldav)
      this._caldav = new CalDAVClient({
        fetch: this.host.fetch,
        auth: this.host.auth,
      });
    return this._caldav;
  }
  carddav(): CardDAVClient | null {
    if (!this.host.fetch || !this.host.auth) return null;
    if (!this._carddav)
      this._carddav = new CardDAVClient({
        fetch: this.host.fetch,
        auth: this.host.auth,
      });
    return this._carddav;
  }

  async syncResource(
    id: string,
  ): Promise<{ pulled: number; pushed: number; errors: number }> {
    if (!this.host.fetch || !this.host.auth)
      return { pulled: 0, pushed: 0, errors: 0 };
    let pulled = 0,
      errors = 0;
    try {
      if (id === "calendar") {
        const c = this.caldav()!;
        const principal = await c.discoverPrincipal();
        if (!principal) return { pulled: 0, pushed: 0, errors: 1 };
        const cals = await c.listCalendars(principal);
        const now = new Date();
        const start = new Date(
          now.getTime() - this.daysWindow * 86400_000,
        ).toISOString();
        const end = new Date(
          now.getTime() + this.daysWindow * 86400_000,
        ).toISOString();
        for (const cal of cals) {
          const events = await c.listEvents(cal, start, end);
          pulled += events.length;
        }
      } else if (id === "contacts") {
        const c = this.carddav()!;
        const principal = await c.discoverPrincipal();
        if (!principal) return { pulled: 0, pushed: 0, errors: 1 };
        const books = await c.listAddressBooks(principal);
        for (const ab of books) {
          const contacts = await c.listContacts(ab);
          pulled += contacts.length;
        }
      }
    } catch {
      errors++;
    }
    return { pulled, pushed: 0, errors };
  }
}
