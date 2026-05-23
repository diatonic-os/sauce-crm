import type {
  ConnectionState,
  IIntegration,
  SyncResource,
} from "../IIntegration";
import type { OAuthFlow } from "../../security/OAuthFlow";
import type { ScopeRegistry } from "../../security/ScopeRegistry";
import type { ProxyClient } from "../../security/ProxyClient";
import { TwilioClient, type FetchHost, type TwilioAuth } from "./TwilioClient";

export { TwilioClient } from "./TwilioClient";
export type {
  TwilioCall,
  TwilioMessage,
  TwilioRecording,
  TwilioTranscription,
  TwilioAuth,
} from "./TwilioClient";

export interface TwilioIntegrationHost {
  readonly oauth?: OAuthFlow;
  readonly scopes: ScopeRegistry;
  readonly proxy: ProxyClient;
  readonly fetch?: FetchHost;
  readonly auth?: () => Promise<TwilioAuth>;
}

export class TwilioIntegration implements IIntegration {
  readonly id = "twilio";
  readonly label = "Twilio";
  private resources: SyncResource[] = [];
  private connection: ConnectionState = { connected: false };

  constructor(protected readonly host: TwilioIntegrationHost) {}

  async connect(): Promise<ConnectionState> {
    if (this.host.oauth) {
      const ts = await this.host.oauth.authorize("twilio", []);
      this.connection = { connected: true, expiresAt: ts.expiresAt };
    } else {
      this.connection = { connected: true };
    }
    return this.connection;
  }

  async disconnect(): Promise<void> {
    if (this.host.oauth) await this.host.oauth.revoke("twilio");
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

  private _client: TwilioClient | null = null;
  client(): TwilioClient | null {
    if (!this.host.fetch || !this.host.auth) return null;
    if (!this._client)
      this._client = new TwilioClient({
        fetch: this.host.fetch,
        auth: this.host.auth,
      });
    return this._client;
  }

  async syncResource(
    id: string,
  ): Promise<{ pulled: number; pushed: number; errors: number }> {
    if (!this.host.fetch || !this.host.auth)
      return { pulled: 0, pushed: 0, errors: 0 };
    const c = this.client()!;
    let pulled = 0,
      errors = 0;
    try {
      if (id === "calls") pulled = (await c.listCalls({ pageSize: 50 })).length;
      else if (id === "messages")
        pulled = (await c.listMessages({ pageSize: 50 })).length;
      else if (id === "recordings") pulled = (await c.listRecordings()).length;
      else if (id === "transcriptions")
        pulled = (await c.listTranscriptions()).length;
    } catch {
      errors++;
    }
    return { pulled, pushed: 0, errors };
  }
}
