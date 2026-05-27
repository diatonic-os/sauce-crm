/**
 * registerVaultTools — wire all F2 vault tools onto a ToolUseAdapter.
 * (F2 / CON-SAUCEBOT S2)
 *
 * Call this from main.ts (or wherever the ToolUseAdapter is configured)
 * after the adapter and its dependencies are initialised.
 *
 * The orchestrator MUST NOT call this from SkillRuntime.bindToCopilot() —
 * vault tools are wired separately so they can be enabled/disabled
 * independently of the CRM skill set.
 */

export { DiffEditor } from "./DiffEditor";
export type {
  VaultProcessHost,
  ApplyDiffOutcome,
  ApplyDiffResult,
  ApplyDiffError,
} from "./DiffEditor";

export { makeReadNoteTool } from "./ReadNoteTool";
export type { ReadNoteHost } from "./ReadNoteTool";

export { makeSearchVaultTool } from "./SearchVaultTool";
export type { SearchVaultHost } from "./SearchVaultTool";

export { makeProposeEditTool, makeApplyEditTool } from "./EditNoteTool";
export type { EditNoteHost } from "./EditNoteTool";

export { makeCreateNoteTool } from "./CreateNoteTool";

export { makeWebResearchTool } from "./WebResearchTool";
export type { WebResearchHost } from "./WebResearchTool";

export {
  createUnifiedDiff,
  formatUnifiedDiff,
  parseUnifiedDiff,
  applyUnifiedDiff,
  applyDiffString,
  diffLines,
} from "./diff";
export type { UnifiedDiff, DiffHunk, DiffOp } from "./diff";
export { DiffParseError, DiffApplyError } from "./diff";

import type { ToolUseAdapter } from "../ToolUseAdapter";
import type { FilesService } from "../../services/core/FilesService";
import type { ReadNoteHost } from "./ReadNoteTool";
import type { SearchVaultHost } from "./SearchVaultTool";
import type { EditNoteHost } from "./EditNoteTool";
import type { WebResearchHost } from "./WebResearchTool";
import type { VaultContextProvider } from "../VaultContextProvider";
import { DiffEditor } from "./DiffEditor";
import { makeReadNoteTool } from "./ReadNoteTool";
import { makeSearchVaultTool } from "./SearchVaultTool";
import { makeProposeEditTool, makeApplyEditTool } from "./EditNoteTool";
import { makeCreateNoteTool } from "./CreateNoteTool";
import { makeWebResearchTool } from "./WebResearchTool";

export interface VaultToolDeps {
  /**
   * The Vault surface for atomic edits (pass `app.vault` in production).
   * Must satisfy VaultProcessHost (Vault.process, getAbstractFileByPath, create).
   */
  vaultHost: ConstructorParameters<typeof DiffEditor>[0];
  /** FilesService — canon-safe write routing (G-003). */
  files: FilesService;
  /** Read-note host — supplies raw note content for read_note + propose_edit. */
  readHost: ReadNoteHost;
  /** Search host — wraps semantic + fuzzy search for search_vault. */
  searchHost: SearchVaultHost;
  /**
   * Edit host — read + generateEdit + diff for propose_edit.
   * `generateEdit` typically calls the active LLM.
   */
  editHost: EditNoteHost;
  /** Web research host — wraps requestUrl for web_research. */
  webHost: WebResearchHost;
  /** VaultContextProvider — powers get_links tool. */
  linkProvider: VaultContextProvider;
}

/**
 * Register all F2 vault tools on `adapter`.
 *
 * ## How to call from main.ts
 *
 * ```ts
 * import { registerVaultTools } from "./saucebot/tools";
 * import { VaultContextProvider } from "./saucebot/VaultContextProvider";
 *
 * // In SauceGraphPlugin.onload():
 * const linkProvider = new VaultContextProvider(this.app.metadataCache);
 * linkProvider.rebuild();
 * this.app.metadataCache.on("resolved", () => linkProvider.rebuild());
 *
 * registerVaultTools(this.copilot.tools, {
 *   vaultHost: this.app.vault,
 *   files: this.services.files,          // FilesService instance
 *   readHost: {
 *     read: async (path) => {
 *       const f = this.app.vault.getAbstractFileByPath(normalizePath(path));
 *       if (!(f instanceof TFile)) return null;
 *       return await this.app.vault.cachedRead(f);
 *     },
 *   },
 *   searchHost: {
 *     search: async (query, limit) => {
 *       // delegate to SearchService.fuzzy / semantic
 *       return this.services.search.fuzzy(query, limit).map(h => ({
 *         path: h.file.path, score: h.score,
 *       }));
 *     },
 *   },
 *   editHost: {
 *     read: async (path) => { /* same as readHost.read *\/ },
 *     generateEdit: async (path, original, instructions) => {
 *       // call SauceBotRuntime for a one-shot rewrite
 *       return await this.copilot.rewrite(original, instructions);
 *     },
 *     diff: (original, updated, label) => {
 *       const d = createUnifiedDiff(original, updated, `a/${label}`, `b/${label}`);
 *       return d ? formatUnifiedDiff(d) : null;
 *     },
 *   },
 *   webHost: {
 *     fetch: async (url) => {
 *       const r = await requestUrl({ url, method: "GET", throw: false });
 *       return r.text;
 *     },
 *   },
 *   linkProvider,
 * });
 * ```
 */
export function registerVaultTools(
  adapter: ToolUseAdapter,
  deps: VaultToolDeps,
): void {
  const editor = new DiffEditor(deps.vaultHost, deps.files);

  adapter.register(makeReadNoteTool(deps.readHost));
  adapter.register(makeSearchVaultTool(deps.searchHost));
  adapter.register(makeProposeEditTool(deps.editHost));
  adapter.register(makeApplyEditTool(editor));
  adapter.register(makeCreateNoteTool(editor));
  adapter.register(makeWebResearchTool(deps.webHost));
  adapter.register(deps.linkProvider.asSkill());
}
