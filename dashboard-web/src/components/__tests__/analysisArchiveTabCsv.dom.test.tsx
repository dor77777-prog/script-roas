// Step 6 (UI) — AnalysisArchiveTab renders an "ייצוא CSV" button that exports
// the CURRENTLY-shown monthly rows (store + visible-month filtered) via the
// shared downloadCsv side-effect.
import { describe, expect, it, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DailyRow } from '@/lib/types';

const MOCK_YEAR = 2026;

function makeRow(over: Partial<DailyRow> & Pick<DailyRow, 'date' | 'storeName'>): DailyRow {
  const totalSpend = over.totalSpend ?? 100;
  const revenue = over.revenue ?? 300;
  return {
    fbSpend: over.fbSpend ?? totalSpend,
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
  makeRow({ date: '2026-06-11', storeName: 'otherstore' }),
];

vi.mock('swr', () => ({
  default: () => ({
    data: { rows: ROWS, stores: ['uzoshop', 'otherstore'], lastUpdated: '2026-06-30T00:00:00Z' },
    error: undefined,
    isLoading: false,
  }),
}));

vi.mock('@/components/MonthlyTables', () => ({ MonthlyTables: () => <div data-testid="monthly-tables" /> }));
vi.mock('@/components/MonthScorecardMatrix', () => ({ MonthScorecardMatrix: () => null }));

// Capture downloadCsv args; keep the real toCsv so the serialized payload is real.
const downloadSpy = vi.fn();
vi.mock('@/lib/csvExport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/csvExport')>();
  return { ...actual, downloadCsv: (name: string, csv: string) => downloadSpy(name, csv) };
});

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${MOCK_YEAR}-06-15T12:00:00Z`));
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(() => {
  downloadSpy.mockClear();
});

import { AnalysisArchiveTab } from '@/components/AnalysisArchiveTab';

describe('AnalysisArchiveTab — CSV export', () => {
  it('renders an ייצוא CSV button', () => {
    render(<AnalysisArchiveTab stores={['uzoshop', 'otherstore']} globalStore="All" />);
    expect(screen.getByRole('button', { name: 'ייצוא CSV' })).toBeInTheDocument();
  });

  it('exports the currently-shown month (default June) for the selected per-store view with Hebrew headers', () => {
    // Default mode = per-store, storeFilter seeds to stores[0] = uzoshop.
    render(<AnalysisArchiveTab stores={['uzoshop', 'otherstore']} globalStore="All" />);
    fireEvent.click(screen.getByRole('button', { name: 'ייצוא CSV' }));
    expect(downloadSpy).toHaveBeenCalledTimes(1);
    const [filename, csv] = downloadSpy.mock.calls[0];
    expect(filename).toMatch(/\.csv$/);
    // Hebrew header present.
    expect(csv).toContain('תאריך');
    expect(csv).toContain('ROAS');
    // June + uzoshop only (single-month default = June, per-store = uzoshop).
    expect(csv).toContain('2026-06-10'); // uzoshop June
    expect(csv).not.toContain('2026-06-11'); // otherstore filtered out (per-store=uzoshop)
    expect(csv).not.toContain('2026-04-10'); // April out (single month = June)
    expect(csv).not.toContain('2026-05-10'); // May out
  });

  it('summary mode exports ALL stores for the visible month', () => {
    render(<AnalysisArchiveTab stores={['uzoshop', 'otherstore']} globalStore="All" />);
    fireEvent.click(screen.getByRole('tab', { name: 'סיכום כללי' }));
    fireEvent.click(screen.getByRole('button', { name: 'ייצוא CSV' }));
    const [, csv] = downloadSpy.mock.calls[0];
    expect(csv).toContain('2026-06-10'); // uzoshop June
    expect(csv).toContain('2026-06-11'); // otherstore June — both stores in summary
  });

  it('scopes the export to the global store filter when one is active', () => {
    render(<AnalysisArchiveTab stores={['uzoshop', 'otherstore']} globalStore="uzoshop" />);
    fireEvent.click(screen.getByRole('button', { name: 'ייצוא CSV' }));
    const [, csv] = downloadSpy.mock.calls[0];
    expect(csv).toContain('2026-06-10'); // uzoshop June
    expect(csv).not.toContain('2026-06-11'); // otherstore filtered out
  });
});
