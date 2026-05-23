// SDK connector — source: sdk/groups/connectors/twilio.md | api_version: 1.8.0 | gen_hash: hand-con002
//
// Twilio SMS: pure builder/parser + thin sendSms over requesturl-fetch.

import { fetchUrl, FetchRequest } from '../tools/requesturl-fetch';

export interface TwilioConfig {
  accountSid: string;
  authToken: string;
}

export interface SmsResult {
  sid: string;
  status: string;
}

/** Build the (pure) Twilio send-SMS request: Basic auth, form-encoded body. */
export function buildSmsRequest(to: string, from: string, body: string, config: TwilioConfig): FetchRequest {
  const auth = btoa(`${config.accountSid}:${config.authToken}`);
  const form = new URLSearchParams({ To: to, From: from, Body: body }).toString();
  return {
    url: `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  };
}

/** Parse a Twilio message response (pure). */
export function parseSmsResponse(json: unknown): SmsResult {
  const o = (json ?? {}) as Record<string, unknown>;
  return { sid: String(o.sid ?? ''), status: String(o.status ?? '') };
}

/** Send an SMS via Twilio. */
export async function sendSms(to: string, from: string, body: string, config: TwilioConfig): Promise<SmsResult> {
  const res = await fetchUrl(buildSmsRequest(to, from, body, config));
  return parseSmsResponse(res.json);
}
