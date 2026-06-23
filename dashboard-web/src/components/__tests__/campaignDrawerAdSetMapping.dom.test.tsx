// dashboard-web/src/components/__tests__/campaignDrawerAdSetMapping.dom.test.tsx
//
// Ad-set-level product mapping — parent wiring (2026-06-23).
//
// Coverage:
//   1. The per-ad-set "מפה מוצרים" action (סטים sub-tab) opens the
//      ProductPickerModal in AD-SET scope (header says "…לאד-סט …").
//   2. Saving in ad-set scope routes to setMappedProductsForAdSet with the
//      ad-set identity + selected product ids — NOT setMappedProducts.
//   3. REGRESSION: the campaign-level "שייך מוצרים" header action still maps
//      at CAMPAIGN level via setMappedProducts (ad-set helper NOT called).
//   4. An ad-set whose OWN mapping is non-empty shows the own-count indicator.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

// SWR: campaigns/products/orders fetches in the drawer stay empty; the
// ProductPickerModal's catalog/products fetches return deterministic rows so a
// product is selectable for the save test.
vi.mock('swr', () => ({
  default: (key: string | null) => {
    if (key === '/api/product-catalog') {
      return {
        data: {
          rows: [
            { storeId: 'uzoshop', productId: 'p-alpha', title: 'Alpha Mascara' },
            { storeId: 'uzoshop', productId: 'p-beta', title: 'Beta Overol' },
          ],
          lastUpdated: '',
        },
        isLoading: false,
      };
    }
    if (key === '/api/products') {
      return { data: { rows: [], lastUpdated: '', dataLastWriteAt: null }, isLoading: false };
    }
    return { data: undefined, isLoading: false };
  },
}));

vi.mock('@/lib/cloudSync', () => ({
  pushCloudKey: vi.fn(),
  pullCloudKey: vi.fn(),
  syncAll: vi.fn(),
}));

vi.mock('@/lib/campaignStoreMap', () => ({
  readCampaignStoreMap: () => ({}),
  writeCampaignStoreMap: vi.fn(),
  campaignStoreKey: (a: string, b: string, c: string) => `${a}::${b}::${c}`,
  resolveStoreForCampaign: vi.fn(() => null),
}));

// Spies for the two write paths + a mutable productMap. Defined via
// vi.hoisted so the hoisted vi.mock factory can reference them safely.
const h = vi.hoisted(() => ({
  setMappedProducts: vi.fn(),
  setMappedProductsForAdSet: vi.fn(),
  productMap: { current: {} as Record<string, string[]> },
}));
const { setMappedProducts, setMappedProductsForAdSet } = h;

vi.mock('@/lib/campaignProductMap', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    readProductMap: () => h.productMap.current,
    setMappedProducts: h.setMappedProducts,
    setMappedProductsForAdSet: h.setMappedProductsForAdSet,
  };
});

import { CampaignDrawer } from '@/components/CampaignDrawer';
import type { CampaignRow } from '@/lib/campaigns';

function makeRow(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    date: '2026-05-30',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    platform: 'Meta',
    campaignId: 'camp-1',
    campaignName: 'Mapping Campaign',
    adSetId: 'as-7',
    adSetName: 'Women 25-34',
    spend: 100,
    impressions: 1000,
    clicks: 50,
    conversions: 5,
    conversionValue: 200,
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
    ...overrides,
  };
}

function renderDrawer() {
  return render(
    <CampaignDrawer
      open
      onClose={() => {}}
      rows={[makeRow()]}
      campaignId="camp-1"
      storeId="uzoshop"
      adAccounts={{}}
      rangeFrom="2026-05-01"
      rangeTo="2026-05-30"
    />,
  );
}

function gotoAdSetsTab() {
  const trigger = screen.getByTestId('campaign-drawer-tab-trigger-adsets');
  act(() => {
    fireEvent.pointerDown(trigger);
    fireEvent.mouseDown(trigger);
    fireEvent.click(trigger);
  });
}

describe('CampaignDrawer — ad-set product mapping wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.productMap.current = {};
  });

  it('per-ad-set action opens the picker in AD-SET scope', () => {
    renderDrawer();
    gotoAdSetsTab();
    fireEvent.click(screen.getByRole('button', { name: /מפה מוצרים/ }));
    // Picker header is in ad-set scope.
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toMatch(/לאד-סט/);
    // The ad-set name appears inside the picker header.
    expect(dialog.textContent).toContain('Women 25-34');
  });

  it('saving in ad-set scope routes to setMappedProductsForAdSet (not setMappedProducts)', () => {
    renderDrawer();
    gotoAdSetsTab();
    fireEvent.click(screen.getByRole('button', { name: /מפה מוצרים/ }));
    fireEvent.click(screen.getByText('Alpha Mascara').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: /שמור/ }));
    expect(setMappedProductsForAdSet).toHaveBeenCalledWith(
      'uzoshop',
      'Meta',
      'camp-1',
      'as-7',
      ['p-alpha'],
    );
    expect(setMappedProducts).not.toHaveBeenCalled();
  });

  it('REGRESSION: the campaign-level header action still maps at CAMPAIGN level', () => {
    renderDrawer();
    // The Overview "שייך מוצרים" campaign action is in the default (Overview) tab.
    fireEvent.click(screen.getByRole('button', { name: /שייך מוצרים/ }));
    fireEvent.click(screen.getByText('Beta Overol').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: /שמור/ }));
    expect(setMappedProducts).toHaveBeenCalledWith(
      'uzoshop',
      'Meta',
      'camp-1',
      ['p-beta'],
    );
    expect(setMappedProductsForAdSet).not.toHaveBeenCalled();
  });

  it('an ad-set with its OWN mapping shows the own-count indicator', () => {
    h.productMap.current = { 'uzoshop::Meta::camp-1::as-7': ['p-alpha', 'p-beta'] };
    renderDrawer();
    gotoAdSetsTab();
    expect(screen.getByTestId('adset-mapping-own-as-7').textContent).toContain('2');
  });
});
