// SPEC §40 — V2 command catalogue. Host wires each `id` to its actual handler.
export interface V2CommandDescriptor {
  id: string;
  name: string;
  defaultHotkey?: string;
  category:
    | "capture"
    | "view"
    | "skill"
    | "vault"
    | "security"
    | "sync"
    | "import-export"
    | "inference";
}

export const V2_COMMANDS: V2CommandDescriptor[] = [
  {
    id: "sauce:quick-capture",
    name: "Quick Capture (CDEL)",
    defaultHotkey: "Mod+Shift+Q",
    category: "capture",
  },
  {
    id: "sauce:open-copilot",
    name: "Open SauceBot",
    defaultHotkey: "Mod+J",
    category: "view",
  },
  {
    id: "sauce:open-map",
    name: "Open Map",
    defaultHotkey: "Mod+M",
    category: "view",
  },
  { id: "sauce:open-ai-inbox", name: "Open AI Inbox", category: "view" },
  { id: "sauce:open-sync-status", name: "Open Sync Status", category: "view" },
  { id: "sauce:open-audit-log", name: "Open Audit Log", category: "view" },
  {
    id: "sauce:run-skill",
    name: "Run Skill…",
    defaultHotkey: "Mod+K",
    category: "skill",
  },
  {
    id: "sauce:summarize-current",
    name: "Summarize Current Note",
    category: "skill",
  },
  {
    id: "sauce:research-current",
    name: "Research Current Note",
    category: "skill",
  },
  {
    id: "sauce:geocode-current",
    name: "Geocode Current Note",
    category: "skill",
  },
  {
    id: "sauce:capture-call",
    name: "Capture Call (Twilio)",
    category: "skill",
  },
  {
    id: "sauce:transcribe-file",
    name: "Transcribe Audio File…",
    category: "skill",
  },
  {
    id: "sauce:lock-vault",
    name: "Lock Vault",
    defaultHotkey: "Mod+L",
    category: "security",
  },
  { id: "sauce:unlock-vault", name: "Unlock Vault", category: "security" },
  { id: "sauce:rotate-keys", name: "Rotate Keys…", category: "security" },
  {
    id: "sauce:verify-audit-chain",
    name: "Verify Audit Chain",
    category: "security",
  },
  { id: "sauce:sync-now", name: "Sync Now (all eligible)", category: "sync" },
  { id: "sauce:import", name: "Import…", category: "import-export" },
  { id: "sauce:export", name: "Export…", category: "import-export" },
  {
    id: "sauce:backup-now",
    name: "Backup Now (Encrypted)",
    category: "import-export",
  },
  {
    id: "sauce:reseed-backend",
    name: "Wipe and Reseed Backend",
    category: "vault",
  },
  {
    id: "sauce:run-inference-pass",
    name: "Run Inference Pass",
    category: "inference",
  },
  { id: "sauce:propose-merges", name: "Propose Merges", category: "inference" },
  { id: "sauce:weekly-briefing", name: "Weekly Briefing", category: "skill" },
  { id: "sauce:open-skill-runs", name: "Open Skill Run Log", category: "view" },
  {
    id: "sauce:reload-cdel-idioms",
    name: "Reload CDEL Idioms",
    category: "capture",
  },
];

export type V2CommandHandler = (id: string) => Promise<void> | void;

export function registerV2Commands(opts: {
  addCommand: (cmd: {
    id: string;
    name: string;
    hotkeys?: { modifiers: string[]; key: string }[];
    callback: () => void | Promise<void>;
  }) => void;
  handler: V2CommandHandler;
}): void {
  for (const c of V2_COMMANDS) {
    // No default hotkeys — Obsidian plugin policy: users assign their own.
    opts.addCommand({
      id: c.id,
      name: c.name,
      callback: () => opts.handler(c.id),
    });
  }
}

function parseHotkey(s: string): { modifiers: string[]; key: string } {
  const parts = s.split("+").map((p) => p.trim());
  const key = parts.pop()!;
  return { modifiers: parts, key };
}
