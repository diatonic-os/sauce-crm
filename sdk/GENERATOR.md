# Sauce CRM SDK — Generator Spec

> Defines the deterministic `docs → SDK` pipeline. The generator is itself a
> `tools/`-free pure build step (Node script, run at dev time, never shipped in
> `main.js`). Input: vendored docs. Output: typed wrappers + token map +
> `REGISTRY.md`. Same input ⇒ byte-identical output.

## Inputs (read-only)

| Input | Path | Purpose |
|---|---|---|
| TypeScript API | `reference/obsidian-developer-docs/en/Reference/TypeScript API/*.md` | symbol signatures → `tools/` wrappers |
| CSS variables | `reference/obsidian-developer-docs/en/Reference/CSS variables/**/*.md` | design tokens → `components/` token map |
| Manifest/Versions | `.../Reference/{Manifest,Versions}.md` | `minAppVersion`, `api_version` stamping |
| Self-critique checklists | `.../Obsidian October * self-critique checklist.md` | acceptance-gate source |
| Member contracts | `sdk/groups/**/_index.md` + member `.md` | what to generate |

## Pipeline (deterministic stages)

1. **Parse API docs** — each `Reference/TypeScript API/<Symbol>.md` yields a
   normalized JSON descriptor `{ symbol, kind, signature, params, returns,
   since }`. Parser is whitespace- and order-insensitive; output sorted by
   symbol.
2. **Parse CSS docs** — extract every `--var: value` into a token map
   `{ token, group, default, doc_path }`, sorted by token.
3. **Resolve contracts** — load all member `.md`; validate frontmatter against
   `CONTRACT.md §2`; build the dependency DAG; **fail on any cycle**.
4. **Emit tools** — for each `tools/` member whose `obsidian_api` resolves to a
   parsed symbol, generate a typed wrapper `.ts` with a provenance header:
   ```ts
   // GENERATED — source: <doc_path> | api_version: <v> | gen_hash: <sha>
   ```
5. **Emit token map** — `sdk/generated/css-tokens.ts` exporting the sorted map;
   `components/` import tokens by name (no literals).
6. **Emit REGISTRY.md** — aggregate all `_index.md` into one catalog, sorted by
   `group` then `id`.
7. **Verify** — `tsc -noEmit` on generated output; fail the build on any error.

## Provenance & re-sync

`gen_hash` = sha256 of (member contract + resolved API descriptor + generator
version). A wrapper is regenerated only if its `gen_hash` changes ⇒ stable
diffs, reviewable re-syncs. `npm run sdk:gen` runs stages 1–7; `npm run
sdk:check` runs verification only.

## Non-goals

The generator does not invent behavior. If a contract references an
`obsidian_api` symbol not present in the parsed docs, generation **fails loudly**
(no silent stub) — surfacing API drift instead of hiding it.
