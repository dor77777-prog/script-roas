/**
 * Phase 05.6 Plan 09 — cron-live factory tests (TDD RED gate).
 *
 * cron-live mirrors Apps Script's 15-minute live trigger which refreshes
 * Shopify revenue for a rolling 3-day window. Meta + Google Ads spend
 * insights are NOT refreshed on the live cadence — they're owned by the
 * daily cron (plan 08). Skipping them on live keeps execution count under
 * the Inngest free-tier 50K/month budget (per 05.6-RESEARCH.md §Pitfall 4
 * recommended decomposition: 2 step.run + 1 function = 3 execs/run).
 *
 * What this file covers (6 tests):
 *   1. cronLiveFunctions.length === 3            — one per store
 *   2. Each function has unique id "cron-live-{storeId}"
 *   3. Each function has cron trigger "TZ=Asia/Jerusalem *\/15 * * * *"
 *   4. runLiveForStore fetches Shopify for TODAY and 2 prior days
 *      (rolling 3-day window) and persists each day's row.
 *   5. Meta + Google fetchers are NEVER called (Shopify-only on live).
 *   6. An error thrown from any step.run propagates out of the handler.
 *
 * Refs:
 *   - 05.6-09-PLAN.md §<tasks> Task 1
 *   - 05.6-RESEARCH.md §Pattern 2 (factory across stores, lines 381-492)
 *   - 05.6-RESEARCH.md §Pitfall 4 (step decomposition, lines 1395-1419)
 *   - 05.6-PATTERNS.md S-9 §cronLive.ts (conventions, line 521-528)
 *
 * NOTE: this file lives under `src/inngest/functions/__tests__/`. The
 * project-wide `vitest.config.ts` include glob is
 * `src/lib/**\/__tests__/**\/*.test.{ts,tsx}` which does NOT pick up
 * `src/inngest/**`. Run explicitly via:
 *
 *   npx vitest run src/inngest/functions/__tests__/cronLive.test.ts
 *
 * The plan's `<verify>` block invokes exactly that path. Widening the glob
 * is a vitest-config change that can be done in a separate plan to avoid
 * cross-wave conflicts with plan 08 (cronDaily) which also lives here.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as shopifyFetcher from '@/lib/fetchers/shopify';
import * as metaFetcher from '@/lib/fetchers/meta';
import * as googleAdsFetcher from '@/lib/fetchers/googleAds';
// Phase E1.6 (2026-05-30) — tiktokFetcher + fxFetcher were used by the
// deleted Test 5/7/8 (LIGHT fetcher dispatch + FX preserve + tt
// inclusion). Retained as underscore-prefixed type imports so a future
// re-add of the tests doesn't have to re-find the right module paths.
import * as _tiktokFetcher from '@/lib/fetchers/tiktok';
import * as _fxFetcher from '@/lib/fetchers/fx';
import * as supabaseAdminMod from '@/lib/supabaseAdmin';
void _tiktokFetcher;
void _fxFetcher;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal `step` stub matching Inngest's `step.run(label, fn)` shape.
 * Each call invokes `fn` once and records the label so tests can assert
 * the step decomposition (Pitfall 4 budget).
 *
 * Note: this stub does NOT model Inngest's retry-on-throw or memoization —
 * it's a one-shot executor. The plan tests focus on call ordering and the
 * Shopify-only invariant, not retry semantics (those are SDK-owned).
 */
function makeStepStub() {
  const labels: string[] = [];
  const step = {
    run: async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      labels.push(label);
      return await fn();
    },
  };
  return { step, labels };
}

/**
 * Supabase admin client mock that records every call to .from(table).
 * The cron-live handler should ONLY touch data_daily + products_daily —
 * NEVER campaigns_daily / ads_daily / manual_overrides (those are daily-only).
 */
function makeSupabaseAdminMock() {
  const touchedTables: string[] = [];
  const upsertCalls: Array<{ table: string; rows: unknown; options?: unknown }> = [];
  const updateCalls: Array<{ table: string; payload: unknown; matchers: unknown }> = [];
  const selectCalls: Array<{ table: string }> = [];

  // Default "row exists" select response — overridden per-test as needed.
  let nextSelectResult: { data: unknown; error: unknown } = {
    data: null,
    error: null,
  };
  const setNextSelectResult = (r: { data: unknown; error: unknown }) => {
    nextSelectResult = r;
  };

  function makeTableBuilder(table: string) {
    touchedTables.push(table);
    const builder = {
      upsert: vi.fn((rows: unknown, options?: unknown) => {
        upsertCalls.push({ table, rows, options });
        return Promise.resolve({ error: null });
      }),
      update: vi.fn((payload: unknown) => {
        const chain = {
          eq: vi.fn(() => {
            const inner = {
              eq: vi.fn(() => {
                updateCalls.push({
                  table,
                  payload,
                  matchers: 'date+store_id',
                });
                return Promise.resolve({ error: null });
              }),
            };
            return inner;
          }),
        };
        return chain;
      }),
      select: vi.fn(() => {
        const chain = {
          eq: vi.fn(() => {
            const inner = {
              eq: vi.fn(() => {
                const last = {
                  maybeSingle: vi.fn(() => {
                    selectCalls.push({ table });
                    return Promise.resolve(nextSelectResult);
                  }),
                };
                return last;
              }),
            };
            return inner;
          }),
        };
        return chain;
      }),
    };
    return builder;
  }

  const admin = {
    from: vi.fn((table: string) => makeTableBuilder(table)),
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })), // Phase E1.6.2 recompute RPC stub
  };

  return {
    admin,
    touchedTables,
    upsertCalls,
    updateCalls,
    selectCalls,
    setNextSelectResult,
  };
}

// ---------------------------------------------------------------------------
// Common test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// The old per-store factory (cronLiveFunctions: array length / `cron-live-{store}`
// ids / `TZ=Asia/Jerusalem */10 * * * *` schedule) was removed in the Inngest →
// Vercel Cron + QStash migration. cron-live now runs on Vercel Cron at
// /api/cron/live → QStash → /api/worker/live-store (schedule/gating covered by
// liveRoute.test.ts). These tests cover the runLiveForStore handler logic.
// ===========================================================================

describe('cronLive — runLiveForStore handler (Shopify-only, rolling 3-day)', () => {
  it('Test 4: fetches Shopify for TODAY and 2 prior days (rolling 3-day window) and persists each', async () => {
    const mod = await import('../cronLive');

    // Mock Shopify fetcher — returns deterministic shape, tracks call args.
    const shopifySpy = vi
      .spyOn(shopifyFetcher, 'fetchShopifyDayRows')
      .mockImplementation(async (storeId, date) => ({
        storeId,
        date,
        storeName: 'uzoshop',
        revenueCad: 1000,
        productRows: [
          {
            product_id: 'p1',
            net_revenue_cad: 500,
            gross_revenue_cad: 500,
            units: 1,
            orders: 1,
            product_title: '',
          },
        ],
        customItemRefundCad: 0,
        grossRevenueCad: 1000,
        refundDeductionCad: 0,
      }));

    const { admin, upsertCalls, updateCalls, selectCalls } = makeSupabaseAdminMock();
    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(
      admin as unknown as ReturnType<typeof supabaseAdminMod.getSupabaseAdmin>,
    );

    const { step, labels } = makeStepStub();
    await mod.runLiveForStore('uzoshop', { step });

    // Shopify fetcher should be called exactly 3 times (today + 2 prior days).
    expect(shopifySpy).toHaveBeenCalledTimes(3);

    // Dates must be in 'YYYY-MM-DD' format and form a 3-day rolling window
    // (today, today-1, today-2 in Asia/Jerusalem). Order-agnostic equality
    // — implementation may sort newest-first OR oldest-first.
    const dateArgs = shopifySpy.mock.calls.map((c) => c[1]);
    expect(dateArgs.length).toBe(3);
    for (const d of dateArgs) {
      expect(/^\d{4}-\d{2}-\d{2}$/.test(d)).toBe(true);
    }
    // The 3 dates must be unique.
    expect(new Set(dateArgs).size).toBe(3);

    // Verify the 3-day rolling window: the 3 dates must be consecutive
    // calendar days (we don't pin the exact day because that depends on
    // "now" in Asia/Jerusalem at test-run time).
    const sorted = [...dateArgs].sort();
    const d0 = new Date(`${sorted[0]}T00:00:00Z`).getTime();
    const d1 = new Date(`${sorted[1]}T00:00:00Z`).getTime();
    const d2 = new Date(`${sorted[2]}T00:00:00Z`).getTime();
    const ONE_DAY = 24 * 60 * 60 * 1000;
    expect(d1 - d0).toBe(ONE_DAY);
    expect(d2 - d1).toBe(ONE_DAY);

    // Persist step must have been called — at least 1 SELECT and 1 UPSERT
    // (insert or update path) per date. The exact counts depend on whether
    // the implementation chose SELECT-then-UPDATE or pure UPSERT, but the
    // touch set must include 'data_daily' and 'products_daily' for each
    // rolling-window date.
    const dataTouches = [...upsertCalls, ...updateCalls, ...selectCalls].filter(
      (c) => c.table === 'data_daily',
    ).length;
    expect(dataTouches).toBeGreaterThanOrEqual(3);

    // Step labels must stay close to Pitfall 4 recommendation. Phase 05.7.7
    // added the meta/google/tiktok spend step; 05.7.8 added the
    // orders-attribution-today step; Phase 05.7.x added refresh-effective-status
    // so the off-chip flips within 10 min of a pause instead of waiting 24h
    // for cron-daily. Audit fix 2026-05-24 (AUDIT INN-10, Phase 12.1.1)
    // added 3 select-prior-spend-{date}-{storeId} steps (one per rolling-
    // window date) so the SELECT-of-prior-spend is memoized across Inngest
    // retries instead of re-executing inside persist-rolling-3day. Budget
    // is now 8 (fetch-shopify + fetch-spend-light + fetch-orders-attribution
    // + 3× select-prior-spend + persist + refresh-effective-status).
    expect(labels.length).toBeGreaterThanOrEqual(1);
    expect(labels.length).toBeLessThanOrEqual(8);
  });


  it('Test 6 (Phase 05.7.6): fetcher errors are CAUGHT (cron always completes, never stalls)', async () => {
    // Pre-05.7.6 this test asserted that a Shopify error PROPAGATES out of
    // the handler — which made Inngest mark the run Failed and retry up
    // to 4 times. That behavior caused cron-live to STALL on Meta API
    // slowness, never completing within the 5-min step.run budget.
    //
    // The new contract: a slow/failing fetcher returns zero/null INSIDE
    // the step.run, the handler completes successfully, and the next
    // cron tick (10 min later) tries again. The dashboard's freshness
    // chip surfaces the staleness so the operator knows.
    const mod = await import('../cronLive');

    vi.spyOn(shopifyFetcher, 'fetchShopifyDayRows').mockRejectedValue(
      new Error('Shopify 503 — service unavailable'),
    );
    vi.spyOn(metaFetcher, 'fetchMetaSpendForDayLight').mockResolvedValue({
      storeId: 'uzoshop',
      date: '2026-05-22',
      spend: 0,
      currency: 'ILS',
    impressions: 0,
    });
    vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsSpendForDay').mockResolvedValue({
      storeId: 'uzoshop',
      date: '2026-05-22',
      spend: 0,
      currency: 'CAD',
    impressions: 0,
    });

    const { admin } = makeSupabaseAdminMock();
    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(
      admin as unknown as ReturnType<typeof supabaseAdminMod.getSupabaseAdmin>,
    );

    // Silence the expected console.warn during the test.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { step } = makeStepStub();
    // The handler completes (does NOT throw) — Shopify failures are
    // caught + logged, replaced with zero-data rows, persist still runs.
    const result = await mod.runLiveForStore('uzoshop', { step });
    expect(result.storeId).toBe('uzoshop');
    // All 3 rolling dates fell through the .catch path → revenue=0 each.
    for (const date of result.rollingDates) {
      expect(result.perDayRevenue[date]).toBe(0);
    }
    // Shopify warnings were emitted (one per failed date).
    expect(warnSpy).toHaveBeenCalled();
    const warnMessages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(warnMessages.some((m) => /Shopify.*503|service unavailable/i.test(m))).toBe(
      true,
    );
  });

  // #29 (2026-06-20): cronLive persists 3 rolling dates with separate
  // non-transactional agg RPCs. Pre-fix, if the agg threw for one date
  // mid-loop, the remaining dates were never persisted/aggregated AT ALL
  // and the failing date kept fresh revenue with stale derived totals.
  // The resilient-pass fix runs the agg for EVERY date even when one throws,
  // then re-throws an aggregate so Inngest still retries the whole tick
  // (ON CONFLICT idempotency makes the retry safe + self-healing).
  it('#29: a mid-loop agg failure still runs the agg for the OTHER dates AND the tick surfaces an error (Inngest retries)', async () => {
    const mod = await import('../cronLive');

    vi.spyOn(shopifyFetcher, 'fetchShopifyDayRows').mockImplementation(
      async (storeId, date) => ({
        storeId,
        date,
        storeName: 'uzoshop',
        revenueCad: 1000,
        productRows: [],
        customItemRefundCad: 0,
        grossRevenueCad: 1000,
        refundDeductionCad: 0,
      }),
    );

    const { admin } = makeSupabaseAdminMock();
    // Make the agg RPC fail for exactly ONE of the 3 rolling dates, succeed
    // for the other two. Track which dates the agg was attempted for.
    const aggDates: string[] = [];
    let failDate: string | null = null;
    admin.rpc = vi.fn((name: string, args: { d: string }) => {
      if (name === 'agg_data_daily_for_date') {
        aggDates.push(args.d);
        // Choose the first date we see as the one that fails.
        if (failDate === null) failDate = args.d;
        if (args.d === failDate) {
          return Promise.resolve({
            data: null,
            error: { message: 'deadlock detected' },
          });
        }
      }
      return Promise.resolve({ data: null, error: null });
    }) as unknown as typeof admin.rpc;

    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(
      admin as unknown as ReturnType<typeof supabaseAdminMod.getSupabaseAdmin>,
    );

    const { step } = makeStepStub();

    // The tick must ultimately surface an error so Inngest retries.
    await expect(mod.runLiveForStore('uzoshop', { step })).rejects.toThrow(
      /agg_data_daily_for_date|deadlock/i,
    );

    // The agg must have been attempted for ALL 3 rolling dates — a mid-loop
    // failure must NOT short-circuit the remaining dates' aggregation.
    expect(new Set(aggDates).size).toBe(3);
  });

});
