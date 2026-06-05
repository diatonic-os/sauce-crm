// Shared chunk-stream parsers for the copilot providers.
//
// `chunks` is an AsyncIterable<string> coming from ProviderHost.fetchStream.
// Each yielded chunk is an arbitrary slice of the response body — boundaries
// do NOT line up with SSE events or NDJSON lines. These helpers handle the
// reassembly so each provider just consumes typed records.

/**
 * Parse SSE (Server-Sent Events) framing. Yields the `data:` payload of every
 * complete event. Lines starting with `event:` are emitted as { event, data }
 * so providers that care (Anthropic) can branch on them. Stops on `data: [DONE]`.
 */
export async function* parseSse(
  chunks: AsyncIterable<string>,
): AsyncIterable<{ event?: string; data: string }> {
  let buffer = "";
  let currentEvent: string | undefined;
  let currentData: string[] = [];
  for await (const chunk of chunks) {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const rawLine = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      // Strip trailing \r (CRLF)
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      if (line === "") {
        // Blank line = event boundary
        if (currentData.length > 0) {
          const data = currentData.join("\n");
          if (data === "[DONE]") return;
          yield {
            ...(currentEvent !== undefined ? { event: currentEvent } : {}),
            data,
          };
        }
        currentEvent = undefined;
        currentData = [];
        continue;
      }
      if (line.startsWith(":")) continue; // comment / keepalive
      if (line.startsWith("event:")) {
        currentEvent = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        currentData.push(line.slice(5).trimStart());
      }
      // other SSE fields (id:, retry:) ignored
    }
  }
  // Flush a final event if the stream ended without a trailing blank line
  if (currentData.length > 0) {
    const data = currentData.join("\n");
    if (data !== "[DONE]")
      yield {
        ...(currentEvent !== undefined ? { event: currentEvent } : {}),
        data,
      };
  }
}

/**
 * Parse NDJSON (newline-delimited JSON) — one JSON object per line. Used by
 * Ollama's /api/chat streaming endpoint. Yields the raw line strings; the
 * provider is responsible for JSON.parse so it can shape per-payload typing.
 */
export async function* parseNdjson(
  chunks: AsyncIterable<string>,
): AsyncIterable<string> {
  let buffer = "";
  for await (const chunk of chunks) {
    buffer += chunk;
    let nl: number;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) yield line;
    }
  }
  const tail = buffer.trim();
  if (tail) yield tail;
}
