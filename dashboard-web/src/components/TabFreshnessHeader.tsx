'use client';

import { RefreshCw } from 'lucide-react';
import { FreshnessChip } from './FreshnessChip';
import { useDashboardRefresh } from '@/lib/useDashboardRefresh';

/**
 * Phase 05.7.6 — Per-tab freshness header.
 *
 * Drops into the top of any tab section to show:
 *   - When the underlying data was last written by a cron (FreshnessChip)
 *   - A "Refresh now" button that triggers a FULL dashboard refresh via
 *     useDashboardRefresh (fires sync-now for all 3 stores, polls until
 *     dataLastWriteAt advances, then SWR-mutates every cache key)
 *
 * UX during refresh:
 *   - Spinner on the refresh button
 *   - Toast banner above the chip: "מרענן את כל הדשבורד... ייקח 30-60 שניות"
 *   - Button disabled to prevent double-trigger
 *
 * The hook is SHARED across all tab instances on the page via SWR's
 * mutate signal, so clicking refresh in one tab refreshes all tabs.
 */
export function TabFreshnessHeader(props: {
  dataLastWriteAt: string | null;
}) {
  const { dataLastWriteAt } = props;
  const { isRefreshing, refresh } = useDashboardRefresh();

  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <div className="flex items-center gap-2 flex-wrap">
        <FreshnessChip dataLastWriteAt={dataLastWriteAt} />
        {isRefreshing && (
          <span
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md ring-1 ring-amber-300/40 bg-amber-500/15 text-amber-200 text-[11px] sm:text-xs"
            role="status"
          >
            <RefreshCw size={11} className="animate-spin" />
            <span>מרענן את כל הדשבורד... ייקח 30-60 שניות</span>
          </span>
        )}
      </div>
      <button
        type="button"
        onClick={refresh}
        disabled={isRefreshing}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface hover:bg-surfaceMuted disabled:opacity-50 disabled:cursor-not-allowed px-2.5 py-1.5 text-xs sm:text-sm text-text-secondary transition-colors"
        title="מרענן את כל הנתונים בדשבורד מ-Shopify, Meta, Google. לוקח 30-60 שניות."
        aria-label="רענן את כל הדשבורד"
      >
        <RefreshCw
          size={13}
          className={isRefreshing ? 'animate-spin' : ''}
        />
        <span>{isRefreshing ? 'מרענן...' : 'רענן הכל'}</span>
      </button>
    </div>
  );
}
