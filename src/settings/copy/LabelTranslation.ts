export interface LabelTranslation {
  technical: string; // canonical technical term
  plainEnglish: string; // user-facing label
  descriptionHint: string; // setDesc text
}

export const LABEL_TRANSLATIONS: LabelTranslation[] = [
  {
    technical: "p_adm",
    plainEnglish: "Match strictness",
    descriptionHint:
      "How similar two contacts must be before we suggest a link (technical name: p_adm)",
  },
  {
    technical: "Cms",
    plainEnglish: "Shared characteristics",
    descriptionHint:
      "Fields both contacts have in common — used for compatibility scoring",
  },
  {
    technical: "Contract strictness",
    plainEnglish: "Save-time checks",
    descriptionHint:
      "How strict to be when something looks wrong — block / warn / allow",
  },
  {
    technical: "Federation policy",
    plainEnglish: "Sub-vault rules",
    descriptionHint: "How strictly child vaults must follow parent vault rules",
  },
  {
    technical: "LSP validation",
    plainEnglish: "Type checking",
    descriptionHint:
      "Make sure each note follows the rules for its kind (person / org / touch)",
  },
  {
    technical: "Semiring",
    plainEnglish: "Path math mode",
    descriptionHint:
      "(advanced) Which algorithm ranks intro paths and overdue contacts",
  },
  {
    technical: "Inference confidence",
    plainEnglish: "Suggestion confidence",
    descriptionHint:
      "How sure I should be before showing a suggestion — higher = fewer but better suggestions",
  },
  {
    technical: "Autonomy level",
    plainEnglish: "How much I can do alone",
    descriptionHint: "Propose / Confirm each / Confirm batches / Run on my own",
  },
  {
    technical: "Frame condition",
    plainEnglish: "What this skill can change",
    descriptionHint: "Files and folders the skill is allowed to edit",
  },
  {
    technical: "Pre/post-condition",
    plainEnglish: "Before-and-after checks",
    descriptionHint: "Rules the skill must pass before saving anything",
  },
  {
    technical: "ρ_adm",
    plainEnglish: "Admissible density",
    descriptionHint: "(advanced — see Match strictness above)",
  },
  {
    technical: "HMAC chain",
    plainEnglish: "Tamper-proof log",
    descriptionHint:
      "Each entry signs the previous one — broken signature means something was edited",
  },
  {
    technical: "Argon2id",
    plainEnglish: "Strong password hash",
    descriptionHint:
      "Industry-standard slow hash; takes about 1 second to unlock",
  },
  {
    technical: "PKCE",
    plainEnglish: "Secure login flow",
    descriptionHint:
      "Standard OAuth pattern that never exposes long-lived tokens",
  },
];

export function plainLabel(technical: string): string | null {
  return (
    LABEL_TRANSLATIONS.find((t) => t.technical === technical)?.plainEnglish ??
    null
  );
}

export function descriptionFor(technical: string): string | null {
  return (
    LABEL_TRANSLATIONS.find((t) => t.technical === technical)
      ?.descriptionHint ?? null
  );
}

/** Words that are OK to use as label text without translation (safe everyday English). */
export const LABEL_ALLOWLIST = new Set([
  "General",
  "Vault",
  "Validation",
  "SauceBot",
  "Copilot",
  "Skills",
  "Integrations",
  "Data",
  "Advanced",
  "Provider",
  "Model",
  "Temperature",
  "API key",
  "Base URL",
  "Cadence",
  "Tags",
  "Backup",
  "Export",
  "Import",
  "Sync",
  "Map",
  "Audit log",
  "Skill run log",
  "Master password",
  "Auto-lock",
  "Telemetry",
  "Diagnostics",
  "About",
  "Google",
  "Microsoft",
  "Apple",
  "Notion",
  "Twilio",
  "Email",
  "Web Search",
  "Person",
  "Org",
  "Touch",
  "Addendum",
]);
