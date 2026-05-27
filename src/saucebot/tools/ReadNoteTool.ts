/**
 * ReadNoteTool — read_note(path) vault tool (F2 / CON-SAUCEBOT S2).
 *
 * Lets the model read the raw content of a vault note by its vault-relative
 * path.  Risk is "low" (read-only).
 */

import type { SkillLike } from "../ToolUseAdapter";

// ---------------------------------------------------------------------------
// Narrow host interface
// ---------------------------------------------------------------------------

export interface ReadNoteHost {
  /** Read the raw content of a vault-relative path. Returns null when absent. */
  read(path: string): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export function makeReadNoteTool(host: ReadNoteHost): SkillLike {
  return {
    id: "read_note",
    description:
      "Read the full content of a vault note by its vault-relative path " +
      "(e.g. 'contacts/Alice.md').  Returns the raw markdown text.",
    risk: "low",
    contract: {
      level: "read",
      inputs: [
        {
          name: "path",
          type: "string",
          description:
            "Vault-relative path of the note to read (e.g. 'contacts/Alice.md')",
          required: true,
        },
      ],
    },
    async execute(
      args: Record<string, unknown>,
    ): Promise<{ content: string } | { error: string }> {
      const path = String(args["path"] ?? "").trim();
      if (!path) return { error: "path is required" };
      if (path.includes(".."))
        return { error: "path must not contain '..' segments" };
      const content = await host.read(path);
      if (content === null) return { error: `Note not found: ${path}` };
      return { content };
    },
  };
}
