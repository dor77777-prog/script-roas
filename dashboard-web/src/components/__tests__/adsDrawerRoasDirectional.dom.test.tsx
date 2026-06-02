// @vitest-environment jsdom
//
// Task 17 (2026-06-02, plan-a-foundation-framing) — AdsDrawer per-platform
// ROAS demotion. The ad-level platform-ROAS COLUMN HEADER must carry the
// "directional / מכוון" cue so the operator reads it as a soft signal, while
// the deterministic "ROAS Shopify" column stays the trusted source of truth.
//
// We mock `swr` to return one ad row in-scope for the open-drawer props so the
// table (and therefore the ROAS column header) actually renders.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup } from '@testing-library/react';

// Primary /api/ads SWR → one in-scope ad row; secondary
// /api/orders-attribution SWR → empty rows (chip degrades to "—").
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
              adId: 'ad-1',
              adName: 'Ad One',
              spend: 100,
              impressions: 1000,
              clicks: 50,
              conversions: 4,
              conversionValue: 250,
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
    return {
      data: { rows: [], lastUpdated: '2026-05-30T00:00:00.000Z' },
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

describe('AdsDrawer per-platform ROAS demotion (2026-06-02)', () => {
  it('the platform-ROAS column header shows the directional cue', () => {
    render(<AdsDrawer {...OPEN_PROPS} />);
    // SheetContent portals to <body>, so assert against the document body
    // (not the render container, which stays empty for portalled content).
    expect(document.body.textContent ?? '').toMatch(/מכוון|directional/);
  });
});
