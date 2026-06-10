// @vitest-environment jsdom
//
// 2026-06-10 audit — row-tap double-fire on touch (Wave 8A item 3).
//
// Pre-fix: CampaignsTableRow wraps its <tr> (which has its own drill
// onClick) in a HelpTooltip hint ('לחץ לפרטים מלאים'). On touch the
// Toggletip made the row the Radix Popover trigger and Radix COMPOSES the
// handlers — one tap opened the drawer AND left an orphaned hint popover
// floating over it. Separately, in-row ⓘ help taps bubbled up into the row
// onClick and triggered the drill.
//
// Post-fix (Toggletip):
//   - a non-phrasing trigger child with its OWN onClick suppresses the hint
//     popover entirely → tapping the row fires the drill ONCE, no orphan.
//   - the ⓘ button (and child-as-trigger taps) stopPropagation → tapping an
//     in-row ⓘ opens ONLY the help, never the drill.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';

// Pin the TOUCH (coarse-pointer) branch.
vi.mock('@/components/ui/tooltip/useTouchTooltipMode', () => ({
  useTouchTooltipMode: () => true,
}));

import { CampaignsTableRow } from '@/components/CampaignsTableRow';
import type { Aggregated } from '@/lib/campaignsAggregator';
import type { AdAccountMap } from '@/lib/campaignsLinks';

afterEach(() => {
  cleanup();
});

const AGG: Aggregated = {
  key: 'uzoshop::Meta::c1::adset-1',
  storeId: 'uzoshop',
  storeName: 'uzoshop',
  platform: 'Meta',
  campaignId: 'c1',
  campaignName: 'Campaign One',
  adSetId: 'adset-1',
  adSetName: 'Ad Set 1',
  spend: 100,
  impressions: 1000,
  clicks: 25,
  conversions: 2,
  conversionValue: 300,
  campaignBudgetCad: 50,
  adSetBudgetCad: 25,
  budgetType: 'CBO',
  lastActiveDate: '2026-06-09',
  effectiveStatus: 'ACTIVE',
  lastLiveTickAt: null,
  regConfiguredStatus: null,
  regEffectiveStatus: null,
  regDeliveryStatus: null,
  regFirstSeenAt: null,
  regStatusChangedAt: null,
  regLastStatusSuccessAt: null,
};

function renderRow(onDrillCampaign = vi.fn()) {
  render(
    <table>
      <tbody>
        <CampaignsTableRow
          a={AGG}
          i={0}
          mode="campaign"
          trueRevenueByKey={new Map()}
          firstClickByCampaign={new Map()}
          mappedCampaignKeys={new Set()}
          health={undefined}
          columnOrder={['spend', 'roas', 'conversions']}
          adAccounts={{} as AdAccountMap}
          optimized={new Set()}
          today="2026-06-10"
          rangeIncludesToday={false}
          onToggleOptimized={vi.fn()}
          onDrillCampaign={onDrillCampaign}
          onDrillAd={vi.fn()}
        />
      </tbody>
    </table>,
  );
  return onDrillCampaign;
}

describe('CampaignsTableRow on TOUCH — single-fire row tap (item 3)', () => {
  it('tapping the row fires the drill EXACTLY ONCE with no orphaned hint popover', () => {
    const onDrill = renderRow();
    const row = screen.getByRole('row');

    fireEvent.click(row);

    expect(onDrill).toHaveBeenCalledTimes(1);
    expect(onDrill).toHaveBeenCalledWith('c1', 'Meta', 'uzoshop');
    // The 'לחץ לפרטים מלאים' hint popover must NOT be left floating over
    // the opened drawer (pre-fix: Radix composed the row tap into a
    // popover toggle as well).
    expect(screen.queryByText('לחץ לפרטים מלאים')).toBeNull();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('tapping an in-row ⓘ help opens ONLY the help — the tap does NOT bubble into the row drill', () => {
    const onDrill = renderRow();
    const row = screen.getByRole('row');

    // The campaign-name cell's toggletip pairs the name with an ⓘ button.
    const infoButtons = within(row).getAllByRole('button', { name: 'הסבר' });
    expect(infoButtons.length).toBeGreaterThan(0);

    fireEvent.click(infoButtons[0]);

    expect(onDrill).not.toHaveBeenCalled();
  });
});
