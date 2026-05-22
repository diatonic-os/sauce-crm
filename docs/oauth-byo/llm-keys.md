# Copilot LLM keys (Anthropic, OpenAI, NVIDIA NIM)

Sauce CRM's Copilot can route to any of these providers. Each is a single API key — no OAuth flow. Local providers (Ollama, LM Studio) don't need a key at all unless you've explicitly enabled auth on them.

## Anthropic (Claude)

1. https://console.anthropic.com/ → **API Keys** → **Create Key**.
2. Copy the `sk-ant-...` key.
3. In Obsidian: **Settings → Sauce CRM → Integrations → Anthropic** → **Configure** → paste → **Save to vault**.

The Copilot section's auto-populated model list pulls Anthropic's static catalog (Opus 4.7, Sonnet 4.6, Haiku 4.5, etc.). To use a model not in the curated list, type its id in the model dropdown's free-text fallback after picking the Anthropic provider.

## OpenAI

1. https://platform.openai.com/api-keys → **Create new secret key** → name it (e.g. `Sauce CRM`).
2. Copy the `sk-...` key.
3. **Settings → Sauce CRM → Integrations → OpenAI** → **Configure** → paste → **Save**.

OpenAI's catalog is static-curated in the plugin (`gpt-4o`, `gpt-4o-mini`, `o1-preview`, etc.). Their `/v1/models` endpoint requires the key, which we don't want the catalog fetch to require (the picker would refuse to render without first asking for the key), so we use a small curated list and let you type in any model id manually.

## NVIDIA NIM

1. https://build.nvidia.com/ → **API Catalog** → **Get API Key**.
2. Copy the `nvapi-...` key.
3. **Settings → Sauce CRM → Integrations → NVIDIA NIM** → **Configure** → paste → **Save**.

NIM's `/v1/models` endpoint is publicly readable (no auth required for the catalog), so the model dropdown populates from the live list (123+ models including `meta/llama-4-maverick-17b-128e-instruct` and `nvidia/llama-3.1-nemotron-70b-instruct`).

## Local providers (no key needed by default)

### Ollama

If your Ollama install requires no auth (the default), just configure the endpoint URL in **Settings → Sauce CRM → Integrations → Ollama**. The Copilot picker populates from `${endpoint}/api/tags`.

If you reverse-proxy Ollama behind nginx with bearer auth, paste the bearer token into the optional key field. The catalog fetch will send it as `Authorization: Bearer ...`.

### LM Studio

Same idea — endpoint URL is enough by default. If you've enabled the API key in LM Studio's Developer settings, paste it. The Copilot picker pulls `${endpoint}/v1/models`.

## Rotation

For every provider above, **Configure** in the Credentials modal is idempotent — paste a new key, click **Save**, and the new value overwrites the old one in KeyVault. The Copilot picks it up on the next request (no plugin restart needed).
