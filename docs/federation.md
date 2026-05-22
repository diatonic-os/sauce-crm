# Federation (ParentVault / SubVault)

Sauce Graph supports multi-vault federation per SPEC §16. A **ParentVault** is a regular Obsidian vault that contains a `PARENT-VAULT.md` registry file and one or more registered **SubVaults**. Federation lets you keep separate vaults per concern (e.g. founder warm network, customer CRM, family contacts) while computing rolled-up dashboards, edge admissibility, and validation across them.

## LSP universe-superclass model

Every entity has `subtype_of:` referencing a parent type in an open type hierarchy rooted at `Entity`. The LSP rule is: **a SubVault may declare new subtypes that the ParentVault has never seen, and the ParentVault treats them as opaque extensions of their nearest known ancestor.**

Concretely:

- ParentVault knows `Entity`, `Person`, `Org`.
- SubVault A declares `subtype_of: Person.Founder`.
- SubVault B declares `subtype_of: Person.Customer`.
- The ParentVault rollup treats both as `Person` for cross-vault queries, while each SubVault retains its specific type for local validation and dashboards.

This means schemas can evolve at the leaf without coordinating with the root — the same property the Language Server Protocol uses for graceful capability negotiation.

## The five federated operations

The `FederationValidator` (`src/federation/FederationValidator.ts`) and the parent-side surfaces support five operations across the parent/sub boundary:

1. **entities** — list and read entities from any SubVault, scoped by type. The parent dashboard (`open-parent-dashboard`) sums counts and overdue queues across registered SubVaults.
2. **adjacency** — query typed-edge adjacency across vault boundaries. Cross-vault edges are first-class: a person in SubVault A can `knows` a person in SubVault B if `federation.cross_vault_edges` is `allowed`.
3. **enums** — resolve enum values per `federation.enum_resolution`:
   - `parent-wins` — SubVault values not in the parent's enum are violations.
   - `union` — both parent and sub values are valid everywhere.
   - `subvault-wins` — SubVault may override parent enums locally.
4. **addenda** — addenda are rolled up to the parent per `federation.addendum_rollup` (`latest`, `all`, or `off`). Useful for surfacing corrections discovered in one vault to readers of the parent.
5. **validate** — `validate-federation` walks every SubVault and runs the federation gate. With `validation_gate: strict`, a single SubVault failure blocks rollups until corrected.

## Registering a SubVault

1. In the ParentVault, run **`Sauce: Initialize Parent Vault`** — creates `PARENT-VAULT.md` (the registry root).
2. In each SubVault, ensure `Sauce: Initialize Vault` has been run.
3. Back in the ParentVault, run **`Sauce: Register SubVault`** — opens a modal where you supply:
   - `vault_id` — stable string identifier
   - `path` — absolute or vault-relative path to the SubVault root
   - Optional: scope filter (which types/folders to roll up)
4. The registry entry is appended to `PARENT-VAULT.md`'s frontmatter. Unregister via **`Sauce: Unregister SubVault`**.

## Cross-vault path queries

If `federation.cross_vault_path_queries` is `allowed`, a `sauce-dql` PATH block in the ParentVault can resolve paths whose intermediate hops live in different SubVaults. Example:

````
```sauce-dql
PATH
  FROM [[Ada Lovelace]]
  TO [[Margaret Hamilton]]
  VIA knows,worked_with
  ACROSS subvaults
  MAX_HOPS 4
```
````

The query walks the union adjacency, respects per-SubVault scope filters, and renders the resulting paths inline.

## Compatibility across vaults

When `federation.cross_vault_compatibility` is `allowed`, the Compatibility Matrix view (`open-compat`) computes `ρ_adm` across the union of all SubVault entities. Useful for warm-intro routing between independently-curated networks.

## Validation gates

`federation.validation_gate` controls what happens when a SubVault fails the gate:

- `strict` — block rollup operations until corrected.
- `warn` — surface the violations in the parent dashboard but allow rollup.
- `off` — skip federation validation entirely.

The recommended default is `strict` for production graphs and `warn` while migrating an existing single-vault setup into a federated layout.

## See also

- `src/federation/RegistryService.ts` — SubVault registry persistence
- `src/federation/FederationValidator.ts` — gate implementation
- `src/federation/ParentVaultBootstrapper.ts` — scaffold creation
- SPEC §16 — full normative spec for federation semantics
