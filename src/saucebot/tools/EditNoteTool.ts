/**
 * EditNoteTool — propose_edit + apply_edit tools (F2 / CON-SAUCEBOT S2).
 *
 * Two-step agentic edit flow:
 *  1. propose_edit(path, instructions) → returns a unified diff (string).
 *     Risk: "medium" (generates but does NOT write yet).
 *  2. apply_edit(path, diff) → applies the diff via DiffEditor (CanonGuard-aware).
 *     Risk: "high" → ApprovalGate MUST show the diff to the operator before writing.
 *
 * The model generates an updated version of the note in its head, calls
 * propose_edit which asks the host to do the actual diffing (the host has the
 * note content), then calls apply_edit to commit.
 */

import type { SkillLike } from "../ToolUseAdapter";
import type { DiffEditor } from "./DiffEditor";

// ---------------------------------------------------------------------------
// Narrow host interface for propose_edit
// ---------------------------------------------------------------------------

export interface EditNoteHost {
  /**
   * Read the current content of a vault-relative note.
   * Returns null when the file does not exist.
   */
  read(path: string): Promise<string | null>;

  /**
   * Given the original content and natural-language instructions,
   * produce an updated content string.  This is typically a call to
   * the active LLM (injected so the tool stays decoupled from the runtime).
   * May throw; caller wraps in try/catch.
   */
  generateEdit(
    path: string,
    original: string,
    instructions: string,
  ): Promise<string>;

  /**
   * Produce a unified diff between `original` and `updated`.
   * Returns null when unchanged.
   */
  diff(original: string, updated: string, label: string): string | null;
}

// ---------------------------------------------------------------------------
// propose_edit tool
// ---------------------------------------------------------------------------

export function makeProposeEditTool(host: EditNoteHost): SkillLike {
  return {
    id: "propose_edit",
    description:
      "Propose an edit to a vault note given natural-language instructions. " +
      "Returns a unified diff showing the proposed changes without writing to disk. " +
      "Pass the diff to apply_edit to commit it (gated by operator approval).",
    risk: "medium",
    contract: {
      level: "read",
      inputs: [
        {
          name: "path",
          type: "string",
          description: "Vault-relative path of the note to edit",
          required: true,
        },
        {
          name: "instructions",
          type: "string",
          description:
            "Natural-language description of what changes to make to the note",
          required: true,
        },
      ],
    },
    async execute(
      args: Record<string, unknown>,
    ): Promise<{ diff: string } | { error: string }> {
      const path = String(args["path"] ?? "").trim();
      const instructions = String(args["instructions"] ?? "").trim();
      if (!path) return { error: "path is required" };
      if (!instructions) return { error: "instructions is required" };
      if (path.includes(".."))
        return { error: "path must not contain '..' segments" };

      const original = await host.read(path);
      if (original === null) return { error: `Note not found: ${path}` };

      let updated: string;
      try {
        updated = await host.generateEdit(path, original, instructions);
      } catch (e) {
        return {
          error: `Edit generation failed: ${e instanceof Error ? e.message : String(e)}`,
        };
      }

      const diffText = host.diff(original, updated, path);
      if (diffText === null)
        return {
          error:
            "No changes — the proposed edit is identical to the current content",
        };
      return { diff: diffText };
    },
  };
}

// ---------------------------------------------------------------------------
// apply_edit tool
// ---------------------------------------------------------------------------

export function makeApplyEditTool(editor: DiffEditor): SkillLike {
  return {
    id: "apply_edit",
    description:
      "Apply a unified diff to a vault note.  " +
      "ALWAYS requires operator approval before writing (risk: high).  " +
      "Obtain the diff first via propose_edit.",
    risk: "high",
    contract: {
      level: "write",
      inputs: [
        {
          name: "path",
          type: "string",
          description: "Vault-relative path of the note to edit",
          required: true,
        },
        {
          name: "diff",
          type: "string",
          description: "Unified diff string produced by propose_edit",
          required: true,
        },
      ],
    },
    async execute(
      args: Record<string, unknown>,
    ): Promise<{ ok: true; message: string } | { error: string }> {
      const path = String(args["path"] ?? "").trim();
      const diffText = String(args["diff"] ?? "").trim();
      if (!path) return { error: "path is required" };
      if (!diffText) return { error: "diff is required" };

      const result = await editor.applyDiff(path, diffText);
      if (!result.ok) return { error: result.error };
      return { ok: true, message: `Applied diff to ${path}` };
    },
  };
}
