# Sauce CRM SDK — Mobile Fork Architecture (Full Parity)

> Decision (locked this session): **full mobile parity**. `manifest.json`
> flips to `isDesktopOnly: false`. Desktop keeps native acceleration; mobile
> gets an equivalent, Capacitor/WASM-safe data path. Every constraint below is
> from the Obsidian mobile docs/checklist — these are non-negotiable.

## Hard constraints (from docs — LOCKED)

1. **No top-level Node modules.** `fs`, `path`, `electron`, `child_process`,
   native `require()` must be gated behind `Platform.isDesktopApp` and required
   dynamically at runtime. (Source: plugin self-critique checklist → Mobile.)
2. **`Vault.adapter` is `CapacitorAdapter` on mobile**, not `FileSystemAdapter`.
   All `FileSystemAdapter` use sits behind `instanceof` checks.
3. **No regex lookbehinds** for iOS < 16.4 support.
4. **Disclose** network/account/telemetry use in README per Developer policies.

## The data-layer fork (the core of the logic chain)

The current `src/services/VectorDB.ts` does
`require('@lancedb/lancedb' | 'sqlite3' | 'sqlite-vec')` — **mobile-fatal** as
written. The SDK introduces one interface, two implementations, selected at
runtime by `Platform`:

```
tools/data/IVectorStore.md         ← contract (the seam)
  ├─ desktop: NativeVectorStore     (gated require: lancedb / sqlite-vec)   Platform.isDesktopApp
  └─ mobile:  RemoteOrWasmVectorStore (remote embeddings API + IndexedDB/sqlite-wasm,
                                       file I/O via CapacitorAdapter)        Platform.isMobileApp
```

**Embeddings:** mobile has no local model runtime → embeddings on mobile go
through a remote provider via `requestUrl` (no raw `fetch` cross-origin
issues), keyed through the existing encrypted KeyVault. Desktop may use local
(LM Studio/Ollama) or remote. The `IEmbedder` contract abstracts this; the
chainer picks the provider per `Platform` + settings.

## Logic-chain mapping on mobile

| Capability | Desktop | Mobile |
|---|---|---|
| Realtime embeddings | local or remote | **remote / WASM only** |
| Vector store | LanceDB / sqlite-vec (native) | sqlite-wasm / IndexedDB |
| Looping / time-sync | `registerInterval` + logical clock | same (logical clock is platform-neutral) |
| Notes / metadata | `Vault` + `MetadataCache` | identical (Vault API is universal) |
| Actions / shortcuts | `Command` + `Scope` + `obsidian://` URI | `Command.mobileOnly` where relevant; URI is the cross-device bridge |
| Messages / connectors | full | network-gated; some (SMTP/native) desktop-only behind `Platform` gate |
| Components (UI) | Svelte + CSS vars | same; honor `WorkspaceMobileDrawer`, safe-area insets |

## Acceptance (mobile)

A member with `platform` including `mobile` must additionally pass: no
ungated Node import (lint rule), no `FileSystemAdapter` without `instanceof`,
no lookbehind regex, and a smoke test under a `Platform.isMobileApp=true` stub.
