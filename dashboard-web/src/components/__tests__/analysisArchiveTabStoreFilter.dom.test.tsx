// Regression: AnalysisArchiveTab must honor the global store filter
// (filters.store). Previously it silently ignored globalStore and rendered
// all stores' data — see audit P0-15.
//
// Strategy: build two stores with disjoint monthly performance, render the
// tab once with globalStore='All' (expect synthesis text reflects MERGED
// rows) and once with globalStore='uzoshop' (expect synthesis text reflects
// uzoshop-only rows). We assert via the SectionIntro scope label AND via
// the rendered synthesis text so the contract is pinned at both the title
// surface and the data-flow level.

import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { DailyRow } from '@/lib/types';

// ---------------------------------------------------------------------------
// Hoist mocks. We feed a deterministic dataset through SWR so the
// synthesiser produces predictable Hebrew copy we can grep.
// ---------------------------------------------------------------------------
const MOCK_YEAR = 2026;

function makeRow(over: Partial<DailyRow> & Pick<DailyRow, 'date' | 'storeName'>): DailyRow {
  const totalSpend = over.totalSpend ?? 0;
  const revenue = over.revenue ?? 0;
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

// uzoshop: strong ROAS in May (5.0), flat elsewhere.
// otherstore: strong ROAS in March (5.0), flat elsewhere.
// With BOTH stores combined, March still wins by total ROAS. With only
// uzoshop, May wins — so the synthesis text changes between the two
// scenarios. NOTE: we add a 4th distinct month (April flat) to all stores
// so the synthesiser's "stable last-3-months" branch can't trip.
const ROWS: DailyRow[] = [
  // uzoshop — strong May, weak Jan/Feb/Apr
  { date: '2026-05-01', storeName: 'uzoshop', totalSpend: 100, revenue: 500 },
  { date: '2026-05-02', storeName: 'uzoshop', totalSpend: 100, revenue: 500 },
  { date: '2026-01-15', storeName: 'uzoshop', totalSpend: 100, revenue: 100 },
  { date: '2026-02-15', storeName: 'uzoshop', totalSpend: 100, revenue: 100 },
  { date: '2026-04-15', storeName: 'uzoshop', totalSpend: 100, revenue: 100 },

  // otherstore — strong March, weak Jan/Feb/May
  { date: '2026-03-01', storeName: 'otherstore', totalSpend: 1000, revenue: 5000 },
  { date: '2026-03-02', storeName: 'otherstore', totalSpend: 1000, revenue: 5000 },
  { date: '2026-01-15', storeName: 'otherstore', totalSpend: 1000, revenue: 1000 },
  { date: '2026-02-15', storeName: 'otherstore', totalSpend: 1000, revenue: 1000 },
  { date: '2026-05-15', storeName: 'otherstore', totalSpend: 1000, revenue: 1000 },
].map(makeRow);

vi.mock('swr', () => ({
  default: () => ({
    data: { rows: ROWS, stores: ['uzoshop', 'otherstore'], lastUpdated: '2026-05-31T00:00:00Z' },
    error: undefined,
    isLoading: false,
  }),
}));

// MonthlyTables fires its own SWR; keep its render minimal so this test
// stays scoped to AnalysisArchiveTab's scoping contract.
vi.mock('@/components/MonthlyTables', () => ({
  MonthlyTables: (props: { globalStore?: string }) => (
    <div data-testid="monthly-tables" data-global-store={props.globalStore ?? ''} />
  ),
}));

// ---------------------------------------------------------------------------
// Pin "today" so YearSelector defaults to 2026 (not whatever year the test
// machine is on). We rely on AnalysisArchiveTab's `new Date().getFullYear()`.
// ---------------------------------------------------------------------------
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(`${MOCK_YEAR}-05-15T12:00:00Z`));
});
afterAll(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Import AFTER mocks so the SWR/MonthlyTables mocks apply.
// ---------------------------------------------------------------------------
import { AnalysisArchiveTab } from '@/components/AnalysisArchiveTab';

describe('AnalysisArchiveTab — global store filter (P0-15)', () => {
  it('without store filter (All): synthesis reflects MERGED data — March wins', () => {
    render(<AnalysisArchiveTab stores={['uzoshop', 'otherstore']} globalStore="All" />);
    // March 2026 (מרץ) is the strongest month across BOTH stores combined.
    expect(screen.getByText(/מרץ 2026/)).toBeInTheDocument();
    // Scope label stays generic (no store name).
    expect(screen.getByText(/^טבלאות חודשיות$/)).toBeInTheDocument();
    // MonthlyTables receives the global filter unchanged so it can scope too.
    const mt = screen.getByTestId('monthly-tables');
    expect(mt.getAttribute('data-global-store')).toBe('All');
  });

  it('with globalStore="uzoshop": synthesis reflects uzoshop-only data — May wins', () => {
    render(<AnalysisArchiveTab stores={['uzoshop', 'otherstore']} globalStore="uzoshop" />);
    // May 2026 (מאי) is uzoshop's strongest month — otherstore's March
    // wouldn't matter once the filter excludes it. This proves the synthesis
    // input is being filtered by storeName.
    expect(screen.getByText(/מאי 2026/)).toBeInTheDocument();
    // Scope label now names the active store so the operator knows the
    // archive is scoped, not showing all-stores totals.
    expect(screen.getByText(/טבלאות חודשיות — uzoshop/)).toBeInTheDocument();
    // MonthlyTables also receives the scoped store so its per-store mode
    // shows the right tables.
    const mt = screen.getByTestId('monthly-tables');
    expect(mt.getAttribute('data-global-store')).toBe('uzoshop');
  });

  it('with globalStore for an unknown store: behaves as "All" (defensive)', () => {
    render(<AnalysisArchiveTab stores={['uzoshop', 'otherstore']} globalStore="not-a-real-store" />);
    // Unknown store -> falls back to all stores -> March wins again.
    expect(screen.getByText(/מרץ 2026/)).toBeInTheDocument();
  });
});
