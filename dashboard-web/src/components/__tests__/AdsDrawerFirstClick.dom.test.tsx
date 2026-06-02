// @vitest-environment jsdom
//
// Plan C — Task 10 (2026-06-02) — first-click ROAS lens in AdsDrawer.
//
// The AdsDrawer per-ad table renders a deterministic "ROAS Shopify" (last-click)
// cell. Plan C adds a sibling first-click cell at ad grain: the value of the
// FIRST customer touch attributed to the ad via utm_content={{ad.id}}, at
// ~60-70% prominence beside last-click, plus the headline delta and a coverage
// chip (first-click-matched ÷ last-click-matched orders). Google-blind by
// construction (no Google rows at ad grain).
//
// We mock `swr` so:
//   - /api/ads               → one in-scope Meta ad 'ad-7' (uzoshop, spend 50)
//   - /api/orders-attribution → one order whose FIRST touch
//                               (firstUtmContent='ad-7') AND last touch
//                               (utmContent='ad-7') match the ad
//
// SheetContent portals to <body>, so assertions query the document body.
//
// Load-bearing assertions (the Task 10 contract):
//   - a first-click value cell keyed `first-click-roas-ad-7` renders
//   - the first-click coverage chip renders

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// Primary /api/ads SWR → one in-scope ad row; secondary
// /api/orders-attribution SWR → one order whose first AND last touch match the
// ad so both the last-click "ROAS Shopify" cell and the first-click cell paint.
vi.mock('swr', () => ({
  default: (key: string | null) => {
    const isAds = typeof key === 'string' && key.startsWith('/api/ads');
    if (isAds) {
      return {
        data: {
          rows: [
            {
              date: '2026-05-15',
              storeId: 'uzoshop',
              storeName: 'uzoshop',
              platform: 'Meta',
              campaignId: 'cmp-1',
              campaignName: 'Campaign 1',
              adSetId: 'adset-1',
              adSetName: 'My Ad Set',
              adId: 'ad-7',
              adName: 'Ad Seven',
              spend: 50,
              impressions: 1000,
              clicks: 50,
              conversions: 2,
              conversionValue: 120,
              regConfiguredStatus: null,
              regEffectiveStatus: null,
              regDeliveryStatus: null,
              regFirstSeenAt: null,
              regStatusChangedAt: null,
              regLastStatusSuccessAt: null,
            },
          ],
          lastUpdated: '2026-05-30T00:00:00.000Z',
        },
        isLoading: false,
        error: undefined,
        mutate: vi.fn(),
      };
    }
    // /api/orders-attribution → one order whose first + last touch match ad-7.
    return {
      data: {
        rows: [
          {
            date: '2026-05-15',
            storeId: 'uzoshop',
            storeName: 'uzoshop',
            orderId: 'order-1',
            totalCad: 100,
            source: 'meta-paid',
            utmSource: '',
            utmMedium: '',
            utmCampaign: '',
            utmContent: 'ad-7', // last-touch match → "ROAS Shopify" cell paints
            fbclidPresent: false,
            gclidPresent: false,
            referringSite: '',
            utmId: '',
            utmTerm: '',
            lineItems: [],
            customerId: null,
            orderCreatedAt: null,
            isFirstOrder: null,
            firstTouchSource: 'meta-paid',
            firstFbclidPresent: false,
            firstGclidPresent: false,
            firstTtclidPresent: false,
            firstUtmSource: null,
            firstUtmMedium: null,
            firstUtmCampaign: null,
            firstUtmContent: 'ad-7', // ← first-touch matches the ad id
            firstUtmId: null,
            firstUtmTerm: null,
            firstSeenAt: null,
          },
        ],
        lastUpdated: '2026-05-30T00:00:00.000Z',
      },
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
    };
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

import { AdsDrawer } from '@/components/AdsDrawer';

afterEach(() => cleanup());

const OPEN_PROPS = {
  open: true,
  onClose: () => {},
  storeId: 'uzoshop',
  platform: 'Meta' as const,
  campaignId: 'cmp-1',
  adSetId: 'adset-1',
  adSetName: 'My Ad Set',
  rangeFrom: '2026-05-01',
  rangeTo: '2026-05-30',
  adAccounts: {},
};

describe('AdsDrawer — first-click lens (Plan C Task 10)', () => {
  it('renders a first-click cell for an ad whose first touch matches', () => {
    render(<AdsDrawer {...OPEN_PROPS} />);
    // SheetContent portals to <body>; query the document body.
    expect(
      document.body.querySelector('[data-testid="first-click-roas-ad-7"]'),
    ).toBeTruthy();
  });

  it('renders the first-click coverage chip in the first-click cell', () => {
    render(<AdsDrawer {...OPEN_PROPS} />);
    expect(
      document.body.querySelector('[data-testid="first-click-coverage-chip"]'),
    ).toBeTruthy();
  });

  it('the first-click column header is present', () => {
    render(<AdsDrawer {...OPEN_PROPS} />);
    expect(document.body.textContent ?? '').toMatch(/first-click/);
  });
});
