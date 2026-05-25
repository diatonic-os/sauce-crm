# Sauce Cloud — MVP design (CON-SAUCE-CLOUD)

> Hosted commercial control plane for SauceBot: a key-less cloud-model gateway
> with monthly credits + strict paywalls, Stripe subscriptions, and a Supabase
> backend, consumed by the Sauce CRM Obsidian plugin. Brainstormed + approved
> 2026-05-25. This is the **MVP vertical slice**; hosted-memory and deploy
> hardening are follow-on specs.

## 1. Goal & positioning

Let community users of the open-source plugin **subscribe to "Sauce CRM Plus"**
and use cloud models (Anthropic / OpenAI / others) **without supplying their own
API keys or running local models** — instead receiving a **monthly credit
allocation per plan**, with **strict paywalls and explicit usage failures** when
limits are reached. Sauce (the company) **owns and manages the data + memories of
users who opt into the hosted tier**, under disclosed consent.

### Decisions locked during brainstorming
- **Consent model: opt-in hosted tier.** Free/local installs keep all data 100%
  local. Signing into Sauce Cloud / subscribing moves *that user's* hosted data +
  memories to our backend under our ToS — fully owned/managed by us, with
  disclosed consent + export/delete. No silent collection of community installs
  (GDPR/CCPA-clean, trust-safe for an OSS plugin).
- **Gateway scope: cloud providers only.** No LM Studio / local-model gateway.
- **Integration shape: Approach A** — the gateway is OpenAI/Anthropic-compatible
  and the plugin consumes it as **one new `saucecloud` entry in the existing
  ProviderRegistry** (built in CON-SAUCEBOT S1). The "API key" is the user's
  Sauce session JWT.
- **Runtime: hybrid.** Dedicated streaming **gateway service on the Proxmox k8s
  cluster** for the LLM proxy; **Supabase** (self-hosted on Proxmox) for
  Postgres/Auth/data; **Supabase Edge Functions** for non-streaming control logic
  (Stripe webhooks, credit RPC).
- **Credits = normalized cost units** (bigint µ-credits; per-model input/output
  rates). Plans grant N credits/month, **reset to allotment at each billing
  period start, no rollover**. Hard paywall at zero.
- **Backend lives in a separate `sauce-cloud/` workspace** (not the plugin repo);
  only the thin client lands in the plugin repo.

### In scope (this MVP spec)
Control-plane schema + identity, Stripe billing & subscriptions, credit metering
+ entitlements + strict paywall, the cloud LLM gateway, and the plugin client.

### Out of scope (follow-on specs)
Hosted vault-memory service; full multi-tenant deploy hardening / HA; the
complete legal layer (full ToS/privacy/export-delete tooling — MVP ships the
consent disclosure at sign-in + an account-delete path); analytics dashboards.

## 2. Architecture & components

Five units, each one job, clear interfaces:

1. **Control plane — Supabase (Postgres + Auth) on Proxmox k8s.** System of
   record; issues the JWTs every other component trusts. **RLS on every table.**
   Interface: PostgREST + Auth JWT.
2. **Edge Functions (Supabase/Deno)** — non-streaming control logic:
   `stripe-webhook`, `account-provision` (claim an anon install → account),
   credit RPCs (or as Postgres functions). Interface: HTTPS, Stripe-signed + JWT.
3. **LLM Gateway — dedicated streaming service on k8s (keystone).** Stateless;
   holds upstream provider keys (k8s secrets). Endpoints: `GET /v1/models`
   (entitled set), `POST /v1/chat/completions` (OpenAI-compat, streaming),
   `POST /v1/messages` (Anthropic-native, streaming). Interface:
   OpenAI/Anthropic-compatible HTTP.
4. **Plugin client (this repo)** — `saucecloud` ProviderSpec + `SauceCloudAuth`
   (PKCE) + credits/paywall UI + "Sauce Cloud" settings panel.
5. **Stripe** — hosted Checkout + Customer Portal → webhooks → (2) → (1).

**Data flow:** install registers (anon id) → user signs in via PKCE (JWT →
KeyVault) → plugin lists entitled models from (3) → chat: plugin → (3) with JWT →
upstream (our key) → metered → credits decremented → streamed back; zero credits
→ `402` paywall surfaced in chat (never silent).

## 3. Data model (Supabase Postgres, RLS everywhere)

**Identity & plans**
- `accounts` — `id uuid pk → auth.users`, `stripe_customer_id`, `plan_id`,
  `status`, timestamps.
- `installs` — `id uuid pk` (anon install id, plugin-generated first run),
  `account_id` *(null until claimed)*, `platform`, `plugin_version`,
  `last_seen_at`.
- `plans` — `id` (`free`/`plus`/`pro`), `monthly_credits`, `price_cents`,
  `stripe_price_id`, `tier_rank`, `features jsonb`.
- `model_catalog` — `id` (e.g. `anthropic/claude-opus-4-7`), `provider`,
  `display_name`, `credit_per_1k_input`, `credit_per_1k_output`, `min_tier_rank`,
  `enabled`. Entitlement = `model.min_tier_rank ≤ plan.tier_rank`.

**Billing mirror**
- `subscriptions` — `account_id`, `plan_id`, `status`, `current_period_start/end`,
  `cancel_at_period_end`. Written only by the webhook.
- `webhook_events` — `stripe_event_id pk` (idempotent webhook processing).

**Credits — append-only ledger + cached balance**
- `credit_ledger` — append-only: `account_id`, `ts`, `kind`
  (`grant`/`reserve`/`commit`/`release`/`adjustment`), `amount` (signed **bigint
  µ-credits**, 1 credit = 1e6 µ), `reason`, `ref`, `idempotency_key unique`.
  Balance = `Σ amount`; the auditable source of truth.
- `credit_balances` — `account_id pk`, `balance bigint`, updated **in the same
  txn** as ledger writes (fast-check cache).
- `usage_events` — `account_id`, `install_id`, `model_id`,
  `input/output_tokens`, `credits_charged`, `request_id`, `status`
  (`ok`/`error`/`paywalled`), `latency_ms`, `upstream_provider`.

**Atomic RPCs (`SECURITY DEFINER` — only writers to ledger/balance)**
- `reserve_credits(account, estimate) → reservation | insufficient` — holds an
  estimate *before* the upstream call; makes the paywall correct under
  concurrency (can't start a request you can't pay for).
- `commit_usage(reservation, actual, usage_event)` — settles the hold to actual
  (releases over-estimate; small under-estimate overage allowed, blocks the next
  request), records the usage event.
- `release_reservation(reservation)` — refund the hold on upstream error.
- `grant_monthly_credits(account, plan, period)` — idempotent monthly grant
  (key = account+period); **reset-to-allotment, no rollover**.

**RLS posture:** users `SELECT` only their own `accounts`/`subscriptions`/
`usage_events`/`credit_*`; **no client writes** to money tables (service-role /
`SECURITY DEFINER` only). `plans` + `model_catalog` public-read. `installs`
upsert-own by install id. Final schema to be reviewed against the
Supabase/Postgres best-practices skill at implementation.

## 4. Request lifecycle

**A. Sign-in (PKCE).** Plugin generates `code_verifier`+`challenge`, opens the
system browser to Supabase Auth; callback via a short-lived loopback server
(desktop) or `obsidian://` deep link (mobile). Exchange `code`+`verifier` →
access JWT + refresh token, both in **KeyVault**. The `saucecloud` apiKey getter
returns the live JWT, refreshing silently. First sign-in calls
`account-provision` with the anon install id → claim.

**B. Metered chat request (keystone).**
1. `CopilotRuntime` → `OpenAICompatibleProvider` POSTs `/v1/chat/completions`,
   `Authorization: Bearer <JWT>`, streaming.
2. Gateway verifies JWT (Supabase JWKS) → `account_id`; `401` → plugin refresh +
   one retry.
3. Entitlement: model in catalog, `min_tier_rank ≤ plan.tier_rank`, subscription
   active → else `403 {code:"model_not_in_plan", upgrade_url}`.
4. Reserve: estimate = (prompt tokens + `max_tokens`) × model rate →
   `reserve_credits()`. Insufficient → **`402 {code:"insufficient_credits",
   balance, reset_at, upgrade_url}`**, no upstream call.
5. Proxy upstream with our server key, mirroring the harness translation
   (OpenAI-compat ↔ Anthropic); relay chunks as they arrive.
6. Meter actual input/output tokens from upstream usage.
7. `commit_usage()` settles the hold (releases over-estimate; rare under-estimate
   overage blocks the next request — never a mid-stream kill).
8. Upstream error/abort → `release_reservation()` + `usage_event(status:error)`;
   error surfaced (no silent failure).

**C. Billing / monthly grant.** Subscribe → plugin opens Stripe Checkout
(hosted). Webhook → `stripe-webhook` (signature-verified, deduped):
`subscription.created|updated` → set `plan_id`+status; **`invoice.paid` →
`grant_monthly_credits()`** (reset-to-allotment); `subscription.deleted`/
`past_due` → downgrade to free, stop granting. Plan changes/cancel via Stripe
Customer Portal. Free tier grant via `pg_cron`.

**Resilience.** Sauce Cloud unreachable → plugin surfaces it; user can still use
own-key/local providers (Sauce Cloud is one provider among many, never the only
path).

## 5. Plugin client (this repo)

- **`saucecloud` ProviderSpec** — `harness:"openai-compat"`, `kind:"cloud"`,
  `catalog:"dynamic"`, configurable `baseUrl`. Its apiKey getter consults
  `SauceCloudAuth` (the live JWT), not `settings.apiKey` — a small change in
  `CopilotRuntime.getOrBuildProvider` to source the getter for this id.
- **`SauceCloudAuth`** — PKCE sign-in/out, KeyVault session (`saucecloud:session`),
  silent refresh, `getAccount()` (plan, balance, reset date).
- **"Sauce Cloud" settings panel** — sign in/out; plan + credits + reset date;
  Upgrade (Checkout); Manage billing (Customer Portal); entitled-model picker.
  When `saucecloud` is active, the API-key field is replaced by "Sign in".
- **Credit meter** in chat header; paywall → actionable banner
  ("Out of credits — resets {date} · Upgrade"), never silent.
- **Consent** disclosed at sign-in ("your chat messages are sent to the selected
  cloud provider via Sauce Cloud"); hosted memory is a later opt-in.

## 6. Error taxonomy

Gateway returns a typed code → mapped to a `CompletionEvent` `done:error` +
user-facing banner + action: `unauthenticated` (401 → refresh + retry once),
`model_not_in_plan` (403 → upgrade), `insufficient_credits` (402 → upgrade/wait),
`rate_limited` (429 → backoff), `upstream_error` (502 → retry). Reserve/commit ⇒
no overspend; release-on-error ⇒ no phantom charges.

## 7. Security

- Upstream provider keys **only in k8s secrets, read only by the gateway** —
  never in Postgres, never to the client.
- JWT verified via Supabase JWKS; service-role key only in gateway/edge env; RLS
  blocks cross-tenant reads; money tables writable only via `SECURITY DEFINER`.
- Stripe webhook signature + idempotency. TLS throughout.
- **SSRF-safe gateway:** proxies only an **allowlist** of known provider hosts,
  never arbitrary URLs (ssrf-filter pattern).
- Abuse control: per-account/per-install rate limits + a max-spend-per-minute cap
  so a leaked token can't instantly drain a plan.
- Account-delete path (GDPR) in MVP; full legal tooling is a follow-on.

## 8. Testing (R-002)

- **Plugin:** `SauceCloudAuth` (PKCE challenge gen, refresh logic), `saucecloud`
  spec builds + lists entitled models, paywall-error → UX mapping (reuse
  `ProviderHostMock`).
- **Gateway:** entitlement check, reserve/commit/release math, error taxonomy,
  streaming passthrough + usage extraction (mock upstream), SSRF allowlist.
- **Postgres:** RPCs under concurrency (no overspend), idempotent monthly grant,
  RLS denies cross-tenant (pgTAP or supabase-local).
- **Billing:** webhook signature, dedup, each event → state.
- **E2e (later):** staging Stripe + a served model.

## 9. Repo layout

- **`sauce-cloud/`** (new, separate workspace/repo): `supabase/migrations/*`,
  `supabase/functions/{stripe-webhook,account-provision}`, `gateway/` (the
  streaming service), `deploy/` (Helm/manifests for Proxmox k8s + self-hosted
  Supabase).
- **Plugin repo (this one):** `src/cloud/SauceCloudAuth.ts`, the `saucecloud`
  ProviderSpec addition, the settings panel + credit/paywall UI, and the
  `getOrBuildProvider` JWT-getter hook.

## 10. Build sequencing (for the implementation plan)

1. Supabase schema + RLS + credit RPCs (foundation).
2. Stripe billing + `stripe-webhook` + monthly grant.
3. LLM gateway (auth → entitlement → reserve → proxy → meter → commit; error
   taxonomy; SSRF allowlist; streaming).
4. Plugin client (`saucecloud` provider + `SauceCloudAuth` + UI + paywall).
5. Proxmox deploy (Helm) + staging verification.

Each step gate-green and independently testable; (4) reuses the existing
ProviderRegistry/harness so the plugin delta is small.
