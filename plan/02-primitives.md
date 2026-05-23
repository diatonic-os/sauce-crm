# Primitives Plan

Status: DRAFTED
Shard: SH-A
Outputs: `packages/ui-primitives/`

## Objective

Create a framework-agnostic primitive contract and CSS layer that React and
Svelte adapters must implement name-for-name and prop-for-prop.

## Component Contract

The primitive manifest must include the full `CC-001` set:

- Button
- IconButton
- Toggle
- Switch
- Checkbox
- Radio
- RadioGroup
- Select
- MultiSelect
- Combobox
- TextInput
- NumberInput
- TextArea
- Slider
- ColorPicker
- FilePicker
- KeyBindingInput
- Card
- Section
- Divider
- Tabs
- Modal
- Drawer
- Tooltip
- Menu
- MenuItem
- Banner
- Callout
- Heading
- Paragraph
- List
- Code
- Kbd
- Avatar
- Badge
- Spinner
- EmptyState
- ErrorState

## Required Files

| File | Purpose |
|---|---|
| `packages/ui-primitives/src/component-manifest.ts` | Canonical component and prop manifest. |
| `packages/ui-primitives/src/props.ts` | Shared prop interfaces and discriminated unions. |
| `packages/ui-primitives/src/a11y.ts` | Shared ARIA and ID helpers. |
| `packages/ui-primitives/primitives.css` | Base classes using only `ui-tokens`. |
| `packages/ui-primitives/package.json` | Package metadata. |

## Shared Props

Every component that can accept them must expose:

- `variant`
- `size`
- `disabled`
- `loading`
- `value`
- `defaultValue`
- `onChange`
- `onCommit`
- `label`
- `description`
- `helperText`
- `error`
- `icon`
- `leadingIcon`
- `trailingIcon`
- `aria-*`
- `data-testid`

## Layout Primitive Rules

- `Section` owns title, optional description, body card, and optional footer.
- `SettingRow` is required even if not listed in CC-001, because settings pages
  need label-left/control-right row geometry. It may be exported as a named
  internal primitive if both adapters expose it.
- `Card` owns one border. Nested bordered children require spacing `lg`.
- `Modal` wraps Obsidian modal hosts but does not own business logic.

## Parity Rule

React and Svelte adapters must import the same manifest and fail tests if any
component or prop differs. Slot parity is represented as:

- React: `children`, `leading`, `trailing`, named render props where required.
- Svelte: default slot, `leading`, `trailing`, matching named snippets/slots.

## Migration Rule

No product file may create raw `button`, `input`, `select`, `textarea`, or
bordered card containers after SH-F begins, except adapter internals and
Obsidian-native wrappers such as `FuzzySuggestModal`.
