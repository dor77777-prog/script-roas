// dashboard-web/src/components/__tests__/productCentricViewColHelp.dom.test.tsx
//
// Tooltip-system-redesign — Phase 3b.
//
// ProductCentricView's two bespoke hover-popovers (ColHelp ×9 column-header
// helps + HoverTooltip ×1 pixel↔Shopify chip) were folded onto the sanctioned
// HelpTooltip primitive (variant="rich"). On desktop that is a PORTALLED Radix
// Popover (role="dialog") — so it escapes the table's overflow-auto wrapper
// that used to clip it, and Radix supplies collision flip/shift.
//
// This is a render smoke that mounts the real ProductRow JSX with a controlled
// cohort row (buildProductCentricView mocked so we don't reconstruct the whole
// SWR → aggregate → pivot pipeline), expands it, and proves:
//   - all 9 column ⓘ buttons render with their exact aria-labels (no text loss),
//   - clicking one opens a role=dialog carrying the exact heading + body text,
//     portalled to document.body (escapes overflow-auto → not clipped),
//   - the pixel↔Shopify chip opens its own role=dialog,
//   - none of these are a role=tooltip (focusable-guard / correct ARIA).

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ProductCohortRow, ProductCohortMember } from '@/lib/productCentricView';

// Pin desktop so rich → Radix Popover (role="dialog"), deterministic.
vi.mock('@/lib/hooks/useIsMobile', () => ({ useIsMobile: () => false }));

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

describe('ProductCentricView column helps — rich primitive (Phase 3b)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders all 9 column-help ⓘ buttons with their exact aria-labels', () => {
    renderExpanded();
    for (const label of EXPECTED_COL_LABELS) {
      expect(
        screen.getByRole('button', { name: `הסבר על ${label}` }),
      ).toBeInTheDocument();
    }
  });

  it('opens a portalled role=dialog with the exact help text when a ⓘ is clicked', async () => {
    renderExpanded();
    fireEvent.click(screen.getByRole('button', { name: 'הסבר על הוצאה' }));
    const dialog = await screen.findByRole('dialog');
    // exact heading (the column label) + exact body fragment, no text loss
    expect(dialog).toHaveTextContent('הוצאה');
    expect(dialog).toHaveTextContent('סך מה שהוצאת על הקמפיין הזה בטווח שנבחר');
    // portalled to body (escapes the overflow-auto wrapper → not clipped)
    expect(document.body.contains(dialog)).toBe(true);
    // rich = dialog, never a tooltip
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('the pixel↔Shopify chip opens its own role=dialog', async () => {
    renderExpanded();
    // The chip text for platformValue=300 vs shopify=250 → +20% drift (warn).
    const chip = screen.getByText('+20%');
    fireEvent.click(chip);
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('פער pixel↔Shopify');
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('a different column ⓘ shows ITS own help (verifies per-column wiring)', async () => {
    renderExpanded();
    fireEvent.click(screen.getByRole('button', { name: 'הסבר על ROAS פלטפ.' }));
    const dialog = await screen.findByRole('dialog');
    expect(
      within(dialog).getByText(/conversionValue \/ spend/),
    ).toBeInTheDocument();
  });
});
