# Contracts

The contract system is how Sauce Graph keeps a vault internally consistent. Every entity carries a contract level and a set of `constrains:` propositions. Before a write is committed, the `ContractValidator` evaluates every proposition against the entity's frontmatter. The result is one of: `passed`, `warn`, or `block` (depending on `Settings → Strictness`).

## Levels

The `contract:` field selects how aggressive validation is:

| Level | What it checks |
|---|---|
| `nosubtype` | Skips subtype hierarchy checks. Useful for legacy notes mid-migration. |
| `subtype` | Only validates that `subtype_of:` resolves to a known parent type. |
| `simple` | Default for people and orgs. Evaluates `constrains:` plus declared enums. |
| `core` | `simple` + immutability checks. Default for touches and addenda. |
| `extended` | `core` + cross-file edge symmetry. The validator follows `knows`/`worked_with` wikilinks and asserts the reverse edge exists. |
| `full` | `extended` + federation gates (parent enum compliance, addendum scope, edge reciprocity across vault boundaries). |

## Required frontmatter fields

Every Sauce entity declares:

- `type:` — discriminator (`warm-contact`, `org`, `subsidiary`, `touch`, `addendum`)
- `contract:` — one of the levels above
- `subtype_of:` — LSP universe-superclass reference (defaults to `Entity`)
- `mutable:` — list of field names the validator will permit subsequent edits to
- `constrains:` — list of strings in `rule_name: predicate` form. Older single-key object entries are still read for backward compatibility, but new writes use strings so Obsidian Properties can render them as a normal list.
- `requires:` *(optional)* — propositions that must hold *before* a save
- `ensures:` *(optional)* — propositions that must hold *after* a save
- `signals:` *(optional)* — non-blocking emitters that surface in the AI Inbox

## How validation runs

1. Obsidian's `metadataCache.changed` event fires.
2. The plugin loads the file's frontmatter.
3. For every entry in `constrains:`, the predicate string is parsed into an AST (`src/contract/Predicate.ts`) and evaluated by `evalExpr()` in `src/contract/PropositionEvaluator.ts`.
4. The evaluator resolves identifier references against the entity's own frontmatter (`closeness`, `roles`, etc.) and against an `enum` namespace populated from settings.
5. If any predicate returns falsy and `strictness === "block"`, the save is rejected; under `"warn"` a `Notice` fires; under `"log"` the violation is recorded to the console only.

## Predicate grammar

The grammar is intentionally small to keep parsing safe:

- Literals: numbers, double-quoted strings, `true`, `false`, `null`
- Identifiers: bare names resolve from frontmatter (`closeness`, `roles`)
- Member access: `enum.cadence`
- Function calls: `today()`, `len(arr)`, `count(arr)`, `date(s)`, `upper(s)`, `lower(s)`, `has(arr, x)`, `isnull(x)`, `not_null(x)`, `closure(...)`, `file(...)` (last two wired by the validator with vault context)
- Unary: `!x`, `-x`
- Binary: `&&`, `||`, `==`, `!=`, `<`, `<=`, `>`, `>=`, `+`, `-`, `*`, `/`
- Membership: `x in arr`, `x in obj` (key check), `x in str` (substring)
- Pattern: `s =~ pat` — **not a real regex.** It is a tiny glob with one metasequence: `.+` (one-or-more anything). All other characters are literal. Backslash-escapes a literal character (`\.` matches a dot). Patterns longer than 200 chars are rejected. This is sufficient for the documented uses (e.g. `company =~ /\[\[.+\]\]/`) and has **zero ReDoS surface** — no dynamic `RegExp` is ever constructed from frontmatter.

See `src/contract/PropositionEvaluator.ts` for the complete implementation.

## Example contracts

These are pulled verbatim from `src/services/TemplateService.ts`. They are what `New Person`, `New Org`, and `Log Touch` write into the new file's frontmatter.

### Person (`warm-contact`)

```yaml
type: warm-contact
contract: simple
subtype_of: Entity
primary_type: advisor
roles: [advisor, connector]
closeness: 3
cadence: quarterly
last_touch: null
company: "[[Analytical Engine Co.]]"
mutable:
  - last_touch
  - closeness
  - cadence
  - roles
  - knows
  - worked_with
  - intro_candidates
  - company
  - title
  - email
  - phone
  - linkedin
  - location
constrains:
  - "closeness_range: closeness >= 1 && closeness <= 5"
  - "cadence_in_enum: cadence in enum.cadence"
  - "primary_in_roles: primary_type in roles"
tags: [warm-network]
```

### Org

```yaml
type: org
contract: simple
subtype_of: Entity
primary_type: org
industry: "Mechanical Computation"
status: active
mutable:
  - industry
  - location
  - website
  - status
  - parent
constrains:
  - "status_in_enum: status in enum.status_org"
tags: [org]
```

### Touch

```yaml
type: touch
contract: core
subtype_of: Entity
contact: "[[Ada Lovelace]]"
date: 2026-05-21
channel: in-person
playbook_used: ff-2
outcome_tags: [advice-received, intro-offered]
attendees:
  - "[[Ada Lovelace]]"
mutable:
  - outcome_tags
  - referral_to
  - attendees
  - source
constrains:
  - "contact_in_attendees: contact in attendees"
  - "channel_in_enum: channel in enum.channel"
```

### Addendum

```yaml
type: addendum
contract: core
subtype_of: Entity
addends: "[[Alan Turing]]"
date: 2026-05-21
kind: correction
mutable: []
constrains:
  - "immutable_after_save: true"
tags: [addendum]
```

Addenda use the `core` contract and an empty `mutable:` list, which the validator treats as a hard immutability seal. Edits after first save are rejected at strictness `block`.

## Authoring new predicates

Any rule you can express in the grammar above is acceptable. A few patterns:

- Required wikilink shape: `company =~ /\[\[.+\]\]/`
- Conditional cadence: `!(closeness >= 4) || cadence == "monthly"`
- Required edge: `len(knows) > 0`
- Date freshness: `date(last_touch) >= "2026-01-01"`

If your rule needs cross-file information (e.g. "all `knows` targets must exist"), use the `closure()` or `file()` built-ins — the validator wires these to a vault-aware resolver.
