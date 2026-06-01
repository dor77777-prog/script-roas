// dashboard-web/src/components/__tests__/campaignDrawerSubTabs.dom.test.tsx
//
// Task 5.5 (Wave 5) — CampaignDrawer 6-sub-tab navigation.
// Task 1.5 (2026-06-01) — NEUTRAL hero header (replaces the old data-band hero).
//
// Coverage:
//   1. All 6 sub-tab triggers render and the default active tab is Overview.
//   2. Clicking a sub-tab swaps the content panel via data-testid.
//   3. The hero header is NEUTRAL — it must NOT carry `data-band` (that coupling
//      to `.glass[data-band]:not([data-mounted])` made the header render at
//      opacity:0 on every campaign — the Task-1.5 invisibility bug). Instead it
//      shows the campaign name, a brand-colored platform pill, and a ROAS health
//      chip (the band signal now lives on the chip, not the header surface).

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

describe('CampaignDrawer — neutral hero header (Task 1.5)', () => {
  it('does NOT carry data-band (else the .glass[data-band] opacity:0 rule hides the header)', () => {
    renderWithRoas(1.5);
    const hero = screen.getByTestId('campaign-drawer-hero');
    expect(
      hero.getAttribute('data-band'),
      'data-band on the hero re-triggers the opacity:0 invisibility bug',
    ).toBeNull();
  });

  it('renders the campaign name, a brand-colored platform pill, and a ROAS health chip', () => {
    renderWithRoas(3.5);
    const hero = screen.getByTestId('campaign-drawer-hero');
    // Campaign name (the thing that was invisible before the fix).
    expect(hero.textContent).toContain('Band Test Campaign');
    // Platform identity = the brand-tinted pill wrapping the canonical badge.
    const pill = hero.querySelector('.platform-pill[data-platform="meta"]');
    expect(pill, 'header must render the .platform-pill for the campaign platform').toBeTruthy();
    expect(hero.textContent).toContain('Meta');
    // ROAS health chip preserves the band signal on the neutral header.
    expect(hero.textContent).toMatch(/ROAS\s*3\.50/);
    // The AA fix (label → neutral ink, dot keeps brand color) is guarded
    // hermetically against globals.css in campaignDrawerHeaderGuard.test.ts —
    // jsdom doesn't load the stylesheet, so the computed-color check lives there.
  });
});
