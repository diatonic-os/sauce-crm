---
group: tools
id: workspace-get-leaf
summary: Get a right-sidebar leaf for placing a CRM view (Workspace.getRightLeaf).
platform: [desktop, mobile]
obsidian_api: Workspace.getRightLeaf
api_version: "1.8.0"
inputs:
  getCrmLeaf: "(workspace: Workspace, split?: boolean) => WorkspaceLeaf | null"
outputs: "a WorkspaceLeaf or null"
side_effects: [ui]
deterministic: true
depends_on: []
---

# tools/workspace-get-leaf

Wraps `Workspace.getRightLeaf` — the cross-platform way to place a plugin view in
the right sidebar (on mobile this is the `WorkspaceMobileDrawer`). The docs have
no standalone `getLeaf` symbol, so the seam binds to `getRightLeaf`, which is in
the catalog. `components/inbox-view` and the CRM views attach here.

## Contract
- `getCrmLeaf(workspace, split=false)` returns a right-sidebar `WorkspaceLeaf`
  (or `null` if unavailable).
- `obsidian_api: Workspace.getRightLeaf` MUST exist in `apiCatalog` (catalog gate).
- Universal; mobile resolves to the drawer.
