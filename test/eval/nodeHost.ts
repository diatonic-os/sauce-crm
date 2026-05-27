// Node implementation of the SauceBot ProviderHost — lets the real provider
// classes run outside Obsidian (against real endpoints) for evals. Uses Node 24
// global fetch; fetchStream yields decoded UTF-8 chunks from the response body
// so the providers' SSE/NDJSON parsers exercise their true streaming path.

import type { ProviderHost } from "../../src/saucebot/ISauceBotProvider";

function headerRecord(h: Headers): Record<string, string> {
  const out: Record<string, string> = {};
  h.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

export function makeNodeHost(): ProviderHost {
  return {
    async fetch(url, init) {
      const resp = await fetch(url, {
        method: init.method,
        headers: init.headers,
        ...(init.body !== undefined ? { body: init.body } : {}),
      });
      const body = await resp.text();
      return { status: resp.status, headers: headerRecord(resp.headers), body };
    },
    async fetchStream(url, init) {
      const resp = await fetch(url, {
        method: init.method,
        headers: init.headers,
        ...(init.body !== undefined ? { body: init.body } : {}),
      });
      const status = resp.status;
      const headers = headerRecord(resp.headers);
      const reader = resp.body?.getReader();
      const iter: AsyncIterable<string> = {
        async *[Symbol.asyncIterator]() {
          if (!reader) {
            // No stream (e.g. error before body) — surface the buffered text.
            yield await resp.text();
            return;
          }
          const dec = new TextDecoder();
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) yield dec.decode(value, { stream: true });
          }
          const tail = dec.decode();
          if (tail) yield tail;
        },
      };
      return { status, headers, iter };
    },
  };
}
