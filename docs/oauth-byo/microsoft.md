# Microsoft 365 — OAuth client setup

You'll register an app in **Microsoft Entra ID** (formerly Azure Active Directory). PKCE is supported, so the app can be a public client with no secret.

## Step 1 — Open the Entra portal

1. Go to https://entra.microsoft.com/ and sign in with the account that owns the Microsoft 365 tenant you want to connect.
2. Sidebar: **Applications → App registrations** → **+ New registration**.

## Step 2 — Register the app

| Field | Value |
|---|---|
| Name | `Sauce CRM (personal)` |
| Supported account types | **Accounts in any organizational directory and personal Microsoft accounts** if you want both work and personal accounts to be able to sign in; otherwise pick the narrower option that matches your tenant |
| Redirect URI | Platform: **Public client/native (mobile & desktop)** · URI: `http://localhost` (literal — port is replaced at flow time) |

Click **Register**.

## Step 3 — Note the application (client) ID

On the app's Overview page, copy the **Application (client) ID**. This is what you paste into Sauce CRM's "Client ID" field.

Sauce CRM uses PKCE, so a client secret is **not required**. You can skip the "Certificates & secrets" tab entirely.

## Step 4 — Add the redirect URI properly

Microsoft Entra requires you to explicitly mark the redirect URI as a *Mobile/Desktop* public client. To verify:

1. Sidebar: **Authentication**.
2. Under **Mobile and desktop applications**, you should see `http://localhost` listed. If you don't, click **+ Add URI** and add it.
3. Under **Advanced settings**, set **Allow public client flows** = **Yes**.
4. Click **Save**.

> Microsoft accepts `http://localhost` (not `127.0.0.1`) for desktop public clients. The plugin's `ObsidianOAuthHost` binds on `127.0.0.1:<port>` but the Microsoft OAuth server treats `localhost` and `127.0.0.1` as equivalent for desktop platform redirects.

## Step 5 — Configure API permissions

1. Sidebar: **API permissions** → **+ Add a permission** → **Microsoft Graph** → **Delegated permissions**.
2. Add these scopes:
   - `offline_access` (required so refresh tokens are issued)
   - `User.Read`
   - `Calendars.Read`
   - `Mail.Read`
   - `Contacts.Read`
   - `Files.Read.All`
3. Click **Add permissions**.
4. (Optional) Click **Grant admin consent for ...** if you're an admin and want to skip per-user consent prompts.

## Step 6 — Paste into Sauce CRM

1. In Obsidian: **Settings → Sauce CRM → Integrations → Microsoft 365**.
2. Click **Configure**.
3. Paste the Application (client) ID. Leave Client Secret blank.
4. **Save client config**.
5. **Connect** → Microsoft consent screen → close tab when done.

## Step 7 — Multi-tenant note

If you picked "Accounts in any organizational directory and personal Microsoft accounts", the OAuth authorize URL uses the `/common/` tenant. Sauce CRM's manifest pre-fills this. If your app is single-tenant, edit the manifest entry to point at your specific tenant ID — open `plugin/src/integrations/IntegrationCredentials.ts`, find `PROVIDER_MANIFESTS.microsoft_365`, and replace `/common/` with `/<tenant-id>/` in `authorizeUrl` and `tokenUrl`.

A planned enhancement is to expose this as a settings field rather than a code edit.

## Refresh + revocation

- **Refresh tokens** live up to 90 days inactive, 365 days otherwise (per Microsoft's defaults).
- **Revoke** from Sauce CRM: Settings → Integrations → Microsoft 365 → **Disconnect** (Sauce CRM forgets the tokens; Microsoft doesn't currently support a documented revoke endpoint for delegated tokens — to fully revoke, also remove the app from https://myapps.microsoft.com/).
