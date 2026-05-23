// SPEC §18.3 — PKCE flow on a loopback ephemeral port (49152–65535). One-shot HTTP listener.
import type { KeyVault } from "./KeyVault";

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scopes: string[];
  raw: Record<string, unknown>;
}

export interface OAuthProviderConfig {
  authorizeUrl: string;
  tokenUrl: string;
  revokeUrl?: string;
  clientId: string;
  clientSecret?: string;
  defaultScopes: string[];
  audience?: string;
}

export interface OAuthHost {
  openBrowser(url: string): Promise<void>;
  listenOnce(port: number, path: string): Promise<URL>;
  fetchJson<T>(
    url: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<T>;
}

export type ProviderId = "google" | "microsoft" | "notion" | "apple" | string;

function b64url(buf: Uint8Array): string {
  let s = "";
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export class OAuthFlow {
  private inMemoryTokens = new Map<ProviderId, TokenSet>();
  private providers = new Map<ProviderId, OAuthProviderConfig>();

  constructor(
    private readonly host: OAuthHost,
    private readonly vault: KeyVault,
    private readonly subtle: SubtleCrypto,
    private readonly random: (n: number) => Uint8Array,
  ) {}

  registerProvider(id: ProviderId, cfg: OAuthProviderConfig): void {
    this.providers.set(id, cfg);
  }

  async authorize(provider: ProviderId, scopes: string[]): Promise<TokenSet> {
    const cfg = this.providers.get(provider);
    if (!cfg) throw new Error(`unregistered provider: ${provider}`);
    // Fall back to provider defaults when callers pass [] — many of our
    // Integration shims call authorize(id, []) and expect "the usual scopes".
    const effective = scopes.length > 0 ? scopes : cfg.defaultScopes;
    const port = 49152 + Math.floor(Math.random() * (65535 - 49152));
    const redirectUri = `http://127.0.0.1:${port}/cb`;
    const state = b64url(this.random(16));
    const verifier = b64url(this.random(32));
    const challenge = b64url(
      new Uint8Array(
        await this.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
      ),
    );

    const params = new URLSearchParams({
      response_type: "code",
      client_id: cfg.clientId,
      redirect_uri: redirectUri,
      scope: effective.join(" "),
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    if (cfg.audience) params.set("audience", cfg.audience);

    await this.host.openBrowser(`${cfg.authorizeUrl}?${params.toString()}`);
    const cbUrl = await this.host.listenOnce(port, "/cb");
    if (cbUrl.searchParams.get("state") !== state)
      throw new Error("state mismatch (possible CSRF)");
    const code = cbUrl.searchParams.get("code");
    if (!code) throw new Error("authorization denied");

    const tokenBody = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      client_id: cfg.clientId,
    });
    if (cfg.clientSecret) tokenBody.set("client_secret", cfg.clientSecret);

    type TokenResp = {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    const resp = await this.host.fetchJson<TokenResp>(cfg.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: tokenBody.toString(),
    });

    const ts: TokenSet = {
      accessToken: resp.access_token,
      refreshToken: resp.refresh_token ?? null,
      expiresAt: Date.now() + 1000 * (resp.expires_in ?? 3600),
      scopes: (resp.scope ?? effective.join(" ")).split(/\s+/).filter(Boolean),
      raw: resp as unknown as Record<string, unknown>,
    };
    if (ts.refreshToken)
      await this.vault.put(`oauth:${provider}:refresh`, ts.refreshToken);
    this.inMemoryTokens.set(provider, ts);
    return ts;
  }

  async refresh(provider: ProviderId): Promise<TokenSet> {
    const cfg = this.providers.get(provider);
    if (!cfg) throw new Error(`unregistered provider: ${provider}`);
    const refresh = await this.vault.get(`oauth:${provider}:refresh`);
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refresh,
      client_id: cfg.clientId,
    });
    if (cfg.clientSecret) body.set("client_secret", cfg.clientSecret);
    type R = {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
      scope?: string;
    };
    const r = await this.host.fetchJson<R>(cfg.tokenUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: body.toString(),
    });
    const ts: TokenSet = {
      accessToken: r.access_token,
      refreshToken: r.refresh_token ?? refresh,
      expiresAt: Date.now() + 1000 * (r.expires_in ?? 3600),
      scopes: (r.scope ?? "").split(/\s+/).filter(Boolean),
      raw: r as unknown as Record<string, unknown>,
    };
    if (r.refresh_token)
      await this.vault.put(`oauth:${provider}:refresh`, r.refresh_token);
    this.inMemoryTokens.set(provider, ts);
    return ts;
  }

  async revoke(provider: ProviderId): Promise<void> {
    const cfg = this.providers.get(provider);
    if (!cfg?.revokeUrl) return;
    const ts = this.inMemoryTokens.get(provider);
    if (!ts) return;
    await this.host
      .fetchJson(cfg.revokeUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          token: ts.refreshToken ?? ts.accessToken,
        }).toString(),
      })
      .catch(() => {});
    this.inMemoryTokens.delete(provider);
  }

  scopesGranted(provider: ProviderId): string[] {
    return this.inMemoryTokens.get(provider)?.scopes ?? [];
  }
  current(provider: ProviderId): TokenSet | null {
    return this.inMemoryTokens.get(provider) ?? null;
  }
}
