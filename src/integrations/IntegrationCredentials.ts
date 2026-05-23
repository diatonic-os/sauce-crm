// One-stop credentials surface for every integration we ship. Bridges:
//   - OAuthFlow (PKCE; KeyVault-backed refresh-token storage)
//   - KeyVault (raw API-key storage for non-OAuth providers)
//   - IntegrationRegistry (TokenResolver functions feed access tokens to clients)
//
// Bring-Your-Own client model: every OAuth provider expects the user to paste
// their own client_id (+ secret where required). We never bake in a shared
// Sauce-CRM OAuth app.

import type { KeyVault } from "../security/KeyVault";
import {
  OAuthFlow,
  type OAuthProviderConfig,
  type TokenSet,
} from "../security/OAuthFlow";
import { ObsidianOAuthHost } from "../security/ObsidianOAuthHost";
import type { Logger } from "../telemetry";

export type CredentialProviderId =
  | "google_workspace"
  | "microsoft_365"
  | "notion"
  | "twilio"
  | "anthropic"
  | "openai"
  | "nim";

export interface ProviderManifest {
  id: CredentialProviderId;
  label: string;
  /** OAuth providers expose a PKCE flow; key-only providers just need API tokens. */
  kind: "oauth" | "key" | "key-pair";
  oauthDefaults?: Omit<OAuthProviderConfig, "clientId" | "clientSecret"> & {
    defaultScopes: string[];
  };
  /** Labels for key-pair providers (Twilio: SID + token). */
  keyFields?: { id: string; label: string; secret: boolean }[];
}

export const PROVIDER_MANIFESTS: Record<
  CredentialProviderId,
  ProviderManifest
> = {
  google_workspace: {
    id: "google_workspace",
    label: "Google Workspace",
    kind: "oauth",
    oauthDefaults: {
      authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
      tokenUrl: "https://oauth2.googleapis.com/token",
      revokeUrl: "https://oauth2.googleapis.com/revoke",
      defaultScopes: [
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/calendar.readonly",
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/contacts.readonly",
        "https://www.googleapis.com/auth/drive.readonly",
      ],
    },
  },
  microsoft_365: {
    id: "microsoft_365",
    label: "Microsoft 365",
    kind: "oauth",
    oauthDefaults: {
      authorizeUrl:
        "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
      tokenUrl: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
      defaultScopes: [
        "offline_access",
        "User.Read",
        "Calendars.Read",
        "Mail.Read",
        "Contacts.Read",
        "Files.Read.All",
      ],
    },
  },
  notion: {
    id: "notion",
    label: "Notion",
    kind: "key",
    keyFields: [
      { id: "token", label: "Internal Integration Token", secret: true },
    ],
  },
  twilio: {
    id: "twilio",
    label: "Twilio",
    kind: "key-pair",
    keyFields: [
      { id: "accountSid", label: "Account SID", secret: false },
      { id: "authToken", label: "Auth Token", secret: true },
    ],
  },
  anthropic: {
    id: "anthropic",
    label: "Anthropic (Claude)",
    kind: "key",
    keyFields: [{ id: "apiKey", label: "API Key", secret: true }],
  },
  openai: {
    id: "openai",
    label: "OpenAI",
    kind: "key",
    keyFields: [{ id: "apiKey", label: "API Key", secret: true }],
  },
  nim: {
    id: "nim",
    label: "NVIDIA NIM",
    kind: "key",
    keyFields: [{ id: "apiKey", label: "NGC API Key", secret: true }],
  },
};

/** KeyVault key namespace. Stable across releases. */
function vaultKey(provider: CredentialProviderId, field: string): string {
  return `creds:${provider}:${field}`;
}

export class IntegrationCredentials {
  readonly oauth: OAuthFlow;
  private readonly host = new ObsidianOAuthHost();

  constructor(
    private readonly vault: KeyVault,
    private readonly logger: Logger | null = null,
  ) {
    this.oauth = new OAuthFlow(
      this.host,
      vault,
      (globalThis as { crypto: Crypto }).crypto.subtle,
      (n) => {
        const out = new Uint8Array(n);
        (globalThis as { crypto: Crypto }).crypto.getRandomValues(out);
        return out;
      },
    );
  }

  /** Returns true iff this build can actually run an OAuth flow (desktop). */
  oauthAvailable(): boolean {
    return this.host.available();
  }

  /** Register a provider's OAuth config using the user-supplied client credentials. */
  async configureOAuth(
    provider: CredentialProviderId,
    clientId: string,
    clientSecret?: string,
  ): Promise<void> {
    const m = PROVIDER_MANIFESTS[provider];
    if (!m.oauthDefaults)
      throw new Error(`${provider} is not an OAuth provider`);
    this.oauth.registerProvider(provider, {
      ...m.oauthDefaults,
      clientId,
      clientSecret,
    });
    await this.vault.put(vaultKey(provider, "client_id"), clientId);
    if (clientSecret)
      await this.vault.put(vaultKey(provider, "client_secret"), clientSecret);
    this.logger?.event("creds.oauth.configured", { provider });
  }

  /** Re-register OAuth configs from vault on plugin startup (called after KeyVault.unlock). */
  async hydrateOAuthConfigs(): Promise<void> {
    for (const m of Object.values(PROVIDER_MANIFESTS)) {
      if (!m.oauthDefaults) continue;
      try {
        const cid = await this.vault
          .get(vaultKey(m.id, "client_id"))
          .catch(() => "");
        if (!cid) continue;
        const cs = await this.vault
          .get(vaultKey(m.id, "client_secret"))
          .catch(() => "");
        this.oauth.registerProvider(m.id, {
          ...m.oauthDefaults,
          clientId: cid,
          clientSecret: cs || undefined,
        });
        this.logger?.event("creds.oauth.hydrated", { provider: m.id });
      } catch (e) {
        this.logger?.event("creds.oauth.hydrate_error", {
          provider: m.id,
          error: String(e),
        });
      }
    }
  }

  /** Persist a single key-field (Notion token, Twilio SID, etc.). */
  async putKey(
    provider: CredentialProviderId,
    field: string,
    value: string,
  ): Promise<void> {
    await this.vault.put(vaultKey(provider, field), value);
    this.logger?.event("creds.key.put", { provider, field });
  }

  /** Read a single key-field. Returns null when absent (vault returns "no secret"). */
  async getKey(
    provider: CredentialProviderId,
    field: string,
  ): Promise<string | null> {
    try {
      return await this.vault.get(vaultKey(provider, field));
    } catch {
      return null;
    }
  }

  /** Kick off an OAuth flow (must have configureOAuth'd first). */
  async connectOAuth(
    provider: CredentialProviderId,
    scopes?: string[],
  ): Promise<TokenSet> {
    const m = PROVIDER_MANIFESTS[provider];
    if (!m.oauthDefaults)
      throw new Error(`${provider} is not an OAuth provider`);
    this.logger?.event("creds.oauth.connect_start", { provider });
    const ts = await this.oauth.authorize(
      provider,
      scopes ?? m.oauthDefaults.defaultScopes,
    );
    this.logger?.event("creds.oauth.connect_ok", {
      provider,
      expiresAt: ts.expiresAt,
    });
    return ts;
  }

  async disconnectOAuth(provider: CredentialProviderId): Promise<void> {
    await this.oauth.revoke(provider);
    this.logger?.event("creds.oauth.disconnect", { provider });
  }

  /** TokenResolver for IntegrationRegistry — returns a fresh access token,
   * refreshing transparently when the cached one is within 60s of expiry. */
  accessToken(provider: CredentialProviderId): () => Promise<string> {
    return async () => {
      const cur = this.oauth.current(provider);
      if (cur && cur.expiresAt > Date.now() + 60_000) return cur.accessToken;
      const refreshed = await this.oauth.refresh(provider);
      return refreshed.accessToken;
    };
  }
}
