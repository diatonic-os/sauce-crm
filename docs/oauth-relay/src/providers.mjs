// Per-provider OAuth endpoint config + default scopes. Client IDs/secrets
// come from env vars (see .env.example). The relay only enumerates providers
// that have both a CLIENT_ID and CLIENT_SECRET present.

const providers = {
  google: {
    authorizeUrl: "https://accounts.google.com/o/oauth2/v2/auth",
    tokenUrl: "https://oauth2.googleapis.com/token",
    revokeUrl: "https://oauth2.googleapis.com/revoke",
    clientId: process.env.GOOGLE_CLIENT_ID || "",
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || "",
    redirectUri: process.env.GOOGLE_REDIRECT_URI || "",
    defaultScopes: [
      "openid",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/calendar.readonly",
      "https://www.googleapis.com/auth/gmail.readonly",
      "https://www.googleapis.com/auth/contacts.readonly",
      "https://www.googleapis.com/auth/drive.readonly",
    ],
    extraAuthParams: { access_type: "offline", prompt: "consent" },
  },
  microsoft: {
    authorizeUrl: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT || "common"}/oauth2/v2.0/authorize`,
    tokenUrl: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT || "common"}/oauth2/v2.0/token`,
    clientId: process.env.MICROSOFT_CLIENT_ID || "",
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET || "",
    redirectUri: process.env.MICROSOFT_REDIRECT_URI || "",
    defaultScopes: [
      "offline_access",
      "User.Read",
      "Calendars.Read",
      "Mail.Read",
      "Contacts.Read",
      "Files.Read.All",
    ],
    extraAuthParams: {},
  },
  notion: {
    authorizeUrl: "https://api.notion.com/v1/oauth/authorize",
    tokenUrl: "https://api.notion.com/v1/oauth/token",
    clientId: process.env.NOTION_CLIENT_ID || "",
    clientSecret: process.env.NOTION_CLIENT_SECRET || "",
    redirectUri: process.env.NOTION_REDIRECT_URI || "",
    defaultScopes: [],
    extraAuthParams: { owner: "user" },
  },
};

export function listEnabledProviders() {
  return Object.entries(providers)
    .filter(([, p]) => p.clientId && p.clientSecret && p.redirectUri)
    .map(([k]) => k);
}

export function getProvider(name) {
  const p = providers[name];
  if (!p) return null;
  if (!p.clientId || !p.clientSecret || !p.redirectUri) return null;
  return p;
}
