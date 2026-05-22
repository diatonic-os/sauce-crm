# Google Workspace — OAuth client setup

You'll create an **OAuth 2.0 Client ID** in Google Cloud Console, then paste the client ID into Sauce CRM's Integrations panel. PKCE is supported, so the client can be either *Public* (no secret, recommended for local plugins) or *Confidential* (with a secret).

## Step 1 — Create or pick a Google Cloud project

1. Open https://console.cloud.google.com/.
2. Top-left project picker → **New Project**.
3. Name it anything you'll recognize (e.g. `sauce-crm-personal`). Click **Create**.
4. After creation, make sure the project is selected in the picker.

## Step 2 — Enable the APIs the plugin uses

Visit each link below and click **Enable** for the project you just created.

| API | Why Sauce CRM needs it |
|---|---|
| [Google Calendar API](https://console.cloud.google.com/apis/library/calendar-json.googleapis.com) | sync events into touches |
| [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com) | parse email threads for relationship signals |
| [People API](https://console.cloud.google.com/apis/library/people.googleapis.com) | import Google Contacts |
| [Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com) | discover docs referenced in touches |

You can enable a subset — the plugin tolerates missing APIs (resources that need a disabled API just stay empty).

## Step 3 — Configure the OAuth consent screen

1. In the left sidebar: **APIs & Services → OAuth consent screen**.
2. User type:
   - **External** if this is a personal Google account (you'll be the only test user — Google requires re-verification before you can publish, but for personal use Testing mode never expires).
   - **Internal** if this is a Google Workspace account and you only want users in your workspace to authenticate.
3. App information:
   - **App name**: `Sauce CRM (personal)` or similar
   - **User support email**: your email
   - **Developer contact information**: your email
4. **Scopes** — click **Add or remove scopes**, then add the scopes the plugin needs:
   - `openid`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/calendar.readonly`
   - `https://www.googleapis.com/auth/gmail.readonly`
   - `https://www.googleapis.com/auth/contacts.readonly`
   - `https://www.googleapis.com/auth/drive.readonly`
5. **Test users** — add the email address you'll be signing in with (if External / Testing).
6. Click **Back to Dashboard**.

## Step 4 — Create the OAuth client

1. **APIs & Services → Credentials** → **Create Credentials → OAuth client ID**.
2. Application type: **Desktop app** (Google's preset for native PKCE flows; this gives you a public client with no secret).
3. Name: `Sauce CRM desktop client` (or whatever helps you identify it).
4. Click **Create**.
5. A dialog shows your **Client ID** (looks like `123456789012-abcdef...apps.googleusercontent.com`). Copy it.
   - If you picked *Web application* instead of *Desktop app*, you'll also have a **Client Secret**. You can paste either — the plugin supports both.

## Step 5 — Set the redirect URI

Sauce CRM uses an **ephemeral loopback port** (49152–65535) for the PKCE redirect, so you don't need to pre-configure a specific port. Google's Desktop OAuth client implicitly allows any `http://127.0.0.1:*` URI.

If you chose *Web application* instead of *Desktop app*, add this redirect URI to the client's allow-list (Google requires the path to be exact; the port can be a wildcard but only for Desktop type):

```
http://127.0.0.1/cb
```

The plugin will replace the port at flow time. (Note: with *Web application* type, you may need to register multiple ports — easier to use *Desktop app*.)

## Step 6 — Paste into Sauce CRM

1. In Obsidian: **Settings → Sauce CRM → Integrations → Google Workspace**.
2. Click **Configure** in the OAuth client row.
3. Paste your Client ID. Leave Client Secret blank if you picked *Desktop app*; fill it in if you picked *Web application*.
4. **Save client config**.
5. **Connect** → browser opens → consent screen → "Connected — you can close this tab."

## Step 7 — Quotas, refresh, and verification

- **Quotas** — your personal client gets a default 1M-requests-per-day quota. View at **APIs & Services → Quotas**.
- **Refresh tokens** — refresh tokens last 6 months on personal Google accounts. Sauce CRM's KeyVault stores the refresh token; the plugin auto-refreshes 60s before access-token expiry.
- **App verification** — if you stay in Testing mode with External user type, you'll see "This app isn't verified" on first consent. That's normal for a personal app. Click "Advanced → Go to app (unsafe)" — only "unsafe" because Google hasn't verified that *Sauce-CRM-Personal* (the app you just created) is safe. Your app, your call.
- **Publishing** — if you want to share this OAuth client across many users, you must submit it for Google verification. That's a multi-week process. For most users, Testing mode is fine.

## Revoking access

- **From inside Sauce CRM**: Settings → Integrations → Google Workspace → **Disconnect**. The plugin calls Google's revoke endpoint.
- **From Google**: https://myaccount.google.com/permissions → find your Sauce CRM client → **Remove access**.
- **From Cloud Console**: APIs & Services → Credentials → delete the OAuth client entirely.
