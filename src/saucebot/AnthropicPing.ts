// Live Anthropic auth ping. The model catalog is STATIC for Anthropic (no public
// /models endpoint), so saving a key can't tell a good key from a typo. This
// does a minimal /v1/messages call (max_tokens:1) and reads the HTTP status to
// decide auth health — the definitive "healthy key" check the catalog can't give.

export interface PingResult {
  ok: boolean;
  error?: string;
}

/**
 * Map an Anthropic HTTP status to auth health. 200 = authed; 400 = the request
 * got PAST auth (bad request body, but the key is valid); 429 = rate-limited but
 * valid; 401/403 = invalid/forbidden key; anything else = reachable-but-error.
 */
export function interpretAnthropicStatus(status: number): PingResult {
  if (status === 200 || status === 400 || status === 429) return { ok: true };
  if (status === 401 || status === 403)
    return { ok: false, error: "Invalid API key (Anthropic rejected it)." };
  return { ok: false, error: `Anthropic returned HTTP ${status}.` };
}

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ status: number }>;

/**
 * Validate an Anthropic key with a 1-token Messages call. `fetchImpl` should be
 * the plugin's requestUrl-backed fetch (CORS-bypassing). Never throws — a
 * transport failure resolves to ok:false with the message.
 */
export async function pingAnthropic(
  apiKey: string,
  fetchImpl: FetchLike,
): Promise<PingResult> {
  if (!apiKey) return { ok: false, error: "No API key provided." };
  try {
    const res = await fetchImpl("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    return interpretAnthropicStatus(res.status);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
