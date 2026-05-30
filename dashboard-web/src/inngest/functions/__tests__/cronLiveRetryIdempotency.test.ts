/**
 * Audit fix 2026-05-24 (AUDIT INN-10, Phase 12.1.1) — locks the retry
 * idempotency contract for cronLive's persist-rolling-3day step.
 *
 * Pre-fix: persist-rolling-3day did SELECT-then-UPSERT inside ONE
 * step.run callback. On Inngest retry the SELECT read the in-progress
 * state of itself, silently corrupting the per-platform-preserve
 * fallback (e.g. priorFb = the just-UPSERTed value, not the original).
 *
 * Fix: SELECT moved to a separate `step.run('select-prior-spend-{date}-
 * {storeId}', ...)` BEFORE persist-rolling-3day. Inngest memoizes
 * step.run results across retries, so the prior values are stable.
 *
 * Evidence pack: .planning/phases/12-codebase-audit-baseline/raw-returns/
 *   inngest_cronLive.json (finding INN-10).
 *
 * Test coverage (3 tests):
 *   1. preserves prior value across persist-rolling-3day retry —
 *      simulates ONE Inngest retry; assertion: persistDayForStore is
 *      called with `fbSpendCad = priorOriginal` (100), NOT the value
 *      from the retry's own first-attempt UPSERT.
 *   2. select-prior-spend step runs BEFORE persist-rolling-3day —
 *      label ordering pin.
 *   3. select-prior-spend is called once per date in the rolling window
 *      (3 dates → 3 select calls).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as shopifyFetcher from '@/lib/fetchers/shopify';
import * as metaFetcher from '@/lib/fetchers/meta';
import * as googleAdsFetcher from '@/lib/fetchers/googleAds';
import * as tiktokFetcher from '@/lib/fetchers/tiktok';
import * as supabaseAdminMod from '@/lib/supabaseAdmin';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Retry-aware step stub. For step.run calls whose label starts with
 * `retryStepLabelPrefix`, the callback is invoked TWICE in sequence —
 * once for the initial attempt, once for the simulated Inngest retry.
 * The retry happens exactly once per matching label (tracked in `retriedFor`).
 *
 * Why: Inngest's default retry policy (4× exponential, D-B6) re-executes
 * a step.run's callback on transient failure. The makeStepStub in
 * cronLive.test.ts runs each callback exactly once and therefore cannot
 * exercise the SELECT-of-our-own-UPSERT bug at INN-10.
 */
function makeRetryingStepStub(retryStepLabelPrefix: string) {
  const labels: string[] = [];
  const retriedFor = new Set<string>();
  const step = {
    run: async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
      labels.push(label);
      const result = await fn();
      if (label.startsWith(retryStepLabelPrefix) && !retriedFor.has(label)) {
        retriedFor.add(label);
        labels.push(`${label} (RETRY)`);
        return await fn();
      }
      return result;
    },
  };
  return { step, labels };
}

/**
 * One-shot step stub for the ordering + per-date count tests (no retry).
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
 * Supabase admin mock that tracks every SELECT chain call AND every
 * UPSERT payload. The SELECT chain's `.maybeSingle()` returns the
 * value injected via the `selectResults` queue — pop one per call.
 *
 * Per-date select tracking: tests can inject one result per `.eq('date', X)`
 * chain by pushing in the same order the cronLive handler calls them
 * (dates[0], dates[1], dates[2] — newest-first per rollingWindowDates).
 */
function makeSupabaseAdminMock(selectResults: Array<{ fb: number; ga: number; tt: number }>) {
  const upsertCalls: Array<{ table: string; rows: unknown }> = [];
  const updateCalls: Array<{ table: string; payload: unknown }> = [];
  const selectCallCount = { n: 0 };

  function makeTableBuilder(table: string) {
    return {
      upsert: vi.fn((rows: unknown) => {
        upsertCalls.push({ table, rows });
        return Promise.resolve({ error: null });
      }),
      update: vi.fn((payload: unknown) => {
        const eqChain = {
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              eq: vi.fn(() => ({
                gte: vi.fn(() => ({
                  lt: vi.fn(() => {
                    updateCalls.push({ table, payload });
                    return Promise.resolve({ error: null });
                  }),
                })),
              })),
            })),
          })),
        };
        return eqChain;
      }),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() => {
              const idx = selectCallCount.n;
              selectCallCount.n += 1;
              // Use the injected result for this call; fall back to last
              // entry if the test injected fewer than the call count
              // (e.g. simulates "every retry reads the same prior").
              const r = selectResults[idx] ?? selectResults[selectResults.length - 1];
              return Promise.resolve({
                data: {
                  fb_spend_cad: r.fb,
                  ga_spend_cad: r.ga,
                  tt_spend_cad: r.tt,
                },
                error: null,
              });
            }),
          })),
        })),
      })),
    };
  }

  const admin = { from: vi.fn((table: string) => makeTableBuilder(table)) };
  return { admin, upsertCalls, updateCalls, selectCallCount };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================

describe('cronLive persist-rolling-3day retry idempotency (INN-10)', () => {
  it('preserves prior value across persist-rolling-3day retry (INN-10)', async () => {
    // Scenario: tick 1 already wrote fb_spend_cad=100 to data_daily (out
    // of band — we inject 100 as the SELECT result). Tick 2 fires.
    // Meta fetcher returns NULL (transient failure → spend null), Google
    // + TikTok succeed.
    //
    // Pre-fix: persist-rolling-3day's SELECT-then-UPSERT is one step.run.
    // On retry, the SELECT runs AFTER the first attempt's UPSERT —
    // reading whatever the first attempt wrote (not the original prior).
    // For "today" (dates[0]): first attempt writes `fb_spend_cad = 100`
    // (preserves prior because Meta is null). Retry's SELECT then reads
    // 100 (its own write). Both attempts agree by coincidence on this
    // exact value, but the contract is broken — any path where the retry
    // changes the prior would silently corrupt.
    //
    // Post-fix: SELECT moved to a separate step.run. The retry-aware
    // stub triggers retries ONLY on persist-rolling-3day (not on
    // select-prior-spend). The select step's callback runs once,
    // returns 100, and the persist step's retry consumes that
    // memoized 100 — NOT a fresh SELECT.
    //
    // To make the bug visible in a single attempt: we inject DIFFERENT
    // values for successive SELECT calls — the first SELECT call
    // returns 100, all subsequent SELECT calls return 200 (simulating
    // "the row was UPSERTed by us, then re-SELECTed by us"). The post-
    // fix code SELECTs once per date BEFORE persist; the per-date
    // priors map is built from the FIRST SELECT result (=100).
    //
    // Pre-fix the SECOND attempt of persist-rolling-3day re-runs the
    // inline SELECT and reads 200, then calls persistDayForStore with
    // `fbSpendCad = 200` for "today" → assertion fails.
    //
    // The exact wave count: rolling window is 3 dates × 2 attempts
    // (1 initial + 1 retry) × 1 SELECT-per-date = up to 6 SELECT calls
    // pre-fix, exactly 3 SELECT calls post-fix (because retries are
    // memoized).
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
    // Meta REJECTS → cron-live's .catch path makes fbSpendCad = null
    // → the persist branch falls back to priorFb from the (memoized) SELECT.
    vi.spyOn(metaFetcher, 'fetchMetaSpendForDayLight').mockRejectedValue(
      new Error('Meta API 503 — transient'),
    );
    vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsSpendForDay').mockResolvedValue({
      storeId: 'uzoshop',
      date: '2026-05-22',
      spend: 300,
      currency: 'CAD',
    impressions: 0,
    });
    vi.spyOn(tiktokFetcher, 'fetchTikTokSpendForDay').mockResolvedValue({
      storeId: 'uzoshop',
      date: '2026-05-22',
      spend: 60,
      currency: 'CAD',
    impressions: 0,
    });
    // Status fetchers (for refresh-effective-status step) — empty results
    // so the loop short-circuits without touching campaigns_daily.
    vi.spyOn(metaFetcher, 'fetchMetaBudgets').mockResolvedValue({
      currency: 'ILS',
      campaigns: {},
      adSets: {},
    });
    vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsAdGroupStatuses').mockResolvedValue([]);
    vi.spyOn(tiktokFetcher, 'fetchTikTokAdGroupStatuses').mockResolvedValue(new Map());

    // Inject SELECT results: first call (per date) returns 100, every
    // subsequent call returns 200. With the FIX, each date's SELECT
    // fires exactly once (memoized via the new select-prior-spend step)
    // so all priors stay at 100. Pre-fix, the retry's SELECT for today
    // would read 200.
    //
    // Note: the new fix calls SELECT 3 times (once per date in the
    // rolling window). Then persist-rolling-3day runs. On retry, the
    // persist step's callback re-runs but the SELECT step's results
    // are memoized — so the SELECT is NOT called again. Therefore:
    // post-fix total SELECT count = 3 (one per date, no retry-induced
    // duplicates). Pre-fix total SELECT count would be 3 + 3 = 6
    // (one per date for the initial attempt, three more for the retry's
    // re-execution).
    //
    // We inject 4 results so that if the bug exists, the retry's
    // SELECT for "today" reads 200 (the 4th injected value, simulating
    // "the UPSERT that just happened changed the row"). Post-fix only
    // 3 are consumed.
    const selectResults = [
      { fb: 100, ga: 200, tt: 50 }, // dates[0] = today initial SELECT (pre-fix OR memoized post-fix)
      { fb: 100, ga: 200, tt: 50 }, // dates[1] = yesterday
      { fb: 100, ga: 200, tt: 50 }, // dates[2] = day-before
      { fb: 200, ga: 200, tt: 50 }, // POST-UPSERT re-read (only fires pre-fix on retry)
      { fb: 200, ga: 200, tt: 50 },
      { fb: 200, ga: 200, tt: 50 },
    ];
    const { admin, upsertCalls } = makeSupabaseAdminMock(selectResults);
    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(
      admin as unknown as ReturnType<typeof supabaseAdminMod.getSupabaseAdmin>,
    );

    // Use a step stub that retries `persist-rolling-3day` exactly once.
    const { step, labels } = makeRetryingStepStub('persist-rolling-3day');
    await mod.runLiveForStore('uzoshop', { step });

    // Confirm the retry actually fired (otherwise the test is vacuous).
    expect(labels.some((l) => l.endsWith('(RETRY)'))).toBe(true);

    // ===== Core assertion =====
    // Filter to data_daily upsert payloads (skip products_daily, etc.).
    // After the retry, BOTH attempts of persist-rolling-3day produce
    // upsert rows. We assert that the LAST upserted fb_spend_cad for
    // each date is the original prior (100), NOT the re-read 200.
    const dataDailyUpserts = upsertCalls.filter((c) => c.table === 'data_daily');
    expect(dataDailyUpserts.length).toBeGreaterThanOrEqual(3);

    // Group the most-recent upsert per date. (Each upsert is a single
    // row in cron-live's case — the rows array has length 1.)
    const latestByDate = new Map<string, Record<string, unknown>>();
    for (const call of dataDailyUpserts) {
      const rows = Array.isArray(call.rows) ? call.rows : [call.rows];
      for (const row of rows) {
        const r = row as Record<string, unknown>;
        latestByDate.set(String(r.date), r);
      }
    }

    // Phase E1.6.2 (2026-05-30 evening hotfix): cron-live no longer
    // writes fb/ga/tt_spend_cad or fb/ga/tt_impressions to data_daily —
    // those columns are owned by the 3 hot_metrics worker branches.
    // The INN-10 prior-preserve invariant is replaced by a stricter
    // contract: the spend columns must NOT appear in cron-live's
    // upsert payload at all (so there's nothing to race with the
    // worker writes that land between SELECT and UPSERT).
    for (const [date, row] of latestByDate.entries()) {
      expect(row.fb_spend_cad, `fb_spend_cad must NOT be in cron-live payload for ${date} (workers own it post-E1.6.2)`).toBeUndefined();
      expect(row.ga_spend_cad, `ga_spend_cad must NOT be in cron-live payload for ${date} (workers own it post-E1.6.2)`).toBeUndefined();
      expect(row.fb_impressions, `fb_impressions must NOT be in cron-live payload for ${date} (workers own it post-E1.6.2)`).toBeUndefined();
      expect(row.ga_impressions, `ga_impressions must NOT be in cron-live payload for ${date} (workers own it post-E1.6.2)`).toBeUndefined();
    }
  });

  it('select-prior-spend step runs BEFORE persist-rolling-3day (step ordering pin)', async () => {
    // Post-fix invariant: every `select-prior-spend-*` label must appear
    // in the labels array BEFORE the `persist-rolling-3day` label. This
    // pins the new step ordering so a future refactor that accidentally
    // re-inlines the SELECT would fail.
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
      date: '2026-05-22',
      spend: 0,
      currency: 'CAD',
    impressions: 0,
    });
    vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsSpendForDay').mockResolvedValue({
      storeId: 'uzoshop',
      date: '2026-05-22',
      spend: 0,
      currency: 'CAD',
    impressions: 0,
    });
    vi.spyOn(tiktokFetcher, 'fetchTikTokSpendForDay').mockResolvedValue({
      storeId: 'uzoshop',
      date: '2026-05-22',
      spend: 0,
      currency: 'CAD',
    impressions: 0,
    });
    vi.spyOn(metaFetcher, 'fetchMetaBudgets').mockResolvedValue({
      currency: 'ILS',
      campaigns: {},
      adSets: {},
    });
    vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsAdGroupStatuses').mockResolvedValue([]);
    vi.spyOn(tiktokFetcher, 'fetchTikTokAdGroupStatuses').mockResolvedValue(new Map());

    const selectResults = [
      { fb: 100, ga: 200, tt: 50 },
      { fb: 100, ga: 200, tt: 50 },
      { fb: 100, ga: 200, tt: 50 },
    ];
    const { admin } = makeSupabaseAdminMock(selectResults);
    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(
      admin as unknown as ReturnType<typeof supabaseAdminMod.getSupabaseAdmin>,
    );

    const { step, labels } = makeStepStub();
    await mod.runLiveForStore('uzoshop', { step });

    // Find the earliest occurrence of any select-prior-spend label and
    // the index of persist-rolling-3day; assert the former < the latter.
    const persistIdx = labels.indexOf('persist-rolling-3day');
    expect(persistIdx).toBeGreaterThanOrEqual(0);
    const selectIndices = labels
      .map((l, i) => (l.startsWith('select-prior-spend-') ? i : -1))
      .filter((i) => i >= 0);
    expect(selectIndices.length).toBeGreaterThanOrEqual(1);
    for (const i of selectIndices) {
      expect(i).toBeLessThan(persistIdx);
    }
  });

  it('select-prior-spend is called once per date in the rolling window (3 dates → 3 calls)', async () => {
    // Post-fix invariant: the rolling window has 3 dates, so exactly
    // 3 select-prior-spend-* step.run labels should appear (one per
    // date). This catches a future refactor that off-by-ones the loop
    // or accidentally folds 3 SELECTs back into 1.
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
      date: '2026-05-22',
      spend: 0,
      currency: 'CAD',
    impressions: 0,
    });
    vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsSpendForDay').mockResolvedValue({
      storeId: 'uzoshop',
      date: '2026-05-22',
      spend: 0,
      currency: 'CAD',
    impressions: 0,
    });
    vi.spyOn(tiktokFetcher, 'fetchTikTokSpendForDay').mockResolvedValue({
      storeId: 'uzoshop',
      date: '2026-05-22',
      spend: 0,
      currency: 'CAD',
    impressions: 0,
    });
    vi.spyOn(metaFetcher, 'fetchMetaBudgets').mockResolvedValue({
      currency: 'ILS',
      campaigns: {},
      adSets: {},
    });
    vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsAdGroupStatuses').mockResolvedValue([]);
    vi.spyOn(tiktokFetcher, 'fetchTikTokAdGroupStatuses').mockResolvedValue(new Map());

    const selectResults = [
      { fb: 100, ga: 200, tt: 50 },
      { fb: 100, ga: 200, tt: 50 },
      { fb: 100, ga: 200, tt: 50 },
    ];
    const { admin } = makeSupabaseAdminMock(selectResults);
    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(
      admin as unknown as ReturnType<typeof supabaseAdminMod.getSupabaseAdmin>,
    );

    const { step, labels } = makeStepStub();
    await mod.runLiveForStore('uzoshop', { step });

    const selectLabels = labels.filter((l) => l.startsWith('select-prior-spend-'));
    expect(selectLabels.length).toBe(3);
    // Each label should be unique (date-suffixed).
    expect(new Set(selectLabels).size).toBe(3);
  });
});
