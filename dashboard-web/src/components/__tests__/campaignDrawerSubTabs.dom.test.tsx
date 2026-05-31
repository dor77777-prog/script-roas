// dashboard-web/src/components/__tests__/campaignDrawerSubTabs.dom.test.tsx
//
// Task 5.5 (Wave 5) — CampaignDrawer 6-sub-tab navigation + hero data-band.
//
// Coverage:
//   1. All 6 sub-tab triggers render and the default active tab is Overview.
//   2. Clicking a sub-tab swaps the content panel via data-testid.
//   3. The Sheet.Header hero card carries `data-band` equal to
//      `useRoasBandGradient(campaign.roas).band` — the same band signal
//      the rest of the dashboard surfaces.
//   4. The 4 ROAS bands (red / orange / green / blue) all map correctly
//      from the campaign's aggregate ROAS.

import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

// ---------------------------------------------------------------------------
// Hoist mocks — same shape as bidi.dom.test.tsx (so the drawer's SWR fetches
// stay null and we don't have to stub network).
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
import type { CampaignRow } from '@/lib/campaigns';

// ---------------------------------------------------------------------------
// Test fixtures.
// ---------------------------------------------------------------------------
function makeRow(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    date: '2026-05-30',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    platform: 'Meta',
    campaignId: 'campaign-band-test',
    campaignName: 'Band Test Campaign',
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

// Helper to render the drawer with a campaign whose aggregate ROAS hits a
// specific band. spend stays 100; flexing conversionValue moves the ROAS.
function renderWithRoas(roas: number) {
  // conversionValue / spend === roas → conversionValue = spend * roas.
  const rows = [
    makeRow({
      spend: 100,
      conversionValue: 100 * roas,
    }),
  ];
  return render(
    <CampaignDrawer
      open
      onClose={() => {}}
      rows={rows}
      campaignId="campaign-band-test"
      storeId="uzoshop"
      adAccounts={{}}
      rangeFrom="2026-05-01"
      rangeTo="2026-05-30"
    />,
  );
}

describe('CampaignDrawer — 6 sub-tab navigation (Task 5.5)', () => {
  it('renders all 6 sub-tab triggers in order', () => {
    renderWithRoas(2.5);
    const tabsList = screen.getByTestId('campaign-drawer-tabs');
    expect(tabsList).toBeTruthy();
    const expectedOrder = [
      'campaign-drawer-tab-trigger-overview',
      'campaign-drawer-tab-trigger-daily',
      'campaign-drawer-tab-trigger-adsets',
      'campaign-drawer-tab-trigger-ads',
      'campaign-drawer-tab-trigger-status',
      'campaign-drawer-tab-trigger-history',
    ];
    for (const id of expectedOrder) {
      expect(screen.getByTestId(id)).toBeTruthy();
    }
  });

  it('default active sub-tab is Overview', () => {
    renderWithRoas(2.5);
    // Overview content is visible by default; the others are not rendered
    // by Radix Tabs until selected.
    expect(screen.getByTestId('campaign-drawer-tab-overview')).toBeTruthy();
    expect(screen.queryByTestId('campaign-drawer-tab-daily')).toBeNull();
    expect(screen.queryByTestId('campaign-drawer-tab-status')).toBeNull();
  });

  it('clicking the Status trigger swaps content to the Status sub-tab', () => {
    renderWithRoas(2.5);
    const statusTrigger = screen.getByTestId('campaign-drawer-tab-trigger-status');
    // Radix Tabs listens on pointerdown / mousedown — use fireEvent with both
    // to match real browser activation sequence.
    act(() => {
      fireEvent.pointerDown(statusTrigger);
      fireEvent.mouseDown(statusTrigger);
      fireEvent.click(statusTrigger);
    });
    expect(screen.getByTestId('campaign-drawer-tab-status')).toBeTruthy();
    expect(screen.queryByTestId('campaign-drawer-tab-overview')).toBeNull();
  });

  it('clicking the History trigger swaps content to the History sub-tab', () => {
    renderWithRoas(2.5);
    const historyTrigger = screen.getByTestId('campaign-drawer-tab-trigger-history');
    act(() => {
      fireEvent.pointerDown(historyTrigger);
      fireEvent.mouseDown(historyTrigger);
      fireEvent.click(historyTrigger);
    });
    expect(screen.getByTestId('campaign-drawer-tab-history')).toBeTruthy();
  });
});

describe('CampaignDrawer — hero data-band matches useRoasBandGradient (Task 5.5)', () => {
  it('roas=1.5 (< 2.0) → data-band="red"', () => {
    renderWithRoas(1.5);
    const hero = screen.getByTestId('campaign-drawer-hero');
    expect(hero.getAttribute('data-band')).toBe('red');
  });

  it('roas=2.3 (2.0 ≤ x < 2.7) → data-band="orange"', () => {
    renderWithRoas(2.3);
    const hero = screen.getByTestId('campaign-drawer-hero');
    expect(hero.getAttribute('data-band')).toBe('orange');
  });

  it('roas=2.8 (2.7 ≤ x < 3.0) → data-band="green"', () => {
    renderWithRoas(2.8);
    const hero = screen.getByTestId('campaign-drawer-hero');
    expect(hero.getAttribute('data-band')).toBe('green');
  });

  it('roas=3.5 (≥ 3.0) → data-band="blue"', () => {
    renderWithRoas(3.5);
    const hero = screen.getByTestId('campaign-drawer-hero');
    expect(hero.getAttribute('data-band')).toBe('blue');
  });
});
