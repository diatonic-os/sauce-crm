// SPEC §27.3 — Settings help links. Per-provider URL the user can click to open
// the app-password / OAuth setup flow. Rendered as a button in SettingsPage.
// All URLs are first-party provider domains.

export interface ProviderHelpEntry {
  id: string;
  label: string;
  domain: string;
  appPasswordUrl: string | null;
  oauthSetupUrl: string | null;
  /** Instructional copy shown next to the link. Markdown allowed in the renderer. */
  steps: string[];
  /** Detect if a given email domain belongs to this provider. */
  matchEmail?: (email: string) => boolean;
  /** Default IMAP host:port for this provider. */
  imap?: { host: string; port: number; tls: 'implicit' };
  /** Default SMTP host:port for this provider. */
  smtp?: { host: string; port: number; tls: 'implicit' };
}

export const PROVIDER_HELP: ProviderHelpEntry[] = [
  {
    id: 'google_workspace',
    label: 'Google Workspace / Gmail',
    domain: 'google.com',
    appPasswordUrl: 'https://myaccount.google.com/apppasswords',
    oauthSetupUrl: 'https://console.cloud.google.com/apis/credentials',
    steps: [
      'Enable 2-Step Verification at https://myaccount.google.com/security if not already on.',
      'Open the App Passwords link below in your browser.',
      'Select app "Mail" and device "Other (Sauce Graph)" — name it whatever you like.',
      'Copy the 16-character password (4 groups of 4 letters) and paste it into Sauce Graph.',
      'The password is shown once — store it in Sauce Graph immediately. Sauce Graph encrypts it in the KeyVault.',
    ],
    matchEmail: (e) => /@gmail\.com$|@googlemail\.com$/i.test(e) || /@saucetech\.io$/i.test(e),
    imap: { host: 'imap.gmail.com', port: 993, tls: 'implicit' },
    smtp: { host: 'smtp.gmail.com', port: 465, tls: 'implicit' },
  },
  {
    id: 'microsoft_365',
    label: 'Microsoft 365 / Outlook',
    domain: 'microsoft.com',
    appPasswordUrl: 'https://account.microsoft.com/security',
    oauthSetupUrl: 'https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
    steps: [
      'Enable two-step verification at https://account.microsoft.com/security.',
      'Under "Advanced security options" → "App passwords" → "Create a new app password".',
      'Name it "Sauce Graph" and copy the generated password.',
      'Paste into Sauce Graph. The password is encrypted in the KeyVault.',
    ],
    matchEmail: (e) => /@outlook\.com$|@hotmail\.com$|@live\.com$/i.test(e),
    imap: { host: 'outlook.office365.com', port: 993, tls: 'implicit' },
    smtp: { host: 'smtp.office365.com', port: 587, tls: 'implicit' },
  },
  {
    id: 'apple_icloud',
    label: 'Apple iCloud',
    domain: 'apple.com',
    appPasswordUrl: 'https://appleid.apple.com/account/manage',
    oauthSetupUrl: null,
    steps: [
      'Sign in at https://appleid.apple.com/account/manage with your Apple ID.',
      'Under "Sign-In and Security" → "App-Specific Passwords" → "+".',
      'Label it "Sauce Graph" and copy the generated password.',
      'Paste into Sauce Graph. The password is encrypted in the KeyVault.',
    ],
    matchEmail: (e) => /@icloud\.com$|@me\.com$|@mac\.com$/i.test(e),
    imap: { host: 'imap.mail.me.com', port: 993, tls: 'implicit' },
    smtp: { host: 'smtp.mail.me.com', port: 587, tls: 'implicit' },
  },
  {
    id: 'fastmail',
    label: 'Fastmail',
    domain: 'fastmail.com',
    appPasswordUrl: 'https://www.fastmail.com/settings/security/devicekeys',
    oauthSetupUrl: null,
    steps: [
      'Open https://www.fastmail.com/settings/security/devicekeys.',
      '"New app password" — name it "Sauce Graph", select access to "Mail (IMAP/POP/SMTP)".',
      'Copy the generated password.',
      'Paste into Sauce Graph. The password is encrypted in the KeyVault.',
    ],
    matchEmail: (e) => /@fastmail\.com$|@fastmail\.fm$|@messagingengine\.com$/i.test(e),
    imap: { host: 'imap.fastmail.com', port: 993, tls: 'implicit' },
    smtp: { host: 'smtp.fastmail.com', port: 465, tls: 'implicit' },
  },
  {
    id: 'protonmail',
    label: 'Proton Mail (Bridge required)',
    domain: 'proton.me',
    appPasswordUrl: 'https://proton.me/mail/bridge',
    oauthSetupUrl: null,
    steps: [
      'Install Proton Mail Bridge from https://proton.me/mail/bridge.',
      'Sign in to Bridge with your Proton account. Bridge gives you per-account local credentials.',
      'In Sauce Graph, use host 127.0.0.1, port 1143 (or whatever Bridge reports), and the Bridge-issued password.',
      'The password is encrypted in the KeyVault.',
    ],
    matchEmail: (e) => /@proton\.me$|@protonmail\.com$|@pm\.me$/i.test(e),
    imap: { host: '127.0.0.1', port: 1143, tls: 'implicit' },
    smtp: { host: '127.0.0.1', port: 1025, tls: 'implicit' },
  },
];

export function helpForEmail(email: string): ProviderHelpEntry | null {
  return PROVIDER_HELP.find((p) => p.matchEmail?.(email)) ?? null;
}

export function helpById(id: string): ProviderHelpEntry | null {
  return PROVIDER_HELP.find((p) => p.id === id) ?? null;
}
