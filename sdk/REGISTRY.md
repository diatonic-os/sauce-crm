<!-- GENERATED — aggregated from sdk/groups/**/*.md member contracts. Do not edit by hand. -->
# Sauce CRM SDK — Registry

Total members: 38

## actions

| id | platform | summary |
| --- | --- | --- |
| `quick-capture` | [desktop, mobile] | Capture a note with merged frontmatter; register it as a command. |
| `run-embedding-sync` | [desktop, mobile] | registerEmbeddingSync(plugin,run) command bound to running chainers/embedding-pipeline. |
## chainers

| id | platform | summary |
| --- | --- | --- |
| `embedding-pipeline` | [desktop, mobile] | Deterministic pipeline — embed docs and upsert into the vector store; query by text. |
| `time-sync-loop` | [desktop, mobile] | Lifecycle-bound reconcile loop ordered by a logical clock (never wall-clock). |
## components

| id | platform | summary |
| --- | --- | --- |
| `crm-card` | [desktop, mobile] | Headless CRM card builder — every style bound to a generated CSS token (zero literals). |
| `inbox-view` | [desktop, mobile] | Headless inbox list — pending-item rows styled only via cssTokens. |
| `setting-row` | [desktop, mobile] | Headless setting-row builder — label + optional description, styled only via cssTokens. |
| `touch-timeline` | [desktop, mobile] | Headless touch-timeline — ordered touch rows styled only via cssTokens. |
## connectors

| id | platform | summary |
| --- | --- | --- |
| `google` | [desktop, mobile] | Google connector: pure request builder + response parser over requesturl-fetch; OAuth bearer token from caller. |
| `microsoft` | [desktop, mobile] | Microsoft 365 connector: pure request builder + parser over requesturl-fetch; OAuth bearer from caller. |
| `notion` | [desktop, mobile] | Notion connector: pure buildRequest + parseResponse over requesturl-fetch; Bearer token auth from caller. |
| `twilio` | [desktop, mobile] | Twilio SMS connector — pure request builder (Basic auth) + parser over requesturl-fetch. |
| `websearch` | [desktop, mobile] | Web-search connector — pure request builder + response parser over requesturl-fetch. |
## helpers

| id | platform | summary |
| --- | --- | --- |
| `arraybuffer-base64` | universal | Wrap Obsidian arrayBufferToBase64 / base64ToArrayBuffer for binary <-> text encoding. |
| `frontmatter-merge` | universal | Deterministic deep-merge of two frontmatter records with array union and stable key order. |
| `logical-clock` | universal | Lamport logical clock for deterministic cross-device ordering without wall-clock. |
| `normalize-path` | universal | Wrap Obsidian normalizePath plus a deterministic POSIX joinPath for vault-relative paths. |
| `parse-yaml` | universal | Wrap Obsidian parseYaml/stringifyYaml for frontmatter round-tripping. |
| `stable-sort` | universal | Deterministic stable sort by key — preserves input order for equal keys. |
| `wikilink` | universal | Pure parse/format of Obsidian wikilinks with target, optional heading and alias. |
## skills

| id | platform | summary |
| --- | --- | --- |
| `infer-edges` | [desktop, mobile] | Derive relationship edges (knows / worked_with) from a note's frontmatter. |
| `research-org` | [desktop, mobile] | Research an organization by composing the websearch connector. |
| `research-person` | [desktop, mobile] | Research a person by composing the websearch connector. |
| `summarize-thread` | [desktop, mobile] | Summarize a message thread via an LLM endpoint — pure builder/parser + thin call. |
## talents

| id | platform | summary |
| --- | --- | --- |
| `relationship-intelligence` | [desktop, mobile] | Capability pack bundling relationship skills into one agent-facing talent. |
## tools

| id | platform | summary |
| --- | --- | --- |
| `command-register` | universal | Register an Obsidian command (Plugin.addCommand) — the substrate for actions/. |
| `data-iembedder` | [desktop, mobile] | Embedding seam — desktop local/remote vs mobile remote, plus a deterministic hash reference. |
| `data-ivectorstore` | [desktop, mobile] | Vector-store seam — desktop native vs mobile WASM/remote, plus an in-memory reference. |
| `file-rename` | universal | Link-safe rename/move of a file (FileManager.renameFile) at a normalized path. |
| `hotkey-register` | desktop | Register a keyboard shortcut on a Scope (Scope.register). |
| `interval-register` | universal | Register a recurring callback tied to plugin lifecycle (Component.registerInterval). |
| `metadata-read` | universal | Read a note's cached metadata / frontmatter (MetadataCache.getFileCache). |
| `platform-detect` | universal | Wrap Obsidian Platform flags — the gates the mobile fork depends on. |
| `requesturl-fetch` | universal | Wrap Obsidian requestUrl into a typed, CORS-free fetch for connectors and embeddings. |
| `vault-create-note` | universal | Create a plaintext note in the vault at a normalized path (Vault.create). |
| `vault-process-note` | universal | Atomic read-modify-write of a note (Vault.process) — the safe edit primitive. |
| `vault-read-note` | universal | Read a note's current contents via Vault.cachedRead (display-safe, fast). |
| `workspace-get-leaf` | [desktop, mobile] | Get a right-sidebar leaf for placing a CRM view (Workspace.getRightLeaf). |
