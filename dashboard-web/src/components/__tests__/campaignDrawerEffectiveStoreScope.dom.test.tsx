// dashboard-web/src/components/__tests__/campaignDrawerEffectiveStoreScope.dom.test.tsx
//
// Regression (P2 2026-06-04) — CampaignDrawer store-scope coherence for a
// REMAPPED TikTok campaign.
//
// Bug: the drawer derived two store ids. `effectiveStoreId` (the TikTok
// shared-account remap target) keyed `mappedIds` + the ProductPicker, but the
// cohort key (`currentCampaignKey`), the cohort store filter, and the
// `buildReconciliation` / `analyzeAttribution` storeId argument all used the
// RAW `storeId` prop. For a TikTok campaign opened from its default (uzoshop)
// view but remapped to another store WITH mapped products:
//   - the cohort panel vanished       (productMap[currentCampaignKey] empty)
//   - reconciliation series went zero  (campaigns/orders filtered to raw store)
//   - attribution read the wrong store's orders.
//
// This test mounts the FULL drawer (SWR mocked, keyed per endpoint) with the
// drawer-input `storeId` = 'uzoshop' (raw default) but a storeMap that remaps
// the campaign to 'usmile360'. The mapped products, post-rewrite spend, and
// orders all live under 'usmile360'. After the fix the cohort accordion + the
// reconciliation panel must render (they consume the EFFECTIVE store's data).

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { CampaignsResponse } from '@/app/api/campaigns/route';
import type { ProductsResponse } from '@/app/api/products/route';
import type { OrdersAttributionResponse } from '@/app/api/orders-attribution/route';
import type { CampaignRow } from '@/lib/campaigns';
import type { OrderAttributionRow } from '@/lib/ordersAttribution';
import type { ProductRow } from '@/lib/products';

// ---------------------------------------------------------------------------
// Fixture identity. RAW store (drawer prop) ≠ EFFECTIVE store (remap target).
// ---------------------------------------------------------------------------
const RAW_STORE = 'uzoshop';
const EFFECTIVE_STORE = 'usmile360';
const ADVERTISER_ID = 'TT-ADV-1';
const CURRENT_CAMPAIGN = 'tt-camp-1';
const SIBLING_CAMPAIGN = 'tt-camp-2'; // shares the same product → forms a cohort
const PRODUCT_ID = 'prod-1';
const RANGE_FROM = '2026-05-01';
const RANGE_TO = '2026-05-10'; // 10 days → reconciliation series.length >= 5

const STORE_MAP_KEY = `tiktok::${ADVERTISER_ID}::${CURRENT_CAMPAIGN}`;

// Mutable shared state read by the mocked map helpers.
let storeMapState: Record<string, string> = {};
let productMapState: Record<string, string[]> = {};

// ---------------------------------------------------------------------------
// Hoisted mocks (must precede module imports).
// ---------------------------------------------------------------------------
vi.mock('@/lib/cloudSync', () => ({
  pushCloudKey: vi.fn(),
  pullCloudKey: vi.fn(),
  syncAll: vi.fn(),
}));

vi.mock('@/lib/campaignStoreMap', () => ({
  readCampaignStoreMap: () => ({ ...storeMapState }),
  writeCampaignStoreMap: vi.fn(),
  campaignStoreKey: (platform: string, advertiserId: string, campaignId: string) =>
    `${platform}::${advertiserId}::${campaignId}`,
  resolveStoreForCampaign: vi.fn(() => null),
}));

vi.mock('@/lib/campaignProductMap', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    readProductMap: () => ({ ...productMapState }),
    setMappedProducts: vi.fn(),
  };
});

// Keyed SWR mock — returns the right fixture per endpoint so the cohort +
// reconciliation derivations actually run (the global undefined-data mock used
// by the sub-tab nav test wouldn't exercise this code path).
vi.mock('swr', () => ({
  default: (key: string | null) => {
    if (!key) return { data: undefined, isLoading: false };
    if (key.includes('/api/campaigns')) return { data: campaignsFixture, isLoading: false };
    if (key.includes('/api/products')) return { data: productsFixture, isLoading: false };
    if (key.includes('/api/orders-attribution')) return { data: ordersFixture, isLoading: false };
    return { data: undefined, isLoading: false };
  },
}));

// ---------------------------------------------------------------------------
// Imports after mocks.
// ---------------------------------------------------------------------------
import { CampaignDrawer } from '@/components/CampaignDrawer';
import type { AdAccountMap } from '@/lib/campaignsLinks';

// ---------------------------------------------------------------------------
// Fixtures — ALL ad/order/product data lives under the EFFECTIVE store.
// ---------------------------------------------------------------------------
function ttRow(campaignId: string, date: string, spend: number, value: number): CampaignRow {
  return {
    date,
    storeId: EFFECTIVE_STORE,
    storeName: '360usmile',
    platform: 'TikTok',
    campaignId,
    campaignName: campaignId === CURRENT_CAMPAIGN ? 'TT Current' : 'TT Sibling',
    adSetId: `${campaignId}-as`,
    adSetName: 'AdSet',
    spend,
    impressions: 1000,
    clicks: 40,
    conversions: 4,
    conversionValue: value,
    campaignBudgetCad: null,
    adSetBudgetCad: null,
    budgetType: '',
    effectiveStatus: 'ACTIVE',
    lastLiveTickAt: null,
    regConfiguredStatus: null,
    regEffectiveStatus: null,
    regDeliveryStatus: null,
    regFirstSeenAt: null,
    regStatusChangedAt: null,
    regLastStatusSuccessAt: null,
  };
}

const DAYS = ['2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06'];
// Per-day VARYING magnitudes so the TikTok ↔ Shopify series have real
// variance (a constant series → pearson null → "אין שונות" even with the fix).
const DAY_VALUE = [60, 90, 45, 120, 30, 75];

const campaignsFixture: CampaignsResponse = {
  rows: [
    ...DAYS.map((d, i) => ttRow(CURRENT_CAMPAIGN, d, 20, DAY_VALUE[i])),
    ...DAYS.map((d, i) => ttRow(SIBLING_CAMPAIGN, d, 30, DAY_VALUE[i] / 2)),
  ],
  lastUpdated: new Date().toISOString(),
  dataLastWriteAt: null,
} as CampaignsResponse;

const productsFixture: ProductsResponse = {
  rows: DAYS.map<ProductRow>(d => ({
    date: d,
    storeId: EFFECTIVE_STORE,
    storeName: '360usmile',
    productId: PRODUCT_ID,
    productTitle: 'Product One',
    units: 2,
    revenue: 50,
    orders: 2,
    netRevenue: 45,
  })),
  lastUpdated: new Date().toISOString(),
  dataLastWriteAt: null,
} as ProductsResponse;

function order(date: string, totalCad: number): OrderAttributionRow {
  return {
    date,
    storeId: EFFECTIVE_STORE,
    storeName: '360usmile',
    orderId: `o-${date}`,
    totalCad,
    source: 'tiktok-paid',
    utmSource: 'tiktok',
    utmMedium: 'cpc',
    utmCampaign: '',
    utmContent: '',
    fbclidPresent: false,
    gclidPresent: false,
    referringSite: '',
    utmId: CURRENT_CAMPAIGN,
    utmTerm: '',
    lineItems: [{ productId: PRODUCT_ID, units: 1, revenueCad: totalCad }],
    customerId: null,
    orderCreatedAt: null,
    isFirstOrder: null,
    firstTouchSource: null,
    firstFbclidPresent: false,
    firstGclidPresent: false,
    firstTtclidPresent: false,
    firstUtmSource: null,
    firstUtmMedium: null,
    firstUtmCampaign: null,
    firstUtmContent: null,
    firstUtmId: null,
    firstUtmTerm: null,
    firstSeenAt: null,
  };
}

const ordersFixture: OrdersAttributionResponse = {
  // Shopify-actual revenue tracks the per-day TikTok claim (so the series
  // correlate and pearson returns a real number once they're scoped right).
  rows: DAYS.map((d, i) => order(d, DAY_VALUE[i] * 0.8)),
  lastUpdated: new Date().toISOString(),
} as OrdersAttributionResponse;

const AD_ACCOUNTS: AdAccountMap = {
  uzoshop: { metaAdAccountId: 'M-UZO', googleAdsCustomerId: null, tiktokAdvertiserId: ADVERTISER_ID },
  usmile360: { metaAdAccountId: 'M-USM', googleAdsCustomerId: null },
  zolplus: { metaAdAccountId: 'M-ZOL', googleAdsCustomerId: null },
};

// Drawer-input rows (the daily rows that opened the drawer). These are the
// EFFECTIVE-store post-rewrite rows for the current campaign — the drawer
// summary just needs a non-empty TikTok set so the platform resolves to TikTok.
const drillRows: CampaignRow[] = DAYS.map(d => ttRow(CURRENT_CAMPAIGN, d, 20, 60));

function renderDrawer() {
  return render(
    <CampaignDrawer
      open
      onClose={() => {}}
      rows={drillRows}
      campaignId={CURRENT_CAMPAIGN}
      // RAW store prop — the campaign was opened from its uzoshop default view.
      storeId={RAW_STORE}
      adAccounts={AD_ACCOUNTS}
      rangeFrom={RANGE_FROM}
      rangeTo={RANGE_TO}
    />,
  );
}

// ---------------------------------------------------------------------------
// Setup — remap the campaign to the EFFECTIVE store + map the product there.
// ---------------------------------------------------------------------------
beforeEach(() => {
  storeMapState = { [STORE_MAP_KEY]: EFFECTIVE_STORE };
  productMapState = {
    // Current campaign + a sibling both promote PRODUCT_ID, under the
    // EFFECTIVE store (where ProductPicker / setMappedProducts write them).
    [`${EFFECTIVE_STORE}::TikTok::${CURRENT_CAMPAIGN}`]: [PRODUCT_ID],
    [`${EFFECTIVE_STORE}::TikTok::${SIBLING_CAMPAIGN}`]: [PRODUCT_ID],
  };
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('CampaignDrawer — effective-store scope for a remapped TikTok campaign', () => {
  it('renders the cohort panel (currentCampaignKey resolves to the effective store)', () => {
    renderDrawer();
    // Cohort accordion only renders when computeMultiMappingCohort != null,
    // which needs productMap[currentCampaignKey] non-empty AND a sibling
    // sharing a product. Both live under the EFFECTIVE store.
    expect(
      screen.queryByText('השוואת cohort — קמפיינים שחולקים מוצרים'),
      'cohort accordion must render — its key must use effectiveStoreId',
    ).toBeTruthy();
  });

  it('renders the reconciliation panel with a nonzero TikTok series', () => {
    renderDrawer();
    // Reconciliation accordion renders only when buildReconciliation != null
    // (mappedIds non-empty + >=5 day series). It scopes campaigns + orders to
    // the storeId arg — must be the effective store for the series to fill.
    expect(
      screen.queryByText('ערוצים מול Shopify — מתאם יומי'),
      'reconciliation panel must render — buildReconciliation needs effectiveStoreId',
    ).toBeTruthy();
    // Bug symptom: with the RAW store, the campaigns + orders are filtered out
    // → every channel series is all-zero → pearson returns null → the panel
    // shows "אין שונות בסדרה" (no variance). The fix scopes both to the
    // effective store, so the TikTok ↔ Shopify series have real variance and a
    // computable correlation. Assert the no-variance copy is ABSENT.
    expect(
      screen.queryByText(/אין שונות בסדרה/),
      'all-zero series (wrong store) → "no variance"; effectiveStoreId must fill the series',
    ).toBeNull();
  });
});
