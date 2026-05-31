// dashboard-web/src/components/__tests__/adsOverModalStack.dom.test.tsx
//
// Wave-4 Task 4.3 — the AdsDrawer (edge drawer, side="end") opens OVER the
// centered Campaign MODAL (variant="modal") and must stack ABOVE it, and the
// Esc key must close the TOP of the stack first (ads, then the modal).
//
// Coverage:
//   1. Open the campaign modal, drill into an ad-set → BOTH surfaces mount
//      (the modal hero + the ads drawer title) at the same time.
//   2. The ads drawer's content + overlay carry z-[60] so they paint above
//      the modal's z-50 layer (its scrim can't cover the drilldown).
//   3. The campaign modal's overlay uses the scrim token (bg-scrim) — it
//      dims behind the ads drawer.
//   4. Esc closes the ads drawer first (via useDrawerEsc / drawerStack);
//      the modal stays open. A second Esc would close the modal — but the
//      modal calls onEscapeKeyDown preventDefault on the Radix layer and
//      relies on useDrawerEsc, so we assert the stack pops ads-first.

import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';

// Keep all SWR fetches null so we don't stub the network (matches
// campaignDrawerSubTabs.dom.test.tsx). Both drawers handle undefined data.
vi.mock('swr', () => ({
  default: () => ({ data: undefined, isLoading: false, error: undefined, mutate: vi.fn() }),
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

import { CampaignDrawer } from '@/components/CampaignDrawer';
import type { CampaignRow } from '@/lib/campaigns';

function makeRow(overrides: Partial<CampaignRow> = {}): CampaignRow {
  return {
    date: '2026-05-30',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    platform: 'Meta',
    campaignId: 'cmp-stack',
    campaignName: 'Stack Test Campaign',
    adSetId: 'adset-1',
    adSetName: 'Ad Set One',
    spend: 100,
    impressions: 1000,
    clicks: 50,
    conversions: 5,
    conversionValue: 280, // roas 2.8
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

function openModal() {
  const onClose = vi.fn();
  render(
    <CampaignDrawer
      open
      onClose={onClose}
      rows={[makeRow()]}
      campaignId="cmp-stack"
      storeId="uzoshop"
      adAccounts={{}}
      rangeFrom="2026-05-01"
      rangeTo="2026-05-30"
    />,
  );
  return { onClose };
}

// Drill into the ad-set via the Ad Sets sub-tab → click the ad-set's
// "drill ads" affordance. The AdSets sub-tab renders a row per ad-set with a
// button that calls onDrillAds; we locate it by the ad-set name.
function drillIntoAds() {
  // Switch to the Ad Sets sub-tab.
  const adsetsTrigger = screen.getByTestId('campaign-drawer-tab-trigger-adsets');
  act(() => {
    fireEvent.pointerDown(adsetsTrigger);
    fireEvent.mouseDown(adsetsTrigger);
    fireEvent.click(adsetsTrigger);
  });
  // The AdSetTable makes the whole ad-set <tr> clickable (canDrillToAds) and
  // its onClick fires onDrillAds → opens the AdsDrawer. Click the row that
  // contains the ad-set name "Ad Set One".
  const adSetNameCell = screen.getByText('Ad Set One');
  const row = adSetNameCell.closest('tr');
  if (!row) throw new Error('could not find the ad-set row on the AdSets sub-tab');
  act(() => {
    fireEvent.click(row);
  });
}

describe('AdsDrawer over the Campaign modal (Wave-4 Task 4.3)', () => {
  it('renders BOTH the modal and the ads drawer; ads stacks above (z-[60]) over a scrim modal', () => {
    openModal();
    // Modal hero present.
    const hero = screen.getByTestId('campaign-drawer-hero');
    expect(hero).toBeInTheDocument();

    drillIntoAds();

    // Ads drawer mounted on top of the still-mounted modal — its title
    // element (id="ads-drawer-title") proves the drawer rendered.
    const adsTitle = hero.ownerDocument.getElementById('ads-drawer-title');
    expect(adsTitle).not.toBeNull();
    expect(adsTitle!.textContent).toContain('Ad Set One');
    // Modal hero is still mounted (modal dims behind, not unmounted).
    expect(screen.getByTestId('campaign-drawer-hero')).toBeInTheDocument();

    const doc = hero.ownerDocument;
    // The ads drawer content carries z-[60] (above the modal's z-50 layer).
    const z60Content = doc.querySelector('[class*="z-[60]"]');
    expect(z60Content).not.toBeNull();

    // Exactly one overlay uses the scrim (the modal). The ads overlay uses
    // the drawer wash (bg-glass-3) and is lifted to z-[60].
    const scrimOverlay = doc.querySelector('[class*="bg-scrim"]');
    expect(scrimOverlay).not.toBeNull();
    const adsOverlay = doc.querySelector('[class*="bg-glass-3"][class*="z-[60]"]');
    expect(adsOverlay).not.toBeNull();
  });

  it('Esc closes the ads drawer first, leaving the modal open', () => {
    openModal();
    const doc = screen.getByTestId('campaign-drawer-hero').ownerDocument;
    drillIntoAds();

    // Both mounted (ads drawer identified by its title id).
    expect(doc.getElementById('ads-drawer-title')).not.toBeNull();
    expect(screen.getByTestId('campaign-drawer-hero')).toBeInTheDocument();

    // Esc → drawerStack pops the TOP entry (the ads drawer) only.
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });

    // Ads drawer is gone (title unmounted); the modal hero remains.
    expect(doc.getElementById('ads-drawer-title')).toBeNull();
    expect(screen.getByTestId('campaign-drawer-hero')).toBeInTheDocument();
  });
});
