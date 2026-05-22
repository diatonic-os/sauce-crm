# OAuth troubleshooting

## "Vault locked" message every time you open the Credentials modal

The KeyVault auto-locks after 30 minutes of idle. Unlock once via the Credentials modal's unlock prompt; subsequent operations in the same session work without re-unlocking. To change the auto-lock interval, edit `setAutoLockMinutes` in your plugin onload code (UI exposure planned).

## Browser opens but the redirect page never loads

The plugin binds an ephemeral port (49152–65535) for the redirect listener. Some scenarios that break this:

- **Firewall blocking loopback** — extremely rare; check OS firewall logs.
- **Antivirus injecting into Node** — disable for the Obsidian binary, retry.
- **Another app holding the port** — the plugin re-randomizes per flow attempt, so just hit **Connect** again.

The listener auto-times-out after 5 minutes if no callback arrives.

## "state mismatch (possible CSRF)" error

The OAuth flow sends a random `state` parameter and verifies it on callback. If you see this error, somebody returned to the callback URL with a different `state` value. Causes:

- The browser cached a previous OAuth callback and replayed it. Clear the browser tab and retry.
- A network middlebox or browser extension altered the URL. Disable extensions in the browser handling the OAuth flow.
- Genuine CSRF attempt — extremely unlikely on a loopback URL but the check still fires.

## "authorization denied" / no `code` in callback

The user clicked Cancel on the consent screen, or the provider refused. Common provider-specific causes:

- **Google**: app is in Testing mode and the signing-in account isn't in the Test Users list. Add the account in the OAuth consent screen settings.
- **Microsoft**: app permissions weren't granted. Have an admin grant consent at https://entra.microsoft.com → App registrations → API permissions → Grant admin consent.
- **Notion**: not an OAuth provider — this error shouldn't arise. If it does, the Notion API token is wrong; re-copy it from the integration page.

## Refresh token expired

OAuth refresh tokens expire eventually (Google: 6 months on personal accounts; Microsoft: 90 days idle / 365 absolute). When refresh fails, the plugin shows the integration as Disconnected. Open the credentials modal and click **Reconnect** to start a fresh PKCE flow.

## "OAuth requires desktop Obsidian" error

The plugin's OAuth flow uses Node's `http` module and Electron's `shell.openExternal`. Neither is available on mobile Obsidian, and the plugin's `manifest.json` already declares `isDesktopOnly: true`. If you see this error on desktop, your install is somehow running in a sandbox that strips these APIs — typically because Obsidian was launched from a flatpak or snap with stricter container settings. Install Obsidian from the official AppImage / dmg / msi instead.

## Tokens stored but Connection row says "Disconnected"

The plugin tracks the in-memory `TokenSet` separately from the on-disk refresh token. If you restart Obsidian, the in-memory access token is gone until the first refresh fires (which happens on the next API call or after KeyVault unlock). Just trigger any integration call (e.g. open the Map view, which uses Google Calendar) and the plugin will silently refresh + reconnect.

If the Disconnected status persists after a deliberate refresh attempt, the refresh token is invalid — reconnect.
