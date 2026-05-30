/**
 * postgresReaders.test.ts — shape-parity tests against the Sheets-side readers.
 *
 * Phase 05.6-17 (dormant in 05.6 — wired in plan 19, default-flipped in 05.7).
 *
 * Cardinal invariant (D-E3): each Postgres reader returns the SAME shape as
 * its sheets.ts counterpart. Route handlers will branch on readFrom() in plan
 * 19 without any shape adaptation downstream.
 *
 * Mocking strategy: vi.mock('@/lib/supabase') replaces getSupabase() with a
 * synthetic client whose .from(...).select(...).gte(...).lte(...) chain
 * resolves to a controlled `{ data, error }` payload. The default
 * implementation returns an empty row set; each test rebuilds the chain via
 * the `setSupabaseRows`/`setSupabaseError` helpers below to drive specific
 * scenarios (range filtering, derived-field computation, error propagation).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// State holder that mocked client closures read from at call time. We can
// reassign these per-test without re-registering the vi.mock factory.
let mockRows: unknown[] = [];
let mockError: { message: string } | null = null;
const gteCalls: Array<{ column: string; value: unknown }> = [];
const lteCalls: Array<{ column: string; value: unknown }> = [];
const fromCalls: string[] = [];

function setSupabaseRows(rows: unknown[]) {
  mockRows = rows;
  mockError = null;
}
function setSupabaseError(message: string) {
  mockRows = [];
  mockError = { message };
}

vi.mock('@/lib/supabase', () => {
  // Each call to .from() returns a chainable query that resolves to the
  // current mockRows/mockError when awaited. Range filters (.gte/.lte) are
  // recorded so we can assert they were applied. The chain is THENABLE so
  // `await q` works the same as `await q.gte(...).lte(...)`.
  const makeQuery = () => {
    const q: Record<string, unknown> = {};
    q.select = vi.fn(() => q);
    q.gte = vi.fn((column: string, value: unknown) => {
      gteCalls.push({ column, value });
      return q;
    });
    q.lte = vi.fn((column: string, value: unknown) => {
      lteCalls.push({ column, value });
      return q;
    });
    q.order = vi.fn(() => q);
    q.range = vi.fn(() => q);
    q.then = (resolve: (v: { data: unknown[] | null; error: { message: string } | null }) => unknown) =>
      Promise.resolve({ data: mockError ? null : mockRows, error: mockError }).then(resolve);
    return q;
  };
  return {
    getSupabase: () => ({
      from: vi.fn((table: string) => {
        fromCalls.push(table);
        return makeQuery();
      }),
    }),
  };
});

import {
  fetchDailyDataFromPostgres,
  fetchStoreMetaFromPostgres,
  fetchDashboardStateFromPostgres,
  fetchProductsFromPostgres,
  fetchCampaignsFromPostgres,
  fetchAdsFromPostgres,
  fetchOrdersAttributionFromPostgres,
  fetchProductCatalogFromPostgres,
} from '../postgresReaders';

beforeEach(() => {
  mockRows = [];
  mockError = null;
  gteCalls.length = 0;
  lteCalls.length = 0;
  fromCalls.length = 0;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('postgresReaders — shape parity with sheets.ts (D-E3)', () => {
  // ──────────────────────────────────────────────────────────────────
  // Test 1 — DailyRow shape parity (data_daily → DailyRow[])
  // ──────────────────────────────────────────────────────────────────
  it('Test 1: fetchDailyDataFromPostgres returns DailyRow[] with all required fields', async () => {
    setSupabaseRows([
      {
        date: '2026-05-15',
        store_id: 'uzoshop',
        store_name: 'uzoshop',
        fb_spend_cad: 100,
        ga_spend_cad: 50,
        total_spend_cad: 150,
        revenue_cad: 600,
        roas: 4,
        gross_profit_cad: 450,
        cogs_cad: 150,
        net_profit_cad: 300,
      },
    ]);

    const rows = await fetchDailyDataFromPostgres();

    expect(rows).toHaveLength(1);
    const r = rows[0];
    // Every field the sheets.ts:fetchDailyData contract emits MUST be present.
    expect(r).toHaveProperty('date', '2026-05-15');
    expect(r).toHaveProperty('storeId', 'uzoshop');
    expect(r).toHaveProperty('storeName', 'uzoshop');
    expect(r).toHaveProperty('fbSpend', 100);
    expect(r).toHaveProperty('gaSpend', 50);
    expect(r).toHaveProperty('totalSpend', 150);
    expect(r).toHaveProperty('revenue', 600);
    expect(r).toHaveProperty('roas', 4);
    expect(r).toHaveProperty('grossProfit', 450);
    expect(r).toHaveProperty('cogs', 150);
    expect(r).toHaveProperty('netProfit', 300);
    expect(r).toHaveProperty('hasCogs', true);
    expect(fromCalls).toContain('data_daily');
  });

  // ──────────────────────────────────────────────────────────────────
  // Test 2 — Range filter applied at the query level
  // ──────────────────────────────────────────────────────────────────
  it('Test 2: range filter (gte/lte on date) is applied when opts.range provided', async () => {
    setSupabaseRows([]);
    await fetchDailyDataFromPostgres({ range: { from: '2026-05-01', to: '2026-05-20' } });
    expect(gteCalls).toEqual(expect.arrayContaining([{ column: 'date', value: '2026-05-01' }]));
    expect(lteCalls).toEqual(expect.arrayContaining([{ column: 'date', value: '2026-05-20' }]));

    // When no range is provided, no gte/lte chain is invoked.
    gteCalls.length = 0;
    lteCalls.length = 0;
    await fetchDailyDataFromPostgres();
    expect(gteCalls).toHaveLength(0);
    expect(lteCalls).toHaveLength(0);
  });

  // ──────────────────────────────────────────────────────────────────
  // Test 3 — Derived fields computed when DB values are null
  // ──────────────────────────────────────────────────────────────────
  it('Test 3: derived fields computed when DB values are null (roas, grossProfit, cogs, netProfit)', async () => {
    setSupabaseRows([
      {
        date: '2026-05-15',
        store_id: 'uzoshop',
        store_name: 'uzoshop',
        fb_spend_cad: 100,
        ga_spend_cad: 50,
        total_spend_cad: null, // ← will be derived from fb + ga
        revenue_cad: 600,
        roas: null,            // ← will be derived from revenue / totalSpend
        gross_profit_cad: null, // ← will be derived from revenue - totalSpend
        cogs_cad: null,        // ← will be derived as 25% of revenue
        net_profit_cad: null,  // ← will be derived as revenue - totalSpend - cogs
      },
    ]);

    const [r] = await fetchDailyDataFromPostgres();

    // totalSpend = fbSpend + gaSpend when DB column is null
    expect(r.totalSpend).toBe(150);
    // roas = revenue / totalSpend when DB column is null
    expect(r.roas).toBeCloseTo(600 / 150, 6);
    // grossProfit = revenue - totalSpend when DB column is null
    expect(r.grossProfit).toBe(450);
    // cogs = revenue * COGS_RATE_OF_REVENUE (0.25) when DB column is null
    expect(r.cogs).toBeCloseTo(600 * 0.25, 6);
    // netProfit = revenue - totalSpend - cogs when DB column is null
    expect(r.netProfit).toBeCloseTo(600 - 150 - 150, 6);
  });

  // ──────────────────────────────────────────────────────────────────
  // Test 4 — StoreMetaRow shape parity (stores → StoreMetaRow[])
  // ──────────────────────────────────────────────────────────────────
  it('Test 4: fetchStoreMetaFromPostgres returns StoreMetaRow[] mirroring sheets.ts:fetchStoreMeta', async () => {
    setSupabaseRows([
      {
        id: 'uzoshop',
        name: 'uzoshop',
        plan_display_name: 'Shopify Plus',
        shopify_plus: true,
        partner_dev: false,
        updated_at: '2026-05-15T00:00:00Z',
        last_error: null,
        meta_ad_account_id: '26442930835313109',
        google_ads_customer_id: '4014537400',
      },
      {
        id: 'zolplus',
        name: 'Zol Plus',
        plan_display_name: null,
        shopify_plus: false,
        partner_dev: false,
        updated_at: null,
        last_error: 'Last refresh failed',
        meta_ad_account_id: 'act_800776975668368', // ← act_ prefix MUST be stripped (matches sheets.ts)
        google_ads_customer_id: null,
      },
    ]);

    const rows = await fetchStoreMetaFromPostgres();

    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      storeId: 'uzoshop',
      storeName: 'uzoshop',
      planDisplayName: 'Shopify Plus',
      shopifyPlus: true,
      partnerDevelopment: false,
      updatedAt: '2026-05-15T00:00:00Z',
      lastError: null,
      metaAdAccountId: '26442930835313109',
      googleAdsCustomerId: '4014537400',
      // Phase A.5 — postgres reader stays pure (null); the route enriches
      // from env var. The shape parity test asserts the reader's contract.
      tiktokAdvertiserId: null,
    });
    // act_ prefix stripping matches sheets.ts:275 normalization
    expect(rows[1].metaAdAccountId).toBe('800776975668368');
    expect(rows[1].googleAdsCustomerId).toBeNull();
    expect(rows[1].lastError).toBe('Last refresh failed');
    expect(fromCalls).toContain('stores');
  });

  // ──────────────────────────────────────────────────────────────────
  // Test 5 — DashboardState shape parity (dashboard_state → {kv, updatedAtByKey})
  // ──────────────────────────────────────────────────────────────────
  it('Test 5: fetchDashboardStateFromPostgres returns {kv, updatedAtByKey} matching sheets.ts:fetchDashboardState', async () => {
    setSupabaseRows([
      { key: 'monthly-revenue-goal', value: 50000, updated_at: '2026-05-15T10:00:00Z' },
      {
        key: 'billing-recurring',
        value: [{ id: 'shopify', amount: 79 }],
        updated_at: '2026-05-16T11:00:00Z',
      },
    ]);

    const out = await fetchDashboardStateFromPostgres();

    // Same return shape as sheets.ts:fetchDashboardState — { kv, updatedAtByKey }
    expect(out).toHaveProperty('kv');
    expect(out).toHaveProperty('updatedAtByKey');
    expect(out.kv['monthly-revenue-goal']).toBe(50000);
    expect(out.kv['billing-recurring']).toEqual([{ id: 'shopify', amount: 79 }]);
    expect(out.updatedAtByKey['monthly-revenue-goal']).toBe('2026-05-15T10:00:00Z');
    expect(out.updatedAtByKey['billing-recurring']).toBe('2026-05-16T11:00:00Z');
    expect(fromCalls).toContain('dashboard_state');
  });

  // ──────────────────────────────────────────────────────────────────
  // Test 6 — Errors throw with reader-name in message
  // ──────────────────────────────────────────────────────────────────
  it('Test 6: Supabase error propagates as Error with reader-name in message', async () => {
    setSupabaseError('connection refused');
    await expect(fetchDailyDataFromPostgres()).rejects.toThrow(/postgresReaders\.fetchDailyData/);

    setSupabaseError('column missing');
    await expect(fetchStoreMetaFromPostgres()).rejects.toThrow(/postgresReaders\.fetchStoreMeta/);

    setSupabaseError('permission denied');
    await expect(fetchDashboardStateFromPostgres()).rejects.toThrow(
      /postgresReaders\.fetchDashboardState/,
    );
  });
});

describe('postgresReaders — additional shape coverage for plan-19 routes', () => {
  it('fetchProductsFromPostgres maps snake_case → ProductRow shape', async () => {
    setSupabaseRows([
      {
        date: '2026-05-15',
        store_id: 'uzoshop',
        store_name: 'uzoshop',
        product_id: '8123456789012345678',
        product_title: 'Widget',
        units: 5,
        gross_revenue_cad: 100,
        orders: 4,
        net_revenue_cad: 90,
      },
    ]);
    const [r] = await fetchProductsFromPostgres();
    expect(r).toEqual({
      date: '2026-05-15',
      storeId: 'uzoshop',
      storeName: 'uzoshop',
      productId: '8123456789012345678',
      productTitle: 'Widget',
      units: 5,
      revenue: 100,
      orders: 4,
      netRevenue: 90,
    });
    expect(fromCalls).toContain('products_daily');
  });

  it('fetchCampaignsFromPostgres TitleCases platform (db lowercase → Sheets-shape capitalized)', async () => {
    // Pitfall 7: DB CHECK constraint forces 'meta'|'google' (lowercase) per
    // migration 20260521075741. The sheets.ts CampaignRow shape uses
    // 'Meta'|'Google' (capitalized). The reader MUST normalize to Sheets shape
    // so consumer code branches on readFrom() without any case-conversion.
    setSupabaseRows([
      {
        date: '2026-05-15',
        store_id: 'uzoshop',
        store_name: 'uzoshop',
        platform: 'meta',
        campaign_id: 'c1',
        campaign_name: 'Campaign 1',
        ad_set_id: 'as1',
        ad_set_name: 'AdSet 1',
        spend_cad: 50,
        impressions: 1000,
        clicks: 100,
        conversions: 5,
        conversion_value_cad: 200,
        campaign_budget_cad: 100,
        ad_set_budget_cad: null,
        budget_type: 'CBO',
      },
    ]);
    const [r] = await fetchCampaignsFromPostgres();
    expect(r.platform).toBe('Meta'); // TitleCased
    expect(r.campaignBudgetCad).toBe(100);
    expect(r.adSetBudgetCad).toBeNull();
    expect(r.budgetType).toBe('CBO');
    // Phase D Task 5 (2026-05-30) — the reader now SELECTs from the
    // campaigns_enriched VIEW (campaigns_daily LEFT JOIN campaign_registry).
    expect(fromCalls).toContain('campaigns_enriched');
  });

  it('fetchCampaignsFromPostgres surfaces TikTok BUDGET_EXCEED with hasActivity=false (AUDIT U-01)', async () => {
    // AUDIT U-01 (2026-05-24) — the regression this test prevents:
    //
    //   Pre-fix, postgresReaders.ts:608 inlined
    //   `statusNorm === 'ADGROUP_STATUS_DELIVERY_OK'` as the ONLY TikTok
    //   "currently active" status. A row with effective_status=
    //   ADGROUP_STATUS_BUDGET_EXCEED AND zero spend/impressions/conversions
    //   (typical mid-day BUDGET_EXCEED placeholder UPSERTed by cron-live
    //   right after the daily cap was hit) was silently dropped because
    //   hasActivity=false AND isCurrentlyActive=false.
    //
    //   Result: the operator saw the row vanish from the dashboard mid-day
    //   even though TikTok Ads Manager still painted it as Active. The
    //   row would reappear tomorrow once spend > 0 in the new day.
    //
    // Post-fix the reader consults the shared TIKTOK_ACTIVE_ENOUGH set,
    // which includes BUDGET_EXCEED. The row now surfaces correctly.
    setSupabaseRows([
      {
        date: '2026-05-15',
        store_id: 'uzoshop',
        store_name: 'uzoshop',
        platform: 'tiktok',
        campaign_id: 'tt-c-1',
        campaign_name: 'TikTok Spring Promo',
        ad_set_id: 'tt-as-1',
        ad_set_name: 'AdGroup BE',
        // hasActivity = false (zero spend AND zero impressions AND zero conversions).
        spend_cad: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        conversion_value_cad: 0,
        campaign_budget_cad: null,
        ad_set_budget_cad: 50,
        budget_type: 'ABO',
        // The U-01 trigger: TikTok daily cap hit, paused TODAY, resumes
        // tomorrow. Pre-fix this status alone would NOT count as
        // currently-active so the row would drop.
        effective_status: 'ADGROUP_STATUS_BUDGET_EXCEED',
      },
    ]);

    const rows = await fetchCampaignsFromPostgres();

    // Post-fix expectation: the row SURFACES (isCurrentlyActive=true via
    // TIKTOK_ACTIVE_ENOUGH membership).
    expect(rows.length).toBe(1);
    expect(rows[0].platform).toBe('TikTok');
    expect(rows[0].campaignId).toBe('tt-c-1');
    expect(rows[0].effectiveStatus).toBe('ADGROUP_STATUS_BUDGET_EXCEED');
    expect(rows[0].spend).toBe(0);
    expect(rows[0].impressions).toBe(0);
  });

  it('fetchCampaignsFromPostgres still drops TikTok DISABLE rows with hasActivity=false (AUDIT U-01 negative)', async () => {
    // Symmetry partner to the test above: an ad-group in a true OFF
    // status (DISABLE) with zero activity in the range MUST NOT surface.
    // This prevents the U-01 fix from being over-broad (e.g. mistakenly
    // including the OFF half of the TikTok taxonomy).
    setSupabaseRows([
      {
        date: '2026-05-15',
        store_id: 'uzoshop',
        store_name: 'uzoshop',
        platform: 'tiktok',
        campaign_id: 'tt-c-2',
        campaign_name: 'TikTok Paused Promo',
        ad_set_id: 'tt-as-2',
        ad_set_name: 'AdGroup DISABLE',
        spend_cad: 0,
        impressions: 0,
        clicks: 0,
        conversions: 0,
        conversion_value_cad: 0,
        campaign_budget_cad: null,
        ad_set_budget_cad: 50,
        budget_type: 'ABO',
        // DISABLE = truly paused, NOT in TIKTOK_ACTIVE_ENOUGH.
        effective_status: 'ADGROUP_STATUS_DISABLE',
      },
    ]);

    const rows = await fetchCampaignsFromPostgres();

    // Dropped — hasActivity=false AND isCurrentlyActive=false.
    expect(rows.length).toBe(0);
  });

  it('fetchAdsFromPostgres maps to AdRow shape and TitleCases platform', async () => {
    setSupabaseRows([
      {
        date: '2026-05-15',
        store_id: 'uzoshop',
        store_name: 'uzoshop',
        platform: 'google',
        campaign_id: 'c1',
        campaign_name: 'Camp',
        ad_set_id: 'as1',
        ad_set_name: 'AS',
        ad_id: 'a1',
        ad_name: 'Ad 1',
        spend_cad: 25,
        impressions: 500,
        clicks: 50,
        conversions: 3,
        conversion_value_cad: 120,
      },
    ]);
    const [r] = await fetchAdsFromPostgres();
    expect(r.platform).toBe('Google'); // TitleCased
    expect(r.adId).toBe('a1');
    expect(r.spend).toBe(25);
    // Phase D (2026-05-30) — reader now reads from the ads_enriched VIEW
    // (ads_daily LEFT JOIN ad_registry). The 6 reg_* fields are NULL here
    // because the fixture row omits them; that is the Phase B/C-pending
    // production state.
    expect(fromCalls).toContain('ads_enriched');
  });

  it('fetchOrdersAttributionFromPostgres returns OrderAttributionRow shape with empty lineItems by default', async () => {
    setSupabaseRows([
      {
        date: '2026-05-15',
        store_id: 'uzoshop',
        store_name: 'uzoshop',
        order_id: 'gid://shopify/Order/123',
        total_cad: 99.99,
        source: 'meta-paid',
        utm_source: 'facebook',
        utm_medium: 'cpc',
        utm_campaign: 'Spring',
        utm_content: 'image1',
        fbclid_present: true,
        gclid_present: false,
        referrer: 'https://l.facebook.com',
        utm_id: '12345',
        utm_term: '67890',
        line_items: [{ p: 'gid://shopify/Product/1', u: 2, r: 50 }],
      },
    ]);
    // Default opts: includeLineItems falsy → lineItems should be [] (matches sheets.ts:259)
    const rows = await fetchOrdersAttributionFromPostgres();
    expect(rows[0]).toMatchObject({
      orderId: 'gid://shopify/Order/123',
      totalCad: 99.99,
      source: 'meta-paid',
      fbclidPresent: true,
      gclidPresent: false,
      utmId: '12345',
      utmTerm: '67890',
      lineItems: [],
    });
    // With includeLineItems=true, the JSONB column is parsed into OrderLineItem[]
    const rowsLI = await fetchOrdersAttributionFromPostgres({ includeLineItems: true });
    expect(rowsLI[0].lineItems).toEqual([
      { productId: 'gid://shopify/Product/1', units: 2, revenueCad: 50 },
    ]);
    expect(fromCalls).toContain('orders_attribution');
  });

  it('fetchProductCatalogFromPostgres returns CatalogProduct shape', async () => {
    setSupabaseRows([
      {
        store_id: 'uzoshop',
        product_id: 'gid://shopify/Product/12345',
        title: 'Phone Case',
        handle: 'phone-case',
        status: 'active',
        price_cad: 19.99,
        image_url: 'https://cdn.shopify.com/abc.jpg',
        product_type: 'Accessories',
        vendor: 'uzoshop',
      },
    ]);
    const [r] = await fetchProductCatalogFromPostgres();
    expect(r).toMatchObject({
      productId: 'gid://shopify/Product/12345',
      storeId: 'uzoshop',
      title: 'Phone Case',
      handle: 'phone-case',
      status: 'active',
      priceCad: 19.99,
      imageUrl: 'https://cdn.shopify.com/abc.jpg',
      productType: 'Accessories',
      vendor: 'uzoshop',
    });
    expect(fromCalls).toContain('product_catalog');
  });
});
