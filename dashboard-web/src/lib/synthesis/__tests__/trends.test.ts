// Task 3.5 — pure-function tests for synthesizeTrends.

import { describe, expect, it } from 'vitest';
import { synthesizeTrends } from '@/lib/synthesis/trends';
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

describe('synthesizeTrends', () => {
  it('returns confidence=low with <6 unique-day rows', () => {
    const r = synthesizeTrends({
      rows: [
        row('2026-05-01', 100, 200),
        row('2026-05-02', 100, 200),
      ],
    });
    expect(r.confidence).toBe('low');
    expect(r.text).toBe('');
  });

  it('detects ROAS uptrend > 5% and emits "עלה"', () => {
    const rows: DailyRow[] = [];
    // First half: ROAS ≈ 2.0
    for (let i = 1; i <= 6; i++) {
      rows.push(row(`2026-05-0${i}`, 100, 200));
    }
    // Second half: ROAS ≈ 3.0
    for (let i = 7; i <= 12; i++) {
      const d = i < 10 ? `2026-05-0${i}` : `2026-05-${i}`;
      rows.push(row(d, 100, 300));
    }
    const r = synthesizeTrends({ rows });
    expect(r.confidence).toBe('high');
    expect(r.text).toMatch(/ROAS עלה/);
  });

  it('detects ROAS downtrend > 5% and emits "ירד"', () => {
    const rows: DailyRow[] = [];
    for (let i = 1; i <= 6; i++) rows.push(row(`2026-05-0${i}`, 100, 300));
    for (let i = 7; i <= 12; i++) {
      const d = i < 10 ? `2026-05-0${i}` : `2026-05-${i}`;
      rows.push(row(d, 100, 200));
    }
    const r = synthesizeTrends({ rows });
    expect(r.text).toMatch(/ROAS ירד/);
  });

  it('falls back to "מגמה יציבה" when everything is flat', () => {
    const rows: DailyRow[] = [];
    for (let i = 1; i <= 12; i++) {
      const d = i < 10 ? `2026-05-0${i}` : `2026-05-${i}`;
      rows.push(row(d, 100, 250));
    }
    const r = synthesizeTrends({ rows });
    expect(r.text).toMatch(/מגמה יציבה/);
  });

  it('P1-9a: odd-length flat series (7 days, flat $100/day) reads ~0% change — not +33%', () => {
    // Pre-fix the half comparison used raw SUMS: Math.floor splits 7 days
    // into 3 vs 4, so a perfectly flat $100/day series read
    // "הוצאה עלתה 33.3%" purely from the extra day in the second half.
    // Post-fix the halves are compared by per-day MEANS.
    const rows: DailyRow[] = [];
    for (let i = 1; i <= 7; i++) rows.push(row(`2026-05-0${i}`, 100, 250));
    const r = synthesizeTrends({ rows });
    expect(r.confidence).toBe('high');
    expect(r.text).toMatch(/מגמה יציבה/);
    expect(r.anchorMetric).toBe(0);
  });

  it('P1-9a: odd-length range still detects a REAL spend move (no over-suppression)', () => {
    // 9 days: first half $100/day, second half $200/day → per-day means
    // diverge by +100% — must still call out the divergence.
    const rows: DailyRow[] = [];
    for (let i = 1; i <= 4; i++) rows.push(row(`2026-05-0${i}`, 100, 250));
    for (let i = 5; i <= 9; i++) rows.push(row(`2026-05-0${i}`, 200, 500));
    const r = synthesizeTrends({ rows });
    expect(r.text).toMatch(/הוצאה עלתה/);
  });

  it('calls out spend/revenue divergence when ROAS is flat', () => {
    // Spend doubled (up), revenue doubled (up) → ROAS unchanged → divergence
    // path emits "הוצאה ... בעוד הכנסה ...".
    const rows: DailyRow[] = [];
    for (let i = 1; i <= 6; i++) rows.push(row(`2026-05-0${i}`, 100, 250));
    for (let i = 7; i <= 12; i++) {
      const d = i < 10 ? `2026-05-0${i}` : `2026-05-${i}`;
      rows.push(row(d, 200, 500));
    }
    const r = synthesizeTrends({ rows });
    expect(r.text).toMatch(/הוצאה/);
    expect(r.text).toMatch(/הכנסה/);
  });
});
