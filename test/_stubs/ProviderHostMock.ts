// Mock ProviderHost — a programmable fetch double that lets tests stage
// canned responses for any URL. Captures requests for assertions.

import type { ProviderHost } from "../../src/saucebot/ISauceBotProvider";

export interface RecordedRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

export interface CannedResponse {
  status: number;
  headers?: Record<string, string>;
  body: string;
}

export interface CannedStreamResponse {
  status: number;
  headers?: Record<string, string>;
  /** Pre-chunked body slices (will be yielded one at a time). */
  chunks: string[];
}

export type Responder = (
  req: RecordedRequest,
) => CannedResponse | Promise<CannedResponse>;
export type StreamResponder = (
  req: RecordedRequest,
) => CannedStreamResponse | Promise<CannedStreamResponse>;

export class ProviderHostMock implements ProviderHost {
  readonly requests: RecordedRequest[] = [];
  private routes = new Map<string, Responder | CannedResponse>();
  private streamRoutes = new Map<
    string,
    StreamResponder | CannedStreamResponse
  >();
  private defaultResponse: CannedResponse = {
    status: 404,
    body: JSON.stringify({ error: "no route registered for URL" }),
  };

  /** Register a canned response for a URL (matched as a substring). */
  route(urlSubstring: string, response: CannedResponse | Responder): this {
    this.routes.set(urlSubstring, response);
    return this;
  }

  /** Register a canned streaming response (chunks). Consumed by fetchStream(). */
  routeStream(
    urlSubstring: string,
    response: CannedStreamResponse | StreamResponder,
  ): this {
    this.streamRoutes.set(urlSubstring, response);
    return this;
  }

  /** Default fallback when no route matches. */
  setDefault(response: CannedResponse): this {
    this.defaultResponse = response;
    return this;
  }

  async fetch(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<{
    status: number;
    headers: Record<string, string>;
    body: string;
  }> {
    const req: RecordedRequest = {
      url,
      method: init.method,
      headers: init.headers,
      body: init.body,
    };
    this.requests.push(req);
    for (const [needle, resp] of this.routes) {
      if (url.includes(needle)) {
        const r = typeof resp === "function" ? await resp(req) : resp;
        return { status: r.status, headers: r.headers ?? {}, body: r.body };
      }
    }
    return {
      status: this.defaultResponse.status,
      headers: this.defaultResponse.headers ?? {},
      body: this.defaultResponse.body,
    };
  }

  async fetchStream(
    url: string,
    init: { method: string; headers: Record<string, string>; body?: string },
  ): Promise<{
    status: number;
    headers: Record<string, string>;
    iter: AsyncIterable<string>;
  }> {
    const req: RecordedRequest = {
      url,
      method: init.method,
      headers: init.headers,
      body: init.body,
    };
    this.requests.push(req);
    for (const [needle, resp] of this.streamRoutes) {
      if (url.includes(needle)) {
        const r = typeof resp === "function" ? await resp(req) : resp;
        const chunks = r.chunks;
        async function* gen(): AsyncIterable<string> {
          for (const c of chunks) yield c;
        }
        return { status: r.status, headers: r.headers ?? {}, iter: gen() };
      }
    }
    async function* empty(): AsyncIterable<string> {
      /* no chunks */
    }
    return { status: this.defaultResponse.status, headers: {}, iter: empty() };
  }

  /** Get the last request matching a URL substring (most recent first). */
  lastRequestTo(needle: string): RecordedRequest | undefined {
    for (let i = this.requests.length - 1; i >= 0; i--) {
      if (this.requests[i].url.includes(needle)) return this.requests[i];
    }
    return undefined;
  }
}
