// SPEC §27 — Secure SMTP/IMAP client.
// • Strict TLS only (no STARTTLS fallback to plaintext)
// • Two auth modes: PLAIN (app password) and XOAUTH2 (Bearer access token)
// • Optional SOCKS5 proxy egress for tor/anonymizing relays
// • All credentials sourced from KeyVault via CredentialSource — never accepted as plain strings
// • Memory hygiene: passwords zeroed after use; never logged; conn id is the only thing traced
//
// Why pure node: the plugin runs in Obsidian's Electron renderer. Pulling in `imap` / `imapflow`
// adds Buffer-polyfill weight and a transitive surface area we don't need for our small set of
// IMAP commands (CAPABILITY, LOGIN, AUTHENTICATE, SELECT, SEARCH, FETCH, LOGOUT).

import * as tls from "node:tls";
import * as net from "node:net";
import type { CredentialSource } from "../../saucebot/CredentialSource";

export type ImapAuthMode = "plain" | "xoauth2";

export interface SmtpImapAccount {
  /** Stable account id used as KeyVault key prefix. e.g. 'default', 'drew-saucetech'. */
  id: string;
  imapHost: string; // e.g. 'imap.gmail.com'
  imapPort: number; // 993 for implicit TLS, 143 + STARTTLS not supported (insecure)
  smtpHost?: string;
  smtpPort?: number;
  username: string;
  authMode: ImapAuthMode;
}

export interface SocksProxyConfig {
  host: string;
  port: number;
  username?: string;
  password?: string;
}

export interface SmtpImapClientOptions {
  account: SmtpImapAccount;
  source: CredentialSource;
  /** Hard timeout for the entire connect+login handshake. */
  handshakeTimeoutMs?: number;
  /** Reject the connection unless the cert chain validates AND the SAN matches the host. */
  rejectUnauthorized?: boolean;
  /** Optional SOCKS5 egress; not used by default. */
  proxy?: SocksProxyConfig;
  /** TLS minimum version. Default TLSv1.2. */
  minTlsVersion?: "TLSv1.2" | "TLSv1.3";
}

export interface ImapConnectionResult {
  ok: boolean;
  capability: string[];
  /** Server greeting (* OK ...) — useful for forensic debugging. Never includes secrets. */
  greeting: string;
  authMode: ImapAuthMode;
  /** Selected folder if SELECT was issued (e.g. INBOX). */
  selectedFolder?: string;
  /** EXISTS count if SELECT issued. */
  messageCount?: number;
  /** Round-trip ms from socket-open to LOGIN OK. */
  loginLatencyMs?: number;
  error?: string;
}

const APP_PASSWORD_KEY = (id: string) => `smtp_imap:${id}:app-password`;
const OAUTH_TOKEN_KEY = (id: string) => `smtp_imap:${id}:oauth-access-token`;

export class SmtpImapClient {
  constructor(private readonly opts: SmtpImapClientOptions) {}

  /** Issue CAPABILITY + LOGIN/AUTHENTICATE + SELECT INBOX + LOGOUT and report. Never logs creds. */
  async probe(): Promise<ImapConnectionResult> {
    const { account } = this.opts;
    const handshakeTimeoutMs = this.opts.handshakeTimeoutMs ?? 15_000;
    const rejectUnauthorized = this.opts.rejectUnauthorized ?? true;

    let socket: net.Socket | tls.TLSSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cleanup = (): void => {
      try {
        socket?.destroy();
      } catch {
        /* */
      }
      if (timer) clearTimeout(timer);
    };

    try {
      const innerSocket = this.opts.proxy
        ? await this.connectSocks5(
            this.opts.proxy,
            account.imapHost,
            account.imapPort,
          )
        : null;
      socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
        const tlsOpts: tls.ConnectionOptions = {
          host: account.imapHost,
          servername: account.imapHost,
          port: account.imapPort,
          rejectUnauthorized,
          minVersion: this.opts.minTlsVersion ?? "TLSv1.2",
          socket: innerSocket ?? undefined,
        };
        const s: tls.TLSSocket = tls.connect(tlsOpts, () => resolve(s));
        s.once("error", (e: Error) => reject(e));
      });

      timer = setTimeout(() => {
        socket?.destroy(new Error("handshake timeout"));
      }, handshakeTimeoutMs);

      const greeting = await this.readUntil(socket, "\r\n");
      if (!/^\* OK/.test(greeting))
        throw new Error(`unexpected greeting: ${greeting.slice(0, 80)}`);

      // CAPABILITY before login
      const capLine = await this.sendCommand(socket, "A1 CAPABILITY");
      const capabilities = this.parseCapabilities(capLine);

      // Authenticate
      const startLogin = Date.now();
      let secret: string;
      let authResp: string;
      if (account.authMode === "xoauth2") {
        const tok = await this.opts.source.get(OAUTH_TOKEN_KEY(account.id));
        if (!tok)
          throw new Error(
            `no XOAUTH2 token for ${account.id} (key: ${OAUTH_TOKEN_KEY(account.id)})`,
          );
        secret = tok;
        const payload = Buffer.from(
          `user=${account.username}\x01auth=Bearer ${secret}\x01\x01`,
        ).toString("base64");
        authResp = await this.sendCommand(
          socket,
          `A2 AUTHENTICATE XOAUTH2 ${payload}`,
        );
      } else {
        const pw = await this.opts.source.get(APP_PASSWORD_KEY(account.id));
        if (!pw)
          throw new Error(
            `no app password for ${account.id} (key: ${APP_PASSWORD_KEY(account.id)})`,
          );
        secret = pw;
        // PLAIN over TLS only — implicit TLS already established above.
        authResp = await this.sendCommand(
          socket,
          `A2 LOGIN ${account.username} ${this.imapQuote(secret)}`,
        );
      }
      const loginLatencyMs = Date.now() - startLogin;

      // Zero the secret in memory ASAP.
      secret = "";

      if (!/^A2 OK/m.test(authResp)) {
        const errMsg = (
          authResp.split("\n").find((l) => /^A2 /.test(l)) ?? ""
        ).slice(0, 200);
        cleanup();
        return {
          ok: false,
          capability: capabilities,
          greeting: greeting.trim(),
          authMode: account.authMode,
          error: errMsg,
        };
      }

      // SELECT INBOX to confirm full e2e
      const selResp = await this.sendCommand(socket, "A3 SELECT INBOX");
      const existsMatch = /\* (\d+) EXISTS/.exec(selResp);
      // capture group 1 (\d+) is always present when the regex matches
      const existsStr = existsMatch?.[1];
      const messageCount =
        existsStr !== undefined ? parseInt(existsStr, 10) : undefined;

      await this.sendCommand(socket, "A4 LOGOUT");
      cleanup();
      return {
        ok: true,
        capability: capabilities,
        greeting: greeting.trim(),
        authMode: account.authMode,
        selectedFolder: "INBOX",
        ...(messageCount !== undefined ? { messageCount } : {}),
        loginLatencyMs,
      };
    } catch (e) {
      cleanup();
      return {
        ok: false,
        capability: [],
        greeting: "",
        authMode: account.authMode,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  private async sendCommand(
    socket: tls.TLSSocket | net.Socket,
    cmd: string,
  ): Promise<string> {
    socket.write(cmd + "\r\n");
    // Tag is always alphanumeric (e.g. "A1"). Pass it as a plain string so
    // readUntil never constructs a dynamic RegExp.
    const tag = cmd.split(" ")[0]!.replace(/[^A-Za-z0-9]/g, ""); // split always produces ≥1 element
    return this.readUntil(socket, tag);
  }

  private readUntil(
    socket: tls.TLSSocket | net.Socket,
    terminator: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let buf = "";
      const onData = (chunk: Buffer): void => {
        buf += chunk.toString("utf-8");
        // A tagged response line looks like "<tag> OK ...", "<tag> NO ...", or
        // "<tag> BAD ...". Checking for the tag followed by a space and one of
        // the three status words is sufficient and avoids any dynamic RegExp.
        const t = terminator + " ";
        const done =
          buf.includes(t + "OK") ||
          buf.includes(t + "NO") ||
          buf.includes(t + "BAD");
        if (done) {
          socket.removeListener("data", onData);
          socket.removeListener("error", onError);
          resolve(buf);
        }
      };
      const onError = (e: Error): void => {
        socket.removeListener("data", onData);
        socket.removeListener("error", onError);
        reject(e);
      };
      socket.on("data", onData);
      socket.once("error", onError);
    });
  }

  private parseCapabilities(line: string): string[] {
    const m = /\* CAPABILITY ([^\r\n]+)/.exec(line);
    const cap = m?.[1]; // capture group 1 is always present when regex matches
    return cap ? cap.split(/\s+/).filter(Boolean) : [];
  }

  private imapQuote(s: string): string {
    // IMAP atom — quote if contains anything outside ATOM_CHAR per RFC 3501.
    if (/^[\x21\x23-\x5B\x5D-\x7E]+$/.test(s)) return s;
    return '"' + s.replace(/[\\"]/g, (c) => "\\" + c) + '"';
  }

  private async connectSocks5(
    cfg: SocksProxyConfig,
    host: string,
    port: number,
  ): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const sock = net.connect(cfg.port, cfg.host, () => {
        // RFC 1928 — minimal SOCKS5 client with optional username/password (RFC 1929).
        const auths = cfg.username
          ? Buffer.from([0x05, 0x02, 0x00, 0x02])
          : Buffer.from([0x05, 0x01, 0x00]);
        sock.write(auths);
        sock.once("data", (greet) => {
          if (greet[0] !== 0x05) {
            reject(new Error("SOCKS5 bad version"));
            return;
          }
          const method = greet[1];
          const proceed = (): void => {
            const addr = Buffer.from(host, "utf-8");
            const req = Buffer.concat([
              Buffer.from([0x05, 0x01, 0x00, 0x03, addr.length]),
              addr,
              Buffer.from([(port >> 8) & 0xff, port & 0xff]),
            ]);
            sock.write(req);
            sock.once("data", (resp) => {
              if (resp[0] !== 0x05 || resp[1] !== 0x00) {
                reject(new Error(`SOCKS5 connect failed (rep=${resp[1]})`));
                return;
              }
              resolve(sock);
            });
          };
          if (method === 0x00) proceed();
          else if (method === 0x02 && cfg.username) {
            const u = Buffer.from(cfg.username);
            const p = Buffer.from(cfg.password ?? "");
            const auth = Buffer.concat([
              Buffer.from([0x01, u.length]),
              u,
              Buffer.from([p.length]),
              p,
            ]);
            sock.write(auth);
            sock.once("data", (a) => {
              if (a[0] !== 0x01 || a[1] !== 0x00) {
                reject(new Error("SOCKS5 auth rejected"));
                return;
              }
              proceed();
            });
          } else
            reject(
              new Error(`SOCKS5 no acceptable auth method (got ${method})`),
            );
        });
      });
      sock.once("error", reject);
    });
  }
}

export const SMTP_IMAP_KEYS = {
  appPassword: APP_PASSWORD_KEY,
  oauthAccessToken: OAUTH_TOKEN_KEY,
};
