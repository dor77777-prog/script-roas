/**
 * Audit fix 2026-05-24 (AUDIT INN-07, Phase 12.2.2) — locks the
 * Shopify-coupled-gating decouple contract for cronLive's
 * persist-rolling-3day step.
 *
 * Pre-fix surface (per .planning/AUDIT.md §Phase 12.2 + raw-returns/
 * inngest_cronLive.json #INN-07):
 *   When `shopifyOk === false` for a date in the rolling window,
 *   persist-rolling-3day's `if (!shopifyOk) { continue; }` short-circuit
 *   skipped EVERYTHING for that date — including the ad-platform spend
 *   columns (fb_spend_cad / ga_spend_cad / tt_spend_cad) that Meta /
 *   Google / TikTok HAD successfully fetched. Net effect: a Shopify
 *   503 for D-1 also blocked spend-recovery for D-1 even when ad-
 *   platform fetchers all succeeded.
 *
 * Post-fix (Option A — spendOnly flag added to persistDayForStore):
 *   When `!shopifyOk` AND `spendByDate[date]` has at least one non-null
 *   platform value, we still call `persistDayForStore(..., spend, {
 *   spendOnly: true })`. The spend-only branch in persistDayForStore
 *   builds a slimmer payload containing ONLY the spend columns
 *   (fb_spend_cad, ga_spend_cad, tt_spend_cad, total_spend_cad) +
 *   PK + store_name — Shopify-owned columns (revenue_cad,
 *   gross_revenue_cad, refund_deduction_cad, roas, gross_profit_cad,
 *   cogs_cad, net_profit_cad) are OMITTED so Supabase's ON CONFLICT
 *   DO UPDATE preserves whatever was last successfully written.
 *
 * Evidence pack: .planning/phases/12-codebase-audit-baseline/raw-returns/
 *   inngest_cronLive.json (finding INN-07).
 *
 * Test coverage (3 tests):
 *   1. Per-date partial failure — Shopify fails for dates[1] only;
 *      ad-platform fetchers succeed for all 3 dates. Assert dates[1]
 *      gets a spend-only UPSERT (fb_spend_cad present, revenue_cad
 *      absent from the payload). Assert dates[0] + dates[2] get
 *      full payloads.
 *   2. All-success regression guard — no Shopify failures. All 3 dates
 *      get full payloads (current happy-path behavior preserved).
 *   3. All-failure spend-only — all 3 dates fail Shopify but spend
 *      fetchers succeed. All 3 dates get spend-only UPSERTs.
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
 * Supabase admin mock that records every UPSERT payload and exposes
 * `selectResults` for injecting per-call SELECT outcomes (in order:
 * select-prior-spend × 3 dates, then any inline SELECT-then-UPSERT
 * round-trips inside persistDayForStore).
 */
function makeSupabaseAdminMock(
  selectResults: Array<{ fb: number; ga: number; tt: number }>,
) {
  const upsertCalls: Array<{ table: string; rows: unknown }> = [];
  const selectCallCount = { n: 0 };

  function makeTableBuilder(table: string) {
    return {
      upsert: vi.fn((rows: unknown) => {
        upsertCalls.push({ table, rows });
        return Promise.resolve({ error: null });
      }),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              gte: vi.fn(() => ({
                lt: vi.fn(() => Promise.resolve({ error: null })),
              })),
            })),
          })),
        })),
      })),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() => {
              const idx = selectCallCount.n;
              selectCallCount.n += 1;
              const r =
                selectResults[idx] ?? selectResults[selectResults.length - 1];
              return Promise.resolve({
                data: {
                  fb_spend_cad: r.fb,
                  ga_spend_cad: r.ga,
                  tt_spend_cad: r.tt,
                  total_spend_cad: r.fb + r.ga + r.tt,
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
  return { admin, upsertCalls, selectCallCount };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================

describe('cronLive Shopify-coupled gating decouple (INN-07)', () => {
  it('per-date partial Shopify failure — middle date still gets spend-only UPSERT', async () => {
    // Setup: rolling window has 3 dates (today, today-1, today-2).
    // Shopify FAILS for dates[1] only (the middle date). Meta + Google +
    // TikTok succeed for ALL 3 dates with fresh CAD values.
    //
    // POST-FIX expectation:
    //   - dates[0]: full UPSERT (revenue + spend cols)
    //   - dates[1]: spend-only UPSERT (fb/ga/tt/total spend cols only;
    //              NO revenue_cad, NO gross_revenue_cad, NO roas etc.)
    //   - dates[2]: full UPSERT
    //
    // PRE-FIX behavior (the bug): dates[1] gets NO UPSERT at all because
    // the early `continue;` skips the entire persist path.
    const mod = await import('../cronLive');

    // Mock Shopify: dates[1] fails (sentinel), others succeed.
    // We can't know dates ahead of time, but the order of calls matches
    // the rolling window — call-counter discriminates.
    let shopifyCallIdx = 0;
    vi.spyOn(shopifyFetcher, 'fetchShopifyDayRows').mockImplementation(
      async (storeId, date) => {
        const idx = shopifyCallIdx++;
        if (idx === 1) {
          // Sentinel: throw → cron-live's .catch path produces the
          // __shopifyFailed: true sentinel object.
          throw new Error('Shopify API 503');
        }
        return {
          storeId,
          date,
          storeName: 'uzoshop',
          revenueCad: 1500,
          productRows: [],
          customItemRefundCad: 0,
          grossRevenueCad: 1500,
          refundDeductionCad: 0,
        };
      },
    );
    // Orders attribution — empty so the orders branch short-circuits.
    vi.spyOn(shopifyFetcher, 'fetchShopifyOrdersAttribution').mockResolvedValue(
      [],
    );

    // Meta + Google + TikTok all succeed with fresh CAD values for every date.
    vi.spyOn(metaFetcher, 'fetchMetaSpendForDayLight').mockResolvedValue({
      storeId: 'uzoshop',
      date: '2026-05-22',
      spend: 100,
      currency: 'CAD',
    impressions: 0,
    });
    vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsSpendForDay').mockResolvedValue({
      storeId: 'uzoshop',
      date: '2026-05-22',
      spend: 200,
      currency: 'CAD',
    impressions: 0,
    });
    vi.spyOn(tiktokFetcher, 'fetchTikTokSpendForDay').mockResolvedValue({
      storeId: 'uzoshop',
      date: '2026-05-22',
      spend: 50,
      currency: 'CAD',
    impressions: 0,
    });

    // Status fetchers — empty results so the loop short-circuits.
    vi.spyOn(metaFetcher, 'fetchMetaBudgets').mockResolvedValue({
      currency: 'ILS',
      campaigns: {},
      adSets: {},
    });
    vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsAdGroupStatuses').mockResolvedValue(
      [],
    );
    vi.spyOn(tiktokFetcher, 'fetchTikTokAdGroupStatuses').mockResolvedValue(
      new Map(),
    );

    const selectResults = [
      { fb: 0, ga: 0, tt: 0 }, // dates[0]
      { fb: 0, ga: 0, tt: 0 }, // dates[1]
      { fb: 0, ga: 0, tt: 0 }, // dates[2]
      // Additional fallbacks (in case persistDayForStore's inline SELECT
      // also fires — spend-only branch may still SELECT for the existing-
      // row check; we feed the same zeros).
      { fb: 0, ga: 0, tt: 0 },
      { fb: 0, ga: 0, tt: 0 },
      { fb: 0, ga: 0, tt: 0 },
    ];
    const { admin, upsertCalls } = makeSupabaseAdminMock(selectResults);
    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(
      admin as unknown as ReturnType<typeof supabaseAdminMod.getSupabaseAdmin>,
    );

    const { step } = makeStepStub();
    await mod.runLiveForStore('uzoshop', { step });

    // Filter to data_daily upserts only (skip products_daily etc.).
    const dataDailyUpserts = upsertCalls.filter(
      (c) => c.table === 'data_daily',
    );

    // Each upsert call's `rows` is a single object (cron-live UPSERTs one
    // row at a time). Group by date.
    const upsertsByDate = new Map<string, Record<string, unknown>>();
    for (const call of dataDailyUpserts) {
      const rows = Array.isArray(call.rows) ? call.rows : [call.rows];
      for (const row of rows) {
        const r = row as Record<string, unknown>;
        // Use last-write-wins per date (in case persist branch re-UPSERTs).
        upsertsByDate.set(String(r.date), r);
      }
    }

    // Should have 3 distinct dates persisted (post-fix). Pre-fix would have 2.
    expect(upsertsByDate.size).toBe(3);

    // Identify which date corresponds to dates[1] (the failed-Shopify one).
    // The rolling window is today→oldest, so dates[1] is yesterday (offset -1).
    // The Shopify mock throws on call index 1 — that's the second
    // fetchShopifyDayRows invocation. The rolling-window fetchers call in
    // order dates[0], dates[1], dates[2], so the failed date is dates[1] =
    // (today - 1 day) in Asia/Jerusalem.
    const sortedDates = Array.from(upsertsByDate.keys()).sort().reverse(); // today first
    const failedDate = sortedDates[1]; // dates[1] = today-1

    const failedRow = upsertsByDate.get(failedDate)!;

    // Spend-only assertion: spend columns must be present, Shopify columns
    // must be ABSENT (so ON CONFLICT preserves prior good values).
    expect(failedRow.fb_spend_cad).toBeDefined();
    expect(failedRow.ga_spend_cad).toBeDefined();
    expect(failedRow.tt_spend_cad).toBeDefined();
    expect(failedRow.total_spend_cad).toBeDefined();
    expect(failedRow.fb_spend_cad).toBe(100);
    expect(failedRow.ga_spend_cad).toBe(200);
    expect(failedRow.tt_spend_cad).toBe(50);

    // Shopify-owned columns must NOT be in the spend-only payload.
    expect(failedRow).not.toHaveProperty('revenue_cad');
    expect(failedRow).not.toHaveProperty('gross_revenue_cad');
    expect(failedRow).not.toHaveProperty('refund_deduction_cad');
    expect(failedRow).not.toHaveProperty('roas');
    expect(failedRow).not.toHaveProperty('gross_profit_cad');
    expect(failedRow).not.toHaveProperty('cogs_cad');
    expect(failedRow).not.toHaveProperty('net_profit_cad');

    // Regression guard for the OTHER dates: full payload, revenue_cad present.
    for (const date of [sortedDates[0], sortedDates[2]]) {
      const row = upsertsByDate.get(date)!;
      expect(row).toHaveProperty('revenue_cad');
      expect(row).toHaveProperty('fb_spend_cad');
      expect(row.revenue_cad).toBe(1500);
    }
  });

  it('all-success regression guard — no Shopify failures, all 3 dates get full payloads', async () => {
    // Regression guard: pre-fix happy-path behavior must be preserved.
    // Every Shopify call succeeds; assert every date gets a full UPSERT
    // including revenue_cad.
    const mod = await import('../cronLive');

    vi.spyOn(shopifyFetcher, 'fetchShopifyDayRows').mockImplementation(
      async (storeId, date) => ({
        storeId,
        date,
        storeName: 'uzoshop',
        revenueCad: 2000,
        productRows: [],
        customItemRefundCad: 0,
        grossRevenueCad: 2000,
        refundDeductionCad: 0,
      }),
    );
    vi.spyOn(shopifyFetcher, 'fetchShopifyOrdersAttribution').mockResolvedValue(
      [],
    );
    vi.spyOn(metaFetcher, 'fetchMetaSpendForDayLight').mockResolvedValue({
      storeId: 'uzoshop',
      date: '2026-05-22',
      spend: 75,
      currency: 'CAD',
    impressions: 0,
    });
    vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsSpendForDay').mockResolvedValue({
      storeId: 'uzoshop',
      date: '2026-05-22',
      spend: 125,
      currency: 'CAD',
    impressions: 0,
    });
    vi.spyOn(tiktokFetcher, 'fetchTikTokSpendForDay').mockResolvedValue({
      storeId: 'uzoshop',
      date: '2026-05-22',
      spend: 25,
      currency: 'CAD',
    impressions: 0,
    });
    vi.spyOn(metaFetcher, 'fetchMetaBudgets').mockResolvedValue({
      currency: 'ILS',
      campaigns: {},
      adSets: {},
    });
    vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsAdGroupStatuses').mockResolvedValue(
      [],
    );
    vi.spyOn(tiktokFetcher, 'fetchTikTokAdGroupStatuses').mockResolvedValue(
      new Map(),
    );

    const selectResults = [
      { fb: 0, ga: 0, tt: 0 },
      { fb: 0, ga: 0, tt: 0 },
      { fb: 0, ga: 0, tt: 0 },
      { fb: 0, ga: 0, tt: 0 },
      { fb: 0, ga: 0, tt: 0 },
      { fb: 0, ga: 0, tt: 0 },
    ];
    const { admin, upsertCalls } = makeSupabaseAdminMock(selectResults);
    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(
      admin as unknown as ReturnType<typeof supabaseAdminMod.getSupabaseAdmin>,
    );

    const { step } = makeStepStub();
    await mod.runLiveForStore('uzoshop', { step });

    const dataDailyUpserts = upsertCalls.filter(
      (c) => c.table === 'data_daily',
    );
    const upsertsByDate = new Map<string, Record<string, unknown>>();
    for (const call of dataDailyUpserts) {
      const rows = Array.isArray(call.rows) ? call.rows : [call.rows];
      for (const row of rows) {
        const r = row as Record<string, unknown>;
        upsertsByDate.set(String(r.date), r);
      }
    }

    expect(upsertsByDate.size).toBe(3);
    for (const [, row] of upsertsByDate) {
      expect(row).toHaveProperty('revenue_cad');
      expect(row).toHaveProperty('fb_spend_cad');
      expect(row).toHaveProperty('gross_revenue_cad');
      expect(row.revenue_cad).toBe(2000);
      expect(row.fb_spend_cad).toBe(75);
    }
  });

  it('all-failure spend-only — every date fails Shopify but spend fetchers succeed', async () => {
    // All 3 Shopify calls fail. All 3 ad-platform fetchers succeed.
    // Expected post-fix: 3 spend-only UPSERTs (no revenue_cad).
    const mod = await import('../cronLive');

    vi.spyOn(shopifyFetcher, 'fetchShopifyDayRows').mockRejectedValue(
      new Error('Shopify down'),
    );
    vi.spyOn(shopifyFetcher, 'fetchShopifyOrdersAttribution').mockResolvedValue(
      [],
    );
    vi.spyOn(metaFetcher, 'fetchMetaSpendForDayLight').mockResolvedValue({
      storeId: 'uzoshop',
      date: '2026-05-22',
      spend: 80,
      currency: 'CAD',
    impressions: 0,
    });
    vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsSpendForDay').mockResolvedValue({
      storeId: 'uzoshop',
      date: '2026-05-22',
      spend: 160,
      currency: 'CAD',
    impressions: 0,
    });
    vi.spyOn(tiktokFetcher, 'fetchTikTokSpendForDay').mockResolvedValue({
      storeId: 'uzoshop',
      date: '2026-05-22',
      spend: 40,
      currency: 'CAD',
    impressions: 0,
    });
    vi.spyOn(metaFetcher, 'fetchMetaBudgets').mockResolvedValue({
      currency: 'ILS',
      campaigns: {},
      adSets: {},
    });
    vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsAdGroupStatuses').mockResolvedValue(
      [],
    );
    vi.spyOn(tiktokFetcher, 'fetchTikTokAdGroupStatuses').mockResolvedValue(
      new Map(),
    );

    const selectResults = [
      { fb: 0, ga: 0, tt: 0 },
      { fb: 0, ga: 0, tt: 0 },
      { fb: 0, ga: 0, tt: 0 },
      { fb: 0, ga: 0, tt: 0 },
      { fb: 0, ga: 0, tt: 0 },
      { fb: 0, ga: 0, tt: 0 },
    ];
    const { admin, upsertCalls } = makeSupabaseAdminMock(selectResults);
    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(
      admin as unknown as ReturnType<typeof supabaseAdminMod.getSupabaseAdmin>,
    );

    const { step } = makeStepStub();
    await mod.runLiveForStore('uzoshop', { step });

    const dataDailyUpserts = upsertCalls.filter(
      (c) => c.table === 'data_daily',
    );
    const upsertsByDate = new Map<string, Record<string, unknown>>();
    for (const call of dataDailyUpserts) {
      const rows = Array.isArray(call.rows) ? call.rows : [call.rows];
      for (const row of rows) {
        const r = row as Record<string, unknown>;
        upsertsByDate.set(String(r.date), r);
      }
    }

    // Post-fix: 3 spend-only UPSERTs. Pre-fix: 0 UPSERTs (continue skips all).
    expect(upsertsByDate.size).toBe(3);
    for (const [, row] of upsertsByDate) {
      // Spend cols present
      expect(row).toHaveProperty('fb_spend_cad');
      expect(row).toHaveProperty('ga_spend_cad');
      expect(row).toHaveProperty('tt_spend_cad');
      expect(row).toHaveProperty('total_spend_cad');
      expect(row.fb_spend_cad).toBe(80);
      expect(row.ga_spend_cad).toBe(160);
      expect(row.tt_spend_cad).toBe(40);
      // Shopify cols absent
      expect(row).not.toHaveProperty('revenue_cad');
      expect(row).not.toHaveProperty('gross_revenue_cad');
      expect(row).not.toHaveProperty('roas');
      expect(row).not.toHaveProperty('cogs_cad');
    }
  });
});
