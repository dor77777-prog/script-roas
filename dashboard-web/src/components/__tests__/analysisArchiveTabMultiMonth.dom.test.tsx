// Step 2 (UI) — AnalysisArchiveTab exposes a "השוואת חודשים" (compare months)
// toggle that reveals month checkboxes; selected months are passed to
// MonthlyTables via the `months` prop. The default single month/year + the
// "all year" behavior stay intact.
import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DailyRow } from '@/lib/types';

const MOCK_YEAR = 2026;

function makeRow(over: Partial<DailyRow> & Pick<DailyRow, 'date' | 'storeName'>): DailyRow {
  const totalSpend = over.totalSpend ?? 100;
  const revenue = over.revenue ?? 300;
  return {
    fbSpend: 0,
    gaSpend: 0,
    ttSpend: 0,
    grossProfit: 0,
    cogs: 0,
    netProfit: 0,
    hasCogs: false,
    grossRevenue: null,
    refundDeduction: null,
    fbImpressions: null,
    gaImpressions: null,
    ttImpressions: null,
    ...over,
    storeId: over.storeName,
    totalSpend,
    revenue,
    roas: totalSpend > 0 ? revenue / totalSpend : 0,
  };
}

const ROWS: DailyRow[] = [
  makeRow({ date: '2026-04-10', storeName: 'uzoshop' }),
  makeRow({ date: '2026-05-10', storeName: 'uzoshop' }),
  makeRow({ date: '2026-06-10', storeName: 'uzoshop' }),
].map(r => r);

vi.mock('swr', () => ({
  default: () => ({
    data: { rows: ROWS, stores: ['uzoshop'], lastUpdated: '2026-06-30T00:00:00Z' },
    error: undefined,
    isLoading: false,
  }),
}));

// Expose the `months` (and `month`) props MonthlyTables receives so we can
// assert the multi-month wiring without rendering the real table.
vi.mock('@/components/MonthlyTables', () => ({
  MonthlyTables: (props: { month?: number | null; months?: number[] | null }) => (
    <div
      data-testid="monthly-tables"
      data-month={props.month == null ? '' : String(props.month)}
      data-months={props.months ? props.months.join(',') : ''}
    />
  ),
}));

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${MOCK_YEAR}-06-15T12:00:00Z`));
});
afterAll(() => {
  vi.useRealTimers();
});

import { AnalysisArchiveTab } from '@/components/AnalysisArchiveTab';

describe('AnalysisArchiveTab — compare-months (multi-month) UI', () => {
  it('by default passes the single `month` and no `months` to MonthlyTables', () => {
    render(<AnalysisArchiveTab stores={['uzoshop']} globalStore="All" />);
    const mt = screen.getByTestId('monthly-tables');
    expect(mt.getAttribute('data-month')).toBe('6'); // default = current month
    expect(mt.getAttribute('data-months')).toBe('');
  });

  it('shows a "השוואת חודשים" toggle and reveals month checkboxes when on', () => {
    render(<AnalysisArchiveTab stores={['uzoshop']} globalStore="All" />);
    // Checkboxes hidden until compare mode is enabled.
    expect(screen.queryByRole('checkbox', { name: 'מאי' })).not.toBeInTheDocument();
    const toggle = screen.getByRole('switch', { name: /השוואת חודשים/ });
    fireEvent.click(toggle);
    expect(screen.getByRole('checkbox', { name: 'אפריל' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'מאי' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'יוני' })).toBeInTheDocument();
  });

  it('selecting months passes them to MonthlyTables via `months`', () => {
    render(<AnalysisArchiveTab stores={['uzoshop']} globalStore="All" />);
    fireEvent.click(screen.getByRole('switch', { name: /השוואת חודשים/ }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'אפריל' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'יוני' }));
    const mt = screen.getByTestId('monthly-tables');
    expect(mt.getAttribute('data-months')).toBe('4,6');
  });

  it('turning compare OFF clears `months` and restores single-month behavior', () => {
    render(<AnalysisArchiveTab stores={['uzoshop']} globalStore="All" />);
    const toggle = screen.getByRole('switch', { name: /השוואת חודשים/ });
    fireEvent.click(toggle);
    fireEvent.click(screen.getByRole('checkbox', { name: 'מאי' }));
    expect(screen.getByTestId('monthly-tables').getAttribute('data-months')).toBe('5');
    fireEvent.click(toggle); // off
    const mt = screen.getByTestId('monthly-tables');
    expect(mt.getAttribute('data-months')).toBe('');
    expect(mt.getAttribute('data-month')).toBe('6');
  });
});
