import type { ConnectionState, IIntegration, SyncResource } from '../IIntegration';
import type { OAuthFlow } from '../../security/OAuthFlow';
import type { ScopeRegistry } from '../../security/ScopeRegistry';
import type { ProxyClient } from '../../security/ProxyClient';
import type { CredentialSource } from '../../copilot/CredentialSource';
import { SmtpImapClient, type SmtpImapAccount, type SocksProxyConfig, type ImapConnectionResult } from './SmtpImapClient';

export interface SmtpImapIntegrationHost {
  readonly oauth?: OAuthFlow;
  readonly scopes: ScopeRegistry;
  readonly proxy: ProxyClient;
  readonly source?: CredentialSource;
  readonly socksProxy?: SocksProxyConfig;
}

export class SmtpImapIntegration implements IIntegration {
  readonly id = 'smtp_imap';
  readonly label = 'SMTP/IMAP';
  private resources: SyncResource[] = [];
  private connection: ConnectionState = { connected: false };
  private accounts: SmtpImapAccount[] = [];

  constructor(protected readonly host: SmtpImapIntegrationHost) {}

  addAccount(account: SmtpImapAccount): void {
    this.accounts = [...this.accounts.filter((a) => a.id !== account.id), account];
  }
  listAccounts(): SmtpImapAccount[] { return [...this.accounts]; }
  setResources(rs: SyncResource[]): void { this.resources = rs; }

  async connect(): Promise<ConnectionState> {
    this.connection = { connected: true, account: this.accounts.map((a) => a.username).join(', ') };
    return this.connection;
  }
  async disconnect(): Promise<void> { this.connection = { connected: false }; }
  async state(): Promise<ConnectionState> { return this.connection; }
  async listResources(): Promise<SyncResource[]> { return this.resources; }
  async syncResource(_id: string): Promise<{ pulled: number; pushed: number; errors: number }> {
    return { pulled: 0, pushed: 0, errors: 0 };
  }

  async probeAccount(accountId: string): Promise<ImapConnectionResult> {
    const account = this.accounts.find((a) => a.id === accountId);
    if (!account) throw new Error(`no account: ${accountId}`);
    if (!this.host.source) throw new Error('no credential source — KeyVault required for SMTP/IMAP');
    this.host.scopes.require(this.id, 'inbox.read');
    const client = new SmtpImapClient({
      account,
      source: this.host.source,
      proxy: this.host.socksProxy,
      rejectUnauthorized: true,
      minTlsVersion: 'TLSv1.2',
    });
    return client.probe();
  }
}
