# CON-OBS-WIZARD — FINAL

Onboarding-wizard rework + shared provider-picker fix + multi-provider KeyVault
setup + reusable success/failure helpers. No PR — pushed to `origin/main`.

- Gate (final): lint **0 errors** (6 pre-existing warnings), typecheck 0,
  **651 tests / 129 files** (+16 over the 635 baseline), sdk:check 0, build 0.
- Operator decisions: KeyVault = **offer + allow skip**; wizard scope = **full
  redesign**; helper reach = **wizard + retrofit all**.

## What the screenshots asked for → what shipped

### Image #2 — the cramped Provider/Model component (`commit 309c428`)
`ProviderPicker` (`.sg-provider-picker`) is used by **5 surfaces** (onboarding
wizard, LocalLLMPage, settings copilot/rag/localllm) but its `.sg-pp-row` /
`.sg-pp-controls` / `.sg-pp-status` classes **had no definitions** — label and
dropdown rendered unstyled with no alignment and no dropdown affordance. Now:
- aligned label↔control **grid** with tokenized spacing (`--sg-*`), focus ring,
  single-column reflow on phones;
- an explicit **dropdown chevron** on the plugin's own `<select>`s (picker +
  `.sauce-field`/`.sauce-modal`/`.sauce-input`), excluding Obsidian's native
  `.dropdown` which already paints its own arrow.
One CSS change fixes all five surfaces uniformly.

### Image #1 — the cramped wizard layout (`commit f6d0968`)
Most `.sauce-onboarding-*` classes were undefined. Added tokenized layout for
the step indicator, bullet/summary lists, the active-provider section, the
per-provider cards, and the skill list.

## Wizard redesign (`commit f6d0968`)

Was: 6 steps, single provider (3 of 5 supported), one plaintext API key into
`settings.copilot.apiKey`, no endpoint field, no connection test, `Notice()`-only
feedback.

Now: **Welcome → Initialize → Secure Keys → AI Providers → Skills → First Person
→ Review**
- **Secure Keys** — optional encrypted **KeyVault** (Argon2id + AES-256-GCM): set
  or unlock a master password; honest vault-state messaging; **skip → settings**
  fallback (per operator decision).
- **AI Providers** — configure **all four runtime providers**
  (anthropic/openai/ollama/lmstudio): endpoint (local) + API key + **Save & test**
  (live `testProviderConnection`) each with its own `InlineStatus`; active
  provider + model via the now-styled `ProviderPicker`. Keys are stored encrypted
  in the vault under `copilot:<provider>:api-key`; endpoints persist to
  `settings.features.localLLM`.
- **Review** — per-item success/warning summary (vault state, keys saved, active
  provider, skills, first person) via `.sg-pill`.

### Honest key-storage note (important)
The Copilot **runtime still reads `settings.copilot.apiKey`** — the `// P15 swaps
for KeyVault lookup` in `CopilotRuntime` is not yet wired. So the wizard stores
**every** entered key in the vault (the "use the KeyVault" feature + multi-provider)
**and mirrors the active provider's key into `settings.copilot.apiKey`** so chat
works today. This is surfaced in the UI and here rather than left as a silent gap.
**Follow-up (P15):** point `CopilotRuntime`'s key getter at the
`KeyVaultCredentialSource` so the active key no longer needs the settings mirror.

## Reusable success/failure helpers

- **`InlineStatus`** (`src/ui/components/v2/InlineStatus.ts`, `commit 2b131e2`):
  dependency-light, jsdom-testable status line with idle/pending/success/error
  states + tokenized `.sg-inline-status*` CSS.
- **`testProviderConnection`** (`src/copilot/testProviderConnection.ts`): wraps
  `ModelCatalog.list` — a **real** reachability/auth probe for local providers
  (ollama/lmstudio/nim); for static cloud catalogs it honestly reports "key
  verified on first use".
- **Retrofits** (`commit 1286b92`): Copilot settings gains a **Test connection**
  button (API key previously saved silently); `IntegrationCredentialsModal`
  key-save and OAuth save/connect now show inline pending→success/error and wrap
  vault writes in try/catch (a locked-vault `putKey` could previously fail
  silently). LocalLLMPage is the unmounted legacy page (live `localllm.ts`
  already surfaces status via the picker), so no change there.

## Tests added (+16; 635 → 651)
- `test/ui/InlineStatus.test.ts` (4)
- `test/copilot/testProviderConnection.test.ts` (4)
- (plus the 8 `MobileStyles` tests from the prior contract already in the baseline)

## Verification caveat
No live in-app screenshot diff (no headless Obsidian on host; `obsidian eval`
disabled per project memory). Validated via typecheck, the new unit tests, the
full gate, CSS brace-balance, and review against the screenshots + source. The
wizard's step orchestration and Modal/ProviderPicker wiring are integration-level
and were not unit-tested (ProviderPicker performs network catalog calls); the
extracted pure logic (InlineStatus, testProviderConnection) is covered.

## Commits
```
1286b92 feat(ui): retrofit InlineStatus into copilot settings + credentials modal
f6d0968 feat(ui/onboarding): full wizard redesign — KeyVault + multi-provider + tests
2b131e2 feat(ui): reusable InlineStatus helper + provider connection-test util
309c428 fix(ui/provider-picker): define .sg-pp-* layout + dropdown chevron
```
