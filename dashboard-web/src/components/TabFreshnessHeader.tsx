'use client';

import { RefreshCw } from 'lucide-react';
import { FreshnessChip } from './FreshnessChip';
import { useDashboardRefresh } from '@/lib/useDashboardRefresh';
import { useStores } from '@/lib/useStores';
import { Button } from '@/components/ui/Button';
import { HelpTooltip } from '@/components/ui/Tooltip';

/**
 * ONE refresh-duration string for the confirm dialog, the in-progress toast
 * and the button tooltip (copy-truth, 2026-06-10 audit P1-26 — they used to
 * disagree: 60-120 vs 30-60 vs 30-60). The honest figure: the poll loop
 * checks every 5s with a 180s watchdog; a full 3-day × all-platform sync
 * typically commits in 1-2 minutes.
 */
const REFRESH_DURATION_TEXT = '60-120 שניות';

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
 *   - Confirm() dialog before triggering — surfaces the cost (30-60s wait,
 *     fires Inngest sync for ALL 3 stores) so the operator doesn't trigger
 *     it by accident when an auto-refresh would have caught up anyway.
 *     Phase 05.7.9 — added per operator request 2026-05-22.
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
  // Dynamic store count (copy-truth, 2026-06-10 audit P1-26): the literal
  // "3 החנויות" lies the moment a store is added/archived via /operator.
  const { stores } = useStores();
  const storeCount = stores.length;

  const handleRefreshClick = () => {
    // Confirm dialog — the action fires Inngest sync-now for every active
    // store (Shopify + Meta + Google + TikTok), then polls until the writers
    // commit. Takes REFRESH_DURATION_TEXT and burns Inngest quota. The
    // auto-poll catches up most of the time, so we want the operator to
    // consciously opt-in to the heavier path.
    const ok = window.confirm(
      'רענון מלא ירוץ עכשיו?\n\n' +
        `• מרענן את כל הדשבורד מ-Shopify + Meta + Google + TikTok עבור ${storeCount} החנויות.\n` +
        '• מכסה היום + אתמול + שלשום (3 ימים אחורה) — תופס cross-day refunds + עדכוני אטריביושן.\n' +
        `• לוקח ${REFRESH_DURATION_TEXT}. תוכל להמשיך לעבוד; הדשבורד יתעדכן אוטומטית כשיסתיים.\n` +
        '• בדרך כלל אין צורך — קיים רענון אוטומטי כל 10 דקות (היום) + כל שעתיים (אתמול).\n\n' +
        'ללחוץ "אישור" כדי להריץ.',
    );
    if (ok) {
      void refresh();
    }
  };

  return (
    <div className="flex items-center justify-between gap-3 mb-3">
      <div className="flex items-center gap-2 flex-wrap">
        <FreshnessChip dataLastWriteAt={dataLastWriteAt} />
        {isRefreshing && (
          <span
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md ring-1 ring-status-warning bg-status-warningBg text-status-warningFg text-[11px] sm:text-xs"
            role="status"
          >
            <RefreshCw size={11} className="animate-spin" />
            <span>מרענן את כל הדשבורד... ייקח {REFRESH_DURATION_TEXT}</span>
          </span>
        )}
      </div>
      <HelpTooltip content={`מרענן את כל הנתונים בדשבורד מ-Shopify, Meta, Google, TikTok. לוקח ${REFRESH_DURATION_TEXT} (יוצג אישור לפני ההפעלה).`}>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={handleRefreshClick}
          disabled={isRefreshing}
          aria-label="רענן את כל הדשבורד"
        >
          <RefreshCw
            size={13}
            className={isRefreshing ? 'animate-spin' : ''}
          />
          <span>{isRefreshing ? 'מרענן...' : 'רענן הכל'}</span>
        </Button>
      </HelpTooltip>
    </div>
  );
}
