// dashboard-web/src/lib/fetchers/withBackoff.ts
//
// Phase 13.4 — wraps fetch() with HTTP 429 / Retry-After handling.
// Provider-agnostic; each fetcher tags its provider for log clarity.
//
// Semantics:
//   - 2xx / 3xx / non-429 4xx / 5xx → returned immediately, caller handles.
//   - 429 → honor Retry-After (numeric seconds OR HTTP-date, capped at 60s).
//     If header absent, exponential 1s/2s/4s capped at 30s.
//   - After maxRetries attempts, returns the last 429 unchanged so the
//     caller's normal error path executes (no special error type).

export type BackoffOpts = {
  provider: 'meta' | 'google' | 'tiktok' | 'shopify' | 'fx' | 'unknown';
  maxRetries?: number;
};

export async function fetchWithBackoff(
  url: string,
  init: RequestInit = {},
  opts: BackoffOpts = { provider: 'unknown' },
): Promise<Response> {
  const max = opts.maxRetries ?? 3;
  for (let attempt = 0; attempt <= max; attempt++) {
    const r = await fetch(url, init);
    if (r.status !== 429) return r;
    if (attempt === max) return r;
    const delayMs = parseRetryAfter(r.headers.get('Retry-After'), attempt);
    console.warn(
      `fetchWithBackoff[${opts.provider}]: 429 from ${url.split('?')[0]}; retrying in ${delayMs}ms (attempt ${attempt + 1}/${max})`,
    );
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }
  // Unreachable per the loop guard above; satisfies TS narrowing.
  return new Response('exhausted', { status: 429 });
}

function parseRetryAfter(header: string | null, attempt: number): number {
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds)) {
      return Math.min(60_000, Math.max(0, seconds * 1000));
    }
    const date = new Date(header).getTime();
    if (Number.isFinite(date)) {
      return Math.max(0, Math.min(60_000, date - Date.now()));
    }
  }
  return Math.min(30_000, 1000 * Math.pow(2, attempt));
}
