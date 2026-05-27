// SPEC §18.6 — Per-integration scope toggles. Throws ScopeNotGranted; never silently degrades.
export class ScopeNotGranted extends Error {
  constructor(
    public readonly integration: string,
    public readonly scope: string,
  ) {
    super(`Scope not granted: ${integration}:${scope}`);
    this.name = "ScopeNotGranted";
  }
}

export type ScopeMap = Record<string, Record<string, boolean>>;

export class ScopeRegistry {
  private scopes: ScopeMap = {};

  load(map: ScopeMap): void {
    this.scopes = JSON.parse(JSON.stringify(map));
  }
  toJSON(): ScopeMap {
    return JSON.parse(JSON.stringify(this.scopes));
  }

  set(integration: string, scope: string, allowed: boolean): void {
    if (!this.scopes[integration]) this.scopes[integration] = {};
    this.scopes[integration]![scope] = allowed; // initialized on the line above if absent
  }

  check(integration: string, scope: string): boolean {
    return !!this.scopes[integration]?.[scope];
  }

  require(integration: string, scope: string): void {
    if (!this.check(integration, scope))
      throw new ScopeNotGranted(integration, scope);
  }

  list(integration: string): Record<string, boolean> {
    return { ...(this.scopes[integration] ?? {}) };
  }
  integrations(): string[] {
    return Object.keys(this.scopes);
  }
}

export const DEFAULT_SCOPES: ScopeMap = {
  google_workspace: {
    "calendar.read": true,
    "calendar.write": false,
    "gmail.read": true,
    "gmail.modify": false,
    "gmail.send": false,
    "drive.read": true,
    "drive.write": false,
    "contacts.read": true,
  },
  microsoft_365: {
    "calendar.read": true,
    "calendar.write": false,
    "mail.read": true,
    "mail.modify": false,
    "mail.send": false,
    "files.read": true,
    "files.write": false,
    "contacts.read": true,
  },
  apple: {
    "calendar.read": true,
    "calendar.write": false,
    "contacts.read": true,
    "mail.read": true,
  },
  notion: { read: true, write: false },
  twilio: {
    "voice.inbound": true,
    "voice.outbound": false,
    "sms.inbound": true,
    "sms.outbound": false,
    "recordings.read": true,
  },
  smtp_imap: { "inbox.read": true, "inbox.send": false },
  web_search: { "web_search.read": true, "web_search.fetch": true },
};
