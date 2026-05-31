// dashboard-web/src/components/__tests__/bidi.dom.test.tsx
//
// Task 12 — bidi isolation on mixed Hebrew+English surfaces.
// Asserts that dynamic LTR strings (campaign name, platform name, store name)
// are wrapped in <bdi dir="ltr"> so RTL layout doesn't mirror them.

import { describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';

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
import { CampaignsTopList, type CampaignTopListPoint } from '@/components/CampaignsTopList';
import { AdsDrawer } from '@/components/AdsDrawer';
import { CommandPalette } from '@/components/CommandPalette';
import { ThemeProvider } from '@/components/ThemeProvider';
import type { CampaignRow } from '@/lib/campaigns';
import type { DashboardData, Filters as DashFilters } from '@/lib/types';

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

// ---------------------------------------------------------------------------
// Wave 4 / Task 4.2 — regressions for 6 newly-isolated interpolation sites.
// ---------------------------------------------------------------------------
describe('Wave 4 / Task 4.2 — additional <bdi> isolation regressions', () => {
  // CampaignsTopList — line 54 (PlatformRow store) + 104 (Row campaign name)
  it('CampaignsTopList wraps campaign name AND store name in <bdi dir="ltr">', () => {
    const data: CampaignTopListPoint[] = [
      { name: 'Summer Sale 2026', platform: 'Meta', storeName: 'uzoshop', roas: 4.2, cac: 12, spend: 500 },
      { name: 'Bad Camp 99', platform: 'TikTok', storeName: 'usmile360', roas: 0.5, cac: 200, spend: 200 },
    ];
    const { container } = render(<CampaignsTopList data={data} title="Test" />);

    // Campaign names (rendered via the Row block, line 104+).
    const nameBdi = Array.from(container.querySelectorAll<HTMLElement>('bdi[dir="ltr"]'))
      .find(b => b.textContent === 'Summer Sale 2026');
    expect(nameBdi).toBeDefined();

    // Store names (rendered via PlatformRow, line 54+).
    const storeBdi = Array.from(container.querySelectorAll<HTMLElement>('bdi[dir="ltr"]'))
      .find(b => b.textContent === 'uzoshop');
    expect(storeBdi).toBeDefined();
  });

  // AdsDrawer — line 336 ("ad-set" literal) + ad-set name in <Heading>.
  it('AdsDrawer header isolates the "ad-set" literal AND the ad-set name', () => {
    render(
      <AdsDrawer
        open
        onClose={() => {}}
        storeId="uzoshop"
        platform="Meta"
        campaignId="campaign-123"
        adSetId="adset-1"
        adSetName="My Ad Set 2026"
        rangeFrom="2026-05-01"
        rangeTo="2026-05-30"
        adAccounts={{}}
      />,
    );
    // Sheet portals into document.body; query the whole document.
    const allBdi = Array.from(document.querySelectorAll<HTMLElement>('bdi[dir="ltr"]'));
    // "ad-set" literal wrapped in <bdi>.
    expect(allBdi.find(b => b.textContent === 'ad-set')).toBeDefined();
    // Ad-set name wrapped in <bdi>.
    expect(allBdi.find(b => b.textContent === 'My Ad Set 2026')).toBeDefined();
  });

  // CommandPalette — line 273 (campaign subtitle/label) + 322 (product subtitle).
  // The palette renders inside a modal layer that's hidden until open; we open
  // it by passing the Cmd+K key, but that's harder than just rendering with
  // open-by-default via the button. Easier: render and click the trigger.
  it('CommandPalette store list wraps store id in <bdi dir="ltr">', () => {
    const data: DashboardData = {
      stores: ['uzoshop', 'usmile360'],
      perStore: [],
      perStoreDaily: [],
      perStoreAndPlatformDaily: [],
      perPlatformDaily: [],
      totalsDaily: [],
      perPlatformPerStoreTotals: [],
      perStoreCogsTotals: [],
      ordersDaily: [],
      lastUpdated: '2026-05-30T00:00:00Z',
      dataLastWriteAt: null,
    } as unknown as DashboardData;

    const filters: DashFilters = {
      store: 'All',
      range: { from: '2026-05-01', to: '2026-05-30' },
      preset: 'last_30_days',
    } as unknown as DashFilters;

    const { container } = render(
      <ThemeProvider>
        <CommandPalette
          data={data}
          filters={filters}
          setFilters={() => {}}
          activeTab="home"
          setActiveTab={() => {}}
          onRefresh={() => {}}
          onOpenAiReport={() => {}}
        />
      </ThemeProvider>,
    );

    // Click the trigger pill to open the palette. act() flushes the
    // setOpen state update so the modal portal is in the DOM before we
    // query for <bdi> wrappers.
    const trigger = container.querySelector<HTMLButtonElement>(
      'button[aria-label="פתח פנל פקודות"]',
    );
    expect(trigger).not.toBeNull();
    act(() => { trigger!.click(); });

    // After open, the modal renders all stores as <bdi> entries.
    const storeBdi = Array.from(document.querySelectorAll<HTMLElement>('bdi[dir="ltr"]'))
      .find(b => b.textContent === 'uzoshop');
    expect(storeBdi).toBeDefined();
  });
});
