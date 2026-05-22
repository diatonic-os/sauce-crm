# Bring-Your-Own OAuth — provider setup

Sauce CRM does **not** ship with a shared OAuth client. Every user registers their own OAuth app in each provider's developer console and pastes the resulting client ID (and, where required, client secret) into the plugin's Credentials modal. This document walks through that process per provider.

## Why BYO instead of a shared Sauce-CRM OAuth app

- **No central liability.** A shared OAuth app makes Sauce CRM (the project) responsible for keeping every user's connection alive, going through Google's annual app verification process, handling deauthorizations, etc. BYO pushes that ownership to each user, where it belongs for a local-first plugin.
- **No shared rate limits.** Google, Microsoft, and Notion all apply per-OAuth-client rate limits. With a shared client, your usage starves your neighbor's. With BYO, each user gets their full quota.
- **No "sign-in with X" data flow.** Sauce CRM never sees your tokens — they go straight from the provider into your local KeyVault.
- **Auditable scopes.** Because *you* register the app, you choose the scopes it requests. Sauce CRM proposes a default scope set; you can remove anything you don't want.

## What you need before you start

- A browser logged in to each provider's developer console.
- About 5 minutes per provider.
- The plugin already installed and the KeyVault unlocked (Settings → Sauce CRM → Integrations triggers the unlock prompt on first use).

## Provider guides

| Provider | OAuth model | Guide |
|---|---|---|
| Google Workspace | OAuth 2.0 (PKCE; public client OK) | [google.md](google.md) |
| Microsoft 365 | OAuth 2.0 (PKCE; public client OK) | [microsoft.md](microsoft.md) |
| Notion | Internal integration token (no OAuth flow) | [notion.md](notion.md) |
| Twilio | API key pair (Account SID + Auth Token) | [twilio.md](twilio.md) |
| Anthropic, OpenAI, NVIDIA NIM | API key only | [llm-keys.md](llm-keys.md) |

## After you've configured a provider

1. Settings → Sauce CRM → Integrations → pick the provider in the left rail.
2. Click **Configure** in the credentials row → paste your `client_id` (and `client_secret` if you opted for a confidential client) → **Save client config**.
3. Click **Connect**. A browser tab opens; complete the consent screen.
4. You'll see "Connected — you can close this tab." Status row updates to show scopes + expiry.

If something doesn't work, see [troubleshooting.md](troubleshooting.md).

## Self-hosted relay (optional)

If you don't want to register OAuth apps yourself (or you want to share one OAuth app across multiple Sauce CRM users on a team), you can run the [self-hosted OAuth relay](../oauth-relay/README.md). It's a small Docker container that holds your OAuth credentials and proxies the auth flow so the plugin never sees them.
