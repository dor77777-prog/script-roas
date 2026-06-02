'use client';

import { useEffect, useRef } from 'react';

/**
 * Silently re-runs `onRefresh` on a fixed interval AND whenever the page
 * becomes visible again (return-to-tab on desktop, reopen on mobile).
 *
 * Why this exists: SWR's built-in `revalidateOnFocus` is unreliable on mobile
 * — when the browser is backgrounded its JS is frozen, so the focus/visibility
 * revalidation often never fires and the user sees stale numbers until they
 * fully close and reopen the tab. This hook adds an explicit
 * `visibilitychange` listener (fires reliably on reopen) plus a steady
 * interval, and calls a caller-supplied revalidate function (e.g. SWR's global
 * `mutate(() => true, undefined, { revalidate: true })`). It performs NO page
 * reload — numbers update in place, so filters / scroll / open panels are kept.
 *
 * Pair it with `cache: 'no-store'` fetchers (see lib/fetchJson.ts) so the
 * revalidation actually reaches the network instead of the browser HTTP cache.
 *
 * @param onRefresh  invoked on each tick and on each return-to-visible
 * @param opts.intervalMs  refresh cadence in ms (default 10 minutes)
 */
export function useAutoRefresh(
  onRefresh: () => void,
  opts?: { intervalMs?: number },
): void {
  const intervalMs = opts?.intervalMs ?? 600_000; // 10 minutes
  // Keep the latest callback in a ref so changing it doesn't tear down and
  // re-create the interval/listener on every render.
  const cb = useRef(onRefresh);
  cb.current = onRefresh;

  useEffect(() => {
    const id = setInterval(() => cb.current(), intervalMs);
    const onVisible = () => {
      if (document.visibilityState === 'visible') cb.current();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [intervalMs]);
}
