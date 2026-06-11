// @vitest-environment jsdom
//
// 2026-06-11 adversarial review — CampaignsTableRow's 'unknown ⇒ no click-id
// evidence' assumption was broken by the P1-8a verdict ('הפלטפורמה מדווחת 0',
// claim=0/det>0). Pre-fix, ANY trust.level==='unknown' routed the ROAS
// Shopify cell to the mapping-fallback tooltip, so an unmapped Google
// campaign whose platform reports 0 while click-id-tagged orders flow
// rendered the deterministic ROAS under THREE false claims:
//   - 'מבוסס מיפוי מוצרים'  (no mapping exists on this row)
//   - 'לא מספיק לסיגנל'      (the tagged orders ARE the trusted evidence)
//   - 'חוזרים למיפוי מוצרים' (nothing falls back to mapping)
// while the drawer's Attribution panel told the opposite (correct) story.
//
// Post-fix the unknown-40 verdict routes through the click-id (useAttr)
// presentation: the tooltip carries the verdict's own label, the platform-
// reports-0 reasons, and the check-the-conversion-tag recommendation.
//
// Touch mode is pinned (same pattern as campaignsRowTouch.dom.test.tsx) so
// the tooltip content is tap-openable and assertable in jsdom via the Radix
// Popover portal + role=status live region.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, fireEvent, cleanup, screen } from '@testing-library/react';

// Pin the TOUCH (coarse-pointer) branch — content opens on tap.
vi.mock('@/components/ui/tooltip/useTouchTooltipMode', () => ({
  useTouchTooltipMode: () => true,
}));

import { CampaignsTableRow } from '@/components/CampaignsTableRow';
import { analyzeAttribution } from '@/lib/attributionAnalysis';
import { buildUnmappedAttributionInfo } from '@/lib/hooks/useCampaignTrueRevenue';
import { campaignKey } from '@/lib/campaignProductMap';
import { makeOrder } from '@/lib/__tests__/fixtures';
import type { Aggregated } from '@/lib/campaignsAggregator';
import type { TrueRevenueInfo } from '@/lib/hooks/useCampaignTrueRevenue';
import type { AdAccountMap } from '@/lib/campaignsLinks';

afterEach(() => {
  cleanup();
});

const STORE_ID = 'uzoshop';
const CAMPAIGN_ID = 'G1';

const AGG: Aggregated = {
  key: `${STORE_ID}::Google::${CAMPAIGN_ID}`,
  storeId: STORE_ID,
  storeName: 'uzoshop',
  platform: 'Google',
  campaignId: CAMPAIGN_ID,
  campaignName: 'PMax — Brand',
  adSetId: undefined,
  adSetName: undefined,
  spend: 100,
  impressions: 4000,
  clicks: 120,
  conversions: 0,
  conversionValue: 0, // ← the platform reports ZERO
  campaignBudgetCad: null,
  adSetBudgetCad: null,
  budgetType: '',
  lastActiveDate: '2026-06-09',
  effectiveStatus: 'ENABLED',
  lastLiveTickAt: null,
  regConfiguredStatus: null,
  regEffectiveStatus: null,
  regDeliveryStatus: null,
  regFirstSeenAt: null,
  regStatusChangedAt: null,
  regLastStatusSuccessAt: null,
};

/** Build the info end-to-end through the REAL analyzer + unmapped-info
 *  builder, so this test breaks if either side of the contract drifts. */
function buildInfo(): TrueRevenueInfo {
  const analysis = analyzeAttribution(
    {
      campaignName: 'PMax — Brand',
      campaignId: CAMPAIGN_ID,
      storeId: STORE_ID,
      platform: 'Google',
      metaClaim: 0, // platform claims nothing…
      spend: 100,
    },
    [
      // …while a click-id-tagged order flows.
      makeOrder({
        orderId: 'g-1',
        source: 'google-paid',
        utmId: CAMPAIGN_ID,
        utmCampaign: '',
        totalCad: 150,
        date: '2026-06-05',
      }),
    ],
    '2026-06-01',
    '2026-06-09',
  );
  expect(analysis).not.toBeNull();
  expect(analysis!.trust.level).toBe('unknown');
  expect(analysis!.trust.label).toBe('הפלטפורמה מדווחת 0');
  expect(analysis!.deterministicOrders).toBe(1);
  const info = buildUnmappedAttributionInfo(
    { platform: 'Google', conversionValue: 0, spend: 100 },
    analysis,
  );
  expect(info).not.toBeNull();
  return info!;
}

function renderRow(info: TrueRevenueInfo) {
  const key = campaignKey(STORE_ID, 'Google', CAMPAIGN_ID);
  return render(
    <table>
      <tbody>
        <CampaignsTableRow
          a={AGG}
          i={0}
          mode="campaign"
          trueRevenueByKey={new Map([[key, info]])}
          firstClickByCampaign={new Map()}
          mappedCampaignKeys={new Set()}
          health={undefined}
          columnOrder={['roasShopify']}
          adAccounts={{} as AdAccountMap}
          optimized={new Set()}
          today="2026-06-10"
          rangeIncludesToday={false}
          onToggleOptimized={vi.fn()}
          onDrillCampaign={vi.fn()}
          onDrillAd={vi.fn()}
        />
      </tbody>
    </table>,
  );
}

describe('ROAS Shopify cell — unknown-40 (claim=0/det>0) tooltip honesty', () => {
  it('renders the deterministic ROAS with the VERDICT story — never the mapping-fallback copy', () => {
    const info = buildInfo();
    const { container } = renderRow(info);

    const cell = container.querySelector('[data-col-id="roasShopify"]');
    expect(cell).not.toBeNull();
    // det $150 / spend $100 → 1.50 — the click-id number renders.
    expect(cell!.textContent).toContain('1.5');

    // Tap the cell's trigger (the non-phrasing inline-flex div IS the
    // Toggletip trigger on touch).
    const trigger = cell!.querySelector('div');
    expect(trigger).not.toBeNull();
    fireEvent.click(trigger!);

    // The opened content carries the verdict's own story…
    const verdictNodes = screen.getAllByText(
      (text) => text.includes('הפלטפורמה מדווחת 0'),
    );
    expect(verdictNodes.length).toBeGreaterThan(0);
    const tooltipText = verdictNodes[0].textContent ?? '';
    // …platform reports 0 / value from click-id tagged orders / check the tag.
    expect(tooltipText).toContain('מתויג click-id');
    expect(tooltipText).toMatch(/תגית|המרות/);

    // The pre-fix false mapping-fallback claims must be gone.
    expect(document.body.textContent).not.toContain('מבוסס מיפוי מוצרים');
    expect(document.body.textContent).not.toContain('לא מספיק לסיגנל');
    expect(document.body.textContent).not.toContain('חוזרים למיפוי מוצרים');
  });
});
