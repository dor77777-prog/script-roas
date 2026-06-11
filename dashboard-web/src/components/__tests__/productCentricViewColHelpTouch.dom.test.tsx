// dashboard-web/src/components/__tests__/productCentricViewColHelpTouch.dom.test.tsx
//
// 2026-06-11 adversarial-review fix — wave-8A item 2 (touch double-ⓘ) parity
// for ProductCentricView's ColHelp column-header help.
//
// Pre-fix: on touch, ColHelp's HelpTooltip (variant="rich" + title) routed to
// the RichSheet PHRASING branch, which paired the violet ⓘ Button with a
// SECOND, gray ⓘ — each help column rendered TWO ⓘ glyphs, the operator's
// violet one DEAD (its only handler is stopPropagation) and the duplicate
// gray one opened the surface. CampaignsTable's identical header pattern was
// fixed in the wave-8A batch (touchTrigger="child"); ColHelp was missed.
//
// Post-fix: ColHelp passes `touchTrigger="child"` so the EXISTING violet ⓘ
// IS the tap trigger — exactly ONE ⓘ per header cell and it opens the
// mode-D bottom sheet (title present → long-rich).
//
// Harness mirrors productCentricViewColHelp.dom.test.tsx (desktop sibling) +
// campaignsTableHeaderTouchInfo.dom.test.tsx (the CampaignsTable touch
// guard): TOUCH pointer mode pinned via the pointer-capability hook.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ProductCohortRow, ProductCohortMember } from '@/lib/productCentricView';

// Pin the TOUCH (coarse-pointer) branch.
vi.mock('@/components/ui/tooltip/useTouchTooltipMode', () => ({
  useTouchTooltipMode: () => true,
}));

// Return truthy data for both SWR fetches so the loading / all-stores guards
// pass; the actual rows come from the mocked buildProductCentricView below.
vi.mock('swr', () => ({
  default: () => ({ data: { rows: [], currentEffectiveStatus: {} } }),
}));

const member: ProductCohortMember = {
  campaignKey: 'uzoshop::Meta::c1',
  campaignId: 'c1',
  campaignName: 'קמפיין בדיקה',
  platform: 'Meta',
  storeId: 'uzoshop',
  storeName: 'uzoshop',
  spend: 100,
  conversionValue: 300,
  intraPlatformSpendShare: 1,
  totalSpendShare: 0.6,
  allocatedRevenueEstimate: 250,
  platformRoas: 3,
  effectiveStatus: 'ACTIVE',
  regDeliveryStatus: 'DELIVERING',
};

const cohortRow: ProductCohortRow = {
  productId: 'p1',
  productTitle: 'מוצר בדיקה',
  storeId: 'uzoshop',
  totalCohortSpend: 100,
  totalNetRevenue: 250,
  members: [member],
  byPlatform: [
    {
      platform: 'Meta',
      members: [member],
      intraSpend: 100,
      intraAllocatedRevenue: 250,
    },
  ],
  isMultiMapped: true,
  blendedRoas: 2.5,
};

vi.mock('@/lib/productCentricView', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/productCentricView')>();
  return { ...actual, buildProductCentricView: () => [cohortRow] };
});

import { ProductCentricView } from '../ProductCentricView';

const EXPECTED_COL_LABELS = [
  'קמפיין',
  'הוצאה',
  'חלק (פנים-פלטפ.)',
  'חלק (כללי)',
  'הכנסה מוקצית',
  'הכנסה פלטפ.',
  'ROAS פלטפ.',
  'פער pixel↔Shopify',
  'סטטוס',
];

function renderExpanded() {
  render(
    <ProductCentricView
      storeId="uzoshop"
      range={{ from: '2026-06-01', to: '2026-06-02' }}
      productMap={{ 'uzoshop::Meta::c1': ['p1'] }}
    />,
  );
  // Expand the product row (the toggle button is the cohort row header).
  fireEvent.click(screen.getByRole('button', { name: /מוצר בדיקה/ }));
}

describe('ProductCentricView column helps on TOUCH — single ⓘ trigger (wave-8A item 2 parity)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('every help header cell renders EXACTLY ONE ⓘ button (no duplicate gray ⓘ)', () => {
    renderExpanded();
    for (const label of EXPECTED_COL_LABELS) {
      const violet = screen.getByRole('button', { name: `הסבר על ${label}` });
      const th = violet.closest('th');
      expect(th, `th for column "${label}"`).not.toBeNull();
      // Pre-fix the RichSheet phrasing branch paired the violet ⓘ with a
      // duplicate gray ⓘ (2 buttons per cell).
      const buttons = within(th as HTMLElement).getAllByRole('button');
      expect(buttons, `buttons inside "${label}" header cell`).toHaveLength(1);
      expect(buttons[0]).toBe(violet);
    }
  });

  it('the violet ⓘ is ALIVE — tapping it opens the bottom-sheet help with the column copy + visible ✕', async () => {
    renderExpanded();
    fireEvent.click(screen.getByRole('button', { name: 'הסבר על הוצאה' }));
    const dialog = await screen.findByRole('dialog');
    // Title (the column label) + exact body fragment.
    expect(dialog).toHaveTextContent('הוצאה');
    expect(dialog).toHaveTextContent('סך מה שהוצאת על הקמפיין הזה בטווח שנבחר');
    // Mode-D bottom Sheet — visible close affordance.
    expect(within(dialog).getByRole('button', { name: 'סגור' })).toBeInTheDocument();
  });
});
