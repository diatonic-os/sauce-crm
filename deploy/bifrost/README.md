# Bifrost gateway — hybrid cloud + local routing for SauceOM

SauceOM routes all chat/embeddings through **Bifrost** (Maxim AI's open-source,
Go, Apache-2.0 AI gateway) instead of calling providers directly. One
OpenAI-compatible endpoint fronts cloud APIs (Anthropic/OpenAI/…) AND the local
fleet (LM Studio / Ollama / vLLM), with adaptive load-balancing, automatic
failover, semantic caching, virtual keys, and budgets.

Chosen over LiteLLM after verification (2026-06-19): Go core (<100µs overhead),
fully-permissive Apache-2.0 (nothing commercial-gated for self-host), first-class
Helm chart, data-stays-in-VPC. Both are OpenAI-compatible, so the SauceBot
integration is identical — only the gateway URL differs.

## Architecture: ONE hosted gateway, clients auto-connect

Bifrost runs **once on our VPS worker node** (not per-client). Every installed
SauceOM plugin **auto-connects** to it on load:

- `settings.gatewayUrl` holds the hosted endpoint (bake it into the client build,
  or push via managed config). On `onload` the plugin probes `<gatewayUrl>/models`
  and, on success, adopts `provider: bifrost` + that endpoint + a model — **zero
  manual setup for the client.**
- Manual trigger / first-time URL entry: command **"SauceOM: Connect to Bifrost
  gateway"** (prompts for the URL if unset, then connects).
- Each client authenticates with a Bifrost **virtual key** (per-client budget +
  which upstreams it may use). The key lives in the client's secure KeyVault.

So the only thing a client needs is the gateway URL (baked or one command); the
hosted proxy does all cloud-vs-local routing centrally.

## Plugin integration (already wired)

`ProviderRegistry` has a `bifrost` provider (`harness: openai-compat`,
`credentialKey: copilot:bifrost:api-key`). `gatewayUrl` overrides its endpoint at
runtime. Manual path: Settings → Copilot → Provider **Bifrost gateway** →
Endpoint = your VPS URL → API key = a Bifrost virtual key.

The plugin sends OpenAI-shaped requests (incl. the tool-calling fix); Bifrost
decides cloud-vs-local per its routing config. No plugin-side routing code.

## Deploy to Kubernetes (Helm)

```bash
helm repo add bifrost https://maximhq.github.io/bifrost   # verify current repo URL
helm install bifrost bifrost/bifrost -n sauce -f values.yaml
```

See `values.yaml` for a production starter: Postgres mode (HA), autoscaling,
ingress, semantic-cache vector store, cloud + local providers, and a virtual key.

> Verify the chart's exact value schema against the pinned chart version
> (ArtifactHub: `bifrost/bifrost`) before applying — keys evolve between releases.

## Local quick test (no k8s)

```bash
npx -y @maximhq/bifrost          # starts on :8080
# then point the plugin's Bifrost endpoint at http://localhost:8080/v1
```

## Local fleet

Point Bifrost at LM Studio / Ollama via their OpenAI-compatible base URLs
(LM Studio `http://<host>:1234/v1`, Ollama `http://<host>:11434/v1`) as custom
OpenAI-compatible providers in `values.yaml`. Bifrost then load-balances /
fails-over between local and cloud per your routing rules.
