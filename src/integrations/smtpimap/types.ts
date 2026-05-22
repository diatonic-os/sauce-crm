// SPEC §27 — IMAP / SMTP need TCP sockets which the Electron renderer doesn't expose
// directly. We model the protocol as a host-interface implemented either by:
//   1. A Node-side companion (Electron main-process IPC bridge), or
//   2. An external relay (user-configured TCP-over-HTTPS proxy).
// The plugin ships the interface + integration class; the host implementation
// is injected at runtime (P15) — see SmtpImapHost below.

export interface ImapCredentials {
  host: string;
  port: number;        // typically 993 (TLS) or 143 (STARTTLS)
  username: string;
  password: string;    // app-specific password or OAuth XOAUTH2 token
  tls: boolean;
}

export interface SmtpCredentials {
  host: string;
  port: number;        // 465 SMTPS, 587 STARTTLS
  username: string;
  password: string;
  tls: boolean;
}

export interface ImapMessageMeta {
  uid: number;
  mailbox: string;
  subject?: string;
  from?: string;
  to?: string;
  cc?: string;
  date?: string;
  messageId?: string;
  flags?: string[];
  bodyPreview?: string;
}

export interface ImapWatchHandle {
  stop(): Promise<void>;
}

/**
 * Host interface that must be provided by a Node-bridge or relay.
 * The plugin code never imports `net` or `tls` — all socket work lives here.
 */
export interface SmtpImapHost {
  imapListMailboxes(creds: ImapCredentials): Promise<string[]>;
  imapList(creds: ImapCredentials, mailbox: string, opts: { since?: string; limit?: number }): Promise<ImapMessageMeta[]>;
  imapFetchBody(creds: ImapCredentials, mailbox: string, uid: number): Promise<{ raw: string }>;
  /** Opens an IMAP IDLE watch; calls onMessage on new arrivals. */
  imapIdle?(creds: ImapCredentials, mailbox: string, onMessage: (m: ImapMessageMeta) => void): Promise<ImapWatchHandle>;
  smtpSend(creds: SmtpCredentials, msg: { from: string; to: string[]; subject: string; body: string; html?: string }): Promise<{ accepted: string[]; messageId: string }>;
}

/** Default host used until a real bridge is wired — every call throws a clear error. */
export class UnconfiguredSmtpImapHost implements SmtpImapHost {
  private err(name: string): never { throw new Error(`smtp/imap host not configured (${name}). Inject a SmtpImapHost via plugin.integrations.setSmtpImapHost().`); }
  async imapListMailboxes(): Promise<string[]> { this.err("imapListMailboxes"); }
  async imapList(): Promise<ImapMessageMeta[]> { this.err("imapList"); }
  async imapFetchBody(): Promise<{ raw: string }> { this.err("imapFetchBody"); }
  async smtpSend(): Promise<{ accepted: string[]; messageId: string }> { this.err("smtpSend"); }
}
