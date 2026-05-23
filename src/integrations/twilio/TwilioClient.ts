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
    const r = await this.get<{ calls?: any[] }>("/Calls", {
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
    const r = await this.get<{ messages?: any[] }>("/Messages", {
      From: params.from,
      To: params.to,
      PageSize: params.pageSize ?? 50,
    });
    return (r.messages ?? []).map(decodeMessage);
  }

  async listRecordings(callSid?: string): Promise<TwilioRecording[]> {
    const r = await this.get<{ recordings?: any[] }>("/Recordings", {
      CallSid: callSid,
      PageSize: 50,
    });
    return (r.recordings ?? []).map(decodeRecording);
  }

  async listTranscriptions(): Promise<TwilioTranscription[]> {
    const r = await this.get<{ transcriptions?: any[] }>("/Transcriptions", {
      PageSize: 50,
    });
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

function decodeCall(c: any): TwilioCall {
  return {
    sid: c.sid,
    from: c.from,
    to: c.to,
    status: c.status,
    direction: c.direction,
    duration: c.duration,
    startTime: c.start_time,
    endTime: c.end_time,
  };
}
function decodeMessage(m: any): TwilioMessage {
  return {
    sid: m.sid,
    from: m.from,
    to: m.to,
    body: m.body,
    status: m.status,
    direction: m.direction,
    dateCreated: m.date_created,
    dateSent: m.date_sent,
  };
}
function decodeRecording(r: any): TwilioRecording {
  return {
    sid: r.sid,
    callSid: r.call_sid,
    duration: r.duration,
    channels: r.channels,
    status: r.status,
    uri: r.uri,
    mediaUrl: r.media_url,
    dateCreated: r.date_created,
  };
}
function decodeTranscription(t: any): TwilioTranscription {
  return {
    sid: t.sid,
    recordingSid: t.recording_sid,
    transcriptionText: t.transcription_text,
    status: t.status,
    price: t.price,
    dateCreated: t.date_created,
  };
}
