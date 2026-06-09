// dashboard-web/src/components/campaign-drawer/__tests__/CampaignDrawerOverview.dom.test.tsx
//
// Task 1 (Overview-tab reorg, 2026-06-03) — the סקירה tab opens to a clean
// at-a-glance SCORECARD + KPI grid, with the deep analyses tucked into
// collapsible <details> accordions (attribution open by default). ZERO info
// loss: every section that rendered before still renders — only collapsed.
//
// Coverage:
//   1. Scorecard surfaces the attribution trust score (/100) + the health
//      grade, ALWAYS visible (no expand needed).
//   2. The KPI grid (הוצאה/המרות/CTR/CPC/CPA) stays always-visible.
//      ROAS and ערך-המרות live ONLY in the scorecard — no duplicate cards
//      (Task 6 de-dup).
//   3. The deep panels (Health / mapped-products / cohort / attribution /
//      product-channel / reconciliation) live inside <details> accordions.
//   4. The attribution accordion is OPEN by default; the rest are collapsed.
//   5. No info loss — the mapped-products + Health summaries are in the DOM
//      even while collapsed.
//   6. The reconciliation accordion renders only when `reconciliation` is
//      present (keeps the existing `reconciliation &&` guard).

import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import {
  CampaignDrawerOverview,
  type CampaignDrawerOverviewProps,
  type OverviewSummary,
} from '@/components/campaign-drawer/CampaignDrawerOverview';
import type { CampaignHealth } from '@/lib/campaignHealthScore';
import type { AttributionAnalysis } from '@/lib/attributionAnalysis';

function makeSummary(overrides: Partial<OverviewSummary> = {}): OverviewSummary {
  return {
    campaignName: 'יונים- מכשיר סולרי',
    storeName: 'uzoshop',
    platform: 'Meta',
    spend: 16,
    value: 112,
    clicks: 64,
    impressions: 478,
    conversions: 1,
    roas: 7.16,
    ctr: 0.1339,
    cpc: 0.25,
    cpa: 15.6,
    activeDays: 1,
    campaignId: 'campaign-1',
    storeId: 'uzoshop',
    ...overrides,
  };
}

function makeHealth(overrides: Partial<CampaignHealth> = {}): CampaignHealth {
  return {
    score: 82,
    grade: 'A',
    components: {
      profitability: 90,
      volume: 60,
      trajectory: 70,
      attributionClarity: 88,
      cohortAdjustment: 0,
    },
    reasons: ['רווחיות גבוהה', 'נפח בינוני', 'מומנטום חיובי', 'attribution אמין'],
    insufficient: false,
    ...overrides,
  };
}

function makeAnalysis(overrides: Partial<AttributionAnalysis> = {}): AttributionAnalysis {
  return {
    deterministicRevenue: 111,
    deterministicOrders: 1,
    modeledRevenue: 1,
    coverage: 1.0,
    coverageExceedsClamp: false,
    trust: { level: 'high', label: 'אמין', score: 90 },
    reasons: ['הזמנה תויגה לקמפיין'],
    recommendation: 'מספרי הקמפיין אמינים. אופטימיזציה רגילה לפי ROAS.',
    roasInterval: null,
    windowStability: null,
    outlierDays: [],
    ...overrides,
  };
}

function makeProps(
  overrides: Partial<CampaignDrawerOverviewProps> = {},
): CampaignDrawerOverviewProps {
  return {
    summary: makeSummary(),
    health: makeHealth(),
    analysis: makeAnalysis(),
    reconciliation: null,
    productChannelBreakdown: null,
    cohort: null,
    cannibalizationVerdicts: [],
    mappedIds: ['8319522308390'],
    otherCampaignsByProduct: new Map(),
    onEditMapping: () => {},
    ...overrides,
  };
}

describe('CampaignDrawerOverview — scorecard + collapsible accordions', () => {
  it('scorecard surfaces the attribution trust score (/100) + health grade, always visible', () => {
    render(<CampaignDrawerOverview {...makeProps()} />);
    // ROAS label appears in the scorecard (exactly once after de-dup).
    expect(screen.getAllByText(/ROAS/).length).toBeGreaterThan(0);
    // Attribution trust score surfaced at the top WITHOUT expanding anything.
    expect(screen.getByTestId('overview-scorecard')).toBeInTheDocument();
    expect(screen.getByTestId('overview-sc-trust')).toHaveTextContent('90');
    // Health grade surfaced (grade letter A).
    expect(screen.getByTestId('overview-sc-health')).toHaveTextContent('A');
  });

  it('KPI grid (operational) stays always-visible: הוצאה/המרות/CTR/CPC/CPA', () => {
    render(<CampaignDrawerOverview {...makeProps()} />);
    // All operational labels always visible (not behind an accordion).
    expect(screen.getByText('CPA')).toBeInTheDocument();
    expect(screen.getByText('CPC')).toBeInTheDocument();
    expect(screen.getByText('CTR')).toBeInTheDocument();
    expect(screen.getByText('הוצאה')).toBeInTheDocument();
    expect(screen.getByText('המרות')).toBeInTheDocument();
  });

  it('wraps the deep analyses in collapsible <details>; attribution OPEN by default', () => {
    render(<CampaignDrawerOverview {...makeProps()} />);
    const details = Array.from(document.querySelectorAll('details'));
    // Health + mapped-products + cohort? (no cohort here) + attribution +
    // product-channel? (none) → at least Health + mapped + attribution = 3.
    expect(details.length).toBeGreaterThanOrEqual(3);
    // Attribution accordion is open by default. Match on the SUMMARY heading
    // (the collapsed Health accordion's inner HealthScorePanel also mentions
    // "attribution", so matching whole-details textContent is ambiguous).
    const summaryText = (d: HTMLDetailsElement) =>
      d.querySelector('summary')?.textContent ?? '';
    const attr = details.find((d) => summaryText(d).includes('ניתוח attribution'));
    expect(attr).toBeTruthy();
    expect(attr?.open).toBe(true);
    // The Health accordion exists and is collapsed by default.
    const healthAcc = details.find((d) => summaryText(d).includes('ציון בריאות'));
    expect(healthAcc).toBeTruthy();
    expect(healthAcc?.open).toBe(false);
  });

  it('no info loss — mapped-products section still present (collapsed, in DOM)', () => {
    render(<CampaignDrawerOverview {...makeProps()} />);
    // The mapped-products section title is rendered (inside its <details>).
    expect(screen.getByText(/מוצרי Shopify משויכים/)).toBeInTheDocument();
    // The mapped product id is rendered in the DOM even while collapsed.
    expect(screen.getByText('8319522308390')).toBeInTheDocument();
  });

  it('mapped-id help is a rich tooltip — multiline content opens a role=dialog (Phase 3a)', async () => {
    // Promoted to variant="rich" so the `\n`-joined "also mapped to" line
    // actually breaks (whitespace-pre-line) instead of collapsing, and so the
    // surface lifts above the drawer scrim (withinDrawer → z-[60]). On a fine
    // pointer it opens a Radix Popover (role="dialog"), never a role="tooltip".
    render(
      <CampaignDrawerOverview
        {...makeProps({
          mappedIds: ['8319522308390'],
          otherCampaignsByProduct: new Map([['8319522308390', ['קמפיין אחר']]]),
        })}
      />,
    );
    // The product id still renders in the trigger <li> (no info loss).
    expect(screen.getByText('8319522308390')).toBeInTheDocument();
    // Click the trigger chip to open the rich popover.
    fireEvent.click(screen.getByText('8319522308390'));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('8319522308390');
    expect(dialog).toHaveTextContent('גם משויך ל: קמפיין אחר');
    expect(screen.queryByRole('tooltip')).toBeNull();
    // Esc closes it.
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('renders ROAS and ערך המרות exactly once (no duplicate cards)', () => {
    render(<CampaignDrawerOverview {...makeProps()} />);
    // After de-dup: ROAS appears only in the scorecard (not also in KPI grid).
    expect(screen.getAllByText('ROAS')).toHaveLength(1);
    // ערך המרות appears only in the scorecard (not also in KPI grid).
    expect(screen.getAllByText('ערך המרות')).toHaveLength(1);
  });

  it('renders the reconciliation accordion only when reconciliation is present', () => {
    const reconciliation = {
      series: [],
      primaryChannel: 'Meta' as const,
      r: 0.8,
      rGoogle: null,
      rTiktok: null,
      rOrganic: null,
      rCombined: null,
      bestLag: 0,
      bestR: 0.8,
      darkTrafficPercent: 12,
    };

    const summaryText = (d: HTMLDetailsElement) =>
      d.querySelector('summary')?.textContent ?? '';

    const { rerender } = render(
      <CampaignDrawerOverview {...makeProps({ reconciliation: null })} />,
    );
    // No accordion whose summary is the reconciliation title.
    expect(
      Array.from(document.querySelectorAll('details')).find((d) =>
        summaryText(d).includes('התאמת ערוצים'),
      ),
    ).toBeUndefined();

    rerender(<CampaignDrawerOverview {...makeProps({ reconciliation })} />);
    // The reconciliation accordion now renders (its <details> is present).
    const recon = Array.from(document.querySelectorAll('details')).find((d) =>
      summaryText(d).includes('התאמת ערוצים'),
    );
    expect(recon).toBeTruthy();
  });
});
