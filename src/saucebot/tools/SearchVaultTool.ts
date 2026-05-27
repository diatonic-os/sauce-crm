/**
 * SearchVaultTool — search_vault(query) vault tool (F2 / CON-SAUCEBOT S2).
 *
 * Wraps a host-injected semantic + fuzzy search implementation so the tool
 * itself does not hard-depend on any concrete service.  Risk is "low"
 * (read-only).
 */

import type { SkillLike } from "../ToolUseAdapter";

// ---------------------------------------------------------------------------
// Narrow host interface
// ---------------------------------------------------------------------------

export interface SearchVaultHost {
  /**
   * Search the vault for notes matching `query`.
   * Returns up to `limit` results sorted by descending relevance score.
   */
  search(
    query: string,
    limit: number,
  ): Promise<Array<{ path: string; score: number; snippet?: string }>>;
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

export function makeSearchVaultTool(host: SearchVaultHost): SkillLike {
  return {
    id: "search_vault",
    description:
      "Search the vault for notes matching a query using semantic + fuzzy search. " +
      "Returns a ranked list of matching note paths with relevance scores.",
    risk: "low",
    contract: {
      level: "read",
      inputs: [
        {
          name: "query",
          type: "string",
          description: "Natural-language or keyword search query",
          required: true,
        },
        {
          name: "limit",
          type: "number",
          description:
            "Maximum number of results to return (default 10, max 50)",
          required: false,
        },
      ],
    },
    async execute(
      args: Record<string, unknown>,
    ): Promise<
      | { results: Array<{ path: string; score: number; snippet?: string }> }
      | { error: string }
    > {
      const query = String(args["query"] ?? "").trim();
      if (!query) return { error: "query is required" };
      const rawLimit = args["limit"];
      const limit = Math.min(
        50,
        Math.max(1, rawLimit !== undefined ? Number(rawLimit) : 10),
      );
      const results = await host.search(query, limit);
      return { results };
    },
  };
}
