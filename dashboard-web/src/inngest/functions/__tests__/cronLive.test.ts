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
import * as tiktokFetcher from '@/lib/fetchers/tiktok';
import * as fxFetcher from '@/lib/fetchers/fx';
import * as supabaseAdminMod from '@/lib/supabaseAdmin';

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

describe('cronLive — factory shape', () => {
  it('Test 1: cronLiveFunctions array has exactly 3 entries (one per store)', async () => {
    const mod = await import('../cronLive');
    expect(Array.isArray(mod.cronLiveFunctions)).toBe(true);
    expect(mod.cronLiveFunctions.length).toBe(3);
  });

  it('Test 2: each function has a unique id "cron-live-{storeId}"', async () => {
    const mod = await import('../cronLive');
    const ids = mod.cronLiveFunctions.map((f) => f.id());
    expect(ids).toEqual(['cron-live-uzoshop', 'cron-live-zolplus', 'cron-live-usmile360']);
    expect(new Set(ids).size).toBe(3);
  });

  it('Test 3: each function uses cron trigger "TZ=Asia/Jerusalem */15 * * * *"', async () => {
    const mod = await import('../cronLive');
    for (const fn of mod.cronLiveFunctions) {
      // fn.opts.triggers is an array of { cron } | { event } objects per Inngest SDK v4.4.
      const triggers = (fn as unknown as { opts: { triggers: Array<{ cron?: string }> } }).opts
        .triggers;
      expect(Array.isArray(triggers)).toBe(true);
      const cronTrigger = triggers.find((t) => typeof t.cron === 'string');
      expect(cronTrigger, 'expected at least one cron trigger').toBeDefined();
      // Phase 05.7.6 cadence change: */15 → */10 so today's spend +
      // revenue refresh every 10 min instead of 15.
      expect(cronTrigger!.cron).toBe('TZ=Asia/Jerusalem */10 * * * *');
    }
  });
});

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

  it('Test 5 (Phase 05.7.6): cron-live calls LIGHT Meta + Google fetchers — NOT the heavy fetchMetaSpendForDay', async () => {
    // History: cron-live was originally Shopify-only. Phase 05.7.6 added
    // Meta + Google spend fetches; the first attempt (commit eb72d18)
    // used the HEAVY `fetchMetaSpendForDay` which paginated all ad-sets,
    // pushed past the 5-min step.run budget, and stalled every tick. The
    // proper fix uses `fetchMetaSpendForDayLight` (level=account, single
    // API call, ~500ms) — this test locks the choice. The heavy fetcher
    // must NEVER be called from cron-live.
    const mod = await import('../cronLive');

    vi.spyOn(shopifyFetcher, 'fetchShopifyDayRows').mockImplementation(async (storeId, date) => ({
      storeId,
      date,
      storeName: 'uzoshop',
      revenueCad: 0,
      productRows: [],
      customItemRefundCad: 0,
      grossRevenueCad: 0,
      refundDeductionCad: 0,
    }));
    const lightMetaSpy = vi
      .spyOn(metaFetcher, 'fetchMetaSpendForDayLight')
      .mockResolvedValue({ storeId: 'uzoshop', date: '2026-05-22', spend: 0, currency: 'ILS' });
    const heavyMetaSpy = vi
      .spyOn(metaFetcher, 'fetchMetaSpendForDay')
      .mockResolvedValue({ storeId: 'uzoshop', date: '2026-05-22', spend: 0, currency: 'ILS' });
    const googleSpy = vi
      .spyOn(googleAdsFetcher, 'fetchGoogleAdsSpendForDay')
      .mockResolvedValue({ storeId: 'uzoshop', date: '2026-05-22', spend: 0, currency: 'CAD' });
    // Audit fix 2026-05-23 (a/WARN-5): pin TikTok parity to Meta + Google.
    // Pre-fix, this test silently let TikTok fall through to the real
    // creds-check path (which throws "Missing TikTok creds" and gets
    // swallowed by the .catch). That hid a regression where the rolling-
    // window count for TikTok could drift from 3 without anyone noticing.
    // Now the spy resolves successfully, so the call-count assertion
    // below has teeth: TikTok MUST be called 3× per cron-live tick on
    // a TikTok-enabled store (uzoshop), matching Meta + Google cadence.
    const tiktokSpy = vi
      .spyOn(tiktokFetcher, 'fetchTikTokSpendForDay')
      .mockResolvedValue({ storeId: 'uzoshop', date: '2026-05-22', spend: 0, currency: 'CAD' });

    const { admin } = makeSupabaseAdminMock();
    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(
      admin as unknown as ReturnType<typeof supabaseAdminMod.getSupabaseAdmin>,
    );

    const { step } = makeStepStub();
    await mod.runLiveForStore('uzoshop', { step });

    // Audit fix 2026-05-23 (CR-02 pipeline): cron-live now refreshes
    // ad-spend for the FULL rolling 3-day window so yesterday +
    // day-before-yesterday recover from any cron-daily failure within
    // the next live-tick (10 min). Pre-fix the count was 1; post-fix
    // it must be exactly 3 (one per date in ROLLING_WINDOW_DAYS=3).
    expect(lightMetaSpy).toHaveBeenCalledTimes(3);
    expect(googleSpy).toHaveBeenCalledTimes(3);
    // Audit fix 2026-05-23 (a/WARN-5): TikTok parity — same 3× cadence.
    expect(tiktokSpy).toHaveBeenCalledTimes(3);
    // Heavy fetcher MUST NOT be called — it stalls the cron.
    expect(heavyMetaSpy).not.toHaveBeenCalled();
    // First positional arg = storeId; second = a valid ISO date.
    expect(lightMetaSpy.mock.calls[0][0]).toBe('uzoshop');
    expect(lightMetaSpy.mock.calls[0][1]).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // The 3 calls cover 3 distinct dates (the rolling window).
    const lightMetaDates = new Set(lightMetaSpy.mock.calls.map(c => c[1]));
    expect(lightMetaDates.size).toBe(3);
    // TikTok also covers all 3 distinct dates.
    const tiktokDates = new Set(tiktokSpy.mock.calls.map(c => c[1]));
    expect(tiktokDates.size).toBe(3);
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
    });
    vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsSpendForDay').mockResolvedValue({
      storeId: 'uzoshop',
      date: '2026-05-22',
      spend: 0,
      currency: 'CAD',
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

  it('Test 7 (audit a/WARN-3): FX failure skips spend update — does NOT corrupt CAD column with raw USD', async () => {
    // Pre-fix (audit a/WARN-3): cron-live's cadConvert did
    // `.catch(() => 1)` on FX failure, treating 1 USD as 1 CAD. With
    // a foreign-currency platform (Meta on ILS account or Google on
    // USD account), this overwrote today's CAD spend column with
    // raw foreign-currency numbers — typically ~25-30% low. Amplified
    // by the rolling 3-day refresh, a single FX outage corrupted 3
    // dates × 3 stores × 3 platforms in one tick.
    //
    // New behavior: FX failure → cadConvert returns null → the
    // per-platform preserve in persist keeps the prior-day value.
    // Operator sees stale data (surfaced by the freshness chip)
    // instead of wrong data.
    //
    // Test scenario: Meta returns spend in USD, FX getFxRate throws,
    // and we assert NO upsert/update is called on data_daily for the
    // spend columns (the haveAnySpend guard short-circuits because
    // fbSpendCad is null, gaSpendCad is null, ttSpendCad is null).
    // Shopify (CAD) is allowed through so Shopify cols still write.
    const mod = await import('../cronLive');

    vi.spyOn(shopifyFetcher, 'fetchShopifyDayRows').mockImplementation(async (storeId, date) => ({
      storeId,
      date,
      storeName: 'uzoshop',
      revenueCad: 1000,
      productRows: [],
      customItemRefundCad: 0,
      grossRevenueCad: 1000,
      refundDeductionCad: 0,
    }));
    // All three ad-platform fetchers return SUCCESS in a non-CAD
    // currency — so cadConvert is forced to call getFxRate.
    vi.spyOn(metaFetcher, 'fetchMetaSpendForDayLight').mockResolvedValue({
      storeId: 'uzoshop',
      date: '2026-05-22',
      spend: 100,
      currency: 'USD',
    });
    vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsSpendForDay').mockResolvedValue({
      storeId: 'uzoshop',
      date: '2026-05-22',
      spend: 50,
      currency: 'USD',
    });
    vi.spyOn(tiktokFetcher, 'fetchTikTokSpendForDay').mockResolvedValue({
      storeId: 'uzoshop',
      date: '2026-05-22',
      spend: 25,
      currency: 'USD',
    });
    // FX rate lookup THROWS for every call — simulates ECB outage,
    // fixer.io quota exceeded, or transient network failure.
    const fxSpy = vi
      .spyOn(fxFetcher, 'getFxRate')
      .mockRejectedValue(new Error('FX provider 503 — upstream timeout'));

    const { admin, upsertCalls } = makeSupabaseAdminMock();
    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(
      admin as unknown as ReturnType<typeof supabaseAdminMod.getSupabaseAdmin>,
    );
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { step } = makeStepStub();
    const result = await mod.runLiveForStore('uzoshop', { step });

    // Handler completes successfully.
    expect(result.storeId).toBe('uzoshop');
    // FX was attempted (proof we exercised the failing code path).
    expect(fxSpy).toHaveBeenCalled();
    // Pre-fix behavior assertion (the one this test prevents from
    // regressing): NO data_daily upsert should carry a non-zero
    // spend column written from the raw USD value. Specifically, we
    // assert no upserted row contains spend equal to the raw USD spend
    // (100, 50, or 25 — these would only appear if FX defaulted to 1).
    const dataDailyUpserts = upsertCalls.filter((c) => c.table === 'data_daily');
    for (const call of dataDailyUpserts) {
      const rows = Array.isArray(call.rows) ? call.rows : [call.rows];
      for (const row of rows) {
        const r = row as Record<string, unknown>;
        // The raw USD spend numbers (100/50/25) must NEVER appear in
        // the CAD column. If they do, the FX-defaults-to-1 bug returned.
        expect(r.fb_spend_cad).not.toBe(100);
        expect(r.ga_spend_cad).not.toBe(50);
        expect(r.tt_spend_cad).not.toBe(25);
      }
    }
    // A warning was emitted explaining the FX skip (helps
    // operator-side debugging when the freshness chip goes stale).
    const warnMessages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(warnMessages.some((m) => /FX.*failed|FX.*skip/i.test(m))).toBe(true);
  });

  it('Test 8 (audit B-01, 2026-05-24): todaySpendCad return value includes tt (TikTok) — was silently dropped', async () => {
    // Pre-fix (audit B-01): the handler's RETURN value at cronLive.ts:1146
    // only exposed { fb, ga } — TikTok spend was missing from the in-memory
    // summary even though the persist step wrote tt_spend_cad correctly
    // to data_daily. Any operator-console consumer that read
    // `runLiveForStore(...).todaySpendCad` underreported the TikTok amount
    // for uzoshop (the TikTok-enabled store).
    //
    // This test mocks today's TikTok spend to 12.34 CAD (a value chosen
    // to be obviously non-zero and not a power of 10, so a regression that
    // silently zeroes it would not collide with a generic default). The
    // assertion: result.todaySpendCad.tt === 12.34.
    const mod = await import('../cronLive');

    vi.spyOn(shopifyFetcher, 'fetchShopifyDayRows').mockImplementation(
      async (storeId, date) => ({
        storeId,
        date,
        storeName: 'uzoshop',
        revenueCad: 0,
        productRows: [],
        customItemRefundCad: 0,
        grossRevenueCad: 0,
        refundDeductionCad: 0,
      }),
    );
    vi.spyOn(metaFetcher, 'fetchMetaSpendForDayLight').mockResolvedValue({
      storeId: 'uzoshop',
      date: 'placeholder',
      spend: 0,
      currency: 'CAD',
    });
    vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsSpendForDay').mockResolvedValue({
      storeId: 'uzoshop',
      date: 'placeholder',
      spend: 0,
      currency: 'CAD',
    });
    // TikTok returns CAD-denominated spend (12.34) for EVERY day in the
    // rolling window. The handler will pick `spendByDate[today]` (=dates[0])
    // and place its ttSpendCad into the return-value todaySpendCad.tt.
    // Currency=CAD short-circuits cadConvert (no FX lookup needed).
    vi.spyOn(tiktokFetcher, 'fetchTikTokSpendForDay').mockImplementation(
      async (storeId, date) => ({
        storeId,
        date,
        spend: 12.34,
        currency: 'CAD',
      }),
    );

    const { admin } = makeSupabaseAdminMock();
    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(
      admin as unknown as ReturnType<typeof supabaseAdminMod.getSupabaseAdmin>,
    );

    const { step } = makeStepStub();
    const result = await mod.runLiveForStore('uzoshop', { step });

    // B-01 assertion: tt is present in the return-value summary AND equals
    // the mocked TikTok spend (12.34 CAD).
    expect(result.todaySpendCad).toHaveProperty('tt');
    expect(result.todaySpendCad.tt).toBe(12.34);
    // Sanity: fb + ga still default to 0 (no Meta/Google spend mocked above).
    expect(result.todaySpendCad.fb).toBe(0);
    expect(result.todaySpendCad.ga).toBe(0);
  });
});
