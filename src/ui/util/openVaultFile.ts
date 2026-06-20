import { App, TFile } from "obsidian";

/**
 * Open a vault file by its exact path. Resolves a real TFile and opens it via
 * a leaf, rather than `workspace.openLinkText`, which can crash on a non-string
 * path (`e.toLowerCase is not a function`) or spawn a phantom tab for a stale
 * path. No-op when the path does not resolve to a file.
 *
 * This is the single home for the "resolve then open" pattern that was
 * previously copy-pasted (with divergent workarounds) across the dashboard,
 * calendar, map, folder-index and chat views.
 */
export function openVaultPath(app: App, path: string, newLeaf = false): void {
  const f = app.vault.getAbstractFileByPath(path);
  if (f instanceof TFile) void app.workspace.getLeaf(newLeaf).openFile(f);
}

/**
 * Open a file by linkpath/basename, resolved (relative to an optional source
 * path) through the metadata cache. No-op when the link does not resolve.
 */
export function openVaultLinkpath(
  app: App,
  linkpath: string,
  sourcePath = "",
  newLeaf = false,
): void {
  const f = app.metadataCache.getFirstLinkpathDest(linkpath, sourcePath);
  if (f instanceof TFile) void app.workspace.getLeaf(newLeaf).openFile(f);
}
