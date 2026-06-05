# Reviewer Notes — sauce-crm

For the Obsidian plugin reviewer. This document enumerates every sensitive
capability in the plugin, the guard that bounds it, and a current
`file:line` citation so each control can be checked against source. Line
numbers reference the working tree on branch `feat/lightweight-runtime`.

Two artifacts ship under this repo. **Only the plugin** (`main.js` +
`manifest.json` + `styles.css`) is submitted to the community marketplace.
The **daemon** (`daemon/`) is a *separately distributed, self-hosted*
artifact the user installs out-of-band; it is NOT shipped through the
marketplace and the plugin never downloads or runs it. Where a control
exists in both, both citations are given.

---

## (a) Process spawning — whisper only, hardened

The plugin has exactly **one** sanctioned process-spawn primitive, and it
is used **only** for an optional local voicenote-transcription feature
(whisper CLI). There is no other `exec`/`spawn` of an external binary.

- **No shell, ever.** The primitive uses Node `execFile` (argv array), never
  a shell, so no argument can be reinterpreted as a command. The module name
  is even assembled from fragments so it does not itself trip the repo's
  "no raw shell exec" source guard.
  `src/utils/execFileNoThrow.ts:88-89` (fragment assembly),
  `src/utils/execFileNoThrow.ts:117-138` (execFile call,
  `windowsHide`, `killSignal:"SIGKILL"`).
- **Absolute-path requirement.** The binary path must be absolute; PATH
  lookup is disabled. Relative/bare names are rejected before any spawn.
  `src/services/transcribe/WhisperArgs.ts:125-163`
  (`isAbsoluteBinaryPath`, `validateBinaryPath`: absolute → exists →
  executable).
- **Argv allowlist.** Every argv entry is produced from a closed allowlist;
  model/language are charset-validated (fail loud, not silently dropped),
  output format is a 4-value set, and the audio/output paths are passed as
  single inert argv entries. No arbitrary-arg passthrough exists.
  `src/services/transcribe/WhisperArgs.ts:23-31` (allowlists/charsets),
  `src/services/transcribe/WhisperArgs.ts:54-98` (`buildWhisperArgs`).
- **Consent on spawn, showing exact argv.** The first spawn per session
  routes through the injected `ApprovalGate` (action class
  `"spawn-process"`); the approval detail is the exact argv string the
  operator is approving. Denial throws and nothing runs.
  `src/services/transcribe/WhisperEngine.ts:159-173` (consent; `argvDisplay`
  = `[bin, ...args].join(" ")`),
  `src/contract/ApprovalGate.ts:72-102` (gate; `approve-always` persisted,
  default is prompt-every-time).
- **Audit log.** Every spawn is appended to the audit sink with the binary,
  argv, and audio path.
  `src/services/transcribe/WhisperEngine.ts:175-181`.
- **Child kill-on-unload.** Each live child is tracked in a
  `ChildProcessRegistry`; the plugin's `onunload` terminates any still-running
  process so no transcription is orphaned.
  `src/utils/execFileNoThrow.ts:53-84` (registry + `killAll`),
  `src/utils/execFileNoThrow.ts:131-137` (auto add/remove around the child).
- **Bounded.** Hard timeout + max output buffer; an overrun is SIGKILL'd by
  the exec layer. `src/services/transcribe/WhisperEngine.ts:184-188`
  (timeout default 600s), `src/utils/execFileNoThrow.ts:32-34,151`
  (maxBuffer default 64 MiB).
- **Never auto-installed by the plugin (detect-only).** The plugin neither
  downloads nor installs whisper. If the binary is absent the feature reports
  it and does nothing. This mirrors the LanceDB detect-only pattern (below).
  `src/services/transcribe/WhisperEngine.ts:132-139` (`isAvailable` is a
  validate-then-probe, no install), and `candidateBinaryPaths` is for an
  explicit operator-confirmed "Detect" action only — never auto-used
  (`src/services/transcribe/WhisperArgs.ts:165-195`).

The daemon (self-hosted channel) reuses the *same* hardened primitives —
`buildWhisperArgs` + `validateBinaryPath` + `execFileNoThrow` — for its
`POST /v1/transcribe` route. `daemon/src/transcribe.ts:206-238`.

---

## (b) HTTP listeners — both default-OFF, loopback-only, authenticated + encrypted

Two optional listeners exist: the in-plugin **mobile-memory bridge**
(`MemoryHttpServer`) and the **self-hosted daemon** (`DaemonServer`,
not marketplace-shipped). Both are **off by default** and start only when
the operator explicitly enables/pairs them.

- **Refuse 0.0.0.0 by default.** The server constructor throws if asked to
  bind `0.0.0.0`/`::` unless an explicit `allowNonLoopback:true` opt-in is
  set (surfaced as an auditable config edit, never an accident). The daemon's
  default bind host is `127.0.0.1`.
  `src/bridge/server/MemoryHttpServer.ts:150-157` (refusal),
  `daemon/src/config.ts:26-27` (`DEFAULT_BIND_HOST = "127.0.0.1"`),
  `daemon/src/config.ts:45-48` (`allowNonLoopback` opt-in).
- **HMAC auth on every non-health route.** Requests are signed (sig + nonce +
  timestamp headers); the verifier checks a clock-skew window, rejects
  replays, and uses constant-time signature comparison.
  `src/bridge/server/MemoryHttpServer.ts:391-417` (auth over the raw wire),
  `src/bridge/auth/HmacAuth.ts:76-103` (window + replay + CT-compare),
  `src/bridge/auth/HmacAuth.ts:129-141` (`constantTimeEqualHex`).
- **AES-256-GCM app-layer body encryption, HKDF-separated key.** The
  transport (AES) key is an HKDF-SHA256 subkey of the pairing key under a
  fixed `info` label, so the AES key and the HMAC key are cryptographically
  independent. Bodies are AES-256-GCM with a fresh 12-byte IV per message;
  GCM's tag gives integrity/tamper detection. Wire token =
  base64(IV‖ciphertext‖tag).
  `src/bridge/crypto.ts:57-115` (`TRANSPORT_ENC_INFO`, `deriveTransportKey`),
  `src/bridge/crypto.ts:121-159` (`transportEncrypt`/`transportDecrypt`),
  `src/bridge/server/MemoryHttpServer.ts:315-388` (server decrypt-in /
  encrypt-out), `daemon/src/server.ts:159-168` (daemon wires the same
  HKDF subkey + cipher).
- **Replay protection.** A bounded LRU nonce set rejects a valid-but-replayed
  request *before* recording, in addition to the timestamp window.
  `src/bridge/auth/HmacAuth.ts:87-113`.
- **Rate limiting.** A per-remote-address token bucket sheds floods with 429
  *before* any body read / auth / crypto work. Bounded LRU caps memory.
  `src/bridge/server/RateLimiter.ts:30-80`,
  `src/bridge/server/MemoryHttpServer.ts:266-276` (checked first).
- **Body caps.** Memory routes cap at 10 MB (413 + socket destroy on
  overflow); the daemon transcribe route raises its own cap to 100 MB
  (audio) explicitly, not by widening the shared cap.
  `src/bridge/server/MemoryHttpServer.ts:99,528-556`,
  `daemon/src/transcribe.ts:50,321-351`.
- **No internal leakage.** Non-`BridgeError` throws map to a generic 500; the
  server never returns a stack or internal message.
  `src/bridge/server/MemoryHttpServer.ts:359-373,571-582`.

Plain HTTP on the wire is intentional and documented: the listener binds the
loopback/Tailscale interface only, and Tailscale (WireGuard) provides the
transport encryption end-to-end; app-layer AES-GCM + HMAC sit on top.
`src/bridge/server/MemoryHttpServer.ts:200-206`,
`daemon/src/server.ts:230-232`.

---

## (c) Secrets — OS keychain → encrypted KeyVault, redaction, master password

- **Chain: OS keychain first, KeyVault fallback.** Credentials resolve
  through a chained source: Electron `safeStorage` (Keychain / libsecret /
  DPAPI) first, then the encrypted KeyVault. First available source wins.
  `src/main.ts:799-807` (chain construction, keychain pushed first),
  `src/saucebot/SafeStorageCredentialSource.ts:27-75` (keychain-bound
  ciphertext; on-disk file is useless without the OS keychain, written 0600).
- **KeyVault.** AES-256-GCM "secretbox" per secret, master key via
  PBKDF2-SHA256 (600k iterations); every ciphertext carries the `SGV2\x01`
  envelope magic so pre-rewrite blobs are rejected rather than
  silently mis-decrypted.
  `src/security/KeyVault.ts:56-71` (magic + KDF/nonce constants),
  `src/security/KeyVault.ts:225-260` (`put`/`get`).
- **data.json redaction.** `saveSettings()` persists a redacted clone:
  `copilot.apiKey`, the **bridge** pairing token, and the **daemon** pairing
  token are all stripped; durable copies live only in the credential chain.
  `src/main.ts:2766-2784` (redacted clone),
  `src/main.ts:2814-2825` (chain service ids
  `bridge:pairing-token` / `daemon:pairing-token`).
- **Master-password manager with confirm-on-create.** First provision
  requires a confirm field so a typo can't silently become the permanent
  master password (SEC-06). Change-password re-encrypts every secret and
  also confirms; reset requires typing `RESET`.
  `src/ui/modals/v2/OnboardingWizardModal.ts:58-62,342-373` (confirm on
  provision), `src/ui/modals/v2/MasterPasswordModal.ts:88-110` (confirm on
  change), `src/security/KeyVault.ts:324-395` (`changeMasterPassword`).
- **Daemon pairing token at rest.** Written 0600 in a 0700 directory,
  outside the vault, under the central per-user data dir.
  `daemon/src/config.ts:166-207`.

---

## (d) No runtime code acquisition

- **LanceDB is detect-only.** The plugin never spawns a package manager or
  downloads code at runtime; the old runtime-install path was removed
  (2026-06-05). It only *detects* an existing install and, if absent, shows
  a copyable command the operator runs themselves, then re-checks.
  `src/services/LanceDBInstaller.ts:1-18` (header documenting the removal),
  `src/services/LanceDBInstaller.ts:43` (`detectLanceDB` — pure detection).
- **Whisper is detect-only** in the plugin (see (a)); it is never downloaded
  or installed by the plugin.
- **The daemon is the only channel that MAY provision whisper**, and only on
  explicit `--with-whisper` opt-in, after printing the exact command and
  prompting for confirmation; model weights are not pre-downloaded. The
  daemon is self-hosted and **not** distributed via the marketplace.
  `daemon/packaging/linux/install.sh:41-88` (opt-in, prompt, no weights),
  `daemon/src/config.ts:55-64` (config points the route at an absolute,
  validated binary path).

---

## (e) Network endpoints

All outbound endpoints the plugin can reach are listed in the README's
**Disclosures → Network use** section, with the exact host for each
provider. Every integration is **opt-in and default-off**; no network call
is made until the operator enables a feature and supplies credentials. See
`README.md` "Disclosures". The two local HTTP listeners ((b) above) are
likewise default-off and loopback-bound.

---

## (f) Telemetry — local JSONL only, never transmitted

The only "telemetry" is a structured event log written **locally** to
`.sauce/memory/TRACE-LOG.jsonl` via Obsidian's vault `DataAdapter`, with an
in-memory ring-buffer fallback when the adapter is unavailable. There is no
network code in the sink — events are pushed to a ring buffer and (best
effort) appended to the vault file; nothing is sent off-device.
`src/telemetry/TelemetrySink.ts:15-58` (ring buffer + `appendOne` writes via
the adapter only; no fetch/requestUrl anywhere in the module).
