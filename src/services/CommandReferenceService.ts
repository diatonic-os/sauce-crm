// CommandReferenceService — auto-installs and keeps fresh a vault-root command
// reference + keyboard-shortcut matrix ("SauceOM Commands.md"), built from the
// LIVE Obsidian command registry so it never drifts from registerCommands().
//
// Idempotency: the generated matrix is wrapped in a versioned managed-block
// sentinel; on every load we replace ONLY the bytes between the sentinels, so
// any user prose outside the block is preserved across regenerations. The
// "Suggested hotkey" column is advisory MARKDOWN ONLY — we never write a default
// hotkey binding (Obsidian plugin policy: plugins must not ship default hotkeys).
import { App, TFile, normalizePath } from "obsidian";

export const COMMAND_DOC_PATH = "SauceOM Commands.md";
const BLOCK_VERSION = 1;
const BEGIN = `<!-- sauce:commands:begin v${BLOCK_VERSION} -->`;
const END = "<!-- sauce:commands:end -->";
// Match any prior block version so an upgrade replaces it cleanly.
const BLOCK_RE = /<!-- sauce:commands:begin v\d+ -->[\s\S]*?<!-- sauce:commands:end -->/;

export interface CommandLike {
  id: string;
  name: string;
}

/** Advisory (NOT applied) suggested hotkeys for the highest-traffic actions.
 *  Keyed by the un-prefixed command id. Everything else gets a blank cell the
 *  user can fill in via Settings → Hotkeys. */
const SUGGESTED_HOTKEYS: Readonly<Record<string, string>> = {
  "quick-capture": "Ctrl/Cmd+Shift+C",
  "open-dashboard": "Ctrl/Cmd+Shift+D",
  "open-copilot": "Ctrl/Cmd+Shift+B",
  "log-touch": "Ctrl/Cmd+Shift+T",
  "new-person": "Ctrl/Cmd+Shift+P",
};

const CATEGORY_ORDER = [
  "Capture",
  "Open / Navigate",
  "AI & Brain",
  "Providers",
  "Data & Sync",
  "Security",
  "Vault & Diagnostics",
  "Other",
] as const;

/** Heuristic category from id+name keywords — keeps the doc self-maintaining
 *  (no hand-curated list to drift from the registry). */
export function categorizeCommand(id: string, name = ""): string {
  const s = `${id} ${name}`.toLowerCase();
  if (/(^|[:-])(new-|log-touch|capture|promote|add-task|bump|edit-current|intro|relation)/.test(s))
    return "Capture";
  if (/(open-|onboarding|relationship-card)/.test(s)) return "Open / Navigate";
  if (/(brain|enrich|harvest|summarize|research|geocode|inference|merge|briefing|harness)/.test(s))
    return "AI & Brain";
  if (/(gateway|claude-code|daemon|integrations|connect)/.test(s)) return "Providers";
  if (/(backup|sync|import|export|lance|index|cache|reconcile|reseed)/.test(s))
    return "Data & Sync";
  if (/(lock|unlock|rotate|audit-chain|verify)/.test(s)) return "Security";
  if (/(initialize|subvault|federation|validate|plugin-auto|boot-timing|path-query|fuzzy)/.test(s))
    return "Vault & Diagnostics";
  return "Other";
}

/** Strip the plugin-id prefix ("sauce-crm:foo" → "foo") and any display-name
 *  brand prefix ("SauceOM: Foo" → "Foo") for clean table cells. */
function shortId(id: string, pluginId: string): string {
  return id.startsWith(`${pluginId}:`) ? id.slice(pluginId.length + 1) : id;
}
function cleanName(name: string): string {
  return name.replace(/^(SauceOM|Sauce CRM|SauceBot)\s*[:—-]\s*/i, "").trim();
}
function esc(s: string): string {
  return s.replace(/\|/g, "\\|");
}

/** Build the managed block (between the sentinels) for the given commands. */
export function buildCommandBlock(
  commands: CommandLike[],
  pluginId: string,
  generatedAtIso: string,
): string {
  const byCat = new Map<string, { name: string; sid: string }[]>();
  for (const c of commands) {
    const sid = shortId(c.id, pluginId);
    const cat = categorizeCommand(sid, c.name);
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat)!.push({ name: cleanName(c.name) || sid, sid });
  }
  const lines: string[] = [BEGIN, "", `_Auto-generated ${generatedAtIso}. ${commands.length} commands. Edits inside this block are overwritten; write notes outside it._`, ""];
  const cats = [...byCat.keys()].sort(
    (a, b) => CATEGORY_ORDER.indexOf(a as never) - CATEGORY_ORDER.indexOf(b as never),
  );
  for (const cat of cats) {
    lines.push(`### ${cat}`, "");
    lines.push("| Command | ID | Suggested hotkey |", "| --- | --- | --- |");
    const rows = byCat.get(cat)!.sort((a, b) => a.name.localeCompare(b.name));
    for (const r of rows) {
      lines.push(`| ${esc(r.name)} | \`${pluginId}:${r.sid}\` | ${SUGGESTED_HOTKEYS[r.sid] ?? ""} |`);
    }
    lines.push("");
  }
  lines.push(END);
  return lines.join("\n");
}

/** Replace an existing managed block in `doc`, or append one if absent. Prose
 *  outside the sentinels is preserved verbatim. */
export function upsertCommandBlock(doc: string, block: string): string {
  if (BLOCK_RE.test(doc)) return doc.replace(BLOCK_RE, block);
  return `${doc.trimEnd()}\n\n${block}\n`;
}

function freshDoc(block: string): string {
  return [
    "---",
    "type: orientation",
    "generated_by: sauce-graph/CommandReferenceService",
    "---",
    "",
    "# SauceOM — Commands & Keyboard Shortcuts",
    "",
    "Every SauceOM command, grouped by purpose. To bind a key: open",
    "**Settings → Hotkeys**, search the command **ID** below, and assign your own",
    "shortcut. The plugin ships **no** default hotkeys; the *Suggested hotkey*",
    "column is advice only.",
    "",
    block,
    "",
  ].join("\n");
}

export class CommandReferenceService {
  constructor(
    private readonly app: App,
    private readonly pluginId: string,
  ) {}

  /** Read the live command registry, filtered to this plugin's commands. */
  private listOwnCommands(): CommandLike[] {
    // app.commands.listCommands is a stable, widely-used semi-public API; the
    // public typings omit it, hence the narrow cast.
    const reg = (
      this.app as unknown as {
        commands?: { listCommands?: () => CommandLike[] };
      }
    ).commands;
    const all = reg?.listCommands?.() ?? [];
    return all
      .filter((c) => c.id.startsWith(`${this.pluginId}:`))
      .map((c) => ({ id: c.id, name: c.name }));
  }

  /** Create the doc if absent, else refresh only the managed block. Idempotent. */
  async ensure(generatedAtIso: string): Promise<void> {
    const commands = this.listOwnCommands();
    if (commands.length === 0) return; // registry not populated yet — skip
    const block = buildCommandBlock(commands, this.pluginId, generatedAtIso);
    const path = normalizePath(COMMAND_DOC_PATH);
    const existing = this.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) {
      const cur = await this.app.vault.read(existing);
      const next = upsertCommandBlock(cur, block);
      if (next !== cur) await this.app.vault.modify(existing, next);
    } else if (!existing) {
      await this.app.vault.create(path, freshDoc(block));
    }
  }
}
