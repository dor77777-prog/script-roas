// dashboard-web/src/components/__tests__/campaignsAllocatedColumn.dom.test.tsx
//
// Column-audit 2026-06-01 — DOM tests for the four Campaigns-table column fixes.
//
// FIX 1 — the new "ערך Shopify · מוקצה" (shopifyValueAllocated) column renders
//         info.trueRevenue (the ROAS Shopify NUMERATOR) with 2 decimals, so the
//         operator can reconcile roasShopify = trueRevenue / spend on screen.
//         No math is changed — the cell reads the existing allocator output.
//
// FIX 4 — the column-reorder ▲▼ buttons in CampaignsColumnsMenu carry a
//         visible, non-transparent token surface (bg-glass-2 + glass-edge
//         border) in both themes instead of being invisible ghost icons.
//
// These render real DOM via @testing-library/react and assert on the painted
// values / classes (no snapshot mocks), matching the project's DOM-test style.

import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CampaignsTableRow } from '../CampaignsTableRow';
import { CampaignsColumnsMenu } from '../CampaignsColumnsMenu';
import { campaignKey } from '@/lib/campaignProductMap';
import type { Aggregated } from '@/lib/campaignsAggregator';
import type { TrueRevenueInfo } from '@/lib/hooks/useCampaignTrueRevenue';

// ---------------------------------------------------------------------------
// Fixtures — a single mapped Meta campaign with a deterministic numerator.
// spend = 118, deterministic = 172, trueRevenue = 173.46 → roasShopify ≈ 1.47.
// ---------------------------------------------------------------------------
const STORE_ID = 'uzoshop';
const PLATFORM = 'Meta';
const CAMPAIGN_ID = 'C123';
const SPEND = 118;
const TRUE_REVENUE = 173.46;

const ROW: Aggregated = {
  key: `${STORE_ID}::${PLATFORM}::${CAMPAIGN_ID}`,
  storeId: STORE_ID,
  storeName: 'uzoshop',
  platform: PLATFORM,
  campaignId: CAMPAIGN_ID,
  campaignName: 'Test Campaign',
  spend: SPEND,
  impressions: 10000,
  clicks: 250,
  conversions: 8,
  conversionValue: 200,
  campaignBudgetCad: 50,
  adSetBudgetCad: null,
  budgetType: 'CBO',
  lastActiveDate: '2026-06-01',
  effectiveStatus: 'ACTIVE',
  lastLiveTickAt: null,
  regConfiguredStatus: 'ACTIVE',
  regEffectiveStatus: 'ACTIVE',
  regDeliveryStatus: 'DELIVERING',
  regFirstSeenAt: null,
  regStatusChangedAt: null,
  regLastStatusSuccessAt: null,
};

const INFO: TrueRevenueInfo = {
  trueRevenue: TRUE_REVENUE,
  trueUnits: 5,
  metaClaim: 200,
  spend: SPEND,
  mappedCount: 1,
  sharedCampaigns: 0,
  confidence: { level: 'high', label: 'אמין', reasons: ['מיפוי יחיד'] },
  attribution: null, // fallback path → tooltip uses the mapping branch
  productTotals: { revenue: 317, units: 9, orders: 7 },
  deterministicRevenue: 172,
  deterministicUnits: 4,
};

// All reorderable metric columns in canonical order (the row maps over this).
const COLUMN_ORDER = [
  'spend', 'budget', 'conversionValue', 'roas', 'roasShopify',
  'roasShopifyPlatform', 'shopifyValuePlatform', 'shopifyValueAllocated',
  'shopifyUnitsPlatform', 'shopifyValueTotal', 'shopifyUnitsTotal',
  'shopifyOrdersTotal', 'conversions', 'clicks', 'impressions',
  'ctr', 'cpc', 'cpm', 'cpa',
];

function renderRow() {
  const trueRevenueByKey = new Map<string, TrueRevenueInfo>([
    [campaignKey(STORE_ID, PLATFORM, CAMPAIGN_ID), INFO],
  ]);
  return render(
    <table>
      <tbody>
        <CampaignsTableRow
          a={ROW}
          i={0}
          mode="campaign"
          trueRevenueByKey={trueRevenueByKey}
          firstClickByCampaign={new Map()}
          mappedCampaignKeys={new Set([campaignKey(STORE_ID, PLATFORM, CAMPAIGN_ID)])}
          health={undefined}
          columnOrder={COLUMN_ORDER}
          dailySeries={undefined}
          adAccounts={{}}
          optimized={new Set()}
          today="2026-06-01"
          rangeIncludesToday={true}
          onToggleOptimized={() => {}}
          onDrillCampaign={() => {}}
          onDrillAd={() => {}}
        />
      </tbody>
    </table>,
  );
}

describe('FIX 1 — shopifyValueAllocated column (ROAS Shopify numerator)', () => {
  it('renders a cell with data-col-id="shopifyValueAllocated"', () => {
    const { container } = renderRow();
    const cell = container.querySelector('[data-col-id="shopifyValueAllocated"]');
    expect(cell).not.toBeNull();
  });

  it('paints info.trueRevenue with 2 decimals (so roasShopify is reproducible)', () => {
    const { container } = renderRow();
    const cell = container.querySelector('[data-col-id="shopifyValueAllocated"]')!;
    // he-IL grouped, 2 decimals → "173.46" (no thousands separator < 1000).
    expect(cell.textContent).toContain('173.46');
    // Crucially NOT the integer-rounded "173" alone.
    expect(cell.textContent).not.toBe('173');
  });

  it('the allocated value ÷ spend reconciles to the roasShopify cell value', () => {
    const { container } = renderRow();
    const allocCell = container.querySelector('[data-col-id="shopifyValueAllocated"]')!;
    const roasCell = container.querySelector('[data-col-id="roasShopify"]')!;

    // Parse the allocated number out of the cell text.
    const allocText = (allocCell.textContent ?? '').replace(/[^\d.]/g, '');
    const alloc = parseFloat(allocText);
    expect(alloc).toBeCloseTo(TRUE_REVENUE, 2);

    // roasShopify cell shows the rounded ROAS (formatNumber → 2 sig).
    const roasText = (roasCell.textContent ?? '').replace(/[^\d.]/g, '');
    const shownRoas = parseFloat(roasText);

    // Reconciliation: allocated / spend ≈ the displayed ROAS.
    const reconciled = alloc / SPEND;
    expect(reconciled).toBeCloseTo(TRUE_REVENUE / SPEND, 5);
    // The displayed ROAS rounds the same quantity (1.47).
    expect(shownRoas).toBeCloseTo(reconciled, 1);
  });

  it('shows an em-dash when there is no allocated revenue', () => {
    const trueRevenueByKey = new Map<string, TrueRevenueInfo>([
      [campaignKey(STORE_ID, PLATFORM, CAMPAIGN_ID), { ...INFO, trueRevenue: 0 }],
    ]);
    const { container } = render(
      <table><tbody>
        <CampaignsTableRow
          a={ROW} i={0} mode="campaign"
          trueRevenueByKey={trueRevenueByKey}
          firstClickByCampaign={new Map()}
          mappedCampaignKeys={new Set()}
          health={undefined}
          columnOrder={COLUMN_ORDER}
          dailySeries={undefined}
          adAccounts={{}} optimized={new Set()} today="2026-06-01" rangeIncludesToday={true}
          onToggleOptimized={() => {}} onDrillCampaign={() => {}} onDrillAd={() => {}}
        />
      </tbody></table>,
    );
    const cell = container.querySelector('[data-col-id="shopifyValueAllocated"]')!;
    expect(cell.textContent).toContain('—');
  });
});

describe('FIX 4 — reorder ▲▼ buttons are visible (non-transparent tokens)', () => {
  it('renders move-up/down buttons with a visible token surface', () => {
    render(<CampaignsColumnsMenu mode="campaign" />);
    // Open the popover (fireEvent wraps in act so React state settles).
    fireEvent.click(screen.getByRole('button', { name: /עמודות/ }));

    const upButtons = screen.getAllByRole('button', { name: /הזז .* למעלה/ });
    expect(upButtons.length).toBeGreaterThan(0);

    for (const btn of upButtons) {
      const cls = btn.className;
      // Visible surface + border tokens — NOT a bare transparent ghost.
      expect(cls).toContain('bg-glass-2');
      expect(cls).toContain('border-glass-edge');
      // A concrete ink token for the icon (never invisible).
      expect(/text-ink(-secondary|-subtle)?\b/.test(cls)).toBe(true);
      // No raw white/black or hex literal leaked in.
      expect(cls).not.toMatch(/#[0-9a-fA-F]{3,8}/);
      expect(cls).not.toMatch(/\b(?:bg|text|border)-(?:white|black)\b/);
    }
  });
});
