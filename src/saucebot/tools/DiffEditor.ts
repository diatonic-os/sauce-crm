/**
 * DiffEditor — atomic vault edits via Vault.process + unified diffs (F2 / CON-SAUCEBOT S2).
 *
 * Design constraints (from SPEC):
 *  - Writes route through FilesService.updateViaContract to honour CanonGuard (G-003).
 *  - Vault.process is the atomic write path (no lost-update from cachedRead→modify).
 *  - No dynamic regex (ReDoS-safe).
 *  - No exec/shell.
 *  - All model-driven writes are risk:"high" so ApprovalGate shows the diff first.
 */

import {
  applyUnifiedDiff,
  parseUnifiedDiff,
  DiffApplyError,
  DiffParseError,
} from "./diff";
import type { FilesService } from "../../services/core/FilesService";

// ---------------------------------------------------------------------------
// Narrow host interface — injected so the class is unit-testable without
// a live Obsidian instance.
// ---------------------------------------------------------------------------

/**
 * The minimum Vault surface DiffEditor needs.
 * In production, pass `app.vault` directly — it satisfies this interface.
 * In tests, pass a `FakeVaultProcess` (see DiffEditor.test.ts).
 */
export interface VaultProcessHost {
  /**
   * Atomically reads and rewrites a file's content.
   * The `fn` callback receives the current content and must return the new
   * content.  Obsidian's Vault.process guarantees no concurrent clobber.
   * Returns the new content.
   */
  process(
    file: { path: string },
    fn: (data: string) => string,
  ): Promise<string>;

  /**
   * Resolve a vault-relative path to a TFile-like handle (or null if absent).
   */
  getAbstractFileByPath(path: string): { path: string } | null;

  /**
   * Create a new file with the given content.
   */
  create(path: string, content: string): Promise<{ path: string }>;
}

// ---------------------------------------------------------------------------
// DiffEditor
// ---------------------------------------------------------------------------

export interface ApplyDiffResult {
  ok: true;
  newContent: string;
}
export interface ApplyDiffError {
  ok: false;
  error: string;
}
export type ApplyDiffOutcome = ApplyDiffResult | ApplyDiffError;

export class DiffEditor {
  constructor(
    private readonly vaultHost: VaultProcessHost,
    private readonly files: FilesService,
  ) {}

  /**
   * Apply a unified diff string to the file at `vaultPath`.
   * Routes through FilesService.updateViaContract (CanonGuard-aware).
   * Returns the new content on success, or an error descriptor.
   *
   * All callers that expose this to the model should be risk:"high" so the
   * ApprovalGate shows the diff to the operator before this is invoked.
   */
  async applyDiff(
    vaultPath: string,
    diffText: string,
  ): Promise<ApplyDiffOutcome> {
    // Validate path early (no directory traversal).
    const safeCheck = this.validatePath(vaultPath);
    if (safeCheck) return { ok: false, error: safeCheck };

    // Parse the diff outside the process callback so parse errors surface
    // before we touch the vault.
    let parsedDiff;
    try {
      parsedDiff = parseUnifiedDiff(diffText);
    } catch (e) {
      const msg = e instanceof DiffParseError ? e.message : String(e);
      return { ok: false, error: `Diff parse error: ${msg}` };
    }

    let applyError: string | null = null;
    let newContent = "";

    // updateViaContract handles canonized vs normal files.
    // It may throw if the CanonGuard refuses the write — catch and surface.
    try {
      await this.files.updateViaContract(vaultPath, (prev) => {
        try {
          newContent = applyUnifiedDiff(prev, parsedDiff);
          return newContent;
        } catch (e) {
          const msg = e instanceof DiffApplyError ? e.message : String(e);
          applyError = `Diff apply error: ${msg}`;
          return prev; // no-op write — still writes prev, which is fine
        }
      });
    } catch (e) {
      // CanonGuard or other write refusal.
      return {
        ok: false,
        error: `Write error: ${e instanceof Error ? e.message : String(e)}`,
      };
    }

    if (applyError) return { ok: false, error: applyError };
    return { ok: true, newContent };
  }

  /**
   * Create a new note at `vaultPath` with `content`.
   * Routes through FilesService.create.
   */
  async createNote(
    vaultPath: string,
    content: string,
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    const safeCheck = this.validatePath(vaultPath);
    if (safeCheck) return { ok: false, error: safeCheck };
    try {
      await this.files.create(vaultPath, content);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  /** Returns an error string if the path is unsafe, null if OK. */
  private validatePath(path: string): string | null {
    if (!path || typeof path !== "string")
      return "Path must be a non-empty string";
    // Reject directory traversal (no dynamic regex).
    if (path.includes("..")) return "Path must not contain '..' segments";
    if (path.startsWith("/"))
      return "Path must be vault-relative (no leading /)";
    return null;
  }
}
