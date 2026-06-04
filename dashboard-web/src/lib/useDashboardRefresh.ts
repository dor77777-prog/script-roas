'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useSWRConfig } from 'swr';

/**
 * Phase 05.7.6 — Global "refresh entire dashboard" hook.
 *
 * What it does on trigger:
 *   1. POST /api/operator/sync-now with `{scope:'all'}` to fire 3 Inngest
 *      events (one per store). The eventSyncNow worker runs the full
 *      cronDaily handler for each store + today's date — Shopify + Meta +
 *      Google + Overrides + per-table writes.
 *   2. Set `isRefreshing = true` so consumers (TabHeader) can show a spinner
 *      on the refresh button + a temporary "מתעדכן..." chip on every tab.
 *   3. Poll /api/data every 5 seconds (cache-busted) checking if
 *      `dataLastWriteAt` has advanced past the moment of trigger. When it
 *      has, the backend is done writing.
 *   4. Call SWR `mutate()` on EVERY in-flight /api/* key so each tab
 *      re-fetches from the bumped DB.
 *   5. Set `isRefreshing = false`.
 *
 * Maximum wait: 90 seconds (the worker's per-store budget × 3 stores +
 * generous network buffer). On timeout: still mutate + set isRefreshing
 * false, but show a console warn so the operator knows the watchdog fired.
 *
 * Idempotent — multiple concurrent triggers collapse to one (subsequent
 * triggers are no-ops while `isRefreshing` is true).
 */

const POLL_INTERVAL_MS = 5_000;
// Phase E1.5 (2026-05-30) — Refresh All now runs runDailyForStore for
// 3 dates per store (today + yesterday + day-before) instead of just
// today. Bump watchdog so the operator doesn't see a false
// "didn't advance" warning on the longer runs.
const MAX_WAIT_MS = 180_000;

type RefreshState = {
  isRefreshing: boolean;
  refresh: () => Promise<void>;
};

export function useDashboardRefresh(): RefreshState {
  const { mutate } = useSWRConfig();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const inFlight = useRef(false);
  // Audit fix 2026-05-23 (d/MD-04): track the active AbortController so the
  // unmount cleanup can cancel any in-flight fetch. Without this, a refresh
  // started right before navigation/unmount would still run its poll loop +
  // mutate(), then setState on an unmounted hook owner — at best a console
  // warning, at worst a state-update on an unmounted tree leaking work.
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsRefreshing(true);
    const triggerTime = Date.now();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    try {
      // 1. Fire sync-now for all 3 stores
      const res = await fetch('/api/operator/sync-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'all' }),
        signal,
      });
      if (!res.ok && res.status !== 202) {
        console.warn(`useDashboardRefresh: sync-now returned ${res.status}`);
      }

      // 2. Poll /api/data for the writer to advance dataLastWriteAt past
      //    triggerTime. Use a cache-busting query so SWR doesn't return a
      //    stale response.
      //
      // Audit fix 2026-05-23 (d/CR-03): the cache-bust string was computed
      // ONCE before the loop, so every poll iteration reused the same
      // `_t=...` value. Any CDN/proxy that keyed on the full URL would
      // happily return the cached probe response across the entire 90s
      // window, defeating the cache bust. Compute Date.now() inside the
      // iteration so each fetch is a unique URL.
      const startedPolling = Date.now();
      let backendDone = false;
      while (Date.now() - startedPolling < MAX_WAIT_MS) {
        if (signal.aborted) break;
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        if (signal.aborted) break;
        try {
          const probe = await fetch(`/api/data?_t=${Date.now()}`, {
            cache: 'no-store',
            signal,
          });
          if (probe.ok) {
            const json = (await probe.json()) as {
              dataLastWriteAt?: string | null;
            };
            const writeTs = json.dataLastWriteAt
              ? Date.parse(json.dataLastWriteAt)
              : NaN;
            if (Number.isFinite(writeTs) && writeTs >= triggerTime) {
              backendDone = true;
              break;
            }
          }
        } catch (e) {
          // Aborted? Bail entirely — the consumer is gone.
          if (signal.aborted) break;
          // Network blip — keep polling, the next tick will probably succeed.
          void e;
        }
      }
      if (signal.aborted) return;
      if (!backendDone) {
        console.warn(
          `useDashboardRefresh: backend did not advance dataLastWriteAt within ${MAX_WAIT_MS}ms — mutating anyway`,
        );
      }

      // 3. Revalidate every SWR cache entry so each tab re-fetches fresh data.
      //    Single-arg mutate (predicate only) = background revalidate that KEEPS
      //    the previous data on screen — no undefined blip, so the operator's
      //    current view / scroll / open panels survive the refresh (2026-06-05).
      if (!signal.aborted) {
        await mutate(() => true);
      }
    } catch (e) {
      // sync-now POST itself can throw on abort — that's expected during
      // unmount, no need to surface it.
      if (!signal.aborted) {
        console.warn('useDashboardRefresh: refresh failed', e);
      }
    } finally {
      setIsRefreshing(false);
      inFlight.current = false;
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }
  }, [mutate]);

  // Defensive: if the component holding this hook unmounts mid-refresh,
  // we'd leave inFlight=true forever. Reset on unmount so a remount can
  // trigger again. Also abort any in-flight fetch (d/MD-04) so the orphaned
  // network request doesn't keep running on a torn-down consumer.
  useEffect(() => {
    return () => {
      if (abortRef.current) {
        abortRef.current.abort();
        abortRef.current = null;
      }
      inFlight.current = false;
    };
  }, []);

  return { isRefreshing, refresh };
}
