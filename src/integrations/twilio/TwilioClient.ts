// SPEC §26 — Twilio REST API client. Uses Account SID + Auth Token via Basic auth.
export interface FetchHost {
  fetch(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<{ status: number; headers: Record<string, string>; body: string }>;
}

export interface TwilioAuth {
  accountSid: string;
  authToken: string;
}

export interface TwilioClientOpts {
  fetch: FetchHost;
  auth: () => Promise<TwilioAuth>;
  base?: string;
}

export interface TwilioCall {
  sid: string;
  from: string;
  to: string;
  status: string;
  direction: string;
  duration?: string;
  startTime?: string;
  endTime?: string;
}

export interface TwilioMessage {
  sid: string;
  from: string;
  to: string;
  body: string;
  status: string;
  direction: string;
  dateCreated?: string;
  dateSent?: string;
}

export interface TwilioRecording {
  sid: string;
  callSid?: string;
  duration?: string;
  channels?: number;
  status?: string;
  uri?: string;
  mediaUrl?: string;
  dateCreated?: string;
}

export interface TwilioTranscription {
  sid: string;
  recordingSid?: string;
  transcriptionText?: string;
  status?: string;
  price?: string;
  dateCreated?: string;
}

function basicAuthHeader(auth: TwilioAuth): string {
  const raw = `${auth.accountSid}:${auth.authToken}`;
  const enc =
    typeof btoa === "function"
      ? btoa
      : (s: string) => Buffer.from(s, "utf-8").toString("base64");
  return "Basic " + enc(raw);
}

export class TwilioClient {
  constructor(public opts: TwilioClientOpts) {}

  private base(): string {
    return this.opts.base ?? "https://api.twilio.com/2010-04-01";
  }

  private async get<T>(
    path: string,
    params?: Record<string, string | number | undefined>,
  ): Promise<T> {
    const a = await this.opts.auth();
    const qs = params
      ? "?" +
        Object.entries(params)
          .filter(([, v]) => v != null)
          .map(
            ([k, v]) =>
              `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`,
          )
          .join("&")
      : "";
    const r = await this.opts.fetch.fetch(
      `${this.base()}/Accounts/${a.accountSid}${path}.json${qs}`,
      {
        method: "GET",
        headers: {
          Authorization: basicAuthHeader(a),
          Accept: "application/json",
        },
      },
    );
    if (r.status < 200 || r.status >= 300)
      throw new Error(`twilio api ${r.status}: ${r.body.slice(0, 200)}`);
    return JSON.parse(r.body) as T;
  }

  async listCalls(
    params: {
      from?: string;
      to?: string;
      status?: string;
      pageSize?: number;
    } = {},
  ): Promise<TwilioCall[]> {
    const r = await this.get<{ calls?: unknown[] }>("/Calls", {
      From: params.from,
      To: params.to,
      Status: params.status,
      PageSize: params.pageSize ?? 50,
    });
    return (r.calls ?? []).map(decodeCall);
  }

  async listMessages(
    params: { from?: string; to?: string; pageSize?: number } = {},
  ): Promise<TwilioMessage[]> {
    const r = await this.get<{ messages?: unknown[] }>("/Messages", {
      From: params.from,
      To: params.to,
      PageSize: params.pageSize ?? 50,
    });
    return (r.messages ?? []).map(decodeMessage);
  }

  async listRecordings(callSid?: string): Promise<TwilioRecording[]> {
    const r = await this.get<{ recordings?: unknown[] }>("/Recordings", {
      CallSid: callSid,
      PageSize: 50,
    });
    return (r.recordings ?? []).map(decodeRecording);
  }

  async listTranscriptions(): Promise<TwilioTranscription[]> {
    const r = await this.get<{ transcriptions?: unknown[] }>(
      "/Transcriptions",
      {
        PageSize: 50,
      },
    );
    return (r.transcriptions ?? []).map(decodeTranscription);
  }

  /** Resolve full media URL for a recording (raw audio). */
  async recordingMediaUrl(
    recordingSid: string,
    format: "wav" | "mp3" = "mp3",
  ): Promise<string> {
    const a = await this.opts.auth();
    return `${this.base()}/Accounts/${a.accountSid}/Recordings/${recordingSid}.${format}`;
  }
}

function asStr(v: unknown): string {
  return typeof v === "string" ? v : String(v ?? "");
}
/** Returns a 1-entry object spread or empty object, so exactOptionalPropertyTypes is satisfied. */
function opt<K extends string>(key: K, v: unknown): { [P in K]?: string } {
  if (v == null) return {};
  return { [key]: String(v) } as { [P in K]?: string };
}
function optNum<K extends string>(key: K, v: unknown): { [P in K]?: number } {
  if (typeof v !== "number") return {};
  return { [key]: v } as { [P in K]?: number };
}

function decodeCall(c: unknown): TwilioCall {
  const r = c as Record<string, unknown>;
  return {
    sid: asStr(r.sid),
    from: asStr(r.from),
    to: asStr(r.to),
    status: asStr(r.status),
    direction: asStr(r.direction),
    ...opt("duration", r.duration),
    ...opt("startTime", r.start_time),
    ...opt("endTime", r.end_time),
  };
}
function decodeMessage(c: unknown): TwilioMessage {
  const m = c as Record<string, unknown>;
  return {
    sid: asStr(m.sid),
    from: asStr(m.from),
    to: asStr(m.to),
    body: asStr(m.body),
    status: asStr(m.status),
    direction: asStr(m.direction),
    ...opt("dateCreated", m.date_created),
    ...opt("dateSent", m.date_sent),
  };
}
function decodeRecording(c: unknown): TwilioRecording {
  const r = c as Record<string, unknown>;
  return {
    sid: asStr(r.sid),
    ...opt("callSid", r.call_sid),
    ...opt("duration", r.duration),
    ...optNum("channels", r.channels),
    ...opt("status", r.status),
    ...opt("uri", r.uri),
    ...opt("mediaUrl", r.media_url),
    ...opt("dateCreated", r.date_created),
  };
}
function decodeTranscription(c: unknown): TwilioTranscription {
  const t = c as Record<string, unknown>;
  return {
    sid: asStr(t.sid),
    ...opt("recordingSid", t.recording_sid),
    ...opt("transcriptionText", t.transcription_text),
    ...opt("status", t.status),
    ...opt("price", t.price),
    ...opt("dateCreated", t.date_created),
  };
}
