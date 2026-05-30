// dashboard-web/src/components/__tests__/bidi.dom.test.tsx
//
// Task 12 — bidi isolation on mixed Hebrew+English surfaces.
// Asserts that dynamic LTR strings (campaign name, platform name, store name)
// are wrapped in <bdi dir="ltr"> so RTL layout doesn't mirror them.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoist mocks (must appear before any imports that load these modules).
// ---------------------------------------------------------------------------
vi.mock('swr', () => ({
  default: () => ({ data: undefined, isLoading: false }),
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

vi.mock('@/lib/campaignProductMap', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    readProductMap: () => ({}),
    setMappedProducts: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Imports after mocks.
// ---------------------------------------------------------------------------
import { CampaignDrawer } from '@/components/CampaignDrawer';
import { PerStoreCards } from '@/components/PerStoreCards';
import type { CampaignRow } from '@/lib/campaigns';

// ---------------------------------------------------------------------------
// Minimal CampaignRow factory.
// ---------------------------------------------------------------------------
function makeRow(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    date: '2026-05-30',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    platform: 'Meta',
    campaignId: 'campaign-123',
    campaignName: 'Summer Sale 2026',
    adSetId: 'adset-1',
    adSetName: 'Ad Set 1',
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

describe('Task 12 — bidi isolation on mixed Hebrew+English surfaces', () => {
  it('CampaignDrawer title wraps campaign name in <bdi dir="ltr">', () => {
    render(
      <CampaignDrawer
        open
        onClose={() => {}}
        rows={[makeRow()]}
        campaignId="campaign-123"
        storeId="uzoshop"
        adAccounts={{}}
        rangeFrom="2026-05-01"
        rangeTo="2026-05-30"
      />,
    );
    const heading = screen.getByRole('heading', { level: 2 });
    const bdi = heading.querySelector('bdi[dir="ltr"]');
    expect(bdi).not.toBeNull();
    expect(bdi!.textContent).toBe('Summer Sale 2026');
  });

  it('CampaignDrawer "Open in {platform} Ads Manager" link isolates platform name', () => {
    render(
      <CampaignDrawer
        open
        onClose={() => {}}
        rows={[makeRow()]}
        campaignId="campaign-123"
        storeId="uzoshop"
        adAccounts={{}}
        rangeFrom="2026-05-01"
        rangeTo="2026-05-30"
      />,
    );
    const link = screen.getByRole('link', { name: /Ads Manager/ });
    expect(link.querySelector('bdi[dir="ltr"]')).not.toBeNull();
  });

  it('PerStoreCards wraps store name in <bdi dir="ltr">', () => {
    render(
      <PerStoreCards
        data={[{ store: 'uzoshop', spend: 100, revenue: 200, roas: 2, orders: 5, fbSpend: 100, gaSpend: 0, grossProfit: 100 } as never]}
      />,
    );
    const storeLabel = screen.getByText('uzoshop');
    expect(storeLabel.tagName.toLowerCase()).toBe('bdi');
    expect(storeLabel.getAttribute('dir')).toBe('ltr');
  });
});
