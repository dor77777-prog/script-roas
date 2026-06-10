// dashboard-web/src/lib/inngest/planStoreJobs.ts
//
// Self-serve stores Phase 4b, Task 7 — the PURE oracle for the
// scheduler→worker cron fold.
//
// TODAY: three per-store factory crons each register one Inngest function per
// store (`STORES.map(makeFn)`), each running exactly one store's job:
//   - cronDaily            → id `cron-daily-{store}`,            runDailyForStore(store, yesterday, ctx)
//   - cronYesterdayRefresh → id `cron-yesterday-refresh-{store}`, runDailyForStore(store, yesterday, ctx)
//   - cronLive             → id `cron-live-{store}`,             runLiveForStore(store, ctx)  (no date)
//
// FOLD (T8/T9, NOT this task): a single scheduler per family loads the store
// list at runtime and emits one event per store, consumed by one worker. This
// module is the deterministic SOURCE OF TRUTH for "which per-store jobs would
// the old factory have run" — so a same-fan-out guard can assert the new
// scheduler emits exactly this set (one event per store, right event name,
// right payload, collision-free id).
//
// PURITY (load-bearing — this is the test oracle): no Inngest SDK import, no
// side effects, no Date.now() / new Date(). All time inputs (date / tickId)
// are passed in by the caller so the same inputs always produce the same
// output. The daily/yesterday families carry yesterday's IL date; the live
// family takes no date (matching runLiveForStore) and uses an optional
// caller-supplied tick id (10-min bucket, cf. registries/snapshots.tickIdForNow)
// purely as an id discriminator across the every-10-min cadence.

export type CronFamily = 'daily' | 'live' | 'yesterday';

export interface StoreJob {
  /** The single store this job operates on (one job === one store). */
  storeId: string;
  /** The fan-out event the scheduler emits; the worker subscribes to it. */
  eventName: string;
  /**
   * Event payload. Carries `date` for daily/yesterday (passed straight to
   * runDailyForStore); live omits it (runLiveForStore takes no date — its
   * rolling window is internal).
   */
  data: { storeId: string; date?: string };
  /**
   * Deterministic, collision-free per-(family, store, date|tick) id. Used as
   * the Inngest event id so retries dedupe and so the fold's per-store jobs
   * map 1:1 to the old factory's per-store functions.
   */
  id: string;
}

/**
 * The fan-out event name per family. One worker subscribes to each; the
 * scheduler emits one event per store.
 */
const EVENT_NAME: Record<CronFamily, string> = {
  daily: 'cron/daily.store.requested',
  live: 'cron/live.store.requested',
  yesterday: 'cron/yesterday.store.requested',
};

export interface PlanStoreJobsOptions {
  family: CronFamily;
  /**
   * Yesterday's IL date ('YYYY-MM-DD') for daily/yesterday. Optional for live
   * (runLiveForStore takes no date); when provided for live it is treated as a
   * tick discriminator only (see `tickId`) — never written into the payload.
   */
  date?: string;
  /**
   * Per-fire id discriminator (e.g. registries/snapshots.tickIdForNow's
   * 10-min bucket for live, or an hour bucket for yesterday). Keeps event ids
   * collision-free across repeated fires without the oracle ever reading the
   * clock.
   *
   * 2026-06-10 (P0-2 fix): COMBINED with `date` when both are present —
   * previously `date` alone won, so the yesterday family (12 fires/day, all
   * carrying the same date) emitted IDENTICAL event ids and Inngest's 24h
   * event-id idempotency silently swallowed fires 2-12, making the every-2h
   * cadence inert (yesterday reconciled once, at 00:15). Never payload.
   */
  tickId?: string;
}

/**
 * Compute the exact set of per-store jobs the scheduler→worker fold must emit
 * for one family on one run. PURE: deterministic for given inputs, no side
 * effects, no clock access.
 *
 * Invariant (the thing the fold guard asserts): exactly one job per store, in
 * input order, so `planStoreJobs(stores, …).length === stores.length`.
 */
export function planStoreJobs(stores: string[], opts: PlanStoreJobsOptions): StoreJob[] {
  const eventName = EVENT_NAME[opts.family];
  return stores.map((storeId) => {
    // Payload mirrors the factory handler args: daily/yesterday → (store, date);
    // live → (store) only. `tickId` is an id discriminator, never payload.
    const data: { storeId: string; date?: string } = opts.date
      ? { storeId, date: opts.date }
      : { storeId };

    // Id discriminator: date and tickId COMBINE when both are present (P0-2,
    // 2026-06-10) — the yesterday family fires 12×/day with the same date, so
    // date-only ids were deduped by Inngest's 24h event-id idempotency and
    // fires 2-12 never invoked the worker. daily (date only, one fire/day)
    // and live (tickId only) are unchanged by the combine.
    const discriminator = [opts.date, opts.tickId].filter(Boolean).join('-');
    const id = discriminator
      ? `cron-${opts.family}-${storeId}-${discriminator}`
      : `cron-${opts.family}-${storeId}`;

    return { storeId, eventName, data, id };
  });
}
