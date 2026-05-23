# Sauce CRM — Public Service API (`svcV1`)

> CON-OBS-INTEG-001 · SH-G (T-G-03) · DEC-007 / DEC-012
> Downstream Obsidian plugins inherit Sauce CRM as a service layer through a
> single, semver-stable facade.

## Accessing the API

Sauce CRM mounts its public API on its own plugin instance:

```ts
const sauce = app.plugins.plugins["sauce-crm"]?.svcV1;
if (!sauce) {
  // Sauce CRM not installed/enabled.
  return;
}
```

Always **negotiate the version** before using it:

```ts
const neg = sauce.negotiateVersion("^0.3.0");
if (!neg.ok) {
  console.warn(neg.reason); // e.g. svcV1 0.3.0 does not satisfy "^0.4.0"
  return;
}
```

## Surface

`svcV1` is **frozen** and version-locked at **`0.3.0`** (`svcV1.version`).
Every member is a *read* or *contract-write* surface — **no member returns a raw
Obsidian `App` / `Vault` / plugin handle** (G-010).

| Member | Kind | Purpose |
|--------|------|---------|
| `entities` | read | `get(id)`, `byType(type)` → graph nodes |
| `touches` | read | `forEntity(id)` → touch nodes for an entity |
| `pipelines` | read | `list()` → pipeline nodes |
| `graph` | read | `node`/`neighbors`/`traverse`/`query`/`subgraph` (index-backed BFS) |
| `canon` | contract-write | `isCanonized`/`mutateViaContract`/`getCanonizedPaths`/`lock`/`unlock` |
| `events` | pub/sub | `on`/`off`/`once`/`emit`/`subscribe`/`correlate` |
| `tasks` | read/command | typed wrapper over obsidian-tasks-plugin `apiV1` |
| `files` | contract-write | canon-aware file ops (CW-files) |
| `search` | read | search/backlinks/outlinks/orphans/tags (CW-search) |
| `content` | read | outline/preview/wordcount/canvas; privacy-gated web fetch (CW-content) |
| `meta` | read/contract-write | properties/bookmarks/daily/commands/workspaces (CW-meta) |
| `registerEntity` | mutate | register a downstream entity type |
| `registerTouchSource` | mutate | register a downstream touch source |
| `registerPipeline` | mutate | register a downstream pipeline |
| `registerView` | mutate | register a downstream view |
| `negotiateVersion` | query | check svcV1 compatibility |

### Guarantees

- **Canonized files are never written directly.** `files`/`meta` route writes for
  canonized paths through `canon.mutateViaContract`, which appends a hash-chained
  ledger entry and emits an `ev-<ulid>` event (G-003 / R-007 / G-004).
- **No raw handles.** Facades return plain data or typed wrappers (G-010 / R-003).

## Example: a downstream plugin

```ts
import { Plugin } from "obsidian";

export default class DealFlowPlugin extends Plugin {
  async onload() {
    const sauce = this.app.plugins.plugins["sauce-crm"]?.svcV1;
    if (!sauce || !sauce.negotiateVersion("^0.3.0").ok) return;

    // Register a downstream entity + pipeline.
    sauce.registerEntity({ type: "deal", prefix: "deal", label: "Deal" });
    sauce.registerPipeline({ name: "Deal Flow", stages: ["lead", "qualified", "won"] });

    // React to entity mutations.
    sauce.events.on("entity.update", (e) => this.refreshBoard(e));

    // Read the graph.
    const alice = sauce.entities.get("person-1");
    const reachable = sauce.graph.traverse("person-1", { maxDepth: 2 });
  }

  private refreshBoard(_e: unknown) {/* … */}
}
```

## Versioning policy (DEC-012)

- `svcV1` is **frozen at `0.3.0`** (the manifest `0.3.0` bump). Additive changes
  (new members, new optional params) ship as minor/patch bumps and remain
  backward compatible.
- **Breaking changes require `svcV2`**, shipped *concurrently* with `svcV1` for
  **at least two minor versions** before `svcV1` is removed. Downstream plugins
  detect the surface they need via `negotiateVersion` and/or by feature-testing
  `app.plugins.plugins["sauce-crm"].svcV2`.
- `negotiateVersion(range)` supports exact (`0.3.0`), wildcard (`*`),
  `>=x.y.z`, and `^x.y.z` (with 0.x caret pinning the minor, per npm semantics).

## Stability

Every public symbol added to `svcV1` is documented here in the same PR (R-004).
The frozen object means downstream code cannot accidentally monkey-patch the API.
