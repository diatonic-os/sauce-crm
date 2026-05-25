/**
 * CreateNoteTool — create_note(path, content) vault tool (F2 / CON-SAUCEBOT S2).
 *
 * Creates a new vault note at the given path.  Risk is "high" (writes to disk)
 * so the ApprovalGate will show the operation to the operator before writing.
 */

import type { SkillLike } from "../ToolUseAdapter";
import type { DiffEditor } from "./DiffEditor";

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export function makeCreateNoteTool(editor: DiffEditor): SkillLike {
  return {
    id: "create_note",
    description:
      "Create a new vault note at the specified path with the given content. " +
      "Requires operator approval before writing (risk: high). " +
      "Fails if the note already exists.",
    risk: "high",
    contract: {
      level: "write",
      inputs: [
        {
          name: "path",
          type: "string",
          description:
            "Vault-relative path for the new note (e.g. 'contacts/NewPerson.md')",
          required: true,
        },
        {
          name: "content",
          type: "string",
          description: "Markdown content for the new note",
          required: true,
        },
      ],
    },
    async execute(
      args: Record<string, unknown>,
    ): Promise<{ ok: true; path: string } | { error: string }> {
      const path = String(args["path"] ?? "").trim();
      const content = String(args["content"] ?? "");
      if (!path) return { error: "path is required" };
      if (path.includes(".."))
        return { error: "path must not contain '..' segments" };

      const result = await editor.createNote(path, content);
      if (!result.ok) return { error: result.error };
      return { ok: true, path };
    },
  };
}
