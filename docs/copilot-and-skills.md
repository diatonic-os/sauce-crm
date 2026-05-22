# Copilot & Skills

Sauce Graph's intelligence layer is split into two cooperating subsystems:

- **Copilot** — a chat surface backed by an `ICopilotProvider`. Implementations: `LMStudioProvider`, `LMStudioSdkProvider`, `OllamaProvider`, `OpenAIProvider`, `AnthropicProvider` (`src/copilot/`). The default is LM Studio; cloud providers are escalation.
- **Skills** — discrete, single-purpose tools the copilot (or the user directly via **`Sauce: Run Skill…`**) can invoke. Each skill is a class implementing the `Skill` interface (`src/skills/Skill.ts`), registered in `SkillRegistry`, and run through `SkillRuntime` (`src/skills/SkillRuntime.ts`).

## Copilot architecture

The copilot consists of:

- **`CopilotRuntime`** — owns the provider, conversation store, and the `ToolUseAdapter` that exposes registered skills as tool-use functions.
- **`RagAssembler`** — builds retrieval prompts from `SearchService` results before each turn.
- **`PromptLibrary`** — versioned system prompts.
- **`ConversationStore`** — per-conversation state, persisted in the plugin's `data.json`.
- **`CredentialSource` / `LocalProviderCredentials`** — credentials resolved through the KeyVault.

Autonomy is per-skill, ranged over `propose | confirm-each | confirm-bulk | autonomous`. The runtime applies a **mutation-threshold downgrade**: any skill that would mutate ≥ 5 entities is forced to `confirm-bulk` regardless of its configured level.

See `src/skills/SkillRuntime.ts` for the gate logic and `src/copilot/ToolUseAdapter.ts` for how skills are exposed to the model.

## The 16 shipped skills

Every skill ID below is the string passed to `SkillRuntime.run(id, opts)` and the value the V2 commands surface (e.g. `sauce:summarize-current` → `summarize-thread`).

### Research (web-search-bound)

| ID | Description | Status |
|---|---|---|
| `research-person` | Search the web + scrape public sources for a person, propose enrichments to the active warm-contact. | Functional (requires web-search integration) |
| `research-org` | Same as above for an org entity. | Functional (requires web-search integration) |

### Drafting

| ID | Description | Status |
|---|---|---|
| `draft-touch` | Compose a follow-up email or message for the active contact. Can send via SMTP if integration configured. | Functional |
| `schedule-touch` | Propose a calendar event for the next touch on the active contact's cadence. | Pending-integration (requires Google or Microsoft Calendar) |

### Summarization

| ID | Description | Status |
|---|---|---|
| `summarize-thread` | Summarize the conversation thread referenced by the active note. Surfaced as `Sauce: Summarize Current Note`. | Functional |
| `summarize-week` | Weekly briefing across the vault — recent touches, overdue contacts, intro opportunities. Surfaced as `Sauce: Weekly Briefing`. | Functional |

### Inference (graph-aware)

| ID | Description | Status |
|---|---|---|
| `infer-edges` | Propose new `knows` / `worked_with` edges from co-attendance in touches and shared `company`. Results queued to AI Inbox. | Functional |
| `merge-duplicates` | Detect near-duplicate people/orgs and propose merges. Surfaced as `Sauce: Propose Merges`. | Functional |
| `route-introduction` | Given two contacts, find the shortest warm path and propose the right intermediary. | Functional |
| `review-changes` | Audit recent mutations for contract violations the validator may have warned past. | Functional |

### Import / export

| ID | Description | Status |
|---|---|---|
| `import-contacts` | Bulk-ingest CSV / vCard / JSON via the mapping modal. | Functional |
| `export-graph` | Dump the full graph to JSON. Mirrors `export-graph-json` command. | Functional |

### Integration-bound

| ID | Description | Status |
|---|---|---|
| `geocode` | Resolve `location:` strings to lat/lng for the Map view. Surfaced as `Sauce: Geocode Current Note`. | Functional (requires geocoder API key or local OSM provider) |
| `capture-call` | Bind a Twilio recording to a new `touch`. Surfaced as `Sauce: Capture Call (Twilio)`. | Pending-integration (requires Twilio credentials) |
| `transcribe` | Speech-to-text for an audio file (local Whisper or cloud STT). Surfaced as `Sauce: Transcribe Audio File…`. | Pending-integration (requires Whisper binary or STT API key) |
| `verify-email` | MX + SMTP-RCPT probe to validate an `email:` field. | Functional |

## Running a skill

- From the command palette: **`Sauce: Run Skill…`** → picker modal lists every enabled skill.
- From a hotkey-bound command (e.g. `sauce:summarize-current`).
- From the copilot chat: ask the model to do the thing; it invokes the skill via tool-use.

Every run is recorded in the Skill Run Log (**`Sauce: Open Skill Run Log`**) with timestamps, autonomy used, mutation counts, and pass/fail status. The runtime annotates each mutation onto the audit chain when the KeyVault is unlocked.

## Disabling skills

`SkillRegistry.setSettings(id, { enabled: false })` removes a skill from both the picker and the copilot's tool-use surface. Settings persist via `data.json`.
