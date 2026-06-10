// dashboard-web/src/inngest/functions/__tests__/cronDailyFxFailure.test.ts
//
// Audit fix 2026-05-23 (CRIT-5 / O4-CR-01): regression tests for the
// FX-failure → per-row CAD omit policy in cronDaily's persist-batch step.
//
// Pre-fix behavior (the bug we're pinning the fix for):
//   - `getFxRate` throws on Frankfurter outage / 5xx / missing rate.
//   - cronDaily's persist-batch issued data_daily + products_daily UPSERTs
//     FIRST, then computed Meta/Google/TikTok campaign+ad rows that
//     `await cadFor(...)` per row.
//   - When cadFor (or the inline TikTok FX block at :396-409) threw mid-step,
//     the data_daily + products_daily writes were ALREADY committed but the
//     campaigns/ads/orders/catalog writes never landed → partial state on
//     disk, dashboard showed Shopify revenue without spend for that day, and
//     the next cron tick had to walk a half-written row through ON CONFLICT.
//
// Post-fix behavior (mirrors v2 cron-LIVE a/WARN-3 pattern):
//   - cadFor returns `null` on FX failure (cached per-currency).
//   - Per-row payload builders OMIT the CAD-denominated keys when cadFor
//     returned null → Supabase ON CONFLICT only updates payload keys present
//     → prior CAD value preserved.
//   - data_daily upsert also omits tt_spend_cad + total_spend_cad +
//     gross_profit_cad + net_profit_cad + roas when TikTok FX failed
//     (consistency: don't write a fb+ga sum that contradicts the untouched
//     tt column).
//   - Persistence step DOES NOT throw; campaigns/ads/orders/catalog upserts
//     STILL fire (with the CAD keys omitted where FX failed).
//
// The operator pinned production-simulation discipline ("בדיקות מחמירות,
// דמה פרודקשיין, תוודא שכל תיקון שלך מושלם"). The scenarios below mirror
// the FIX-PLAN spec verbatim:
//   1. TikTok FX fails first call, succeeds on the second cron tick
//      (sequential recovery — verify omit-then-write semantics).
//   2. All FX calls throw → NO step throws; ALL CAD columns omitted;
//      data_daily still upserts the non-CAD columns.
//   3. 1 platform throws, 2 succeed → 2 platforms have fresh CAD;
//      failed platform's CAD keys omitted.

import { describe, it, expect, vi, beforeEach } from 'vitest';

type UpsertCall = { table: string; rows: unknown; opts: { onConflict?: string } };

type MockState = {
  upserts: UpsertCall[];
  /**
   * Per-currency FX behavior. The key is the source currency code
   * (e.g. 'ILS', 'USD'); the value is either a numeric rate or 'throw'
   * to simulate the Frankfurter outage path.
   *
   * We also support a `__sequence` map for tests that need to fail the
   * first call but succeed the second (sequential-recovery scenario).
   */
  fxBehaviorByCurrency: Record<string, number | 'throw'>;
  fxSequence: Record<string, Array<number | 'throw'>>;
  fxCallLog: Array<{ from: string; to: string; date: string }>;
};

const mockState = vi.hoisted<MockState>(() => ({
  upserts: [],
  fxBehaviorByCurrency: { ILS: 0.36, USD: 1.35 },
  fxSequence: {},
  fxCallLog: [],
}));

// ---------------------------------------------------------------------------
// Fetcher mocks — minimal but production-shaped.
// We give Meta, Google, and TikTok each at least 1 row of each kind (campaign
// + ad) so the per-row cadFor() path is exercised. Currencies match prod
// (Meta=ILS, Google=CAD, TikTok=USD) so the FX path actually fires.
// ---------------------------------------------------------------------------

vi.mock('@/lib/fetchers/shopify', () => ({
  fetchShopifyDayRows: vi.fn(async () => ({
    storeId: 'uzoshop',
    date: '2026-05-20',
    storeName: 'uzoshop',
    revenueCad: 1234,
    productRows: [
      {
        product_id: 'p1',
        product_title: 'P1',
        net_revenue_cad: 1000,
        gross_revenue_cad: 1000,
        units: 5,
        orders: 3,
      },
    ],
    customItemRefundCad: 0,
    grossRevenueCad: 1234,
    refundDeductionCad: 0,
  })),
  fetchShopifyOrdersAttribution: vi.fn(async () => [
    {
      storeId: 'uzoshop',
      orderId: 'O-A',
      date: '2026-05-20',
      totalCad: 200,
      source: 'meta-paid',
      utmSource: 'facebook',
      utmMedium: 'cpc',
      utmCampaign: 'spring',
      utmContent: null,
      fbclidPresent: true,
      gclidPresent: false,
      referrer: 'l.facebook.com',
      utmId: null,
      utmTerm: null,
      lineItems: [{ p: 'p1', u: 1, r: 200 }],
    },
  ]),
  fetchShopifyProductsCatalog: vi.fn(async () => [
    {
      storeId: 'uzoshop',
      productId: 'p1',
      title: 'P1',
      handle: 'p1',
      status: 'active',
      priceCad: 19.99,
      imageUrl: null,
      productType: null,
      vendor: null,
      updatedAt: '2026-05-20T00:00:00Z',
    },
  ]),
}));

vi.mock('@/lib/fetchers/meta', () => ({
  fetchMetaSpendForDay: vi.fn(async () => ({
    storeId: 'uzoshop',
    date: '2026-05-20',
    spend: 100,
    currency: 'ILS',
  })),
  fetchMetaAdSetInsights: vi.fn(async () => [
    {
      campaignId: 'mc1',
      campaignName: 'Meta Campaign 1',
      adSetId: 'mas1',
      adSetName: 'Meta AdSet 1',
      spend: 100,
      currency: 'ILS',
      impressions: 1000,
      clicks: 50,
      conversions: 5,
      conversionValue: 500,
    },
  ]),
  fetchMetaAdInsights: vi.fn(async () => [
    {
      storeId: 'uzoshop',
      date: '2026-05-20',
      platform: 'meta',
      campaignId: 'mc1',
      campaignName: 'Meta Campaign 1',
      adSetId: 'mas1',
      adSetName: 'Meta AdSet 1',
      adId: 'mad1',
      adName: 'Meta Ad 1',
      impressions: 600,
      clicks: 30,
      conversions: 3,
      spend: 60,
      currency: 'ILS',
      conversionValue: 300,
    },
  ]),
  fetchMetaBudgets: vi.fn(async () => ({
    currency: 'ILS',
    campaigns: {
      mc1: { dailyBudget: 50, lifetimeBudget: 0, bidStrategy: 'LOWEST_COST' },
    },
    adSets: {
      mas1: { dailyBudget: 0, lifetimeBudget: 0, campaignId: 'mc1' },
    },
  })),
}));

vi.mock('@/lib/fetchers/googleAds', () => ({
  fetchGoogleAdsSpendForDay: vi.fn(async () => ({
    storeId: 'uzoshop',
    date: '2026-05-20',
    spend: 50,
    currency: 'CAD',
  })),
  fetchGoogleAdsAdGroupInsights: vi.fn(async () => [
    {
      campaignId: 'gc1',
      campaignName: 'Google Campaign 1',
      adSetId: 'gag1',
      adSetName: 'Google AdGroup 1',
      spend: 50,
      currency: 'CAD',
      impressions: 500,
      clicks: 25,
      conversions: 2,
      conversionValue: 200,
    },
  ]),
  fetchGoogleAdsAdInsights: vi.fn(async () => [
    {
      storeId: 'uzoshop',
      date: '2026-05-20',
      platform: 'google',
      campaignId: 'gc1',
      campaignName: 'Google Campaign 1',
      adSetId: 'gag1',
      adSetName: 'Google AdGroup 1',
      adId: 'gad1',
      adName: 'Google Ad 1',
      impressions: 300,
      clicks: 15,
      conversions: 1,
      conversionValueCad: 90,
      spendCad: 25,
    },
  ]),
}));

vi.mock('@/lib/fetchers/tiktok', () => ({
  fetchTikTokSpendForDay: vi.fn(async () => ({
    storeId: 'uzoshop',
    date: '2026-05-20',
    spend: 40,
    currency: 'USD',
  })),
  fetchTikTokAdInsights: vi.fn(async () => [
    {
      campaignId: 'tc1',
      campaignName: 'TikTok Campaign 1',
      adGroupId: 'tag1',
      adGroupName: 'TikTok AdGroup 1',
      adId: 'tad1',
      adName: 'TikTok Ad 1',
      spend: 25,
      currency: 'USD',
      impressions: 400,
      clicks: 20,
      conversions: 1,
      conversionValue: 80,
      effectiveStatus: 'ADGROUP_STATUS_DELIVERY_OK',
    },
  ]),
  fetchTikTokAdvertiserInfo: vi.fn(async () => ({
    advertiserId: '7306450983905787906',
    name: 'DOD',
    currency: 'USD',
    timezone: 'Etc/GMT-2',
  })),
}));

vi.mock('@/lib/fetchers/manualOverrides', () => ({
  mergeOverridesFromSupabase: vi.fn(async () => ({
    fbSpendCad: 36, // 100 ILS @ 0.36 = 36 CAD
    gaSpendCad: 50,
    totalSpendCad: 86,
    overridesApplied: { meta: false, google: false },
  })),
}));

// ---------------------------------------------------------------------------
// FX mock — the heart of these tests.
// Per-currency override: 'throw' simulates the Frankfurter outage path
// (getFxRate throws). Numeric returns the rate as-is.
// Sequence override: per-currency array of behaviors; pops one per call.
// ---------------------------------------------------------------------------
vi.mock('@/lib/fetchers/fx', () => ({
  getFxRate: vi.fn(async (from: string, to: string, date: string) => {
    mockState.fxCallLog.push({ from, to, date });
    const sequenced = mockState.fxSequence[from];
    if (sequenced && sequenced.length > 0) {
      const next = sequenced.shift()!;
      if (next === 'throw') throw new Error(`FX ${from}→${to} mock-throw`);
      return next;
    }
    const behavior = mockState.fxBehaviorByCurrency[from];
    if (behavior === 'throw') throw new Error(`FX ${from}→${to} mock-throw`);
    if (typeof behavior === 'number') return behavior;
    throw new Error(`unmocked FX ${from}→${to}`);
  }),
}));

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({
    from: (table: string) => ({
      upsert: (rows: unknown, opts: { onConflict?: string } = {}) => {
        mockState.upserts.push({ table, rows, opts });
        return Promise.resolve({ error: null });
      },
      delete: () => {
        // Phase A.5 v2 — stub the DELETE chain used by the TikTok
        // DELETE-then-UPSERT path. Tests here don't assert on DELETE
        // calls; we just need the chain to resolve without throwing.
        const chain: Record<string, unknown> = {};
        const c = {
          eq: (_col: string, _v: unknown) => c,
          in: (_col: string, _v: unknown[]) => c,
          not: (_col: string, _op: string, _v: string) => Promise.resolve({ error: null }),
        };
        void chain;
        return c;
      },
    }),
    rpc: (_fn: string, _args: unknown) => Promise.resolve({ error: null }),
  }),
}));

import { runDailyForStore } from '../cronDaily';

function makeMockStep() {
  const ids: string[] = [];
  return {
    step: {
      run: async (id: string, cb: () => Promise<unknown>) => {
        ids.push(id);
        return cb();
      },
    },
    ids,
  };
}

beforeEach(() => {
  mockState.upserts = [];
  mockState.fxBehaviorByCurrency = { ILS: 0.36, USD: 1.35 };
  mockState.fxSequence = {};
  mockState.fxCallLog = [];
});

describe('cronDaily — FX failure preserves prior CAD via per-row omit (CRIT-5)', () => {
  // -----------------------------------------------------------------------
  // Scenario 1: TikTok FX fails on the first cron tick; recovers on the second.
  //
  // First tick (FX throws for USD):
  //   - data_daily upsert succeeds WITHOUT tt_spend_cad / total_spend_cad /
  //     roas / gross_profit_cad / net_profit_cad keys.
  //   - revenue_cad / gross_revenue_cad / refund_deduction_cad / fb_spend_cad
  //     / ga_spend_cad / cogs_cad still update.
  //   - TikTok ads_daily row OMITS spend_cad + conversion_value_cad.
  //   - TikTok campaigns_daily row OMITS spend_cad + conversion_value_cad.
  //   - Meta + Google campaigns/ads upserts STILL FIRE.
  //   - orders_attribution + product_catalog upserts STILL FIRE.
  //
  // Second tick (FX recovers):
  //   - Now all CAD columns land — proves the omit-then-write semantics.
  // -----------------------------------------------------------------------
  it('Scenario 1: TikTok FX throws first call, succeeds second → first tick omits CAD keys, second tick writes them', async () => {
    // First tick: USD FX throws.
    mockState.fxBehaviorByCurrency = { ILS: 0.36, USD: 'throw' };

    const { step: step1 } = makeMockStep();
    await expect(
      runDailyForStore('uzoshop', '2026-05-20', { step: step1 }),
    ).resolves.toBeDefined();

    // data_daily row built on tick 1.
    const dataDailyTick1 = mockState.upserts.find(
      (u) => u.table === 'data_daily',
    );
    expect(dataDailyTick1).toBeDefined();
    const tick1Row = dataDailyTick1!.rows as Record<string, unknown>;

    // CAD columns dependent on TikTok FX must be ABSENT from the payload
    // (ON CONFLICT preserves prior).
    expect('tt_spend_cad' in tick1Row).toBe(false);
    expect('total_spend_cad' in tick1Row).toBe(false);
    expect('roas' in tick1Row).toBe(false);
    expect('gross_profit_cad' in tick1Row).toBe(false);
    expect('net_profit_cad' in tick1Row).toBe(false);

    // Non-FX columns must still update.
    expect(tick1Row.revenue_cad).toBe(1234);
    expect(tick1Row.gross_revenue_cad).toBe(1234);
    expect(tick1Row.refund_deduction_cad).toBe(0);
    expect(tick1Row.fb_spend_cad).toBe(36);
    expect(tick1Row.ga_spend_cad).toBe(50);
    expect(typeof tick1Row.cogs_cad).toBe('number');

    // TikTok ads_daily row omits spend_cad / conversion_value_cad.
    const adsCall = mockState.upserts.find((u) => u.table === 'ads_daily');
    expect(adsCall).toBeDefined();
    const adsRows = adsCall!.rows as Array<Record<string, unknown>>;
    const tiktokAdRow = adsRows.find((r) => r.platform === 'tiktok');
    expect(tiktokAdRow).toBeDefined();
    expect('spend_cad' in tiktokAdRow!).toBe(false);
    expect('conversion_value_cad' in tiktokAdRow!).toBe(false);

    // Meta ad row STILL has spend_cad (ILS FX still works).
    const metaAdRow = adsRows.find((r) => r.platform === 'meta');
    expect(metaAdRow).toBeDefined();
    expect('spend_cad' in metaAdRow!).toBe(true);
    expect(metaAdRow!.spend_cad).toBeCloseTo(60 * 0.36);

    // TikTok campaigns_daily row omits spend_cad / conversion_value_cad.
    const campaignsCalls = mockState.upserts.filter(
      (u) => u.table === 'campaigns_daily',
    );
    const tiktokCampaignsCall = campaignsCalls.find((c) => {
      const rows = c.rows as Array<{ platform?: string }>;
      return rows.some((r) => r.platform === 'tiktok');
    });
    expect(tiktokCampaignsCall).toBeDefined();
    const tiktokCampaignRow = (
      tiktokCampaignsCall!.rows as Array<Record<string, unknown>>
    ).find((r) => r.platform === 'tiktok');
    expect(tiktokCampaignRow).toBeDefined();
    expect('spend_cad' in tiktokCampaignRow!).toBe(false);
    expect('conversion_value_cad' in tiktokCampaignRow!).toBe(false);

    // Other writes proceeded normally.
    expect(
      mockState.upserts.some((u) => u.table === 'orders_attribution'),
    ).toBe(true);
    expect(
      mockState.upserts.some((u) => u.table === 'product_catalog'),
    ).toBe(true);
    expect(
      mockState.upserts.some((u) => u.table === 'products_daily'),
    ).toBe(true);

    // -------- Second tick: FX recovers. --------
    mockState.upserts = [];
    mockState.fxCallLog = [];
    mockState.fxBehaviorByCurrency = { ILS: 0.36, USD: 1.35 };

    const { step: step2 } = makeMockStep();
    await runDailyForStore('uzoshop', '2026-05-20', { step: step2 });

    const dataDailyTick2 = mockState.upserts.find(
      (u) => u.table === 'data_daily',
    );
    expect(dataDailyTick2).toBeDefined();
    const tick2Row = dataDailyTick2!.rows as Record<string, unknown>;
    // Now all CAD columns are present.
    expect('tt_spend_cad' in tick2Row).toBe(true);
    expect('total_spend_cad' in tick2Row).toBe(true);
    expect('roas' in tick2Row).toBe(true);
    expect('gross_profit_cad' in tick2Row).toBe(true);
    expect('net_profit_cad' in tick2Row).toBe(true);
    expect(tick2Row.tt_spend_cad).toBeCloseTo(40 * 1.35);
    expect(tick2Row.total_spend_cad).toBeCloseTo(86 + 40 * 1.35);

    // Tick 2 TikTok ad row now has the CAD keys.
    const adsCall2 = mockState.upserts.find((u) => u.table === 'ads_daily');
    const tiktokAdRow2 = (adsCall2!.rows as Array<Record<string, unknown>>).find(
      (r) => r.platform === 'tiktok',
    );
    expect('spend_cad' in tiktokAdRow2!).toBe(true);
    expect(tiktokAdRow2!.spend_cad).toBeCloseTo(25 * 1.35);
  });

  // -----------------------------------------------------------------------
  // Scenario 2: ALL FX calls throw → no step throws; all CAD columns omitted.
  // -----------------------------------------------------------------------
  it('Scenario 2: ALL FX calls throw → persist-batch completes, ALL platforms omit spend_cad in upserts', async () => {
    mockState.fxBehaviorByCurrency = { ILS: 'throw', USD: 'throw' };

    const { step } = makeMockStep();
    // Critical: must NOT throw.
    await expect(
      runDailyForStore('uzoshop', '2026-05-20', { step }),
    ).resolves.toBeDefined();

    // data_daily landed without TikTok-dependent CAD columns.
    const dataDailyCall = mockState.upserts.find(
      (u) => u.table === 'data_daily',
    );
    expect(dataDailyCall).toBeDefined();
    const ddRow = dataDailyCall!.rows as Record<string, unknown>;
    expect('tt_spend_cad' in ddRow).toBe(false);
    expect('total_spend_cad' in ddRow).toBe(false);
    // Non-FX columns still updated.
    expect(ddRow.revenue_cad).toBe(1234);
    expect(ddRow.fb_spend_cad).toBe(36);
    expect(ddRow.ga_spend_cad).toBe(50);

    // Meta campaigns_daily row omits spend_cad + conversion_value_cad
    // (ILS→CAD failed for the per-row Meta values).
    const campaignsCalls = mockState.upserts.filter(
      (u) => u.table === 'campaigns_daily',
    );
    const metaCampCall = campaignsCalls.find((c) => {
      const rows = c.rows as Array<{ platform?: string }>;
      return rows.some((r) => r.platform === 'meta');
    });
    expect(metaCampCall).toBeDefined();
    const metaCampRow = (
      metaCampCall!.rows as Array<Record<string, unknown>>
    ).find((r) => r.platform === 'meta')!;
    expect('spend_cad' in metaCampRow).toBe(false);
    expect('conversion_value_cad' in metaCampRow).toBe(false);
    // Per-CRIT-5 spec: budget columns are still present (with prior values
    // preserved on ON CONFLICT because cadFor returned null and we omit them
    // when the raw budget was > 0).
    expect('campaign_budget_cad' in metaCampRow).toBe(false);

    // Meta + TikTok ad rows omit spend_cad; Google ad row keeps its (native
    // CAD) value because cadFor isn't invoked for already-CAD currencies.
    const adsCall = mockState.upserts.find((u) => u.table === 'ads_daily');
    const adsRows = adsCall!.rows as Array<Record<string, unknown>>;
    const metaAd = adsRows.find((r) => r.platform === 'meta')!;
    const googleAd = adsRows.find((r) => r.platform === 'google')!;
    const tiktokAd = adsRows.find((r) => r.platform === 'tiktok')!;
    expect('spend_cad' in metaAd).toBe(false);
    expect('spend_cad' in googleAd).toBe(true); // Google is CAD-native
    expect(googleAd.spend_cad).toBe(25);
    expect('spend_cad' in tiktokAd).toBe(false);

    // Shopify-derived writes still landed.
    expect(
      mockState.upserts.some((u) => u.table === 'products_daily'),
    ).toBe(true);
    expect(
      mockState.upserts.some((u) => u.table === 'orders_attribution'),
    ).toBe(true);
    expect(
      mockState.upserts.some((u) => u.table === 'product_catalog'),
    ).toBe(true);
  });

  // -----------------------------------------------------------------------
  // Scenario 3: TikTok FX throws, but ILS (Meta) works → 2 platforms fresh,
  //             1 platform's CAD keys omitted.
  // -----------------------------------------------------------------------
  it('Scenario 3: TikTok FX throws but Meta/Google FX succeed → Meta+Google CAD fresh, TikTok CAD omitted', async () => {
    // ILS succeeds, USD throws.
    mockState.fxBehaviorByCurrency = { ILS: 0.36, USD: 'throw' };

    const { step } = makeMockStep();
    await expect(
      runDailyForStore('uzoshop', '2026-05-20', { step }),
    ).resolves.toBeDefined();

    // Meta campaigns_daily row still has spend_cad (ILS FX worked).
    const campaignsCalls = mockState.upserts.filter(
      (u) => u.table === 'campaigns_daily',
    );
    const metaCampCall = campaignsCalls.find((c) => {
      const rows = c.rows as Array<{ platform?: string }>;
      return rows.some((r) => r.platform === 'meta');
    });
    expect(metaCampCall).toBeDefined();
    const metaCampRow = (
      metaCampCall!.rows as Array<Record<string, unknown>>
    ).find((r) => r.platform === 'meta')!;
    expect('spend_cad' in metaCampRow).toBe(true);
    expect(metaCampRow.spend_cad).toBeCloseTo(100 * 0.36);

    // Google campaigns_daily row is CAD-native → always present.
    const googleCampCall = campaignsCalls.find((c) => {
      const rows = c.rows as Array<{ platform?: string }>;
      return rows.some((r) => r.platform === 'google');
    });
    expect(googleCampCall).toBeDefined();
    const googleCampRow = (
      googleCampCall!.rows as Array<Record<string, unknown>>
    ).find((r) => r.platform === 'google')!;
    expect(googleCampRow.spend_cad).toBe(50);

    // TikTok campaigns_daily row OMITS spend_cad.
    const tiktokCampCall = campaignsCalls.find((c) => {
      const rows = c.rows as Array<{ platform?: string }>;
      return rows.some((r) => r.platform === 'tiktok');
    });
    expect(tiktokCampCall).toBeDefined();
    const tiktokCampRow = (
      tiktokCampCall!.rows as Array<Record<string, unknown>>
    ).find((r) => r.platform === 'tiktok')!;
    expect('spend_cad' in tiktokCampRow).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Scenario 4 (P1-11, 2026-06-10): MERGE-layer FX failure. The
  // apply-manual-overrides step's spendToCad now returns null instead of
  // throwing (the old throw failed the WHOLE step pre-persist — Shopify +
  // Google + TikTok lost for the day). persist-batch must OMIT fb_spend_cad
  // (+ the fb_impressions pair + every derived total) and still land all
  // other writes.
  // -----------------------------------------------------------------------
  it('Scenario 4 (P1-11): merge-layer returns fbSpendCad=null → data_daily omits fb_spend_cad + totals; everything else lands', async () => {
    const overridesMod = await import('@/lib/fetchers/manualOverrides');
    (overridesMod.mergeOverridesFromSupabase as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({
        fbSpendCad: null, // merge-layer FX failure (Meta is ILS nightly)
        gaSpendCad: 50,
        ttSpendCad: 0,
        totalSpendCad: null, // no partial sums
        overridesApplied: { meta: false, google: false, tiktok: false },
      });

    const { step } = makeMockStep();
    // Critical: the run must NOT throw (the old behavior failed the whole
    // nightly persist for the store).
    await expect(
      runDailyForStore('uzoshop', '2026-05-20', { step }),
    ).resolves.toBeDefined();

    const dataDailyCall = mockState.upserts.find((u) => u.table === 'data_daily');
    expect(dataDailyCall).toBeDefined();
    const row = dataDailyCall!.rows as Record<string, unknown>;
    // fb pair omitted → ON CONFLICT preserves prior values.
    expect('fb_spend_cad' in row).toBe(false);
    expect('fb_impressions' in row).toBe(false);
    // Derived totals omitted (would contradict the preserved fb column).
    expect('total_spend_cad' in row).toBe(false);
    expect('roas' in row).toBe(false);
    expect('gross_profit_cad' in row).toBe(false);
    expect('net_profit_cad' in row).toBe(false);
    // ga pair + revenue still land.
    expect(row.ga_spend_cad).toBe(50);
    expect(row.revenue_cad).toBe(1234);
    // Sibling tables still write.
    expect(mockState.upserts.some((u) => u.table === 'products_daily')).toBe(true);
    expect(mockState.upserts.some((u) => u.table === 'orders_attribution')).toBe(true);
  });
});
