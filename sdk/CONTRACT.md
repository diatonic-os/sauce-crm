# Sauce CRM SDK — Master Contract

> **Status:** Phase-0 contract (human-authored). Locked sections are binding on
> all generators, ralph-loop iterations, and orc tasks. Source of truth for the
> Obsidian surface is the vendored docs repo at
> `../../../reference/obsidian-developer-docs/en/` (relative to plugin root).

## 0. Mission

Build a **`.md`-driven SDK** that wraps the Obsidian developer surface into a
self-describing, deterministic, MCP-esque registry of capabilities, so the
Sauce CRM plugin (desktop **and** iOS/Android mobile) is assembled from typed,
docs-derived building blocks rather than hand-rolled glue.

The SDK is "maximized" in coverage and "deterministic" in behavior: identical
inputs produce identical artifacts, and every wrapper traces to a specific
doc + API version.

## 1. Philosophy — mirror how Obsidian builds (LOCKED)

Obsidian's own model is the philosophy we adopt verbatim:

| Obsidian practice | SDK adoption |
|---|---|
| Typed API published as structured `.md` (`Reference/TypeScript API/*.md`) | The SDK is **generated from those `.md` files**; the docs are the contract |
| Styling via a **CSS variable system** (`Reference/CSS variables/*.md`) | `components/` consume only CSS-variable tokens; **zero hardcoded colors/sizes** |
| Quality enforced by **self-critique checklists** | Those checklists are the SDK's machine-checked acceptance gates (see `ralph/CHECKLIST.md`) |
| `Platform`-gated capabilities; one codebase, desktop + mobile | Every capability declares a `platform` contract; mobile-unsafe code is gated (see `MOBILE-FORK.md`) |
| Semantic versioning via `Manifest.md` + `Versions.md` | SDK pins `minAppVersion` and records the API version each wrapper was generated against |

**Determinism rules (LOCKED):**
1. No wrapper may use wall-clock time for logic; use vault-stored logical clocks / monotonic counters. Wall-clock is allowed only for display.
2. No nondeterministic ordering: all registries iterate in a stable, declared sort.
3. Every generated artifact carries a provenance header: source doc path + API version + generator hash.
4. Side effects go through `tools/` only; `helpers/` are pure functions.

## 2. The grouping taxonomy (LOCKED definitions)

Eight groups. Each is a directory under `sdk/groups/<group>/` with an
`_index.md` manifest and one `.md` + one `.ts` per member. The `.md` is the
contract; the `.ts` is generated/implemented to satisfy it.

| Group | Definition | Side effects? | Platform | Maps to Obsidian |
|---|---|---|---|---|
| **tools** | Atomic, single-responsibility API wrappers | Yes (the only place) | declared per tool | `Vault`, `Workspace`, `MetadataCache`, `FileManager` |
| **actions** | User-triggerable operations registered as commands | Yes (via tools) | desktop + mobile | `Command` (`addCommand`, `checkCallback`, `Command.mobileOnly`) |
| **helpers** | Pure utility functions, no I/O | **No** | universal | `normalizePath`, `parseYaml`, `arrayBufferToBase64`, … |
| **skills** | Composed, multi-step capabilities defined in `.md` | Yes (via tools/chainers) | declared | existing `src/skills/*` |
| **talents** | Named bundles of skills exposing one agent-facing capability pack | Yes (via skills) | declared | (Sauce concept; no 1:1 Obsidian analog) |
| **components** | UI building blocks (Svelte) bound to CSS-variable tokens | UI only | desktop + mobile | `ItemView`, `Modal`, `Setting`, `Component`, CSS variables |
| **connectors** | External-system integrations | Yes (network) | gated (most desktop) | existing `src/integrations/*` |
| **chainers** | Deterministic pipelines composing tools→actions with explicit edges | Yes (via tools) | declared | (Sauce concept; orchestration layer) |

**Member contract (every `.md` member file MUST declare):**
```yaml
---
group: tools | actions | helpers | skills | talents | components | connectors | chainers
id: <stable-kebab-id>            # immortal; never reused
summary: <one line>
platform: universal | desktop | mobile | [desktop, mobile]
obsidian_api: <symbol or "none"> # e.g. Vault.create
api_version: <from Reference/Versions.md>
inputs: { ... }                  # typed
outputs: { ... }                 # typed
side_effects: none | [vault.write, network, ui]
deterministic: true | false      # false requires a documented reason
depends_on: [<group/id>, ...]    # edges; acyclic
---
```

## 3. The `.md`-driven principle (LOCKED)

The docs repo is parsed, not paraphrased. `GENERATOR.md` defines the pipeline:
`Reference/TypeScript API/*.md` → typed `tools/` wrappers + signatures;
`Reference/CSS variables/*.md` → a CSS-variable **token map** consumed by
`components/`. Re-running the generator against an updated docs checkout
re-syncs the SDK. Hand edits to generated `.ts` are forbidden; change the
`.md` contract or the generator.

## 4. MCP-esque grouping (LOCKED shape)

Each group's `_index.md` is a manifest enumerating its members with the
frontmatter above, so the whole SDK is introspectable as a tool catalog
(the "MCP-esque grouping of tools/actions/helpers/skills/talents/components/
connectors/chainers"). A top-level `sdk/REGISTRY.md` aggregates all eight
indexes into one catalog. Generation of `REGISTRY.md` is deterministic.

## 5. Acceptance gates (LOCKED — see ralph/CHECKLIST.md)

A member is "done" only when: contract `.md` valid → `.ts` implements it →
`tsc` clean → unit test proves the contract → Obsidian self-critique checklist
items relevant to its `platform` pass → provenance header present.

## 6. Out of scope for Phase 0

Implementation `.ts` (Phase 1+ via ralph-loop). Phase 0 delivers contracts only.
