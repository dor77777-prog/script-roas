// Task 3.5 — pure-function tests for synthesizeArchive.

import { describe, expect, it } from 'vitest';
import { synthesizeArchive } from '@/lib/synthesis/archive';
import type { DailyRow } from '@/lib/types';

function row(date: string, spend: number, revenue: number): DailyRow {
  return {
    date,
    storeId: 's1',
    storeName: 'store-a',
    fbSpend: spend,
    gaSpend: 0,
    ttSpend: 0,
    totalSpend: spend,
    revenue,
    roas: spend > 0 ? revenue / spend : 0,
    grossProfit: revenue - spend,
    cogs: 0,
    netProfit: revenue - spend,
    hasCogs: false,
    grossRevenue: null,
    refundDeduction: null,
    fbImpressions: null,
    gaImpressions: null,
    ttImpressions: null,
  };
}

describe('synthesizeArchive', () => {
  it('returns confidence=low with fewer than 2 months of data', () => {
    const r = synthesizeArchive({
      rows: [row('2026-05-01', 100, 200)],
      year: 2026,
    });
    expect(r.confidence).toBe('low');
    expect(r.text).toBe('');
  });

  it('names the strongest month with Hebrew name + 2-decimal ROAS', () => {
    const r = synthesizeArchive({
      rows: [
        // April — ROAS 2.0
        row('2026-04-01', 100, 200),
        // May — ROAS 3.5 (strongest)
        row('2026-05-01', 100, 350),
        // No June data → not considered.
      ],
      year: 2026,
    });
    expect(r.confidence).toBe('high');
    expect(r.text).toMatch(/מאי 2026/);
    expect(r.text).toMatch(/3\.50/);
  });

  it('switches to stability headline when last 3 months are tightly clustered', () => {
    // March 2.90, April 3.00, May 2.95 → avg 2.95, all within ±10%
    const r = synthesizeArchive({
      rows: [
        row('2026-03-01', 100, 290),
        row('2026-04-01', 100, 300),
        row('2026-05-01', 100, 295),
      ],
      year: 2026,
    });
    expect(r.text).toMatch(/יציב/);
    expect(r.text).toMatch(/3 החודשים האחרונים/);
  });

  it('skips months with zero spend', () => {
    const r = synthesizeArchive({
      rows: [
        row('2026-01-01', 0, 0),   // dormant — skipped
        row('2026-04-01', 100, 200),
        row('2026-05-01', 100, 400),
      ],
      year: 2026,
    });
    expect(r.confidence).toBe('high');
    // strongest is May
    expect(r.text).toMatch(/מאי/);
  });

  it('ignores rows outside the requested year', () => {
    const r = synthesizeArchive({
      rows: [
        row('2025-12-01', 100, 1000), // huge — but wrong year
        row('2026-04-01', 100, 200),
        row('2026-05-01', 100, 350),
      ],
      year: 2026,
    });
    expect(r.text).toMatch(/מאי 2026/);
    expect(r.text).toMatch(/3\.50/);
  });
});
