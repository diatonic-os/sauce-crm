// ─────────────────────────────────────────────────────────────────────────────
//  SAUCE BRAIN / SAUCE OM TOOLSET — concrete ToolDef wiring
// ─────────────────────────────────────────────────────────────────────────────
//
//  Per SAUCEOM_HARNESS_DIRECTIVE v0.1 @brain_tools:
//    "memory recall + fact storage + vault search + file read"
//    "ToolDef objects are pure data; service interactions are INJECTED"
//    "testable without Obsidian or lancedb dependencies"

/**
 * Local interface for tool definitions.
 * Mirrors ISauceBotProvider.ToolDef structurally (shapes unify at integration).
 */
export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (input: Record<string, unknown>) => Promise<unknown>;
  dangerous?: boolean;
}

/**
 * Dependency injection interface for brain tool service functions.
 * All I/O is threaded through these injected functions — no Obsidian/lancedb imports.
 */
export interface BrainToolDeps {
  /**
   * Recalls facts from memory store by query.
   * @param query — search query string
   * @returns array of matching facts or empty array
   */
  recallMemory: (query: string) => Promise<unknown[]>;

  /**
   * Stores a fact in memory.
   * @param text — fact text to remember
   * @returns acknowledgment object (id, ts, etc.)
   */
  rememberFact: (text: string) => Promise<unknown>;

  /**
   * Searches the Obsidian vault by query.
   * @param query — search query string
   * @returns array of matching notes/paths
   */
  searchVault: (query: string) => Promise<unknown[]>;

  /**
   * Reads the full content of a note by path.
   * @param path — note path (e.g., "folder/note.md")
   * @returns note text content
   */
  readNote: (path: string) => Promise<string>;
}

/**
 * Builds the concrete SAUCE BRAIN / SAUCE OM toolset as ToolDef objects.
 *
 * Returns four tools:
 *  - sauce_brain.recall — recall facts by query (input: {query})
 *  - sauce_brain.remember — store a fact (input: {text}, dangerous:false)
 *  - sauce_om.search — search vault (input: {query})
 *  - fs.read — read note content (input: {path}, dangerous:false)
 *
 * All handlers coerce input defensively (string coercion, empty-string fallback).
 * Handlers never throw; all errors propagate through the async result.
 *
 * @param deps — service function injections (memory, fact store, vault, file read)
 * @returns array of four ToolDef objects
 */
export function buildSauceBrainTools(deps: BrainToolDeps): ToolDef[] {
  /**
   * Helper: safely extract and coerce a string input field.
   * Returns empty string if obj is null/undefined/non-object, or if field is missing, null, undefined, or non-stringifiable.
   */
  const getStringInput = (
    obj: Record<string, unknown>,
    key: string,
  ): string => {
    if (!obj || typeof obj !== "object") return "";
    const val = obj[key];
    if (val == null) return "";
    if (typeof val === "string") return val;
    if (typeof val === "boolean") return ""; // false/true are not useful strings
    if (typeof val === "number") return String(val);
    return "";
  };

  return [
    {
      name: "sauce_brain.recall",
      description:
        "Recall facts from memory store by query. Use to retrieve learned context about the user, project, or conversation history.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query to find matching facts",
          },
        },
        required: ["query"],
      },
      handler: async (input: Record<string, unknown>) => {
        const query = getStringInput(input, "query");
        return deps.recallMemory(query);
      },
    },

    {
      name: "sauce_brain.remember",
      description:
        "Store a fact in memory. Use to persist important user preferences, project context, or conversation insights.",
      inputSchema: {
        type: "object",
        properties: {
          text: {
            type: "string",
            description: "Fact or insight to remember",
          },
        },
        required: ["text"],
      },
      handler: async (input: Record<string, unknown>) => {
        const text = getStringInput(input, "text");
        return deps.rememberFact(text);
      },
      dangerous: false,
    },

    {
      name: "sauce_om.search",
      description:
        "Search the Obsidian vault for notes matching a query. Use to discover relevant project files, documentation, and context.",
      inputSchema: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Search query to find matching vault notes",
          },
        },
        required: ["query"],
      },
      handler: async (input: Record<string, unknown>) => {
        const query = getStringInput(input, "query");
        return deps.searchVault(query);
      },
    },

    {
      name: "fs.read",
      description:
        "Read the full text content of a note from the vault by path. Use to retrieve detailed content from a specific note.",
      inputSchema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Vault-relative path to the note (e.g., 'folder/note.md')",
          },
        },
        required: ["path"],
      },
      handler: async (input: Record<string, unknown>) => {
        const path = getStringInput(input, "path");
        return deps.readNote(path);
      },
      dangerous: false,
    },
  ];
}
