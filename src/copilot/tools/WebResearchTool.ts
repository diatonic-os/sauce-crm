/**
 * WebResearchTool — web_research(url|query) tool (F2 / CON-SAUCEBOT S2).
 *
 * Wraps an injected `WebResearchHost` so the tool never calls exec/shell and
 * does not hard-depend on `requestUrl` from Obsidian.  In production the host
 * delegates to `requestUrl`; in tests a fake is injected.
 *
 * Risk is "medium" — sends a network request but does not write to disk.
 */

import type { SkillLike } from "../ToolUseAdapter";

// ---------------------------------------------------------------------------
// Narrow host interface
// ---------------------------------------------------------------------------

export interface WebResearchHost {
  /**
   * Fetch text content from `url`.
   * Returns the response body as a string, or throws on network error.
   * Implementations MUST use Obsidian's `requestUrl` (not exec/shell).
   */
  fetch(url: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// Tool
// ---------------------------------------------------------------------------

const URL_PREFIX_HTTP = "http://";
const URL_PREFIX_HTTPS = "https://";

function looksLikeUrl(s: string): boolean {
  return s.startsWith(URL_PREFIX_HTTP) || s.startsWith(URL_PREFIX_HTTPS);
}

export function makeWebResearchTool(host: WebResearchHost): SkillLike {
  return {
    id: "web_research",
    description:
      "Fetch and return the text content of a URL, or perform a web search for a query. " +
      "Provide a full URL (https://...) to fetch a specific page, or a plain query string " +
      "to search the web. Requires operator approval (risk: medium).",
    risk: "medium",
    contract: {
      level: "network",
      inputs: [
        {
          name: "url_or_query",
          type: "string",
          description:
            "A URL to fetch (must start with https://) or a plain search query string",
          required: true,
        },
      ],
    },
    async execute(
      args: Record<string, unknown>,
    ): Promise<{ content: string } | { error: string }> {
      const raw = String(args["url_or_query"] ?? "").trim();
      if (!raw) return { error: "url_or_query is required" };

      // Determine URL to fetch.  Plain queries are forwarded to DuckDuckGo HTML.
      const url = looksLikeUrl(raw)
        ? raw
        : `https://html.duckduckgo.com/html/?q=${encodeURIComponent(raw)}`;

      try {
        const content = await host.fetch(url);
        // Cap returned content to avoid blowing the context window.
        const truncated = content.slice(0, 8000);
        return { content: truncated };
      } catch (e) {
        return {
          error: `Network error: ${e instanceof Error ? e.message : String(e)}`,
        };
      }
    },
  };
}
