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
const MAX_WAIT_MS = 90_000;

type RefreshState = {
  isRefreshing: boolean;
  refresh: () => Promise<void>;
};

export function useDashboardRefresh(): RefreshState {
  const { mutate } = useSWRConfig();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const inFlight = useRef(false);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsRefreshing(true);
    const triggerTime = Date.now();

    try {
      // 1. Fire sync-now for all 3 stores
      const res = await fetch('/api/operator/sync-now', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope: 'all' }),
      });
      if (!res.ok && res.status !== 202) {
        console.warn(`useDashboardRefresh: sync-now returned ${res.status}`);
      }

      // 2. Poll /api/data for the writer to advance dataLastWriteAt past
      //    triggerTime. Use a cache-busting query so SWR doesn't return a
      //    stale response.
      const startedPolling = Date.now();
      const cacheBust = `_t=${triggerTime}`;
      let backendDone = false;
      while (Date.now() - startedPolling < MAX_WAIT_MS) {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        try {
          const probe = await fetch(`/api/data?${cacheBust}`, {
            cache: 'no-store',
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
        } catch {
          // Network blip — keep polling, the next tick will probably succeed.
        }
      }
      if (!backendDone) {
        console.warn(
          `useDashboardRefresh: backend did not advance dataLastWriteAt within ${MAX_WAIT_MS}ms — mutating anyway`,
        );
      }

      // 3. Mutate every SWR cache entry so each tab re-fetches fresh data.
      //    The undefined predicate triggers ALL keys.
      await mutate(() => true, undefined, { revalidate: true });
    } finally {
      setIsRefreshing(false);
      inFlight.current = false;
    }
  }, [mutate]);

  // Defensive: if the component holding this hook unmounts mid-refresh,
  // we'd leave inFlight=true forever. Reset on unmount so a remount can
  // trigger again.
  useEffect(() => {
    return () => {
      inFlight.current = false;
    };
  }, []);

  return { isRefreshing, refresh };
}
