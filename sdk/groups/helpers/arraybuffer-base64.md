---
group: helpers
id: arraybuffer-base64
summary: Wrap Obsidian arrayBufferToBase64 / base64ToArrayBuffer for binary <-> text encoding.
platform: universal
obsidian_api: arrayBufferToBase64
api_version: "1.8.0"
inputs:
  toBase64: "(buf: ArrayBuffer) => string"
  fromBase64: "(b64: string) => ArrayBuffer"
outputs: "base64 string / ArrayBuffer"
side_effects: none
deterministic: true
depends_on: []
---

# helpers/arraybuffer-base64

Wraps Obsidian's `arrayBufferToBase64` / `base64ToArrayBuffer` so binary payloads
(embeddings, attachments, media for the multimodal path) encode identically on
desktop and mobile via the host's implementation — no Node `Buffer` at the SDK
layer (mobile-safe).

## Contract
- `toBase64(buf)` — delegate to Obsidian `arrayBufferToBase64`.
- `fromBase64(b64)` — delegate to Obsidian `base64ToArrayBuffer`.
- Round-trips: `fromBase64(toBase64(b))` reproduces the bytes.
- Pure, deterministic, universal platform.
