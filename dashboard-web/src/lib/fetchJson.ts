/**
 * fetch + JSON parse with `cache: 'no-store'`.
 *
 * Why `no-store`: the dashboard's data used to get "stuck" on mobile (and
 * occasionally desktop) — no amount of pull-to-refresh updated the numbers;
 * only fully closing/reopening the tab (or Cmd+Shift+R) helped. Root cause:
 * the plain `fetch(url)` used the browser's default cache mode, so mobile
 * browsers (whose JS is frozen while backgrounded, making SWR's
 * revalidateOnFocus unreliable) kept serving an old cached response. `no-store`
 * forces every request to the network from the BROWSER's perspective only — it
 * does NOT add cache-busting request headers, so the Vercel CDN still serves
 * its ≤s-maxage-fresh copy. Net effect: the user always sees data that's at
 * most ~60s old, with no extra origin load.
 *
 * Throws `Error(body.error)` when the JSON error body carries one, else a
 * generic `Failed to load (<status>)`.
 */
export async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.error || `Failed to load (${res.status})`);
  }
  return res.json() as Promise<T>;
}

/**
 * Soft sibling of {@link fetchJson} for SWR fetchers that prefer a `null`
 * datum over a thrown error (the "stay rendered, just show no data" path).
 * Consolidates the four identical inline
 * `(url) => fetch(url, { cache: 'no-store' }).then(r => r.ok ? r.json() : null)`
 * fetchers (AiReportButton, SyncIndicator, CommandPalette, InsightsBoard).
 *
 * Returns the parsed body on 2xx; `null` on any non-2xx OR on a thrown
 * network error. Same `no-store` browser-cache semantics as `fetchJson`.
 */
export async function fetchJsonOrNull<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
