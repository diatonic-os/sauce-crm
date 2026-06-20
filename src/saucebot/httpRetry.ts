// Retry-with-backoff for rate-limited / transiently-failed HTTP calls. Extracted
// so the retry policy is unit-testable in isolation (the embed path composes it).
// Matters most for the OpenAI embedding default, where a full-vault resync can
// burst many requests and trip 429s (EMB-3).

/** Statuses worth retrying: 429 (rate limit) + 5xx (transient server errors).
 *  4xx other than 429 are caller/config errors and must NOT be retried. */
export function isRetriableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Backoff delay for a 0-based attempt index. Honors a server `Retry-After`
 * header (seconds, or an HTTP-date) when present and sane; otherwise exponential
 * (base · 2^attempt) capped at `maxMs`. A small deterministic jitter (derived
 * from the attempt, not Math.random — which is unavailable here) avoids
 * thundering-herd alignment across concurrent callers.
 */
export function backoffMs(
  attempt: number,
  retryAfter?: string,
  base = 500,
  maxMs = 20_000,
  nowMs?: number,
): number {
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs) && secs >= 0) return Math.min(secs * 1000, maxMs);
    const when = Date.parse(retryAfter);
    if (!Number.isNaN(when) && nowMs != null) {
      return Math.min(Math.max(0, when - nowMs), maxMs);
    }
  }
  const exp = Math.min(base * 2 ** attempt, maxMs);
  const jitter = (attempt * 137) % 250; // deterministic 0–249ms spread
  return Math.min(exp + jitter, maxMs);
}

export interface RetryResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface WithRetryOpts {
  /** Max RETRIES after the initial attempt (so total attempts = maxRetries+1). */
  maxRetries?: number;
  base?: number;
  maxMs?: number;
  /** Injected for tests; defaults to a real timer sleep. */
  sleep?: (ms: number) => Promise<void>;
  /** Injected for Retry-After HTTP-date math; defaults to wall clock. */
  now?: () => number;
}

const realSleep = (ms: number): Promise<void> =>
  new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn` (an HTTP call returning a status), retrying on retriable statuses
 * with backoff. Returns the final response (retriable or not) once retries are
 * exhausted; never throws on a retriable status — the caller inspects `.status`.
 */
export async function withRetry(
  fn: () => Promise<RetryResponse>,
  opts: WithRetryOpts = {},
): Promise<RetryResponse> {
  const maxRetries = opts.maxRetries ?? 4;
  const sleep = opts.sleep ?? realSleep;
  const now = opts.now ?? (() => 0);
  let last: RetryResponse | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    last = await fn();
    if (!isRetriableStatus(last.status) || attempt === maxRetries) return last;
    await sleep(
      backoffMs(attempt, last.headers["retry-after"], opts.base, opts.maxMs, now()),
    );
  }
  // Unreachable (loop always returns), but satisfies the type checker.
  return last as RetryResponse;
}
