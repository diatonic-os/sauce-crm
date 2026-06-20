# Copilot → SauceBot Re-Engineering Audit

> Generated 2026-06-19. Source of truth for absorbing the 3rd-party **Obsidian
> Copilot v3.3.3** (Logan Yang) feature surface into our first-party **SauceBot**
> (`copilot` settings key / `src/saucebot/`). The vendored plugin was dumped,
> archived to buffalo, then removed from the `Sauce_Relationship_Graph` vault.
> This document is the spec for the backend + settings reconciliation wave.

## 1. Schema Dump — Vendored Copilot v3.3.3 (`data.json`)

Faithful capture of the real installed settings instance. Grouped by concern.

### 1.1 Provider credentials (flat keys)
`openAIApiKey, openAIOrgId, huggingfaceApiKey, cohereApiKey, anthropicApiKey,
azureOpenAIApiKey, azureOpenAIApiInstanceName, azureOpenAIApiDeploymentName,
azureOpenAIApiVersion, azureOpenAIApiEmbeddingDeploymentName, googleApiKey,
openRouterAiApiKey, xaiApiKey, mistralApiKey, deepseekApiKey,
amazonBedrockApiKey, amazonBedrockRegion, siliconflowApiKey, groqApiKey,
githubCopilotAccessToken, githubCopilotToken, githubCopilotTokenExpiresAt`
— plus proxy base URLs `openAIProxyBaseUrl, openAIEmbeddingProxyBaseUrl`,
keychain markers `_keychainOnly, _keychainVaultId`.

### 1.2 Model registry — `activeModels[]`
Per entry: `{ name, provider, enabled, isBuiltIn, core, projectEnabled,
plusExclusive, capabilities: ("vision"|"reasoning")[], baseUrl?, apiKey? }`.
Providers seen: `openai, anthropic, google, openrouterai, xai, deepseek,
siliconflow, lm-studio, cohereai, azure openai, copilot-plus(-jina)`.
LM Studio entries carry an explicit `baseUrl: http://10.60.0.100:1234/v1`.

### 1.3 Embedding registry — `activeEmbeddingModels[]`
Per entry: `{ name, provider, enabled, isBuiltIn, isEmbeddingModel:true, core,
dimensions?, baseUrl?, apiKey? }`. Separate from chat models.
Tuning: `embeddingRequestsPerMin:60, embeddingBatchSize:16,
disableIndexOnMobile:true, numPartitions:1, lexicalSearchRamLimit:100`.

### 1.4 Chat / generation
`defaultChainType:"llm_chain", defaultModelKey:"<name>|<provider>",
embeddingModelKey, temperature:0.1, maxTokens:6000, contextTurns:15,
userSystemPrompt, stream:true, defaultSendShortcut:"enter",
defaultOpenArea:"view", reasoningEffort:"low", verbosity:"medium",
passMarkdownImages:true, autoCompactThreshold:128000`.

### 1.5 Conversation persistence
`defaultSaveFolder:"copilot/copilot-conversations",
defaultConversationTag:"copilot-conversation", autosaveChat:true,
generateAIChatTitleOnSave:true,
defaultConversationNoteName:"{$topic}@{$date}_{$time}",
chatHistorySortStrategy:"recent", enableRecentConversations:true,
maxRecentConversations:30`.

### 1.6 Context assembly
`autoAddActiveContentToContext:true, chatNoteContextPath, chatNoteContextTags[],
autoIncludeTextSelection:false, autoAddSelectionToContext:false,
quickCommandIncludeNoteContext:true`.

### 1.7 Vector store / RAG
`indexVaultToVectorStore:"ON MODE SWITCH", qaExclusions:"copilot", qaInclusions,
enableIndexSync:true, maxSourceChunks:30, enableInlineCitations:true,
enableSemanticSearchV3:false, enableLexicalBoosts:true, showRelevantNotes:true`.

### 1.8 Custom prompts / commands
`customPromptsFolder:"copilot/copilot-custom-prompts",
enableCustomPromptTemplating:true, promptUsageTimestamps:{},
promptSortStrategy:"timestamp", showSuggestedPrompts:true,
suggestedDefaultCommands:true, inlineEditCommands[]`.

### 1.9 Autonomous agent
`enableAutonomousAgent:true, autonomousAgentMaxIterations:4,
autonomousAgentEnabledToolIds:[localSearch, readNote, webSearch, pomodoro,
youtubeTranscription, writeFile, editFile, updateMemory]`.

### 1.10 Saved memory
`enableSavedMemory:true, memoryFolderName:"copilot/memory"` (the `updateMemory`
tool persists durable cross-session facts).

### 1.11 Projects
`projectsFolder:"copilot/projects", projectList[], projectListSortStrategy,
projectEnabled per model`.

### 1.12 Inline edit / apply
`autoAcceptEdits:false, diffViewMode:"split", inlineEditCommands[]`.

### 1.13 System prompts
`userSystemPromptsFolder:"copilot/system-prompts", defaultSystemPromptTitle`.

### 1.14 Self-host / advanced search
`enableSelfHostMode, selfHostUrl, selfHostApiKey, selfHostSearchProvider:
"firecrawl", firecrawlApiKey, perplexityApiKey, supadataApiKey, enableMiyo,
miyoServerUrl, miyoSearchAll, convertedDocOutputFolder`.

## 2. Schema Dump — SauceBot (`COPILOT_DEFAULTS`, `src/saucebot/SauceBotRuntime.ts:148`)

`SauceBotSettings`: `provider:ProviderId, model, apiKey, baseUrl?,
temperature:0.4, maxTokens:4096, systemPrompt, embedModel?,
slashCommands?:SlashCommand[], stream:true, contextTurns:15,
promptsFolder:"copilot/sauce-commands", maxRetries?, disabledModels[],
knownGoodModels[], keepModelWarm:false, modelTtlSeconds:240,
preferredEmbeddingModel?, distill:DistillSettings, localTuning:LocalTuningSettings`.

- `DistillSettings`: `enabled, provider?, model?, autoSelectLocal, tokenGate:700,
  maxPasses:2` — context compaction (TOON). **Ahead of Copilot** here.
- `LocalTuningSettings`: `enabled?, toolPrompt, historyTokenBudget:2000,
  toolRepairReask, emptyAnswerRetry` — local-model quality + auto-heal.
  **Ahead of Copilot** here.
- Chat history: `SauceBotSession` (id, conversationId, chatId, installId,
  agentId, createdTs, turns:TurnTrace[]) persisted by `ConversationStore` to
  `<addenda>/_copilot/YYYY-MM-DD-<slug>.md`. **Replay-grade traces** — ahead.
- Model registry: `ProviderRegistry` + `ModelCatalog` (live `/api/v0/models`
  + OpenAI-compat), `ModelManager` fallback ladder. **Live discovery** — ahead.

## 3. Feature Re-Engineering List (gap analysis)

Legend: ✅ already ≥ Copilot · ⚠️ partial · ❌ missing.

| # | Capability | SauceBot today | Action |
|---|---|---|---|
| R1 | **Per-model registry with capabilities** (vision/reasoning, enabled, core, baseUrl, projectEnabled) | ⚠️ live catalog, no persisted per-model `capabilities`/`enabled` flags | Land the **LM Studio capability library** (Task #2) + generalize to a `ModelEntry{name,provider,enabled,capabilities[],contextLength,baseUrl,apiKey}` persisted registry across providers |
| R2 | **Saved cross-session memory** (`updateMemory` tool + `memory/` folder) | ❌ no durable user-memory tool | Add `updateMemory` tool + `.sauceBrain/memory/` store wired into RAG assembly |
| R3 | **Autonomous agent loop w/ tool allow-list + max-iterations** | ⚠️ tool-use + repair exists; no bounded autonomous multi-step loop | Build on Task #3 orchestrator: `enableAutonomousAgent, maxIterations, enabledToolIds[]` |
| R4 | **Conversation note naming + autosave + AI title + recents list** | ⚠️ autosaves traces; no title-gen, no `{$topic}@{$date}` template, no recents UI | Add `generateAIChatTitleOnSave`, `conversationNoteName` template, `recentConversations` surface |
| R5 | **Suggested prompts / relevant-notes panel** | ❌ | Add `showSuggestedPrompts`, `showRelevantNotes` side panel |
| R6 | **Inline edit / apply-to-note with diff view** | ❌ | Add `inlineEditCommands`, `diffViewMode:"split"`, `autoAcceptEdits` |
| R7 | **Vault-index tuning knobs** (maxSourceChunks, inline citations, index-sync mode, lexical boosts) | ⚠️ realtime embeddings + RAG; no chunk cap / citation / sync-mode knobs | Surface `maxSourceChunks, enableInlineCitations, indexVaultToVectorStore mode, enableLexicalBoosts` |
| R8 | **Per-provider credential vault** (broad provider set + proxy URLs) | ⚠️ KeyVault + chained sources; fewer providers | Expand `ProviderRegistry` to cover openrouter/xai/deepseek/siliconflow/bedrock/mistral/cohere + proxy base URLs |
| R9 | **System-prompt library** (`userSystemPromptsFolder`, named default) | ⚠️ single `systemPrompt` | Add named system-prompt library under `.sauceBrain/saucebot/system-prompts/` |
| R10 | **Projects** (scoped workspaces with their own model/context) | ❌ | Defer — overlaps with our `lanes`/`agents`; evaluate after R1-R4 |
| R11 | **Context compaction threshold** (`autoCompactThreshold`) | ✅ `distill` + `historyTokenBudget` (stronger) | Expose a single `autoCompactThreshold` alias for parity |
| R12 | **Send shortcut / open area / verbosity / reasoningEffort** | ⚠️ partial | Add `defaultSendShortcut, defaultOpenArea, verbosity, reasoningEffort` to settings |

**Where SauceBot already wins (preserve, don't regress):** TOON context
distillation (R11), local-model auto-heal (`toolRepairReask`/`emptyAnswerRetry`),
replay-grade trace persistence, live LM Studio model discovery + warm/validate,
known-good fallback ladder, vault-native entity graph as first-class context.

## 4. Decoupling cleanup (immediate)

Our defaults still hard-code the **vendored plugin's** folder convention:
- `COPILOT_DEFAULTS.promptsFolder = "copilot/sauce-commands"`
  (`src/saucebot/SauceBotRuntime.ts:164`, `src/ui/settings/sections/copilot.ts:327`).

Re-point to `.sauceBrain/saucebot/prompts` so SauceBot owns its surface and does
not collide with (or depend on) a `copilot/` folder once the plugin is gone.

## 5. Deletion record

Vendored `copilot` v3.3.3 archived to
`/mnt/buffalo-backup/backups/daclab-asus/obsidian-copilot-plugin/` (plugin dir +
`data.json`) and removed from
`Sauce_Relationship_Graph/.obsidian/plugins/copilot/`. Re-installable from the
Obsidian community store; settings instance preserved in §1 + the archive.
