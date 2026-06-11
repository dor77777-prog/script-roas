// dashboard-web/src/components/__tests__/adsDrawerAriaSort.dom.test.tsx
//
// 2026-06-11 adversarial-review fix — wave-8A item 6 (aria-sort placement)
// parity for AdsDrawer's AdSortHeader.
//
// The batch moved aria-sort from the inner sort <Button> (invalid ARIA — the
// attribute is only defined for row/column header cells, so AT never
// announced sort state) onto the <th> in CampaignsTable + AdSetTable, and the
// guard test (rowKeyboardAriaSort.dom.test.tsx) only renders those two
// tables. AdsDrawer's AdSortHeader kept the defect. This test pins the same
// contract on the ads table: aria-sort on the <th>, on NO button.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';
import type { AdsResponse } from '@/app/api/ads/route';

const AD_ROW = {
  date: '2026-05-15',
  storeId: 'uzoshop',
  storeName: 'uzoshop',
  platform: 'Meta',
  campaignId: 'c1',
  campaignName: 'Campaign 1',
  adSetId: 'as1',
  adSetName: 'Set One',
  adId: 'ad1',
  adName: 'Ad One',
  spend: 50,
  impressions: 500,
  clicks: 10,
  conversions: 1,
  conversionValue: 120,
  regConfiguredStatus: null,
  regEffectiveStatus: null,
  regDeliveryStatus: null,
  regFirstSeenAt: null,
  regStatusChangedAt: null,
  regLastStatusSuccessAt: null,
};

const ADS_RESPONSE: AdsResponse = {
  rows: [AD_ROW],
  lastUpdated: '2026-05-31T00:00:00.000Z',
  dataLastWriteAt: '2026-05-31T00:00:00.000Z',
};

// Deterministic SWR: the ads key gets one in-scope row (so the sortable
// header row actually renders); orders-attribution degrades to empty.
vi.mock('swr', () => ({
  default: (key: string | null) => {
    if (typeof key === 'string' && key.includes('/api/ads')) {
      return { data: ADS_RESPONSE, isLoading: false, error: undefined, mutate: vi.fn() };
    }
    return {
      data: { rows: [], lastUpdated: '2026-05-31T00:00:00.000Z' },
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
    };
  },
}));

import { AdsDrawer } from '@/components/AdsDrawer';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderDrawer() {
  return render(
    <AdsDrawer
      open
      onClose={vi.fn()}
      storeId="uzoshop"
      platform="Meta"
      campaignId="c1"
      adSetId="as1"
      adSetName="Set One"
      rangeFrom="2026-05-01"
      rangeTo="2026-05-31"
      adAccounts={{}}
    />,
  );
}

describe('AdsDrawer AdSortHeader: aria-sort sits on the <th>, never on the button', () => {
  it('the active sort column (default spend/desc) announces on its <th>; inactive sortable <th>s carry "none"; NO button has aria-sort', async () => {
    renderDrawer();
    // The Sheet portals to document.body — query the whole document.
    await waitFor(() => {
      expect(document.querySelectorAll('th[aria-sort]').length).toBeGreaterThan(0);
    });

    const sortableThs = Array.from(document.querySelectorAll('th[aria-sort]'));
    const spendTh = sortableThs.find((th) => th.textContent?.includes('הוצאה'));
    const nameTh = sortableThs.find((th) => th.textContent?.includes('מודעה'));

    // Active sort column (default sortKey='spend', dir='desc').
    expect(spendTh).toBeDefined();
    expect(spendTh!.getAttribute('aria-sort')).toBe('descending');
    // Inactive sortable column.
    expect(nameTh).toBeDefined();
    expect(nameTh!.getAttribute('aria-sort')).toBe('none');
    // Every sortable AdSortHeader column carries the attribute on the cell
    // (name/spend/value/roas/conversions/impressions/clicks = 7).
    expect(sortableThs.length).toBe(7);

    // The invalid placement must be gone: no button anywhere has aria-sort.
    expect(document.querySelector('button[aria-sort]')).toBeNull();
  });
});
