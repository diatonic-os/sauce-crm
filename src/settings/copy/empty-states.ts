import type { CapabilityDescriptor } from "../../v2/Registry";

export interface EmptyStateFixture {
  sectionId: string;
  phase: CapabilityDescriptor["phase"];
  title: string;
  body: string;          // sentence 1 + sentence 2
  actionLabel?: string;  // verb+object per ES-03
}

export const EMPTY_STATE_FIXTURES: EmptyStateFixture[] = [
  { sectionId: "copilot.provider", phase: "P9",  title: "Copilot",                body: "Choose your AI assistant. Free local models (Ollama / LM Studio) or cloud (Anthropic / OpenAI)." },
  { sectionId: "copilot.skills",   phase: "P10", title: "Skills",                 body: "Skills are AI helpers like Research a person or Summarize this thread. They run only when you ask." },
  { sectionId: "integrations.google",     phase: "P11", title: "Google Workspace", body: "Connect your Google account to auto-log meetings and emails as touches.",          actionLabel: "Connect Google" },
  { sectionId: "integrations.microsoft",  phase: "P11", title: "Microsoft 365",    body: "Connect your Microsoft 365 account to auto-log meetings and emails as touches.",   actionLabel: "Connect Microsoft" },
  { sectionId: "integrations.apple",      phase: "P12", title: "Apple iCloud",     body: "Connect your iCloud to sync contacts and calendars (uses an app-specific password).", actionLabel: "Add app password" },
  { sectionId: "integrations.notion",     phase: "P12", title: "Notion",           body: "Mirror Notion databases into Obsidian as people or orgs.",                            actionLabel: "Connect Notion" },
  { sectionId: "integrations.twilio",     phase: "P12", title: "Twilio",           body: "Make and record calls; transcripts auto-fill new touches.",                           actionLabel: "Connect Twilio" },
  { sectionId: "integrations.email",      phase: "P12", title: "Email (IMAP/SMTP)", body: "Watch one or more email accounts; new threads auto-draft touches.",                  actionLabel: "Add account" },
  { sectionId: "integrations.websearch",  phase: "P12", title: "Web Search",       body: "Let Skills do web research with your chosen search provider (or your self-hosted SearXNG).", actionLabel: "Choose provider" },
  { sectionId: "geocoding",              phase: "P13", title: "Map & Geocoding",  body: "Pin your contacts on a map; find who is near you.",                                   actionLabel: "Choose provider" },
  { sectionId: "sync",                   phase: "P14", title: "Background Sync",  body: "Schedule background updates from your connected accounts." },
  { sectionId: "backend",                phase: "P8",  title: "Fast Database",    body: "Optional SQLite database makes search and stats up to 50× faster on large vaults.",   actionLabel: "Install SQLite" },
  { sectionId: "security",               phase: "P8",  title: "Security",         body: "Lock your API keys behind a master password; review every external call in the audit log.", actionLabel: "Set master password" },
  { sectionId: "import_export",          phase: "P14", title: "Import / Export",  body: "Bring in CSV, vCard, iCalendar, Notion exports; back up the whole graph." },
];

export function fixtureFor(sectionId: string): EmptyStateFixture | undefined {
  return EMPTY_STATE_FIXTURES.find((f) => f.sectionId === sectionId);
}
