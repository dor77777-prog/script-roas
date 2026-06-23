// Step 2 — multi-month side-by-side: MonthlyTables can render SEVERAL chosen
// months' blocks at once via the `months` prop, while the single-month
// (`month`) + all-year (month/months null) behavior stays intact.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DailyRow } from '@/lib/types';

function makeRow(date: string): DailyRow {
  return {
    date,
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    fbSpend: 100,
    gaSpend: 0,
    ttSpend: 0,
    totalSpend: 100,
    revenue: 300,
    roas: 3,
    grossProfit: 0,
    cogs: 0,
    netProfit: 0,
    hasCogs: false,
    grossRevenue: null,
    refundDeduction: null,
    fbImpressions: null,
    gaImpressions: null,
    ttImpressions: null,
  };
}

// Rows in 3 distinct months of 2026.
const ROWS: DailyRow[] = [
  makeRow('2026-04-10'),
  makeRow('2026-05-10'),
  makeRow('2026-06-10'),
];

vi.mock('swr', () => ({
  default: () => ({
    data: { rows: ROWS, stores: ['uzoshop'], lastUpdated: '2026-06-30T00:00:00Z' },
    error: undefined,
    isLoading: false,
  }),
}));

import { MonthlyTables } from '@/components/MonthlyTables';

const COMMON = {
  stores: ['uzoshop'],
  year: 2026,
  mode: 'per-store' as const,
  storeFilter: 'uzoshop',
  onModeChange: () => {},
  onStoreFilterChange: () => {},
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('MonthlyTables — multi-month selection', () => {
  it('renders ONLY the chosen months when `months` lists multiple', () => {
    render(<MonthlyTables {...COMMON} months={[4, 6]} />);
    // April + June blocks present, May absent.
    expect(screen.getByText(/אפריל 2026/)).toBeInTheDocument();
    expect(screen.getByText(/יוני 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/מאי 2026/)).not.toBeInTheDocument();
  });

  it('falls back to single-month `month` when `months` is null/empty', () => {
    render(<MonthlyTables {...COMMON} month={5} months={null} />);
    expect(screen.getByText(/מאי 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/אפריל 2026/)).not.toBeInTheDocument();
    expect(screen.queryByText(/יוני 2026/)).not.toBeInTheDocument();
  });

  it('shows all months when both month and months are null (all-year)', () => {
    render(<MonthlyTables {...COMMON} month={null} months={null} />);
    expect(screen.getByText(/אפריל 2026/)).toBeInTheDocument();
    expect(screen.getByText(/מאי 2026/)).toBeInTheDocument();
    expect(screen.getByText(/יוני 2026/)).toBeInTheDocument();
  });

  it('empty `months` array is treated as "no multi-month filter" (defers to month)', () => {
    render(<MonthlyTables {...COMMON} month={6} months={[]} />);
    expect(screen.getByText(/יוני 2026/)).toBeInTheDocument();
    expect(screen.queryByText(/אפריל 2026/)).not.toBeInTheDocument();
  });
});
