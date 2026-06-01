// dashboard-web/src/components/home/__tests__/StoreDetailModal.dom.test.tsx
//
// Per-store drill-down MODAL — smoke + contract tests.
//
// Pins (match the approved mockup store-modal-mockup.html):
//   • null data → no modal renders (the Sheet stays closed).
//   • Header: store name (bdi ltr) + big ROAS + a close button.
//   • KPI section: all 5 labels (הוצאה / הכנסה / רווח תפעולי / הזמנות / AOV).
//   • A platform breakdown card + at least one top-campaign row.
//   • Footer primary button fires onOpenCampaigns(storeId); clicking a
//     campaign row also fires it.
//
// Reduced-motion is on in the test runner → <CountUp> renders the FINAL value
// immediately (no animation frames), so the ROAS number is its final string.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { StoreDetailModal } from '@/components/home/StoreDetailModal';
import type { StoreDetailData } from '@/lib/home/storeDetail';

function makeData(over: Partial<StoreDetailData> = {}): StoreDetailData {
  return {
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    roas: 3.45,
    zeroSalesWithSpend: false,
    updatedAt: new Date(Date.now() - 2 * 60_000).toISOString(),
    kpis: {
      spend: 1840,
      revenue: 6350,
      operatingProfit: 2790,
      orders: 46,
      aov: 138,
    },
    deltas: {
      spendPct: -0.08,
      revenuePct: 0.14,
      operatingProfitPct: 0.19,
      ordersPct: 0.06,
      aovPct: -0.03,
    },
    roasSeries: [
      { date: '2026-05-01', roas: 2.1 },
      { date: '2026-05-02', roas: null },
      { date: '2026-05-03', roas: 3.4 },
    ],
    platforms: [
      { platform: 'meta', spend: 1180, cpm: 37, roas: 3.6 },
      { platform: 'google', spend: 520, cpm: 9, roas: 3.1 },
      { platform: 'tiktok', spend: 140, cpm: 3, roas: 2.4 },
    ],
    topCampaigns: [
      { name: 'Meta · ABO – Hero Video', platform: 'meta', roas: 4.2, spend: 640 },
      { name: 'Google · PMax – Catalog', platform: 'google', roas: 3.3, spend: 520 },
    ],
    ...over,
  };
}

describe('<StoreDetailModal>', () => {
  it('renders nothing meaningful when data is null', () => {
    render(<StoreDetailModal data={null} open={false} onClose={() => {}} rangeLabel="30 ימים" onOpenCampaigns={() => {}} />);
    expect(screen.queryByTestId('store-detail-modal')).toBeNull();
  });

  it('renders the store name in a bdi dir="ltr" in the header', () => {
    render(<StoreDetailModal data={makeData()} open onClose={() => {}} rangeLabel="30 ימים" onOpenCampaigns={() => {}} />);
    const hero = screen.getByTestId('store-detail-hero');
    const name = within(hero).getByText('uzoshop');
    expect(name.tagName.toLowerCase()).toBe('bdi');
    expect(name.getAttribute('dir')).toBe('ltr');
  });

  it('renders the big ROAS value (final, reduced-motion)', () => {
    render(<StoreDetailModal data={makeData()} open onClose={() => {}} rangeLabel="30 ימים" onOpenCampaigns={() => {}} />);
    expect(screen.getByTestId('store-detail-modal').textContent).toContain('3.45x');
  });

  it('alarm-red state shows a static 0.00x', () => {
    const data = makeData({ roas: null, zeroSalesWithSpend: true });
    render(<StoreDetailModal data={data} open onClose={() => {}} rangeLabel="30 ימים" onOpenCampaigns={() => {}} />);
    expect(screen.getByTestId('store-detail-modal').textContent).toContain('0.00x');
  });

  it('renders all 5 KPI labels', () => {
    render(<StoreDetailModal data={makeData()} open onClose={() => {}} rangeLabel="30 ימים" onOpenCampaigns={() => {}} />);
    // "הוצאה" also appears in the per-platform breakdown, so scope each KPI
    // label assertion to its own KPI card.
    expect(within(screen.getByTestId('kpi-spend')).getByText('הוצאה')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-revenue')).getByText('הכנסה')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-op')).getByText('רווח תפעולי')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-orders')).getByText('הזמנות')).toBeInTheDocument();
    expect(within(screen.getByTestId('kpi-aov')).getByText('AOV')).toBeInTheDocument();
  });

  it('renders a per-platform breakdown including Meta', () => {
    render(<StoreDetailModal data={makeData()} open onClose={() => {}} rangeLabel="30 ימים" onOpenCampaigns={() => {}} />);
    // PlatformBadge renders the label "Meta".
    expect(screen.getAllByText('Meta').length).toBeGreaterThan(0);
  });

  it('renders a top campaign row', () => {
    render(<StoreDetailModal data={makeData()} open onClose={() => {}} rangeLabel="30 ימים" onOpenCampaigns={() => {}} />);
    expect(screen.getByText('Meta · ABO – Hero Video')).toBeInTheDocument();
  });

  it('footer primary button fires onOpenCampaigns with the storeId', () => {
    const onOpenCampaigns = vi.fn();
    render(<StoreDetailModal data={makeData()} open onClose={() => {}} rangeLabel="30 ימים" onOpenCampaigns={onOpenCampaigns} />);
    fireEvent.click(screen.getByTestId('store-detail-open-campaigns'));
    expect(onOpenCampaigns).toHaveBeenCalledWith('uzoshop');
  });

  it('clicking a campaign row fires onOpenCampaigns with the storeId', () => {
    const onOpenCampaigns = vi.fn();
    render(<StoreDetailModal data={makeData()} open onClose={() => {}} rangeLabel="30 ימים" onOpenCampaigns={onOpenCampaigns} />);
    fireEvent.click(screen.getByText('Meta · ABO – Hero Video'));
    expect(onOpenCampaigns).toHaveBeenCalledWith('uzoshop');
  });

  it('ghost close button fires onClose', () => {
    const onClose = vi.fn();
    render(<StoreDetailModal data={makeData()} open onClose={onClose} rangeLabel="30 ימים" onOpenCampaigns={() => {}} />);
    fireEvent.click(screen.getByTestId('store-detail-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('SheetContent carries the store-detail-modal testid', () => {
    render(<StoreDetailModal data={makeData()} open onClose={() => {}} rangeLabel="30 ימים" onOpenCampaigns={() => {}} />);
    expect(screen.getByTestId('store-detail-modal')).toBeInTheDocument();
  });
});
