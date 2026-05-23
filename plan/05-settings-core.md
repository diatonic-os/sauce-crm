# Settings Core Plan

Status: DRAFTED
Shard: SH-D
Depends on: SH-A
Outputs: `packages/settings-core/`

## Objective

Create a typed settings registry, persistence adapter, validation layer, and
change-event bus. This becomes the only allowed path for settings controls.

## Current State

Settings currently mutate `plugin.settings` directly and call
`plugin.saveSettings()` from render code. Some controls are real, some are
Notice-only placeholders, and there is no central key registry.

## Required Files

| File | Purpose |
|---|---|
| `packages/settings-core/src/registry.ts` | Typed key registry. |
| `packages/settings-core/src/schema.ts` | Block/control schema types. |
| `packages/settings-core/src/store.ts` | Reactive store contract. |
| `packages/settings-core/src/events.ts` | `settings.changed` event bus. |
| `packages/settings-core/src/persistence.ts` | Persistence adapter interface. |
| `packages/settings-core/src/defaults.ts` | Default resolver. |
| `packages/settings-core/src/validation.ts` | Validators and parse errors. |
| `packages/settings-core/package.json` | Package metadata. |

## Registry Shape

```ts
export interface SettingsKeySpec<T> {
  key: string;
  type: SettingsControlType;
  default: T;
  scope: "plugin" | "vault" | "session" | "secret";
  validate: (value: unknown) => { ok: true; value: T } | { ok: false; message: string };
  onChange?: (ctx: SettingsChangeContext<T>) => Promise<void> | void;
}
```

## Persistence Rules

- Default adapter reads/writes plugin data through `loadData` and `saveData`.
- Secret keys route to secure store, never Markdown or `data.json`.
- Every write emits `settings.changed:{key, prev, next, source}`.
- Store semantics must be identical for React hook and Svelte store.

## First Keys To Register

| Key | Type | Scope | Default |
|---|---|---|---|
| `ui.activeSettingsPage` | text | plugin | `home` |
| `ui.density` | select | plugin | `comfortable` |
| `ui.reducedMotion` | toggle | plugin | `false` |
| `ui.showAdvanced` | toggle | plugin | `false` |
| `copilot.provider` | select | plugin | existing default |
| `copilot.model` | text | plugin | existing default |
| `copilot.temperature` | slider | plugin | existing default |
| `vault.paths.people` | text | plugin | existing default |
| `vault.paths.orgs` | text | plugin | existing default |
| `vault.paths.touches` | text | plugin | existing default |
| `validation.strictness` | select | plugin | existing default |

## Dead Handler Rule

A control handler is valid only if it reaches one of:

- settings-core persistence write
- secure-store write
- domain service action
- command execution with real command implementation

Notice-only handlers are invalid unless the settings block is explicitly
`type: callout` or documentation-only Markdown.
