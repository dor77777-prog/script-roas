/**
 * Phase A 2026-05-29 — Task 14: last_live_tick_at written on all live-tick
 * upsert payloads (data_daily, products_daily, campaigns_daily, ads_daily).
 *
 * 7 tests:
 *   1. data_daily main-payload upsert contains last_live_tick_at
 *   2. data_daily upsert payload does NOT contain source / is_finalized keys
 *   3. products_daily rows each contain last_live_tick_at
 *   4. data_daily spend-only fallback still contains last_live_tick_at
 *   5. campaigns_daily rows each contain last_live_tick_at (all 3 platforms)
 *   6. ads_daily rows each contain last_live_tick_at (all 3 platforms)
 *   7. last_live_tick_at is identical across all rows in one persistCampaignsLive call
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as shopifyFetcher from '@/lib/fetchers/shopify';
import * as metaFetcher from '@/lib/fetchers/meta';
import * as googleAdsFetcher from '@/lib/fetchers/googleAds';
import * as tiktokFetcher from '@/lib/fetchers/tiktok';
import * as supabaseAdminMod from '@/lib/supabaseAdmin';
import type { SupabaseClient } from '@supabase/supabase-js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStepStub() {
  return {
    step: {
      async run<T>(_id: string, cb: () => Promise<T>): Promise<T> {
        return cb();
      },
    },
  };
}

/** Supabase mock that captures upsert payloads per table. */
function makeSupabaseMock() {
  const upsertsByTable: Record<string, unknown[][]> = {};

  function makeTableBuilder(table: string) {
    return {
      upsert: vi.fn((rows: unknown, _opts?: unknown) => {
        if (!upsertsByTable[table]) upsertsByTable[table] = [];
        const rowArr = Array.isArray(rows) ? (rows as unknown[]) : [rows];
        upsertsByTable[table].push(rowArr);
        return Promise.resolve({ error: null });
      }),
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(() => Promise.resolve({ data: null, error: null })),
          })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ error: null })),
        })),
      })),
    };
  }

  const admin = {
    from: vi.fn((table: string) => makeTableBuilder(table)),
    // Phase E1.6.2 (2026-05-30 evening) — cron-live + upsertDataDailySpend
    // now call `recompute_data_daily_derived(d)` after each write to keep
    // total/roas/gross/net atomically in sync with worker-fresh spend.
    // Tests can ignore the RPC; just acknowledge the call.
    rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
  } as unknown as ReturnType<typeof supabaseAdminMod.getSupabaseAdmin>;

  return { admin, upsertsByTable };
}

/** ISO timestamp pattern. */
const ISO_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ===========================================================================
// Tests 1–4: cronLive.ts  (data_daily + products_daily paths)
// ===========================================================================

describe('cron-live — last_live_tick_at on data_daily + products_daily', () => {
  /** Wire up all fetcher spies needed for cronLive to run without crashing. */
  function wireCommonSpies(withProducts = false) {
    vi.spyOn(shopifyFetcher, 'fetchShopifyDayRows').mockImplementation(
      async (storeId, date) => ({
        storeId,
        date,
        storeName: storeId,
        revenueCad: 500,
        grossRevenueCad: 500,
        refundDeductionCad: 0,
        customItemRefundCad: 0,
        productRows: withProducts
          ? [{ product_id: 'p1', product_title: 'Widget', units: 2, orders: 1, gross_revenue_cad: 300, net_revenue_cad: 290 }]
          : [],
      }),
    );
    vi.spyOn(shopifyFetcher, 'fetchShopifyOrdersAttribution').mockResolvedValue([]);
    vi.spyOn(metaFetcher, 'fetchMetaSpendForDayLight').mockResolvedValue({
      storeId: 'uzoshop', date: '2026-05-29', spend: 100, currency: 'CAD', impressions: 1000,
    });
    vi.spyOn(googleAdsFetcher, 'fetchGoogleAdsSpendForDay').mockResolvedValue({
      storeId: 'uzoshop', date: '2026-05-29', spend: 50, currency: 'CAD', impressions: 500,
    });
    vi.spyOn(tiktokFetcher, 'fetchTikTokSpendForDay').mockResolvedValue({
      storeId: 'uzoshop', date: '2026-05-29', spend: 25, currency: 'CAD', impressions: 250,
    });
  }

  it('1. data_daily main-payload upsert contains last_live_tick_at', async () => {
    const mod = await import('../cronLive');
    wireCommonSpies(false);
    const { admin, upsertsByTable } = makeSupabaseMock();
    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(admin);

    const { step } = makeStepStub();
    await mod.runLiveForStore('uzoshop', { step });

    const dataDailyUpserts = upsertsByTable['data_daily'] ?? [];
    expect(dataDailyUpserts.length).toBeGreaterThanOrEqual(1);

    // Main rows have revenue_cad (vs spend-only rows which don't)
    const mainRows = dataDailyUpserts
      .flat()
      .filter((r) => (r as Record<string, unknown>).revenue_cad !== undefined);
    expect(mainRows.length).toBeGreaterThanOrEqual(1);

    for (const row of mainRows) {
      const r = row as Record<string, unknown>;
      expect(r).toHaveProperty('last_live_tick_at');
      expect(typeof r.last_live_tick_at).toBe('string');
      expect(ISO_PATTERN.test(r.last_live_tick_at as string)).toBe(true);
    }
  });

  it('2. data_daily upsert payload does NOT contain source or is_finalized keys', async () => {
    const mod = await import('../cronLive');
    wireCommonSpies(false);
    const { admin, upsertsByTable } = makeSupabaseMock();
    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(admin);

    const { step } = makeStepStub();
    await mod.runLiveForStore('uzoshop', { step });

    const allDataRows = (upsertsByTable['data_daily'] ?? []).flat();
    expect(allDataRows.length).toBeGreaterThanOrEqual(1);

    for (const row of allDataRows) {
      const r = row as Record<string, unknown>;
      // source must NOT be in payload — migration default ('live_tick') handles it.
      expect(r).not.toHaveProperty('source');
      // is_finalized must NOT be in payload — migration default (false) handles it.
      expect(r).not.toHaveProperty('is_finalized');
    }
  });

  it('3. products_daily rows each contain last_live_tick_at', async () => {
    const mod = await import('../cronLive');
    wireCommonSpies(true);
    const { admin, upsertsByTable } = makeSupabaseMock();
    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(admin);

    const { step } = makeStepStub();
    await mod.runLiveForStore('uzoshop', { step });

    const productRows = (upsertsByTable['products_daily'] ?? []).flat();
    // At least 1 product row (rolling window has ≥1 date with products)
    expect(productRows.length).toBeGreaterThanOrEqual(1);

    for (const row of productRows) {
      const r = row as Record<string, unknown>;
      expect(r).toHaveProperty('last_live_tick_at');
      expect(typeof r.last_live_tick_at).toBe('string');
      expect(ISO_PATTERN.test(r.last_live_tick_at as string)).toBe(true);
    }
  });

  it('4. Phase E1.6.2 — spend-only fallback is a NO-OP (workers own spend columns; no data_daily upsert when Shopify fails)', async () => {
    // Post-Phase-E1.6.2 hotfix (2026-05-30 evening): cron-live no longer
    // writes fb/ga/tt_spend_cad / *_impressions to data_daily — those are
    // owned by the 3 hot_metrics worker branches. When Shopify fails and
    // no Shopify data is available, there is literally nothing for
    // cron-live to write (the platform spend would race the workers).
    // The spend-only branch is now a silent return.
    const mod = await import('../cronLive');
    vi.spyOn(shopifyFetcher, 'fetchShopifyDayRows').mockRejectedValue(
      new Error('Shopify 503'),
    );
    vi.spyOn(shopifyFetcher, 'fetchShopifyOrdersAttribution').mockResolvedValue([]);

    const { admin, upsertsByTable } = makeSupabaseMock();
    vi.spyOn(supabaseAdminMod, 'getSupabaseAdmin').mockReturnValue(admin);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { step } = makeStepStub();
    await mod.runLiveForStore('uzoshop', { step });

    // No spend-only upsert should fire — workers own those columns now.
    const dataDailyUpserts = (upsertsByTable['data_daily'] ?? []).flat();
    const spendOnlyRows = dataDailyUpserts.filter(
      (r) => (r as Record<string, unknown>).revenue_cad === undefined &&
              (r as Record<string, unknown>).fb_spend_cad !== undefined,
    );
    expect(spendOnlyRows).toEqual([]);
  });
});

// ===========================================================================
// Tests 5–7: persistCampaignsLive.ts  (campaigns_daily + ads_daily paths)
// ===========================================================================

describe('persistCampaignsLive — last_live_tick_at on campaigns_daily + ads_daily', () => {
  /** Build a minimal persistCampaignsLive input with one row per platform. */
  function makeInput(admin: SupabaseClient) {
    return {
      storeId: 'uzoshop',
      dateStr: '2026-05-29',
      admin,
      getFx: async () => 1 as number | null,
      meta: {
        adsetRows: [
          {
            campaignId: 'c1', campaignName: 'Meta Camp', adSetId: 'a1', adSetName: 'Meta AdSet',
            spend: 100, impressions: 1000, clicks: 50, conversions: 3, conversionValue: 250,
            currency: 'CAD',
          },
        ],
        adRows: [
          {
            campaignId: 'c1', campaignName: 'Meta Camp', adSetId: 'a1', adSetName: 'Meta AdSet',
            adId: 'meta-ad-1', adName: 'Meta Ad', spend: 100, impressions: 1000, clicks: 50,
            conversions: 3, conversionValue: 250, currency: 'CAD',
          },
        ],
        budgets: { currency: 'CAD', campaigns: {}, adSets: {} },
      },
      google: {
        adGroupRows: [
          {
            campaignId: 'gc1', campaignName: 'Google Camp', adSetId: 'ga1', adSetName: 'Google AG',
            spend: 60, impressions: 600, clicks: 30, conversions: 2, conversionValue: 180,
            effectiveStatus: 'ENABLED',
          },
        ],
        adRows: [
          {
            campaignId: 'gc1', campaignName: 'Google Camp', adSetId: 'ga1', adSetName: 'Google AG',
            adId: 'google-ad-1', adName: 'Google Ad', spend: 60, impressions: 600, clicks: 30,
            conversions: 2, conversionValue: 180, effectiveStatus: 'ENABLED',
          },
        ],
      },
      tiktok: {
        adRows: [
          {
            storeId: 'uzoshop',
            campaignId: 'tc1', campaignName: 'TikTok Camp', adSetId: 'ta1', adSetName: 'TikTok AG',
            adId: 'tiktok-ad-1', adName: 'TikTok Ad', spend: 40, impressions: 400, clicks: 20,
            conversions: 1, conversionValue: 100, effectiveStatus: null,
          },
        ],
      },
    };
  }

  function makeAdminMock() {
    const upsertsByTable: Record<string, unknown[][]> = {};
    // no-op delete chain — Phase A.5 v2 added DELETE-then-UPSERT for TikTok rows
    function makeNoOpDeleteChain() {
      const chain: Record<string, unknown> = {
        eq: () => chain,
        in: () => chain,
        not: () => Promise.resolve({ error: null }),
      };
      return chain;
    }
    const admin = {
      from: vi.fn((table: string) => ({
        delete: vi.fn(() => makeNoOpDeleteChain()),
        upsert: vi.fn((rows: unknown, _opts?: unknown) => {
          if (!upsertsByTable[table]) upsertsByTable[table] = [];
          upsertsByTable[table].push(Array.isArray(rows) ? (rows as unknown[]) : [rows]);
          return Promise.resolve({ error: null });
        }),
      })),
    } as unknown as SupabaseClient;
    return { admin, upsertsByTable };
  }

  it('5. campaigns_daily upsert rows each contain last_live_tick_at', async () => {
    const { persistCampaignsLive } = await import('@/lib/inngest/persistCampaignsLive');
    const { admin, upsertsByTable } = makeAdminMock();

    await persistCampaignsLive(makeInput(admin));

    const campaignRows = (upsertsByTable['campaigns_daily'] ?? []).flat();
    // 3 campaign rows: 1 Meta adset + 1 Google adgroup + 1 TikTok aggregated
    expect(campaignRows.length).toBeGreaterThanOrEqual(3);

    for (const row of campaignRows) {
      const r = row as Record<string, unknown>;
      expect(r).toHaveProperty('last_live_tick_at');
      expect(typeof r.last_live_tick_at).toBe('string');
      expect(ISO_PATTERN.test(r.last_live_tick_at as string)).toBe(true);
    }
  });

  it('6. ads_daily upsert rows each contain last_live_tick_at', async () => {
    const { persistCampaignsLive } = await import('@/lib/inngest/persistCampaignsLive');
    const { admin, upsertsByTable } = makeAdminMock();

    await persistCampaignsLive(makeInput(admin));

    const adRows = (upsertsByTable['ads_daily'] ?? []).flat();
    // 3 ad rows: 1 Meta + 1 Google + 1 TikTok
    expect(adRows.length).toBeGreaterThanOrEqual(3);

    for (const row of adRows) {
      const r = row as Record<string, unknown>;
      expect(r).toHaveProperty('last_live_tick_at');
      expect(typeof r.last_live_tick_at).toBe('string');
      expect(ISO_PATTERN.test(r.last_live_tick_at as string)).toBe(true);
    }
  });

  it('7. last_live_tick_at is identical across all rows in one persistCampaignsLive call', async () => {
    const { persistCampaignsLive } = await import('@/lib/inngest/persistCampaignsLive');
    const { admin, upsertsByTable } = makeAdminMock();

    await persistCampaignsLive(makeInput(admin));

    const allRows = [
      ...(upsertsByTable['campaigns_daily'] ?? []).flat(),
      ...(upsertsByTable['ads_daily'] ?? []).flat(),
    ];
    expect(allRows.length).toBeGreaterThanOrEqual(1);

    const timestamps = allRows.map(
      (r) => (r as Record<string, unknown>).last_live_tick_at as string,
    );
    // All timestamps in one call must be the same string (within-call invariant)
    const unique = new Set(timestamps);
    expect(unique.size).toBe(1);
  });
});
