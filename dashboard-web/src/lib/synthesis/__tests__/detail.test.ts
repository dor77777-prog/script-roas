// Task 3.5 — pure-function tests for synthesizeDetail.

import { describe, expect, it } from 'vitest';
import { synthesizeDetail } from '@/lib/synthesis/detail';
import type { DailyRow } from '@/lib/types';

function row(storeName: string, spend: number): DailyRow {
  return {
    date: '2026-05-01',
    storeId: storeName,
    storeName,
    fbSpend: spend,
    gaSpend: 0,
    ttSpend: 0,
    totalSpend: spend,
    revenue: spend * 2,
    roas: 2,
    grossProfit: spend,
    cogs: 0,
    netProfit: spend,
    hasCogs: false,
    grossRevenue: null,
    refundDeduction: null,
    fbImpressions: null,
    gaImpressions: null,
    ttImpressions: null,
  };
}

describe('synthesizeDetail', () => {
  it('returns confidence=low when there are no rows', () => {
    const r = synthesizeDetail({ rows: [] });
    expect(r.confidence).toBe('low');
    expect(r.text).toBe('');
  });

  it('returns confidence=low when only one store is present', () => {
    const r = synthesizeDetail({ rows: [row('store-a', 100), row('store-a', 200)] });
    expect(r.confidence).toBe('low');
  });

  it('returns confidence=low when top store share is under 40%', () => {
    // 3 stores at 100/110/120 → top share ≈ 36% — too distributed to headline.
    const r = synthesizeDetail({
      rows: [row('a', 100), row('b', 110), row('c', 120)],
    });
    expect(r.confidence).toBe('low');
  });

  it('emits "מרכז" when top store share >= 60%', () => {
    const r = synthesizeDetail({
      rows: [row('a', 800), row('b', 100), row('c', 100)],
    });
    expect(r.confidence).toBe('high');
    expect(r.text).toMatch(/^a מרכז/);
    expect(r.text).toMatch(/80%/);
  });

  it('emits "מוביל עם" when top share is 40..59%', () => {
    // a=500, b=350, c=150 → a is 50%
    const r = synthesizeDetail({
      rows: [row('a', 500), row('b', 350), row('c', 150)],
    });
    expect(r.confidence).toBe('high');
    expect(r.text).toMatch(/מוביל עם/);
    expect(r.text).toMatch(/50%/);
  });

  it('returns confidence=low when totalSpend is zero', () => {
    const r = synthesizeDetail({ rows: [row('a', 0), row('b', 0)] });
    expect(r.confidence).toBe('low');
  });
});
