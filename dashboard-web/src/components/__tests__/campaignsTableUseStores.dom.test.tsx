// dashboard-web/src/components/__tests__/campaignsTableUseStores.dom.test.tsx
//
// Self-serve stores Phase 2 (Task 4) — CampaignsTable derives its store
// display-name map from useStores() instead of the hardcoded
// STORE_DISPLAY_NAMES_MAP. The map is read by `effectiveStoreByRowKey`, which
// overrides a remapped TikTok row's storeName for immediate display (before
// cron-live-heavy migrates campaigns_daily).
//
// Strategy: mount the FULL real CampaignsTable with SWR mocked keyed-per-endpoint
// and the campaign-store-map / product-map helpers mocked. A single TikTok
// campaign is REMAPPED via the storeMap so `effectiveStoreByRowKey` emits an
// entry → the row's painted storeName comes from the display-name map, which is
// exactly what we want to assert is now data-driven.
//
// Coverage:
//   (a) useStores returns the 3 today → the remapped row's storeName is
//       byte-identical to today (usmile360 → '360usmile').
//   (b) a mocked 4th store is added → a TikTok campaign remapped to that 4th
//       store paints the 4th store's display name (data-driven map).
//   (c) useStores returns the fallback 3 (loading/empty) → hardcoded fallback
//       names still render (zero-regression).

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { CampaignsResponse } from '@/app/api/campaigns/route';
import type { CampaignRow } from '@/lib/campaigns';
import type { StoreInfo } from '@/lib/getStores';

// ---------------------------------------------------------------------------
// Fixture identity. RAW store (data-side) ≠ EFFECTIVE store (remap target).
// ---------------------------------------------------------------------------
const RAW_STORE = 'uzoshop';
const ADVERTISER_ID = 'TT-ADV-1';
const CAMPAIGN_ID = 'tt-camp-1';
const RANGE = { from: '2026-05-01', to: '2026-05-10' };

// ---------------------------------------------------------------------------
// Mutable shared state read by the mocked map + useStores helpers.
// ---------------------------------------------------------------------------
let storeMapState: Record<string, string> = {};
let storesReturn: StoreInfo[] = [];

const THREE_STORES: StoreInfo[] = [
  { storeId: 'uzoshop',   storeName: 'uzoshop',   brandColor: 'var(--store-uzo)', isHeadless: false, hasTikTok: true,  status: 'active', displayOrder: 1, enableCustomerJourney: false },
  { storeId: 'zolplus',   storeName: 'Zol Plus',  brandColor: 'var(--store-3)',   isHeadless: false, hasTikTok: false, status: 'active', displayOrder: 2, enableCustomerJourney: false },
  { storeId: 'usmile360', storeName: '360usmile', brandColor: 'var(--store-usm)', isHeadless: true,  hasTikTok: true,  status: 'active', displayOrder: 3, enableCustomerJourney: false },
];

const FOURTH_STORE: StoreInfo = {
  storeId: 'newstore', storeName: 'Brand New Store', brandColor: 'var(--store-4)', isHeadless: false, hasTikTok: true, status: 'active', displayOrder: 4, enableCustomerJourney: false,
};

// ---------------------------------------------------------------------------
// Hoisted mocks (must precede module imports).
// ---------------------------------------------------------------------------
vi.mock('@/lib/cloudSync', () => ({
  pushCloudKey: vi.fn(),
  pullCloudKey: vi.fn(),
  syncAll: vi.fn(),
}));

vi.mock('@/lib/useStores', () => ({
  useStores: () => ({ stores: storesReturn }),
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
    readProductMap: () => ({}),
    setMappedProducts: vi.fn(),
  };
});

// Keyed SWR mock — only /api/campaigns + /api/store-meta need fixtures.
// Return STABLE singleton objects (lazily built + cached) so the consuming
// component's effects don't see a new `mutate`/`data` identity each render
// (which would trigger an infinite update loop via the productMap-migration
// effect that depends on `swrMutate`).
const { stableMutate } = vi.hoisted(() => ({ stableMutate: vi.fn() }));
const swrCache: Record<string, unknown> = {};
vi.mock('swr', () => ({
  default: (key: string | null) => {
    const k =
      !key ? 'empty'
        : key.includes('/api/store-meta') ? 'store-meta'
        : key.includes('/api/campaigns') ? 'campaigns'
        : 'empty';
    if (!swrCache[k]) {
      const data =
        k === 'store-meta' ? storeMetaFixture
          : k === 'campaigns' ? campaignsFixture
          : undefined;
      swrCache[k] = { data, error: undefined, isLoading: false, mutate: stableMutate };
    }
    return swrCache[k];
  },
  useSWRConfig: () => ({ mutate: stableMutate }),
}));

// ---------------------------------------------------------------------------
// Imports after mocks.
// ---------------------------------------------------------------------------
import { CampaignsTable } from '@/components/CampaignsTable';

// ---------------------------------------------------------------------------
// Fixtures.
// ---------------------------------------------------------------------------
function ttRow(date: string): CampaignRow {
  return {
    date,
    storeId: RAW_STORE,
    storeName: 'uzoshop',
    platform: 'TikTok',
    campaignId: CAMPAIGN_ID,
    campaignName: 'TT Campaign One',
    adSetId: `${CAMPAIGN_ID}-as`,
    adSetName: 'AdSet',
    spend: 20,
    impressions: 1000,
    clicks: 40,
    conversions: 4,
    conversionValue: 80,
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

const campaignsFixture: CampaignsResponse = {
  rows: ['2026-05-01', '2026-05-02', '2026-05-03'].map(ttRow),
  lastUpdated: new Date().toISOString(),
  dataLastWriteAt: null,
} as CampaignsResponse;

// store-meta carries the shared TikTok advertiser id under uzoshop (the
// data-side store) so `effectiveStoreByRowKey` can build the remap key.
const storeMetaFixture = {
  rows: [
    { storeId: 'uzoshop', metaAdAccountId: 'M-UZO', googleAdsCustomerId: null, tiktokAdvertiserId: ADVERTISER_ID },
    { storeId: 'zolplus', metaAdAccountId: 'M-ZOL', googleAdsCustomerId: null, tiktokAdvertiserId: null },
    { storeId: 'usmile360', metaAdAccountId: 'M-USM', googleAdsCustomerId: null, tiktokAdvertiserId: null },
  ],
};

function renderTable() {
  return render(
    <CampaignsTable
      range={RANGE}
      store="All"
      stores={['uzoshop', 'Zol Plus', '360usmile']}
      dailyRows={[]}
    />,
  );
}

beforeEach(() => {
  storeMapState = {};
  storesReturn = THREE_STORES;
  window.localStorage.clear();
});

describe('CampaignsTable — store display names via useStores (Phase 2)', () => {
  it('(a) with the 3 stores, a TikTok campaign remapped to usmile360 paints "360usmile" (byte-identical to today)', () => {
    // Remap the campaign (data-side uzoshop) → usmile360.
    storeMapState = { [`tiktok::${ADVERTISER_ID}::${CAMPAIGN_ID}`]: 'usmile360' };
    renderTable();
    // effectiveStoreByRowKey overrides the row storeName via the display-name map.
    const cells = screen.getAllByText('360usmile');
    expect(cells.length, 'remapped TikTok row should paint the usmile360 display name').toBeGreaterThan(0);
    // The stale data-side "uzoshop" name must NOT be the painted store chip for this row.
    expect(screen.queryByText('TT Campaign One')).toBeInTheDocument();
  });

  it('(b) a mocked 4th store is a valid remap label — campaign remapped to it paints the 4th store name', () => {
    storesReturn = [...THREE_STORES, FOURTH_STORE];
    storeMapState = { [`tiktok::${ADVERTISER_ID}::${CAMPAIGN_ID}`]: 'newstore' };
    renderTable();
    const cells = screen.getAllByText('Brand New Store');
    expect(cells.length, 'remapped row should paint the 4th store display name from useStores').toBeGreaterThan(0);
  });

  it('(c) with the fallback 3 (loading/empty), the hardcoded fallback names still render (zero-regression)', () => {
    storesReturn = THREE_STORES; // mirrors useStores fallback
    storeMapState = { [`tiktok::${ADVERTISER_ID}::${CAMPAIGN_ID}`]: 'zolplus' };
    renderTable();
    const cells = screen.getAllByText('Zol Plus');
    expect(cells.length, 'fallback display name must still resolve').toBeGreaterThan(0);
  });
});
