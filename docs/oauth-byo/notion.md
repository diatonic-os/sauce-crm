# Notion — Internal Integration Token

Notion's API uses an "internal integration token" rather than a true OAuth flow. You create an integration in your Notion workspace, share specific pages/databases with it, and copy the token into Sauce CRM. No browser-redirect dance.

## Step 1 — Create the integration

1. Open https://www.notion.so/profile/integrations.
2. Click **+ New integration**.
3. **Internal integration**.
4. Name: `Sauce CRM` (or whatever you'll recognize).
5. **Associated workspace**: pick the workspace whose pages you want Sauce CRM to read/write.
6. **Capabilities**: at minimum
   - Read content
   - Read user information (without email) — needed for relationship attribution
   - (Optional) Insert content / Update content if you want Sauce CRM to write back

Click **Submit**.

## Step 2 — Copy the secret

On the integration page, the **Internal Integration Secret** starts with `secret_`. Copy it.

## Step 3 — Share pages/databases with the integration

The token only grants access to pages explicitly shared with the integration.

For each page or database you want Sauce CRM to see:

1. Open the page in Notion.
2. Top-right **••• → Connections** (sometimes labeled "Add connections").
3. Pick your `Sauce CRM` integration → **Confirm**.

## Step 4 — Paste into Sauce CRM

1. **Settings → Sauce CRM → Integrations → Notion**.
2. Click **Configure**.
3. Paste the `secret_...` token into the **Internal Integration Token** field.
4. **Save to vault**.

The token is stored AES-GCM-encrypted in the KeyVault. The Notion integration row in Settings shows "Credentials saved" once stored.

## Rotation / revocation

- **Rotate**: same integration page → **Refresh secret**. Update the value in Sauce CRM's Credentials modal afterward.
- **Revoke**: same integration page → **Delete integration**. All Sauce CRM API calls using that token start failing with 401.
