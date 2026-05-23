// SDK tool — source: sdk/groups/tools/workspace-get-leaf.md | api_version: 1.8.0 | gen_hash: hand-t011
//
// Right-sidebar leaf for CRM views (cross-platform; mobile = drawer).

import { Workspace, WorkspaceLeaf } from 'obsidian';

/** Get a right-sidebar leaf for a CRM view. */
export function getCrmLeaf(workspace: Workspace, split = false): WorkspaceLeaf | null {
  return workspace.getRightLeaf(split);
}
