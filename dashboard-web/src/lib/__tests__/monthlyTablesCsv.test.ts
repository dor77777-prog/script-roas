// Step 6 — CSV export of the currently-shown monthly data.
import { describe, it, expect } from 'vitest';
import type { DailyRow } from '@/lib/types';
import { buildMonthlyCsv } from '@/lib/monthlyTablesCsv';

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

describe('buildMonthlyCsv', () => {
  it('emits the Hebrew header row in the canonical order', () => {
    const { headers } = buildMonthlyCsv([makeRow({ date: '2026-06-01' })]);
    expect(headers).toEqual([
      'תאריך',
      'חנות',
      'הוצאה FB',
      'הוצאה GA',
      'הוצאה TT',
      'סה"כ הוצאה',
      'הכנסה',
      'ROAS',
      'רווח נקי',
    ]);
  });

  it('emits one data row per DailyRow with the right cell values', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-02', storeName: 'uzoshop', fbSpend: 100, gaSpend: 20, ttSpend: 5, revenue: 500, netProfit: 120, hasCogs: true }),
    ];
    const { rows: out } = buildMonthlyCsv(rows);
    expect(out).toHaveLength(1);
    const [r] = out;
    expect(r[0]).toBe('2026-06-02');     // date (ISO, sortable)
    expect(r[1]).toBe('uzoshop');        // store
    expect(r[2]).toBe('100.00');         // FB
    expect(r[3]).toBe('20.00');          // GA
    expect(r[4]).toBe('5.00');           // TT
    expect(r[5]).toBe('125.00');         // total spend
    expect(r[6]).toBe('500.00');         // revenue
    expect(r[7]).toBe('4.00');           // ROAS = 500/125
    expect(r[8]).toBe('120.00');         // net profit
  });

  it('leaves net profit blank when the row has no COGS', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-02', fbSpend: 100, revenue: 300, hasCogs: false }),
    ];
    const { rows: out } = buildMonthlyCsv(rows);
    expect(out[0][8]).toBe(''); // net profit blank, not "0"
  });

  it('sorts rows by date ascending then store name', () => {
    const rows: DailyRow[] = [
      makeRow({ date: '2026-06-02', storeName: 'b' }),
      makeRow({ date: '2026-06-01', storeName: 'z' }),
      makeRow({ date: '2026-06-02', storeName: 'a' }),
    ];
    const { rows: out } = buildMonthlyCsv(rows);
    expect(out.map(r => [r[0], r[1]])).toEqual([
      ['2026-06-01', 'z'],
      ['2026-06-02', 'a'],
      ['2026-06-02', 'b'],
    ]);
  });
});
