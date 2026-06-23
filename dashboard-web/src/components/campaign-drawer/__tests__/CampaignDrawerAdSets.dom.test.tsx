// dashboard-web/src/components/campaign-drawer/__tests__/CampaignDrawerAdSets.dom.test.tsx
//
// Ad-set-level product mapping UI (2026-06-23).
//
// Coverage:
//   1. Each ad-set row renders a "מפה מוצרים" action; clicking it calls
//      onMapProducts with the ad-set identity (store/platform/campaign/id/name).
//   2. An ad-set with its OWN mapping shows a product-count indicator chip.
//   3. An ad-set inheriting the campaign mapping (no own entry) shows the
//      "יורש" (inherited) hint, NOT an own-count chip.
//   4. The action + chip do NOT break the existing row drill (clicking the
//      action must NOT also drill to ads — stopPropagation).

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { CampaignDrawerAdSets } from '@/components/campaign-drawer/CampaignDrawerAdSets';

type Props = React.ComponentProps<typeof CampaignDrawerAdSets>;
type AdSet = Props['adSets'][number];

function makeSet(overrides: Partial<AdSet> = {}): AdSet {
  return {
    id: 'as-1',
    name: 'Ad Set 1',
    storeId: 'uzoshop',
    platform: 'Meta',
    campaignId: 'camp-1',
    spend: 100,
    value: 350,
    clicks: 50,
    impressions: 1000,
    conversions: 5,
    adSetBudgetCad: null,
    roas: 3.5,
    ...overrides,
  };
}

function renderAdSets(overrides: Partial<Props> = {}) {
  const onMapProducts = vi.fn();
  const onDrillAds = vi.fn();
  const props: Props = {
    adSets: [makeSet()],
    sortKey: 'spend',
    sortDir: 'desc',
    onSort: vi.fn(),
    attributionByAdSet: new Map(),
    optimized: new Set(),
    onToggleOptimized: vi.fn(),
    onDrillAds,
    rangeIncludesToday: false,
    onMapProducts,
    mappingByAdSet: new Map(),
    ...overrides,
  };
  render(<CampaignDrawerAdSets {...props} />);
  return { onMapProducts, onDrillAds };
}

describe('CampaignDrawerAdSets — per-ad-set product mapping', () => {
  it('renders a "מפה מוצרים" action on each ad-set row', () => {
    renderAdSets();
    expect(screen.getByRole('button', { name: /מפה מוצרים/ })).toBeTruthy();
  });

  it('clicking the action calls onMapProducts with the ad-set identity', () => {
    const { onMapProducts, onDrillAds } = renderAdSets({
      adSets: [makeSet({ id: 'as-7', name: 'נשים 25-34', campaignId: 'camp-9', platform: 'Meta', storeId: 'zolplus' })],
    });
    fireEvent.click(screen.getByRole('button', { name: /מפה מוצרים/ }));
    expect(onMapProducts).toHaveBeenCalledWith({
      storeId: 'zolplus',
      platform: 'Meta',
      campaignId: 'camp-9',
      adSetId: 'as-7',
      adSetName: 'נשים 25-34',
    });
    // Must not ALSO drill to ads (stopPropagation on the action button).
    expect(onDrillAds).not.toHaveBeenCalled();
  });

  it('shows an own-mapping count chip when the ad-set has its OWN mapping', () => {
    renderAdSets({
      adSets: [makeSet({ id: 'as-1' })],
      mappingByAdSet: new Map([['as-1', { ownCount: 2, inheritedCount: 0 }]]),
    });
    // The count chip shows "2".
    expect(screen.getByTestId('adset-mapping-own-as-1').textContent).toContain('2');
  });

  it('shows the inherited hint (NOT an own chip) when the ad-set inherits the campaign mapping', () => {
    renderAdSets({
      adSets: [makeSet({ id: 'as-1' })],
      mappingByAdSet: new Map([['as-1', { ownCount: 0, inheritedCount: 3 }]]),
    });
    expect(screen.queryByTestId('adset-mapping-own-as-1')).toBeNull();
    expect(screen.getByTestId('adset-mapping-inherited-as-1')).toBeTruthy();
  });

  it('shows neither chip when the ad-set has no own and no inherited mapping', () => {
    renderAdSets({
      adSets: [makeSet({ id: 'as-1' })],
      mappingByAdSet: new Map([['as-1', { ownCount: 0, inheritedCount: 0 }]]),
    });
    expect(screen.queryByTestId('adset-mapping-own-as-1')).toBeNull();
    expect(screen.queryByTestId('adset-mapping-inherited-as-1')).toBeNull();
  });
});
