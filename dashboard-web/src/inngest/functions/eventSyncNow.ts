/**
 * Phase 05.6 Plan 10 — `event/sync-now` Inngest event function.
 *
 * Triggered by the operator console "Sync now" button (plan 14's
 * `/api/operator/sync-now` route POSTs and that route fires
 * `inngest.send('event/sync-now', { data: { storeId, date? } })`).
 *
 * Single-store, single-date wrapper around `runDailyForStore` (plan 08's
 * shared handler in `./cronDaily.ts`). Keeping the helper as the one place
 * the fetch+merge+persist sequence lives means a future algorithm fix
 * (Phase 05.7+) lands in ONE module — cron-daily, event/sync-now, and
 * event/backfill all execute the same code path.
 *
 * === Payload ===
 *
 *   {
 *     storeId: 'uzoshop' | 'zolplus' | 'usmile360',   // required
 *     date?:   string  // YYYY-MM-DD; omitted → today in Asia/Jerusalem
 *   }
 *
 * `storeId` validation: TypeScript's StoreId discriminated union catches
 * misuse from internal callers at compile time. Runtime validation of the
 * payload from the network boundary is the API route's job (plan 14) —
 * `event/sync-now` itself trusts the payload it receives from
 * `inngest.send` because that call is server-only.
 *
 * `date` default: today in Asia/Jerusalem (NOT yesterday). cron-daily uses
 * yesterday because it fires at 00:05 to process "the day that just
 * ended"; sync-now is operator-initiated and the operator's mental model
 * is "refresh today's numbers right now". Sync-now-for-yesterday is
 * achievable by passing `date: '2026-05-20'` explicitly.
 *
 * === Free-tier budget contribution ===
 *
 * 5 step.run + 1 function = 6 execs per sync-now click. Operator clicks
 * are bounded by Single User Trust Model (D-D2) — even at 100
 * clicks/month that's 600 execs/month ≈ 1.2% of the 50K cap. Forecast
 * load across all event-trigger functions: ~9K/month (per
 * 05.6-CONTEXT.md line 9).
 *
 * === SDK signature note ===
 *
 * `inngest.createFunction(opts, handler)` — 2-arg form in inngest@^4.4.0.
 * Triggers nested in `opts.triggers` as an array (single-trigger input
 * is normalised by sanitizeTriggers per Inngest.cjs:561). The PLAN.md
 * skeleton (Research §Pattern 7) showed a hypothetical 3-arg form which
 * does not exist in the v4 line — corrected here per the precedent set
 * by plan 08's deviation #2 (cronDaily.ts).
 *
 * Refs:
 *   - 05.6-10-PLAN.md §<tasks> Task 2
 *   - 05.6-RESEARCH.md §Pattern 7 lines 920-967 (eventSyncNow skeleton)
 *   - 05.6-08-SUMMARY.md (runDailyForStore signature + reuse contract)
 */

import { inngest } from '@/inngest/client';
import { runDailyForStore, type StoreId } from './cronDaily';

// ---------------------------------------------------------------------------
// Payload type — matches the contract emitted by plan 14's API route.
// ---------------------------------------------------------------------------
type SyncNowPayload = {
  storeId: StoreId;
  /**
   * Optional date. YYYY-MM-DD. When omitted, the handler resolves it to
   * today in Asia/Jerusalem at function-execution time (not send time)
   * so the value reflects the moment the worker picks up the event.
   */
  date?: string;
};

/**
 * Returns today's calendar day in Asia/Jerusalem as 'YYYY-MM-DD'.
 *
 * Mirrors the Intl.DateTimeFormat-en-CA pattern used at
 * cronDaily.ts:yesterdayJerusalem (lines 73-82) but for "today" rather
 * than "yesterday". en-CA produces ISO-shape `YYYY-MM-DD` regardless of
 * the system locale — safest format for date strings flowing into
 * Supabase DATE columns and Inngest step IDs.
 */
function todayJerusalem(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date());
}

// ---------------------------------------------------------------------------
// Loose StepRunner shape — same lowest-common-denominator pattern as
// cronDaily.ts:RunDailyStep (see plan 08 deviation #3). The real Inngest
// `step.run` returns `Promise<Jsonify<Awaited<T>>>`; test mocks return
// plain `Promise<unknown>`. `unknown` is the only return type that both
// shapes satisfy.
// ---------------------------------------------------------------------------
type StepRunner = {
  run(id: string, callback: () => Promise<unknown>): Promise<unknown>;
};

export const eventSyncNow = inngest.createFunction(
  {
    id: 'event-sync-now',
    // Triggers as an array per Inngest v4 SDK convention; the SDK
    // sanitizeTriggers helper normalises single-object input to array
    // anyway, but using array form makes the shape explicit and matches
    // cronDaily.ts:makeCronDaily.
    triggers: [{ event: 'event/sync-now' }],
  },
  async ({ event, step }) => {
    const { storeId, date = todayJerusalem() } = event.data as SyncNowPayload;

    // Cast narrows Inngest's full step API to the StepRunner subset
    // runDailyForStore consumes. See plan 08 deviation #3 + cronLive.ts
    // line 410 for the same cast precedent — sound because the handler's
    // payloads (StoreId, dateStr) and runDailyForStore's return type are
    // primitive/plain-object (Jsonify<T> ≡ T for these shapes).
    return runDailyForStore(storeId, date, {
      step: step as unknown as StepRunner,
    });
  },
);
