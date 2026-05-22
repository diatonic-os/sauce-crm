# Twilio — Account SID + Auth Token

Twilio uses HTTP Basic auth with an Account SID (username) and Auth Token (password). Both are visible on the Twilio Console homepage.

## Step 1 — Sign in to Twilio

https://console.twilio.com/ — log in with the account that owns the phone number you want to use.

## Step 2 — Copy the credentials

On the Console dashboard:

- **Account SID** — visible at the top, starts with `AC`.
- **Auth Token** — also visible at the top; click "Show" to reveal it.

> If you want per-feature scoped credentials instead of the full Auth Token, create an [API Key](https://console.twilio.com/us1/account/keys-credentials/api-keys) instead. The plugin currently uses the master Auth Token; API-key support is on the roadmap.

## Step 3 — Paste into Sauce CRM

1. **Settings → Sauce CRM → Integrations → Twilio**.
2. Click **Configure**.
3. Paste:
   - Account SID (starts with `AC`)
   - Auth Token
4. **Save to vault**.

Both values land in the AES-GCM-encrypted KeyVault.

## Rotation

When you rotate the Twilio Auth Token (Console → Account → API keys & tokens → Auth Token → "Request Secondary Token", then promote), re-paste the new token in Sauce CRM's Credentials modal and **Save**.
