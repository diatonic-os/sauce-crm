// SPEC §22-27 — Aggregate registry of all integrations + resource list per provider.

import { App, requestUrl } from "obsidian";
import type {
  IIntegration,
  SyncResource,
  SyncFrequency,
  IntegrationId,
} from "./IIntegration";
import type { OAuthFlow } from "../security/OAuthFlow";
import { GoogleWorkspaceIntegration } from "./google";
import { Microsoft365Integration } from "./microsoft";
import { AppleIntegration } from "./apple";
import { NotionIntegration } from "./notion";
import { TwilioIntegration } from "./twilio";
import { SmtpImapIntegration } from "./smtpimap";
import type { SmtpImapAccount } from "./smtpimap/SmtpImapClient";
import type { FetchHost, TokenResolver } from "./google/types";
import type { AppleAuth } from "./apple/types";
import type { TwilioAuth } from "./twilio/TwilioClient";
import type {
  SmtpImapHost,
  ImapCredentials,
  SmtpCredentials,
} from "./smtpimap/types";
import type { ScopeRegistry } from "../security/ScopeRegistry";
import type { ProxyClient } from "../security/ProxyClient";

export class ObsidianFetchHost implements FetchHost {
  async fetch(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
  }> {
    const r = await requestUrl({
      url,
      method: init.method,
      headers: init.headers,
      ...(init.body !== undefined ? { body: init.body } : {}),
      throw: false,
    });
    const headers: Record<string, string> = {};
    const rawHeaders = r.headers as Record<string, unknown>;
    for (const k of Object.keys(rawHeaders))
      headers[k.toLowerCase()] = String(rawHeaders[k]);
    return { status: r.status, headers, body: r.text };
  }
}

export interface IntegrationTokens {
  google?: () => Promise<string>;
  microsoft?: () => Promise<string>;
  notion?: () => Promise<string>;
  apple?: () => Promise<AppleAuth>;
  twilio?: () => Promise<TwilioAuth>;
  imap?: () => Promise<ImapCredentials>;
  smtp?: () => Promise<SmtpCredentials>;
  smtpImapBridge?: SmtpImapHost;
}

export class IntegrationRegistry {
  google: GoogleWorkspaceIntegration | null = null;
  microsoft: Microsoft365Integration | null = null;
  apple: AppleIntegration | null = null;
  notion: NotionIntegration | null = null;
  twilio: TwilioIntegration | null = null;
  smtpImap: SmtpImapIntegration | null = null;
  /**
   * Socket bridge injected at runtime (P15). The plugin renderer cannot open
   * raw TCP sockets, so the actual IMAP/SMTP transport is provided by a
   * Node-side companion or relay implementing SmtpImapHost. This is the
   * injection point named by UnconfiguredSmtpImapHost's error message
   * ("plugin.integrations.setSmtpImapHost()"). Defaults to the bridge passed
   * in tokens, or null until set.
   */
  private smtpImapHost: SmtpImapHost | null = null;
  private resources = new Map<IntegrationId, SyncResource[]>();

  oauth: OAuthFlow | null = null;

  constructor(
    public app: App,
    public tokens: IntegrationTokens,
    public fetch: FetchHost = new ObsidianFetchHost(),
    oauth?: OAuthFlow,
  ) {
    this.oauth = oauth ?? null;
    // P15 will wire real ScopeRegistry/ProxyClient; stubs satisfy the structural
    // requirement until then. Cast through unknown — the `as never` at each
    // constructor call is the single escape that acknowledges the stub.
    const scopes = {
      require: (_i: string, _s: string) => {
        /* P15 wires ScopeRegistry */
      },
    } as unknown as ScopeRegistry;
    const proxy = {} as unknown as ProxyClient;
    this.google = new GoogleWorkspaceIntegration({
      scopes,
      proxy,
      fetch: this.fetch,
      token: tokens.google ?? noToken,
      // OAuthFlow handle so connect()/disconnect() actually run PKCE + revoke.
      ...(this.oauth ? { oauth: this.oauth } : {}),
    } as never);
    this.microsoft = new Microsoft365Integration({
      scopes,
      proxy,
      fetch: this.fetch,
      token: tokens.microsoft ?? noToken,
      ...(this.oauth ? { oauth: this.oauth } : {}),
    } as never);
    this.apple = new AppleIntegration({
      scopes,
      proxy,
      fetch: this.fetch,
      ...(tokens.apple !== undefined ? { auth: tokens.apple } : {}),
    });
    this.notion = new NotionIntegration({
      scopes,
      proxy,
      fetch: this.fetch,
      token: tokens.notion ?? noToken,
    });
    this.twilio = new TwilioIntegration({
      scopes,
      proxy,
      fetch: this.fetch,
      ...(tokens.twilio !== undefined ? { auth: tokens.twilio } : {}),
    });
    this.smtpImap = new SmtpImapIntegration({
      scopes,
      proxy,
      ...(this.oauth ? { oauth: this.oauth } : {}),
    });
    // A pre-supplied socket bridge (Electron-main companion or relay) may be
    // injected via tokens; otherwise it is wired later through
    // setSmtpImapHost(). Either way it lives on the registry, not the
    // integration class (which speaks to the network via SmtpImapClient).
    this.smtpImapHost = tokens.smtpImapBridge ?? null;
    this.resources.set("google_workspace", defaultGoogleResources());
    this.resources.set("microsoft_365", defaultMicrosoftResources());
    this.resources.set("apple", defaultAppleResources());
    this.resources.set("notion", defaultNotionResources());
    this.resources.set("twilio", defaultTwilioResources());
    this.resources.set("smtp_imap", defaultSmtpImapResources());
    this.google.setResources(this.resources.get("google_workspace")!);
    this.microsoft.setResources(this.resources.get("microsoft_365")!);
    this.apple.setResources(this.resources.get("apple")!);
    this.notion.setResources(this.resources.get("notion")!);
    this.twilio.setResources(this.resources.get("twilio")!);
    this.smtpImap.setResources(this.resources.get("smtp_imap")!);
  }

  /**
   * Inject the SMTP/IMAP socket bridge (Node-side companion or TCP-over-HTTPS
   * relay). Referenced by UnconfiguredSmtpImapHost's error message. Returns the
   * registry for chaining.
   */
  setSmtpImapHost(host: SmtpImapHost): this {
    this.smtpImapHost = host;
    return this;
  }

  /** The currently-wired SMTP/IMAP socket bridge, or null if none. */
  getSmtpImapHost(): SmtpImapHost | null {
    return this.smtpImapHost;
  }

  /**
   * Resolve the imap/smtp credential resolvers from tokens into an
   * SmtpImapAccount and register it on the SMTP/IMAP integration. No-op when
   * neither resolver is configured. Returns the registered account, if any.
   */
  async loadSmtpImapAccount(
    accountId = "default",
  ): Promise<SmtpImapAccount | null> {
    if (!this.smtpImap) return null;
    if (!this.tokens.imap && !this.tokens.smtp) return null;
    const imap = this.tokens.imap ? await this.tokens.imap() : null;
    const smtp = this.tokens.smtp ? await this.tokens.smtp() : null;
    if (!imap && !smtp) return null;
    const account: SmtpImapAccount = {
      id: accountId,
      imapHost: imap?.host ?? "",
      imapPort: imap?.port ?? 993,
      ...(smtp?.host !== undefined ? { smtpHost: smtp.host } : {}),
      ...(smtp?.port !== undefined ? { smtpPort: smtp.port } : {}),
      username: imap?.username ?? smtp?.username ?? "",
      authMode: "plain",
    };
    this.smtpImap.addAccount(account);
    return account;
  }

  list(): IIntegration[] {
    const out: IIntegration[] = [];
    if (this.google) out.push(this.google);
    if (this.microsoft) out.push(this.microsoft);
    if (this.apple) out.push(this.apple);
    if (this.notion) out.push(this.notion);
    if (this.twilio) out.push(this.twilio);
    if (this.smtpImap) out.push(this.smtpImap);
    return out;
  }

  byId(id: IntegrationId): IIntegration | null {
    if (id === "google_workspace") return this.google;
    if (id === "microsoft_365") return this.microsoft;
    if (id === "apple") return this.apple;
    if (id === "notion") return this.notion;
    if (id === "twilio") return this.twilio;
    if (id === "smtp_imap") return this.smtpImap;
    return null;
  }

  resourcesFor(id: IntegrationId): SyncResource[] {
    return this.resources.get(id) ?? [];
  }

  async syncAll(): Promise<
    { id: string; resource: string; pulled: number; errors: number }[]
  > {
    const out: {
      id: string;
      resource: string;
      pulled: number;
      errors: number;
    }[] = [];
    for (const integ of this.list()) {
      for (const res of this.resourcesFor(integ.id as IntegrationId)) {
        if (!res.enabled) continue;
        const r = await integ.syncResource(res.id);
        out.push({
          id: integ.id,
          resource: res.id,
          pulled: r.pulled,
          errors: r.errors,
        });
      }
    }
    return out;
  }

  setToken(provider: "google" | "microsoft", resolver: TokenResolver): void {
    this.tokens[provider] = resolver;
  }
}

const noToken: TokenResolver = async () => {
  throw new Error("integration token not configured");
};

function defaultGoogleResources(): SyncResource[] {
  const mk = (
    id: string,
    label: string,
    frequency: SyncFrequency,
  ): SyncResource => ({
    id,
    label,
    frequency,
    enabled: false,
    lastPullTs: null,
    cursor: null,
  });
  return [
    mk("calendar", "Calendar (events)", "15m"),
    mk("gmail", "Gmail (recent)", "1h"),
    mk("contacts", "Contacts", "manual"),
    mk("drive", "Drive (metadata)", "daily"),
  ];
}

function defaultMicrosoftResources(): SyncResource[] {
  const mk = (
    id: string,
    label: string,
    frequency: SyncFrequency,
  ): SyncResource => ({
    id,
    label,
    frequency,
    enabled: false,
    lastPullTs: null,
    cursor: null,
  });
  return [
    mk("calendar", "Calendar (events)", "15m"),
    mk("outlook", "Outlook (mail)", "1h"),
    mk("contacts", "Contacts", "manual"),
  ];
}

function defaultAppleResources(): SyncResource[] {
  const mk = (
    id: string,
    label: string,
    frequency: SyncFrequency,
  ): SyncResource => ({
    id,
    label,
    frequency,
    enabled: false,
    lastPullTs: null,
    cursor: null,
  });
  return [
    mk("calendar", "iCloud Calendar (CalDAV)", "15m"),
    mk("contacts", "iCloud Contacts (CardDAV)", "manual"),
  ];
}

function defaultNotionResources(): SyncResource[] {
  const mk = (
    id: string,
    label: string,
    frequency: SyncFrequency,
  ): SyncResource => ({
    id,
    label,
    frequency,
    enabled: false,
    lastPullTs: null,
    cursor: null,
  });
  return [mk("databases", "Notion Databases (discovery)", "daily")];
}

function defaultTwilioResources(): SyncResource[] {
  const mk = (
    id: string,
    label: string,
    frequency: SyncFrequency,
  ): SyncResource => ({
    id,
    label,
    frequency,
    enabled: false,
    lastPullTs: null,
    cursor: null,
  });
  return [
    mk("calls", "Twilio calls", "1h"),
    mk("messages", "Twilio SMS", "1h"),
    mk("recordings", "Twilio recordings", "1h"),
    mk("transcriptions", "Twilio transcriptions", "1h"),
  ];
}

function defaultSmtpImapResources(): SyncResource[] {
  const mk = (
    id: string,
    label: string,
    frequency: SyncFrequency,
  ): SyncResource => ({
    id,
    label,
    frequency,
    enabled: false,
    lastPullTs: null,
    cursor: null,
  });
  return [mk("inbox", "Inbox (recent)", "1h"), mk("sent", "Sent", "manual")];
}
