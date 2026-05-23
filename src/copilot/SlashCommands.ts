// Slash-command registry — user-editable prompt commands available as /slash
// actions and/or in the editor context menu. Models the Copilot command table.
// `{}` in a prompt is replaced with the current selection/active note text.

export interface SlashCommand {
  /** Stable, immortal id (kebab). */
  id: string;
  /** Display name (sentence case). */
  name: string;
  /** Prompt template; `{}` ⇒ selected text / active note. */
  prompt: string;
  /** Show in the editor right-click menu. */
  inMenu: boolean;
  /** Expose as a `/slash` command. */
  slashCmd: boolean;
}

/** Default command set (mirrors the common Copilot library). */
export const DEFAULT_SLASH_COMMANDS: SlashCommand[] = [
  { id: "fix-grammar", name: "Fix grammar and spelling", prompt: "Fix the grammar and spelling of the following, preserving meaning and tone:\n\n{}", inMenu: true, slashCmd: true },
  { id: "translate", name: "Translate", prompt: "Translate the following into the requested language (ask if unspecified):\n\n{}", inMenu: true, slashCmd: true },
  { id: "summarize", name: "Summarize", prompt: "Summarize the following concisely:\n\n{}", inMenu: true, slashCmd: true },
  { id: "simplify", name: "Simplify", prompt: "Rewrite the following in simpler language:\n\n{}", inMenu: true, slashCmd: true },
  { id: "eli5", name: "Explain like I am 5", prompt: "Explain the following as if to a five-year-old:\n\n{}", inMenu: true, slashCmd: true },
  { id: "emojify", name: "Emojify", prompt: "Add tasteful, relevant emoji to the following without changing the wording:\n\n{}", inMenu: true, slashCmd: true },
  { id: "make-shorter", name: "Make shorter", prompt: "Make the following more concise while keeping the key points:\n\n{}", inMenu: true, slashCmd: true },
  { id: "make-longer", name: "Make longer", prompt: "Expand the following with more detail and examples:\n\n{}", inMenu: true, slashCmd: true },
  { id: "toc", name: "Generate table of contents", prompt: "Generate a Markdown table of contents for the following:\n\n{}", inMenu: false, slashCmd: false },
  { id: "glossary", name: "Generate glossary", prompt: "Generate a glossary of key terms from the following:\n\n{}", inMenu: false, slashCmd: false },
  { id: "remove-urls", name: "Remove URLs", prompt: "Remove all URLs from the following, keeping everything else intact:\n\n{}", inMenu: false, slashCmd: false },
  { id: "rewrite-tweet", name: "Rewrite as tweet", prompt: "Rewrite the following as a single engaging tweet (<280 chars):\n\n{}", inMenu: false, slashCmd: false },
  { id: "rewrite-thread", name: "Rewrite as tweet thread", prompt: "Rewrite the following as a numbered tweet thread:\n\n{}", inMenu: false, slashCmd: false },
];

/** Deep clone the defaults (so callers can mutate without touching the const). */
export function defaultSlashCommands(): SlashCommand[] {
  return DEFAULT_SLASH_COMMANDS.map((c) => ({ ...c }));
}
