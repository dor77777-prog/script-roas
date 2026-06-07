// dashboard-web/src/components/__tests__/campaignDrawerStoreSelectUseStores.dom.test.tsx
//
// Self-serve stores Phase 2 (Task 4) — CampaignDrawer's TikTok shared-account
// store-remap dropdown (data-testid="drawer-store-select") sources its <option>s
// AND its display-name lookup from useStores() instead of the hardcoded
// STORE_DISPLAY_NAMES_CONST / inline <option> list.
//
// CRITICAL load-bearing control: this dropdown is the TikTok campaign↔store
// REMAP control. The localStorage key, the default (uzoshop), the persisted
// value, and the leading `__unmapped__` sentinel option MUST be unchanged. Only
// the SOURCE of the option list + label map becomes data-driven.
//
// Strategy: mount the FULL real CampaignDrawer (SWR mocked keyed-per-endpoint,
// campaign-store-map + product-map mocked) and assert on the painted <option>s.
//
// Coverage:
//   (a) with the 3 stores → the dropdown options are byte-identical to today
//       (the leading __unmapped__ sentinel + uzoshop / Zol Plus / 360usmile).
//   (b) a mocked 4th store appears as a selectable remap option whose value is
//       its storeId, the __unmapped__ sentinel still leads unchanged.
//   (c) with the fallback 3 (loading/empty) → the hardcoded fallback options
//       still render (zero-regression).

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { CampaignsResponse } from '@/app/api/campaigns/route';
import type { CampaignRow } from '@/lib/campaigns';
import type { StoreInfo } from '@/lib/getStores';

const RAW_STORE = 'uzoshop';
const ADVERTISER_ID = 'TT-ADV-1';
const CAMPAIGN_ID = 'tt-camp-1';
const RANGE_FROM = '2026-05-01';
const RANGE_TO = '2026-05-10';

let storeMapState: Record<string, string> = {};
let storesReturn: StoreInfo[] = [];

const THREE_STORES: StoreInfo[] = [
  { storeId: 'uzoshop',   storeName: 'uzoshop',   brandColor: 'var(--store-uzo)', isHeadless: false, hasTikTok: true,  status: 'active', displayOrder: 1 },
  { storeId: 'zolplus',   storeName: 'Zol Plus',  brandColor: 'var(--store-3)',   isHeadless: false, hasTikTok: false, status: 'active', displayOrder: 2 },
  { storeId: 'usmile360', storeName: '360usmile', brandColor: 'var(--store-usm)', isHeadless: true,  hasTikTok: true,  status: 'active', displayOrder: 3 },
];

const FOURTH_STORE: StoreInfo = {
  storeId: 'newstore', storeName: 'Brand New Store', brandColor: 'var(--store-4)', isHeadless: false, hasTikTok: true, status: 'active', displayOrder: 4,
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

vi.mock('swr', () => ({
  default: (key: string | null) => {
    if (!key) return { data: undefined, isLoading: false };
    if (key.includes('/api/campaigns')) return { data: campaignsFixture, isLoading: false };
    return { data: undefined, isLoading: false };
  },
}));

// ---------------------------------------------------------------------------
// Imports after mocks.
// ---------------------------------------------------------------------------
import { CampaignDrawer } from '@/components/CampaignDrawer';
import type { AdAccountMap } from '@/lib/campaignsLinks';

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

const AD_ACCOUNTS: AdAccountMap = {
  uzoshop: { metaAdAccountId: 'M-UZO', googleAdsCustomerId: null, tiktokAdvertiserId: ADVERTISER_ID },
  usmile360: { metaAdAccountId: 'M-USM', googleAdsCustomerId: null },
  zolplus: { metaAdAccountId: 'M-ZOL', googleAdsCustomerId: null },
};

const drillRows: CampaignRow[] = ['2026-05-01', '2026-05-02'].map(ttRow);

function renderDrawer() {
  return render(
    <CampaignDrawer
      open
      onClose={() => {}}
      rows={drillRows}
      campaignId={CAMPAIGN_ID}
      storeId={RAW_STORE}
      adAccounts={AD_ACCOUNTS}
      rangeFrom={RANGE_FROM}
      rangeTo={RANGE_TO}
    />,
  );
}

function getSelect(): HTMLSelectElement {
  return screen.getByTestId('drawer-store-select') as HTMLSelectElement;
}
function optionValues(sel: HTMLSelectElement): string[] {
  return Array.from(sel.options).map((o) => o.value);
}
function optionLabels(sel: HTMLSelectElement): string[] {
  return Array.from(sel.options).map((o) => o.textContent ?? '');
}

beforeEach(() => {
  storeMapState = {};
  storesReturn = THREE_STORES;
  window.localStorage.clear();
});

describe('CampaignDrawer store-remap dropdown — sourced from useStores (Phase 2)', () => {
  it('(a) with the 3 stores → options byte-identical to today (sentinel + 3 stores)', () => {
    renderDrawer();
    const sel = getSelect();
    expect(optionValues(sel)).toEqual(['__unmapped__', 'uzoshop', 'zolplus', 'usmile360']);
    expect(optionLabels(sel)).toEqual([
      '(לא ממופה · ברירת מחדל uzoshop)',
      'uzoshop',
      'Zol Plus',
      '360usmile',
    ]);
    // The default for an unmapped campaign is the __unmapped__ sentinel.
    expect(sel.value).toBe('__unmapped__');
  });

  it('(b) a mocked 4th store appears as a selectable remap option (value = its storeId); sentinel still leads unchanged', () => {
    storesReturn = [...THREE_STORES, FOURTH_STORE];
    renderDrawer();
    const sel = getSelect();
    const values = optionValues(sel);
    // Leading sentinel preserved EXACTLY.
    expect(values[0]).toBe('__unmapped__');
    expect(sel.options[0].textContent).toBe('(לא ממופה · ברירת מחדל uzoshop)');
    // The 4th store is now a valid remap target, keyed on its storeId.
    expect(values).toContain('newstore');
    const fourth = Array.from(sel.options).find((o) => o.value === 'newstore');
    expect(fourth?.textContent).toBe('Brand New Store');
    // Full shape: sentinel + 4 stores in displayOrder.
    expect(values).toEqual(['__unmapped__', 'uzoshop', 'zolplus', 'usmile360', 'newstore']);
  });

  it('(c) with the fallback 3 (loading/empty) → hardcoded fallback options still render (zero-regression)', () => {
    storesReturn = THREE_STORES; // mirrors the useStores fallback exactly
    renderDrawer();
    const sel = getSelect();
    expect(optionValues(sel)).toEqual(['__unmapped__', 'uzoshop', 'zolplus', 'usmile360']);
  });
});
