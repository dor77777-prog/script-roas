// Steps 3-5 — Month-summary scorecard matrix: one compact row per month with
// Total Spend / Revenue / ROAS (banded badge) / Net Profit / Margin%, plus a
// month-over-month Δ% per metric (toned) and a per-month ROAS sparkline.
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DailyRow } from '@/lib/types';
import { MonthScorecardMatrix } from '@/components/MonthScorecardMatrix';

function makeRow(over: Partial<DailyRow> & Pick<DailyRow, 'date'>): DailyRow {
  const totalSpend = over.totalSpend ?? 100;
  const revenue = over.revenue ?? 300;
  return {
    storeId: over.storeId ?? 'store-1',
    storeName: over.storeName ?? 'store-1',
    fbSpend: over.fbSpend ?? totalSpend,
    gaSpend: 0,
    ttSpend: 0,
    totalSpend,
    revenue,
    roas: totalSpend > 0 ? revenue / totalSpend : 0,
    grossProfit: 0,
    cogs: 0,
    netProfit: over.netProfit ?? 0,
    hasCogs: over.hasCogs ?? false,
    grossRevenue: null,
    refundDeduction: null,
    fbImpressions: null,
    gaImpressions: null,
    ttImpressions: null,
    ...over,
  };
}

describe('MonthScorecardMatrix', () => {
  it('renders one row per month (newest-first) with the column headers', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-05-01', totalSpend: 100, revenue: 300, netProfit: 100, hasCogs: true }),
      makeRow({ date: '2026-06-01', totalSpend: 200, revenue: 800, netProfit: 300, hasCogs: true }),
    ];
    render(<MonthScorecardMatrix rows={rows} />);
    const headers = Array.from(document.querySelectorAll('thead th')).map(th => th.textContent?.trim());
    expect(headers).toContain('חודש');
    expect(headers).toContain('הוצאה');
    expect(headers).toContain('הכנסה');
    expect(headers).toContain('ROAS');
    expect(headers).toContain('רווח נקי');
    expect(headers).toContain('מרווח');
    // Two month rows, newest first.
    const bodyRows = document.querySelectorAll('tbody tr');
    expect(bodyRows).toHaveLength(2);
    expect(bodyRows[0].textContent).toContain('יוני 2026');
    expect(bodyRows[1].textContent).toContain('מאי 2026');
  });

  it('shows the ROAS as a banded badge and the per-month totals', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-01', totalSpend: 200, revenue: 800, netProfit: 300, hasCogs: true }),
    ];
    render(<MonthScorecardMatrix rows={rows} />);
    // ROAS 4.00 rendered (blue band > 3); spend 200, revenue 800, margin 38%.
    expect(screen.getByText('4.00')).toBeInTheDocument();
    expect(document.body.textContent).toContain('38%'); // 300/800 = 37.5% → round = 38
  });

  it('renders a month-over-month Δ% for non-oldest months, toned green for up', () => {
    const rows: DailyRow[] = [
      // May rev 300, June rev 800 → +166.7%
      makeRow({ date: '2026-05-01', totalSpend: 100, revenue: 300, netProfit: 100, hasCogs: true }),
      makeRow({ date: '2026-06-01', totalSpend: 200, revenue: 800, netProfit: 300, hasCogs: true }),
    ];
    render(<MonthScorecardMatrix rows={rows} />);
    const juneRow = document.querySelectorAll('tbody tr')[0];
    // Revenue up → a green delta chip somewhere in the June row.
    expect(juneRow.innerHTML).toContain('text-status-greenFg');
    // A "+" signed percentage is present in the June row.
    expect(juneRow.textContent).toMatch(/\+\d/);
  });

  it('tones a downward delta red', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-05-01', totalSpend: 100, revenue: 800, netProfit: 300, hasCogs: true }),
      makeRow({ date: '2026-06-01', totalSpend: 100, revenue: 300, netProfit: 100, hasCogs: true }),
    ];
    render(<MonthScorecardMatrix rows={rows} />);
    const juneRow = document.querySelectorAll('tbody tr')[0];
    expect(juneRow.innerHTML).toContain('text-status-redFg');
  });

  it('the oldest month shows no delta chips', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-05-01', totalSpend: 100, revenue: 300, netProfit: 100, hasCogs: true }),
      makeRow({ date: '2026-06-01', totalSpend: 200, revenue: 800, netProfit: 300, hasCogs: true }),
    ];
    render(<MonthScorecardMatrix rows={rows} />);
    const mayRow = document.querySelectorAll('tbody tr')[1]; // oldest
    expect(mayRow.textContent).toContain('מאי 2026');
    // No signed percentage in the oldest row (no prior to compare).
    expect(mayRow.textContent).not.toMatch(/[+]\d/);
  });

  it('renders a per-month ROAS sparkline (svg) when the month has ≥2 days', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-01', totalSpend: 100, revenue: 200, roas: 2 }),
      makeRow({ date: '2026-06-02', totalSpend: 100, revenue: 500, roas: 5 }),
    ];
    render(<MonthScorecardMatrix rows={rows} />);
    expect(document.querySelector('tbody tr svg')).toBeTruthy();
  });

  it('renders nothing when there are no rows', () => {
    const { container } = render(<MonthScorecardMatrix rows={[]} />);
    expect(container.querySelector('table')).toBeNull();
  });
});
