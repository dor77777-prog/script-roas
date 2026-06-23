// Step 1 — Net-profit ("רווח נקי") + margin ("מרווח") columns in the
// Monthly (Archive) tables, on both MonthBlockPerStore + MonthBlockSummary
// and their "סך הכל" total rows.
import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/react';
import type { DailyRow } from '@/lib/types';
import { MonthBlockPerStore, MonthBlockSummary } from '@/components/MonthlyTables';

function makeRow(over: Partial<DailyRow> & Pick<DailyRow, 'date'>): DailyRow {
  const fb = over.fbSpend ?? 0;
  const ga = over.gaSpend ?? 0;
  const tt = over.ttSpend ?? 0;
  const totalSpend = over.totalSpend ?? fb + ga + tt;
  const revenue = over.revenue ?? 0;
  return {
    storeId: over.storeId ?? 'store-1',
    storeName: over.storeName ?? 'store-1',
    fbSpend: fb,
    gaSpend: ga,
    ttSpend: tt,
    totalSpend,
    revenue,
    roas: totalSpend > 0 ? revenue / totalSpend : 0,
    grossProfit: 0,
    cogs: over.cogs ?? 0,
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

function headerTexts(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('thead th')).map(th => th.textContent?.trim() ?? '');
}

describe('MonthBlockPerStore — net profit + margin columns', () => {
  it('renders רווח נקי + מרווח headers and the net-profit value when hasCogs', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-01', fbSpend: 100, revenue: 400, netProfit: 100, hasCogs: true }),
    ];
    const { container } = render(
      <MonthBlockPerStore ym="2026-06" storeName="store-1" rows={rows} defaultOpen />,
    );
    const headers = headerTexts(container);
    expect(headers).toContain('רווח נקי');
    expect(headers).toContain('מרווח');
    // net profit 100 (decimals=0 → "100"); margin 100/400 = 25%
    expect(container.textContent).toContain('100');
    expect(container.textContent).toContain('25%');
  });

  it('shows "—" for net profit + margin on a row without COGS', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-01', fbSpend: 100, revenue: 400, netProfit: 0, hasCogs: false }),
    ];
    const { container } = render(
      <MonthBlockPerStore ym="2026-06" storeName="store-1" rows={rows} defaultOpen />,
    );
    const firstDataRow = container.querySelector('tbody tr')!;
    expect(firstDataRow.textContent).toContain('—');
  });

  it('tones a positive margin green and a negative margin red', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-01', fbSpend: 100, revenue: 400, netProfit: 100, hasCogs: true }),
      makeRow({ date: '2026-06-02', fbSpend: 500, revenue: 400, netProfit: -200, hasCogs: true }),
    ];
    const { container } = render(
      <MonthBlockPerStore ym="2026-06" storeName="store-1" rows={rows} defaultOpen />,
    );
    expect(container.innerHTML).toContain('text-status-greenFg');
    expect(container.innerHTML).toContain('text-status-redFg');
  });

  it('totals net profit in the סך הכל row', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-01', fbSpend: 100, revenue: 400, netProfit: 100, hasCogs: true }),
      makeRow({ date: '2026-06-02', fbSpend: 100, revenue: 600, netProfit: 250, hasCogs: true }),
    ];
    const { container } = render(
      <MonthBlockPerStore ym="2026-06" storeName="store-1" rows={rows} defaultOpen />,
    );
    const totalRow = container.querySelector('tbody tr:last-child')!;
    // total net profit = 350; total margin = 350/1000 = 35%
    expect(within(totalRow as HTMLElement).getByText(/350/)).toBeInTheDocument();
    expect(totalRow.textContent).toContain('35%');
  });
});

describe('MonthBlockSummary — net profit + margin columns', () => {
  it('renders רווח נקי + מרווח headers and aggregates across stores', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-01', storeName: 'a', fbSpend: 100, revenue: 400, netProfit: 100, hasCogs: true }),
      makeRow({ date: '2026-06-01', storeName: 'b', fbSpend: 100, revenue: 600, netProfit: 200, hasCogs: true }),
    ];
    const { container } = render(
      <MonthBlockSummary ym="2026-06" rows={rows} stores={['a', 'b']} defaultOpen />,
    );
    const headers = headerTexts(container);
    expect(headers).toContain('רווח נקי');
    expect(headers).toContain('מרווח');
    // total net profit across stores on the day = 300; margin 300/1000 = 30%
    const totalRow = container.querySelector('tbody tr:last-child')!;
    expect(totalRow.textContent).toContain('300');
    expect(totalRow.textContent).toContain('30%');
  });

  it('shows "—" when no row in the month carries COGS', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-01', storeName: 'a', fbSpend: 100, revenue: 400, hasCogs: false }),
    ];
    const { container } = render(
      <MonthBlockSummary ym="2026-06" rows={rows} stores={['a']} defaultOpen />,
    );
    const totalRow = container.querySelector('tbody tr:last-child')!;
    expect(totalRow.textContent).toContain('—');
  });
});
