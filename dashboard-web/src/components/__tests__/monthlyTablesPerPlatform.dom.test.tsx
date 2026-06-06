// Per-platform spend columns in the Analysis→History monthly tables.
// Spec: docs/superpowers/specs/2026-06-01-monthly-tables-per-platform-design.md
import { describe, it, expect } from 'vitest';
import { render, within } from '@testing-library/react';
import type { DailyRow } from '@/lib/types';
import type { AdStateMap, AdPlatform } from '@/lib/adState';
import {
  MonthBlockSummary,
  MonthBlockPerStore,
} from '@/components/MonthlyTables';

// Build a valid DailyRow with sane defaults; override only what a test cares about.
function makeRow(over: Partial<DailyRow>): DailyRow {
  const fb = over.fbSpend ?? 0;
  const ga = over.gaSpend ?? 0;
  const tt = over.ttSpend ?? 0;
  const totalSpend = over.totalSpend ?? fb + ga + tt;
  const revenue = over.revenue ?? 0;
  return {
    date: '2026-06-01',
    storeId: 'store-1',
    storeName: 'store-1',
    fbSpend: fb,
    gaSpend: ga,
    ttSpend: tt,
    totalSpend,
    revenue,
    roas: totalSpend > 0 ? revenue / totalSpend : 0,
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
  };
}

// Read the <thead> header texts of the first table in the container.
function headerTexts(container: HTMLElement): string[] {
  const ths = container.querySelectorAll('thead th');
  return Array.from(ths).map((th) => th.textContent?.trim() ?? '');
}

describe('MonthBlockSummary — per-platform spend columns', () => {
  it('shows a platform column ONLY for platforms that spent that month (FB + TikTok, not Google)', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-01', storeId: 'a', fbSpend: 100, ttSpend: 50, revenue: 400 }),
      makeRow({ date: '2026-06-02', storeId: 'b', fbSpend: 200, ttSpend: 0, revenue: 500 }),
    ];
    const { container } = render(
      <MonthBlockSummary ym="2026-06" rows={rows} stores={['a', 'b']} defaultOpen />,
    );
    const headers = headerTexts(container);
    expect(headers).toContain('פייסבוק');
    expect(headers).toContain('טיקטוק');
    expect(headers).not.toContain('גוגל'); // Google never spent → no column
  });

  it('sums each platform across stores per day AND in the total row', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-01', storeId: 'a', fbSpend: 100, gaSpend: 10, revenue: 300 }),
      makeRow({ date: '2026-06-01', storeId: 'b', fbSpend: 200, gaSpend: 20, revenue: 600 }),
      makeRow({ date: '2026-06-02', storeId: 'a', fbSpend: 50, gaSpend: 5, revenue: 150 }),
    ];
    const { container } = render(
      <MonthBlockSummary ym="2026-06" rows={rows} stores={['a', 'b']} defaultOpen />,
    );
    // Total row (tfoot-equivalent last <tr>) carries the column sums.
    // FB total = 100+200+50 = 350; GA total = 10+20+5 = 35; spend total = 385.
    // formatNumber uses he-IL with 2 decimal places → '350.00', '35.00', '385.00'.
    const totalRow = container.querySelector('tbody tr:last-child')!;
    const cells = within(totalRow as HTMLElement).getAllByRole('cell').map((c) => c.textContent?.trim());
    expect(cells).toContain('350.00'); // FB total
    expect(cells).toContain('35.00');  // GA total
    expect(cells).toContain('385.00'); // total spend (יצא סה"כ)
  });

  it('labels total-spend "יצא סה\\"כ" when any platform column shows', () => {
    const rows: DailyRow[] = [makeRow({ fbSpend: 100, revenue: 300 })];
    const { container } = render(
      <MonthBlockSummary ym="2026-06" rows={rows} stores={['a']} defaultOpen />,
    );
    expect(headerTexts(container)).toContain('יצא סה"כ');
  });
});

describe('MonthBlockPerStore — off-aware ROAS cells (ads-off Phase 2)', () => {
  it('renders "אורגני" for a fully-off store day with spend=0 and revenue>0', () => {
    const adStateMap: AdStateMap = { 'mystore:meta': false };
    const storeApplicablePlatforms: Record<string, AdPlatform[]> = { mystore: ['meta'] };
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-01', storeId: 'mystore', storeName: 'mystore', fbSpend: 0, gaSpend: 0, ttSpend: 0, totalSpend: 0, revenue: 500, roas: 0 }),
    ];
    const { container } = render(
      <MonthBlockPerStore
        ym="2026-06"
        storeName="mystore"
        rows={rows}
        defaultOpen
        adStateMap={adStateMap}
        storeApplicablePlatforms={storeApplicablePlatforms}
      />,
    );
    expect(container.textContent).toContain('אורגני');
  });

  it('renders normal numeric ROAS for a historical day with spend>0 (no retroactive rewrite)', () => {
    const adStateMap: AdStateMap = { 'mystore:meta': false };
    const storeApplicablePlatforms: Record<string, AdPlatform[]> = { mystore: ['meta'] };
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-01', storeId: 'mystore', storeName: 'mystore', fbSpend: 100, gaSpend: 0, ttSpend: 0, totalSpend: 100, revenue: 300, roas: 3 }),
    ];
    const { container } = render(
      <MonthBlockPerStore
        ym="2026-06"
        storeName="mystore"
        rows={rows}
        defaultOpen
        adStateMap={adStateMap}
        storeApplicablePlatforms={storeApplicablePlatforms}
      />,
    );
    expect(container.textContent).not.toContain('אורגני');
    // Normal numeric ROAS badge: 3.00
    expect(container.textContent).toContain('3.00');
  });

  it('renders normal ROAS when adStateMap is empty (off=false, backward compat)', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-01', storeId: 'mystore', storeName: 'mystore', fbSpend: 0, gaSpend: 0, ttSpend: 0, totalSpend: 0, revenue: 400, roas: 0 }),
    ];
    const { container } = render(
      <MonthBlockPerStore
        ym="2026-06"
        storeName="mystore"
        rows={rows}
        defaultOpen
      />,
    );
    // No organic when off not set — blank cell (spend=0, revenue>0 but off=false → no organic)
    expect(container.textContent).not.toContain('אורגני');
  });
});

describe('MonthBlockSummary — off-aware ROAS cells (ads-off Phase 2)', () => {
  it('renders "אורגני" in summary when ALL stores fully off + spend=0 + revenue>0', () => {
    const adStateMap: AdStateMap = { 'store-a:meta': false, 'store-b:meta': false };
    const storeApplicablePlatforms: Record<string, AdPlatform[]> = {
      'store-a': ['meta'],
      'store-b': ['meta'],
    };
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-01', storeId: 'store-a', storeName: 'store-a', fbSpend: 0, totalSpend: 0, revenue: 200 }),
      makeRow({ date: '2026-06-01', storeId: 'store-b', storeName: 'store-b', fbSpend: 0, totalSpend: 0, revenue: 300 }),
    ];
    const { container } = render(
      <MonthBlockSummary
        ym="2026-06"
        rows={rows}
        stores={['store-a', 'store-b']}
        defaultOpen
        adStateMap={adStateMap}
        storeApplicablePlatforms={storeApplicablePlatforms}
      />,
    );
    expect(container.textContent).toContain('אורגני');
  });

  it('does NOT render "אורגני" in summary when at least one store is on', () => {
    const adStateMap: AdStateMap = { 'store-a:meta': false };
    // store-b is on (no false entry)
    const storeApplicablePlatforms: Record<string, AdPlatform[]> = {
      'store-a': ['meta'],
      'store-b': ['meta'],
    };
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-01', storeId: 'store-a', storeName: 'store-a', fbSpend: 0, totalSpend: 0, revenue: 200 }),
      makeRow({ date: '2026-06-01', storeId: 'store-b', storeName: 'store-b', fbSpend: 0, totalSpend: 0, revenue: 300 }),
    ];
    const { container } = render(
      <MonthBlockSummary
        ym="2026-06"
        rows={rows}
        stores={['store-a', 'store-b']}
        defaultOpen
        adStateMap={adStateMap}
        storeApplicablePlatforms={storeApplicablePlatforms}
      />,
    );
    expect(container.textContent).not.toContain('אורגני');
  });

  it('renders normal ROAS in summary when adStateMap is empty (backward compat)', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-01', storeId: 'store-a', storeName: 'store-a', fbSpend: 100, totalSpend: 100, revenue: 300, roas: 3 }),
    ];
    const { container } = render(
      <MonthBlockSummary
        ym="2026-06"
        rows={rows}
        stores={['store-a']}
        defaultOpen
      />,
    );
    expect(container.textContent).not.toContain('אורגני');
    expect(container.textContent).toContain('3.00');
  });
});

describe('MonthBlockPerStore — independent platform columns (bug fix)', () => {
  it('a Facebook-only store shows the פייסבוק column (not bundled away with Google)', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-01', storeName: 'zolplus', fbSpend: 842, gaSpend: 0, ttSpend: 0, revenue: 2310 }),
      makeRow({ date: '2026-06-02', storeName: 'zolplus', fbSpend: 910, gaSpend: 0, ttSpend: 0, revenue: 2140 }),
    ];
    const { container } = render(
      <MonthBlockPerStore ym="2026-06" storeName="zolplus" rows={rows} defaultOpen />,
    );
    const headers = headerTexts(container);
    expect(headers).toContain('פייסבוק');     // FB spent → shown (was hidden before the fix)
    expect(headers).not.toContain('גוגל');     // Google never spent → no column
    expect(headers).not.toContain('טיקטוק');   // TikTok never spent → no column
    // FB spend is visible in the body, not just folded into the total.
    // formatNumber uses he-IL 2dp → '842.00'.
    expect(container.textContent).toContain('842.00');
  });

  it('a store with Facebook + Google (no TikTok) shows both, not TikTok', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-01', storeName: 's', fbSpend: 100, gaSpend: 40, ttSpend: 0, revenue: 500 }),
    ];
    const { container } = render(
      <MonthBlockPerStore ym="2026-06" storeName="s" rows={rows} defaultOpen />,
    );
    const headers = headerTexts(container);
    expect(headers).toContain('פייסבוק');
    expect(headers).toContain('גוגל');
    expect(headers).not.toContain('טיקטוק');
  });
});
