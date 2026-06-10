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
import { runDailyForStore, type StoreId, type RunDailyStep } from './cronDaily';
// Self-serve stores Phase 4b (Task 8) — scheduler→worker fold imports.
import { loadActiveStoreIds } from '@/lib/getStores';
import { planStoreJobs } from '@/lib/inngest/planStoreJobs';

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

// ===========================================================================
// Self-serve stores Phase 4b (Task 8) — scheduler→worker FOLD.
//
// The per-store factory above (`makeCronYesterdayRefresh` +
// `cronYesterdayRefreshFunctions`) is KEPT on disk as a revert lever. The pair
// below replaces it once T9 registers them in serve(); until then these
// functions are INERT.
//
// Shape: ONE static-trigger scheduler runs every 2h on even hours (the same
// cadence the factory's CRON_STAGGER used) and emits one
// `cron/yesterday.store.requested` event per active store carrying yesterday's
// IL date; ONE event-driven worker (concurrency-keyed by store) calls the
// unchanged `runDailyForStore` handler.
//
// ANTI-THUNDERING-HERD STAGGER: the factory achieved spacing with N distinct
// cron strings (5-min offsets per store) so the 3 stores never hit Meta's
// shared rate limit simultaneously. With one scheduler we can no longer offset
// the cron per store, so we reproduce the spacing INSIDE the run: store i is
// emitted after `step.sleep('stagger-{i}', '{i*5}m')` — i.e. store 0 fires
// immediately, store 1 at +5m, store 2 at +10m, etc. Each event is sent in its
// own `step.sendEvent` at the OUTER function level (NEVER inside step.run). The
// store-list load + plan build is the only step.run; the sleeps and emits are
// outer.
//
// Trade-off vs the factory: a single scheduler invocation now spans the whole
// stagger window (≈ (N-1)*5 min) instead of N independent cron fires. Inngest
// step.sleep is durable (the function suspends, not a wall-clock block), so
// this consumes no execution budget during the sleep and never approaches the
// per-step wall-clock limit.
// ===========================================================================

const YESTERDAY_REFRESH_SCHEDULER_CRON =
  'TZ=Asia/Jerusalem 15 0,2,4,6,8,10,12,14,16,18,20,22 * * *';

/** Per-store stagger increment (minutes) — mirrors the factory's 5-min offsets. */
const STAGGER_MINUTES = 5;

export const cronYesterdayRefreshScheduler = inngest.createFunction(
  {
    id: 'cron-yesterday-refresh-scheduler',
    triggers: [{ cron: YESTERDAY_REFRESH_SCHEDULER_CRON }],
  },
  async ({ step }) => {
    const jobs = await step.run('load-stores', async () => {
      const stores = await loadActiveStoreIds();
      // P0-2 (2026-06-10): hour-bucket tickId so each of the 12 daily fires
      // emits a UNIQUE event id. Pre-fix the id was date-only → Inngest's 24h
      // event-id idempotency deduped fires 2-12 and the every-2h cadence was
      // completely inert (yesterday reconciled once, at 00:15, right after
      // cron-daily had already done the same date). Computed INSIDE step.run
      // so retries of the same scheduler run reuse the memoized ids.
      const hourBucket = 'h' + new Date().toISOString().slice(11, 13);
      return planStoreJobs(stores, {
        family: 'yesterday',
        date: yesterdayJerusalem(),
        tickId: hourBucket,
      });
    });

    // Emit one event per store, staggered. step.sleep + step.sendEvent are both
    // outer-level (never nested in step.run). i=0 sleeps '0m' (effectively a
    // no-op durable checkpoint) to keep the loop uniform; Inngest treats a
    // 0-duration sleep as an immediate resume.
    for (let i = 0; i < jobs.length; i++) {
      if (i > 0) {
        await step.sleep(`stagger-${i}`, `${i * STAGGER_MINUTES}m`);
      }
      const j = jobs[i];
      await step.sendEvent(`fan-out-yesterday-${i}`, [
        { name: j.eventName, id: j.id, data: j.data },
      ]);
    }

    return { enqueued: jobs.length };
  },
);

/**
 * Pure worker core — exported so vitest can assert the worker threads
 * `event.data` into the handler. The Inngest binding passes the real
 * `runDailyForStore` (imported cross-module from cronDaily); tests pass a
 * `vi.fn()`. `runDailyForStore` itself is UNCHANGED. Mirrors the daily/live
 * worker cores so all three families share one testable shape.
 */
export async function runCronYesterdayRefreshWorker(
  event: { data: { storeId: string; date?: string } },
  step: RunDailyStep,
  handler: typeof runDailyForStore = runDailyForStore,
): ReturnType<typeof runDailyForStore> {
  // Untyped event payload (no EventSchemas) — cast at the boundary. yesterday
  // family emits `{ storeId, date }`.
  return handler(event.data.storeId as StoreId, event.data.date as string, { step });
}

export const cronYesterdayRefreshWorker = inngest.createFunction(
  {
    id: 'cron-yesterday-refresh-worker',
    triggers: [{ event: 'cron/yesterday.store.requested' }],
    // Concurrency key matches the planStoreJobs payload field (`data.storeId`).
    concurrency: [{ key: 'event.data.storeId', limit: 1 }],
    retries: 1,
  },
  // The `step` cast narrows Inngest's full API to the `RunDailyStep` subset
  // runDailyForStore consumes.
  async ({ event, step }) =>
    runCronYesterdayRefreshWorker(
      event as unknown as { data: { storeId: string; date?: string } },
      step as unknown as RunDailyStep,
    ),
);
