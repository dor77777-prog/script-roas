/**
 * Phase 05.6 Plan 10 — `event/backfill` Inngest event function.
 *
 * Triggered by the operator console backfill range picker (plan 14's
 * `/api/operator/backfill` route POSTs `{from, to, storeIds[]}` and that
 * route fires `inngest.send('event/backfill', { data: {...} })`).
 *
 * Iterates a date range × storeIds Cartesian product and dispatches a
 * `runDailyForStore` call per (date, store) pair. Reuses the shared
 * handler body from `./cronDaily.ts` — keeping fetch+merge+persist in
 * one module means a future algorithm fix lands once (D-C4 parity).
 *
 * === Payload ===
 *
 *   {
 *     from:     string,                // YYYY-MM-DD inclusive
 *     to:       string,                // YYYY-MM-DD inclusive
 *     storeIds: ('uzoshop' | 'zolplus' | 'usmile360')[]
 *   }
 *
 * Validation (rejected with throw — Inngest retries 4× then dead-letters
 * to the jobs table, where the operator sees the failure):
 *   - from < '2026-05-01'  → D-A3 history boundary; Supabase has no data
 *                            before this date so backfill would fetch
 *                            from upstream APIs for nothing
 *   - storeIds.length === 0 → trivially malformed (operator clicked
 *                             backfill with no stores selected)
 *   - from > to            → range is empty / inverted
 *
 * === Step ID collision avoidance (CHECK.md W6) ===
 *
 * The naive shape `step.run(`backfill-${date}-${storeId}`, () =>
 * runDailyForStore(storeId, date, { step }))` collides because
 * `runDailyForStore` itself calls `step.run('fetch-shopify', ...)` etc.
 * Inngest step IDs must be unique per function invocation; six backfill
 * iterations would all call `step.run('fetch-shopify')` — collision.
 *
 * **Fix: pass a prefixing step shim into runDailyForStore.** Each call
 * inside the loop receives a `prefixedStep` wrapper that prepends
 * `${date}-${storeId}-` to every step.run id. Effective IDs become
 * `2026-05-15-uzoshop-fetch-shopify`, `2026-05-15-zolplus-fetch-shopify`,
 * etc. — globally unique across the entire backfill invocation.
 *
 * Trade-off vs `step.run('backfill-{date}-{storeId}', () => ...)`
 * wrapping: the wrapping approach is incompatible with Inngest's step
 * model (step.run callbacks cannot themselves issue step.run calls via
 * the same step instance — that's the W6 collision). The shim is the
 * supported workaround per the W6 fix proposal.
 *
 * The PLAN.md `<action>` block sketched the wrapping shape; we apply
 * the W6 mitigation here (Rule 1 deviation — plan skeleton bug fix).
 *
 * === Free-tier budget ===
 *
 * 5 step.run per (date, store) pair (the same 5 cron-daily steps,
 * prefix-renamed). A 21-day × 3-store backfill (D-A3 max scope:
 * 2026-05-01 → 2026-05-21) = 63 pairs × 5 steps + 1 outer function =
 * 316 execs per backfill click. Generous: operators rarely run more
 * than 1-2 backfills per month. Forecast: ~1K execs/month from backfill
 * (lower bound of CONTEXT.md's ~9K event-trigger budget; sync-now
 * clicks dominate).
 *
 * === Step.invoke alternative ===
 *
 * Per CHECK.md W6 option (c): we could `step.invoke(eventSyncNow, {data
 * {storeId, date}})` instead. That delegates each pair to a separate
 * Inngest function (and the receiver's step IDs are scoped to that
 * invocation, so no collision). Rejected for plan 10 because (1) it
 * requires both functions registered in serve() — plan 11 territory;
 * (2) step.invoke is opaque to test mocks that mock `runDailyForStore`
 * directly (Test 5 asserts call count). The prefixing-shim choice
 * keeps Test 5's assertion intact and keeps the plan-10 scope self-
 * contained (no plan-11 dependency).
 *
 * === Per-pair failure handling ===
 *
 * Each (date, store) call is wrapped in try/catch. A failure does NOT
 * abort the rest of the loop — the operator wants to see partial
 * progress on the jobs table rather than a hard stop. Inngest's
 * default per-step retry policy (4× exponential per D-B6) still kicks
 * in for transient errors; only after retries exhaust does the catch
 * fire and we record the failure in `results[]`.
 *
 * Refs:
 *   - 05.6-10-PLAN.md §<tasks> Task 3 (action skeleton + must_haves)
 *   - 05.6-CHECK.md §W6 (step ID collision warning + 3 fix options)
 *   - 05.6-RESEARCH.md §Pattern 7 (event triggering pattern)
 *   - 05.6-08-SUMMARY.md (runDailyForStore reuse contract)
 *   - 05.6-CONTEXT.md §D-A3 (history boundary = 2026-05-01)
 */

import { inngest } from '@/inngest/client';
import { runDailyForStore, type StoreId } from './cronDaily';

// ---------------------------------------------------------------------------
// Payload type — matches the contract emitted by plan 14's API route.
// ---------------------------------------------------------------------------
type BackfillPayload = {
  from: string; // YYYY-MM-DD inclusive
  to: string; // YYYY-MM-DD inclusive
  storeIds: StoreId[];
};

/**
 * D-A3 history boundary. Phase 05.5-20's importer seeded historical
 * Supabase rows starting at 2026-05-01; nothing exists upstream before
 * that date in a format we can re-derive. Backfill requests for older
 * dates would loop over upstream Shopify/Meta/Google fetchers that
 * return empty results — wasted exec budget. Reject at the boundary.
 */
const HISTORY_BOUNDARY = '2026-05-01';

// ---------------------------------------------------------------------------
// Loose StepRunner shape — same lowest-common-denominator pattern as
// cronDaily.ts:RunDailyStep and eventSyncNow.ts:StepRunner.
// ---------------------------------------------------------------------------
type StepRunner = {
  run(id: string, callback: () => Promise<unknown>): Promise<unknown>;
};

/**
 * Inclusive YYYY-MM-DD date generator.
 *
 * Uses Date.UTC + millisecond arithmetic to traverse the range — avoids
 * timezone drift from local-tz Date constructors. The output strings
 * are exact ISO-8601 calendar days (YYYY-MM-DD), matching the format
 * Supabase DATE columns expect.
 *
 * Edge cases:
 *   - from === to → yields exactly one date
 *   - from > to   → caller must reject before calling (the loop would
 *                   yield nothing and the function would no-op, but
 *                   that masks a malformed payload — we reject upstream
 *                   in the handler)
 *   - DST boundaries → millisecond arithmetic on UTC is unaffected by
 *                      Asia/Jerusalem's IDT/IST flip (only display
 *                      formatting cares, and we use .toISOString().slice
 *                      which always reports UTC)
 */
function* dateRange(from: string, to: string): Generator<string> {
  const [fy, fm, fd] = from.split('-').map(Number);
  const [ty, tm, td] = to.split('-').map(Number);
  const start = new Date(Date.UTC(fy, fm - 1, fd));
  const end = new Date(Date.UTC(ty, tm - 1, td));
  for (let d = start; d <= end; d = new Date(d.getTime() + 24 * 60 * 60 * 1000)) {
    yield d.toISOString().slice(0, 10);
  }
}

/**
 * W6 mitigation — return a step shim whose every `.run` id is prefixed
 * with `${prefix}-`. The shim delegates to the wrapped outer step so
 * memoization, retry, and timing all flow through Inngest's normal
 * pipeline; the only difference is the id namespace.
 *
 * Returning Promise<unknown> matches the runDailyForStore handler's
 * RunDailyStep contract (cronDaily.ts:103-105).
 */
function makePrefixedStep(outer: StepRunner, prefix: string): StepRunner {
  return {
    run: (id: string, callback: () => Promise<unknown>) =>
      outer.run(`${prefix}-${id}`, callback),
  };
}

// ---------------------------------------------------------------------------
// Per-pair result row — collected into the function's return value so the
// operator console's job-detail view (plan 12) can render a per-day-per-
// store success/failure matrix.
// ---------------------------------------------------------------------------
type PairResult = {
  date: string;
  storeId: string;
  ok: boolean;
  error?: string;
};

export const eventBackfill = inngest.createFunction(
  {
    id: 'event-backfill',
    triggers: [{ event: 'event/backfill' }],
  },
  async ({ event, step }) => {
    const { from, to, storeIds } = event.data as BackfillPayload;

    // ---- Validation (throw → Inngest retry-then-deadletter) -----------
    if (!storeIds || storeIds.length === 0) {
      throw new Error(
        'event/backfill: storeIds array is required and must be non-empty',
      );
    }
    if (from < HISTORY_BOUNDARY) {
      throw new Error(
        `event/backfill: from=${from} predates D-A3 history boundary ${HISTORY_BOUNDARY}; ` +
          `Phase 05.6 only supports backfill from ${HISTORY_BOUNDARY} forward.`,
      );
    }
    if (from > to) {
      throw new Error(`event/backfill: from=${from} > to=${to}`);
    }

    // The cast narrows Inngest's full step API to the StepRunner subset
    // we need for the prefix shim. Same pattern as eventSyncNow.ts.
    const outerStep = step as unknown as StepRunner;

    const results: PairResult[] = [];

    // ---- Iteration: date range × storeIds Cartesian product ----------
    // Sequential, not Promise.all-parallel: the same upstream API
    // (Shopify orders, Meta insights, Google Ads GAQL) is hit by every
    // pair — parallelizing would race against per-app rate limits and
    // the Google Ads token-refresh race (RESEARCH §Pitfall 8). Sequential
    // also keeps the Inngest step graph linear for operator readability
    // in the jobs table.
    //
    // Audit fix 2026-05-24 (AUDIT INN-16, Phase 12.1.1): console.warn
    // on per-pair failure for operator visibility in Inngest run logs,
    // and abort the whole event after 3 consecutive identical error
    // messages so Inngest's retry/DLQ machinery sees the throw. Pre-fix
    // the loop swallowed every error and burned 63 pairs × 6 step.runs
    // on systemic failures (RLS denial, missing migration) without ever
    // escalating to Inngest. Evidence: .planning/phases/12-codebase-
    //   audit-baseline/raw-returns/inngest_eventBackfill.json (INN-16).
    //
    // The counter resets on each different message AND on each success,
    // so transient per-pair flakes (different errors per pair) still
    // run the full backfill — only TRULY systemic (same error N times
    // in a row) triggers the abort.
    let consecutiveIdenticalErrorCount = 0;
    let lastErrorMessage: string | null = null;
    const SYSTEMIC_FAILURE_THRESHOLD = 3;

    for (const date of dateRange(from, to)) {
      for (const storeId of storeIds) {
        // W6 mitigation — prefix every inner step.run id with
        // `${date}-${storeId}-` so the 5 inner ids (fetch-shopify,
        // fetch-meta, fetch-google, apply-manual-overrides,
        // persist-batch) become globally unique across iterations.
        const prefixedStep = makePrefixedStep(outerStep, `${date}-${storeId}`);
        try {
          await runDailyForStore(storeId, date, { step: prefixedStep });
          results.push({ date, storeId, ok: true });
          // Reset the systemic-failure counter on any successful pair.
          consecutiveIdenticalErrorCount = 0;
          lastErrorMessage = null;
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          results.push({ date, storeId, ok: false, error: message });
          console.warn(
            `[backfill] pair ${date}/${storeId} failed: ${message}`,
          );
          if (message === lastErrorMessage) {
            consecutiveIdenticalErrorCount += 1;
          } else {
            consecutiveIdenticalErrorCount = 1;
            lastErrorMessage = message;
          }
          if (consecutiveIdenticalErrorCount >= SYSTEMIC_FAILURE_THRESHOLD) {
            throw new Error(
              `systemic failure (${SYSTEMIC_FAILURE_THRESHOLD} consecutive identical errors): ${message}`,
            );
          }
          // Otherwise continue to the next pair. Inngest's own retry
          // policy already exhausted before this catch fires; we keep
          // marching so the operator can see partial progress on the
          // jobs table rather than abort the whole backfill for a
          // single transient per-pair flake.
        }
      }
    }

    return {
      from,
      to,
      storeIds,
      totalPairs: results.length,
      successCount: results.filter((r) => r.ok).length,
      failureCount: results.filter((r) => !r.ok).length,
      // Full per-pair audit trail. The operator console (plan 12 jobs
      // table) renders this as a matrix.
      results,
    };
  },
);
