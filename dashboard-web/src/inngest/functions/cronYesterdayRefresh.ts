/**
 * Phase E1.5 (2026-05-30) — cron-yesterday-refresh-{store} (× 3 stores).
 *
 * Cadence: every 2 hours in Asia/Jerusalem, staggered per store.
 *
 * Why this exists:
 *   E1 disabled cron-live-heavy. cron-live-heavy used to refresh
 *   [today, yesterday] every 30 min, so yesterday's per-platform spend
 *   + cross-day refunds were rebuilt many times during the day. With it
 *   gone, the only automatic refresh for yesterday is cron-daily at
 *   00:05 — meaning a refund or attribution shift on yesterday's data
 *   that arrives at e.g. 10:00 today wouldn't surface until 00:05
 *   tomorrow (~14h staleness). That gap was unacceptable per operator
 *   feedback 2026-05-30.
 *
 * Fix:
 *   A new lightweight cron family — one Inngest function per store —
 *   runs `runDailyForStore(store, yesterday)` every 2 hours. Same
 *   handler cron-daily uses, just bound to yesterday and a denser
 *   cadence. 12 fires per day per store = 36/day total.
 *
 *   The 2-hour cadence is intentionally less aggressive than
 *   cron-live-heavy's 30-min (which we just removed). Yesterday's
 *   spend doesn't change minute-to-minute — once the platform has
 *   reported it, it only mutates from late attribution + refunds.
 *   2-hour latency is the operator-acceptable midpoint between
 *   "perfect" (30 min, but expensive) and "next day" (00:05 only).
 *
 * Stagger: 5-minute offsets within each 2h cycle so the 3 stores
 * never fire simultaneously and hammer Meta's shared app rate limit.
 *
 * Inngest free-tier budget contribution:
 *   3 stores × 12 fires/day × ~9 step.runs/run = ~324 step.runs/day
 *   ≈ ~10K step.runs/month. Well within the 50K cap, even combined
 *   with the rest of the cron family.
 */

import { inngest } from '@/inngest/client';
import { runDailyForStore, type StoreId } from './cronDaily';

const STORES: readonly StoreId[] = ['uzoshop', 'zolplus', 'usmile360'] as const;

/**
 * Stagger cron strings — 5-min offsets within the 2h cycle so the 3
 * stores never fire at the same minute. All run on EVEN hours (every
 * 2h starting from midnight), interpreted in Asia/Jerusalem.
 */
const CRON_STAGGER: Record<StoreId, string> = {
  uzoshop:   'TZ=Asia/Jerusalem 15 0,2,4,6,8,10,12,14,16,18,20,22 * * *',
  zolplus:   'TZ=Asia/Jerusalem 20 0,2,4,6,8,10,12,14,16,18,20,22 * * *',
  usmile360: 'TZ=Asia/Jerusalem 25 0,2,4,6,8,10,12,14,16,18,20,22 * * *',
};

/**
 * Returns yesterday's calendar day in Asia/Jerusalem as 'YYYY-MM-DD'.
 * Local copy of cronDaily.yesterdayJerusalem to avoid a non-exported
 * import; the formatter is small and self-contained.
 */
function yesterdayJerusalem(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const oneDayMs = 24 * 60 * 60 * 1000;
  return fmt.format(new Date(Date.now() - oneDayMs));
}

function makeCronYesterdayRefresh(storeId: StoreId) {
  return inngest.createFunction(
    {
      id: `cron-yesterday-refresh-${storeId}`,
      triggers: [{ cron: CRON_STAGGER[storeId] }],
      // concurrency=1 per store: prevents a slow tick from racing the
      // next one (also matches cron-daily's implicit single-flight
      // semantics for the same store).
      concurrency: [{ key: 'event.data.storeId', limit: 1 }],
    },
    async ({ step }) => {
      const date = yesterdayJerusalem();
      return runDailyForStore(storeId, date, { step });
    },
  );
}

export const cronYesterdayRefreshFunctions = STORES.map(makeCronYesterdayRefresh);
