# Integrations

Sauce Graph ships seven first-party integrations. Each is implemented as a discrete client class registered with the `IntegrationRegistry` (`src/integrations/IntegrationRegistry.ts`) and reachable via **`Sauce: Sync All Integrations`** or the per-source commands.

All OAuth-based integrations use **PKCE** (Proof Key for Code Exchange, RFC 7636). The plugin generates a random `code_verifier` per flow, derives the `code_challenge` via SHA-256, opens the provider's consent screen in the system browser, and exchanges the returned authorization code for tokens. Tokens are stored in the KeyVault (AES-256-GCM); see [SECURITY.md](SECURITY.md).

## 1. Google

**Sub-clients:** `GCalendarClient`, `GContactsClient`, `GDriveClient`, `GMailClient` (`src/integrations/google/`).

**Scopes required:**
- `https://www.googleapis.com/auth/calendar.readonly`
- `https://www.googleapis.com/auth/contacts.readonly`
- `https://www.googleapis.com/auth/drive.metadata.readonly`
- `https://www.googleapis.com/auth/gmail.readonly`

**What gets pulled:** calendar events (mapped to candidate touches), contacts (mapped to `warm-contact` proposals in the AI Inbox), Drive file metadata (used by the research skills), Gmail message headers + bodies for thread summarization.

## 2. Microsoft

**Sub-clients:** `MSCalendarClient`, `MSContactsClient`, `MSOutlookClient` (`src/integrations/microsoft/`).

**Scopes required (MS Graph):** `Calendars.Read`, `Contacts.Read`, `Mail.Read`, `offline_access`.

**What gets pulled:** Outlook calendar events → touch proposals, Microsoft 365 contacts → person proposals, Outlook mail threads → conversation context for `summarize-thread`.

## 3. Apple (CalDAV/CardDAV)

**Sub-clients:** `CalDAVClient`, `CardDAVClient` (`src/integrations/apple/`).

**Scopes required:** none — these are open standards. The user supplies a CalDAV/CardDAV URL plus an app-specific password (iCloud requires this).

**What gets pulled:** iCloud / generic CalDAV calendar events and CardDAV vCards. Useful for users who refuse Google or Microsoft. The sync is read-only.

## 4. Notion

**Sub-client:** `NotionClient` (`src/integrations/notion/NotionClient.ts`).

**Scopes required:** Notion internal-integration token (manually issued from Notion's developer dashboard) — no OAuth flow; the user pastes the secret into Settings → Integrations.

**What gets pulled:** databases the integration is shared into. Page properties are mapped to entity frontmatter via the import mapping UI. Useful for migrating an existing Notion-based CRM.

## 5. Twilio

**Sub-client:** `TwilioClient` (`src/integrations/twilio/TwilioClient.ts`).

**Scopes required:** Account SID + Auth Token (Twilio's basic-auth model). No OAuth.

**What gets pulled:** call recordings and call metadata. Recordings are passed to the `transcribe` skill which can run locally (Whisper) or against a cloud STT provider. The resulting transcript is attached to a new `touch` entity. Invoked via **`Sauce: Capture Call (Twilio)`**.

## 6. SMTP/IMAP

**Sub-client:** `SmtpImapClient` (`src/integrations/smtpimap/SmtpImapClient.ts`).

**Scopes required:** standard IMAP credentials (host, port, username, password or app password). TLS strongly recommended; STARTTLS supported. `HelpLinks.ts` ships provider-specific setup links.

**What gets pulled:** IMAP folders mapped to threads. The `SignatureParser` extracts email signatures into person proposals (name, title, company, phone). Outbound SMTP is wired for the `draft-touch` skill to send follow-up emails.

## 7. Web search

**Module:** `src/integrations/websearch/`.

**Scopes required:** API key for the configured provider (Brave, Bing, DuckDuckGo proxy, or an OpenAI-compatible web tool). Pasted in settings.

**What gets pulled:** on-demand search results consumed by `research-person` and `research-org`. Nothing is synced on a schedule — web search is purely a tool the copilot can call.

## Triggering a sync

- **`Sauce: Sync All Integrations`** — iterates every enabled integration, calls its `sync()` method, and reports `pulled` / `errors` counts via a Notice.
- The `AutoTouchPipeline` (`src/integrations/AutoTouchPipeline.ts`) batches incoming calendar/email events into touch proposals queued in the AI Inbox; the user approves each before write.

## Storage

Tokens, refresh tokens, and provider config live in the KeyVault keyed by integration ID. The vault must be unlocked (**`Sauce: Unlock Vault`**) for any sync to succeed. Tokens are never written to vault `.md` files.
