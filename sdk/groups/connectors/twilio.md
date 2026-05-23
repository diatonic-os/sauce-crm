---
group: connectors
id: twilio
summary: Twilio SMS connector — pure request builder (Basic auth) + parser over requesturl-fetch.
platform: [desktop, mobile]
obsidian_api: none
api_version: "1.8.0"
deterministic: false
depends_on: [tools/requesturl-fetch]
---

# connectors/twilio

Pure `buildSmsRequest` (HTTP Basic auth, form-encoded body) + `parseSmsResponse`
plus a thin `sendSms` over `tools/requesturl-fetch`. Credentials supplied by the
caller from the encrypted KeyVault.

## Contract
- `buildSmsRequest(to, from, body, { accountSid, authToken })` → `FetchRequest`
  (POST to the Messages endpoint, `Basic` auth, `application/x-www-form-urlencoded`). Pure.
- `parseSmsResponse(json)` → `{ sid, status }`. Pure.
- `sendSms(...)` → result. Network (non-deterministic).
