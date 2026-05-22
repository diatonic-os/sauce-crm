import type { ConnectionState, IIntegration, SyncResource } from '../IIntegration';
import type { OAuthFlow } from '../../security/OAuthFlow';
import type { ScopeRegistry } from '../../security/ScopeRegistry';
import type { ProxyClient } from '../../security/ProxyClient';
import type { FetchHost, TokenResolver } from './types';
import { MSCalendarClient } from './MSCalendarClient';
import { MSOutlookClient } from './MSOutlookClient';
import { MSContactsClient } from './MSContactsClient';

export * from './types';
export { MSCalendarClient } from './MSCalendarClient';
export { MSOutlookClient } from './MSOutlookClient';
export { MSContactsClient } from './MSContactsClient';

export interface Microsoft365IntegrationHost {
  readonly oauth?: OAuthFlow;
  readonly scopes: ScopeRegistry;
  readonly proxy: ProxyClient;
  readonly fetch?: FetchHost;
  readonly token?: TokenResolver;
}

export class Microsoft365Integration implements IIntegration {
  readonly id = 'microsoft_365';
  readonly label = 'Microsoft 365';
  private resources: SyncResource[] = [];
  private connection: ConnectionState = { connected: false };

  constructor(protected readonly host: Microsoft365IntegrationHost) {}

  async connect(): Promise<ConnectionState> {
    if (this.host.oauth) {
      const ts = await this.host.oauth.authorize('microsoft_365', []);
      this.connection = { connected: true, expiresAt: ts.expiresAt };
    } else {
      this.connection = { connected: true };
    }
    return this.connection;
  }

  async disconnect(): Promise<void> {
    if (this.host.oauth) await this.host.oauth.revoke('microsoft_365');
    this.connection = { connected: false };
  }

  async state(): Promise<ConnectionState> { return this.connection; }
  async listResources(): Promise<SyncResource[]> { return this.resources; }

  setResources(rs: SyncResource[]): void { this.resources = rs; }

  private _cal: MSCalendarClient | null = null;
  private _mail: MSOutlookClient | null = null;
  private _contacts: MSContactsClient | null = null;

  calendar(): MSCalendarClient | null {
    if (!this.host.fetch || !this.host.token) return null;
    if (!this._cal) this._cal = new MSCalendarClient({ fetch: this.host.fetch, token: this.host.token });
    return this._cal;
  }
  outlook(): MSOutlookClient | null {
    if (!this.host.fetch || !this.host.token) return null;
    if (!this._mail) this._mail = new MSOutlookClient({ fetch: this.host.fetch, token: this.host.token });
    return this._mail;
  }
  contacts(): MSContactsClient | null {
    if (!this.host.fetch || !this.host.token) return null;
    if (!this._contacts) this._contacts = new MSContactsClient({ fetch: this.host.fetch, token: this.host.token });
    return this._contacts;
  }

  async syncResource(id: string): Promise<{ pulled: number; pushed: number; errors: number }> {
    if (!this.host.fetch || !this.host.token) return { pulled: 0, pushed: 0, errors: 0 };
    let pulled = 0, errors = 0;
    try {
      switch (id) {
        case "calendar": {
          this.host.scopes.require("microsoft_365", "calendar.read");
          const now = new Date();
          const r = await this.calendar()!.listEvents({
            startDateTime: new Date(now.getTime() - 7 * 86400_000).toISOString(),
            endDateTime: new Date(now.getTime() + 7 * 86400_000).toISOString(),
            top: 200,
          });
          pulled = r.events.length;
          break;
        }
        case "outlook": {
          this.host.scopes.require("microsoft_365", "mail.read");
          const r = await this.outlook()!.listMessages({ top: 50 });
          pulled = r.length;
          break;
        }
        case "contacts": {
          this.host.scopes.require("microsoft_365", "contacts.read");
          const r = await this.contacts()!.listContacts({ top: 100 });
          pulled = r.length;
          break;
        }
      }
    } catch { errors++; }
    return { pulled, pushed: 0, errors };
  }
}
