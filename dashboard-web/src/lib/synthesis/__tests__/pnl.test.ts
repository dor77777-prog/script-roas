// Task 3.5 — pure-function tests for synthesizePnl.

import { describe, expect, it } from 'vitest';
import { synthesizePnl } from '@/lib/synthesis/pnl';
import type { Aggregate } from '@/lib/analytics';

function agg(partial: Partial<Aggregate>): Aggregate {
  return {
    revenue: 1000,
    spend: 200,
    fbSpend: 200,
    gaSpend: 0,
    ttSpend: 0,
    roas: 5,
    grossProfit: 800,
    cogs: 250,
    netProfit: 550,
    transactionFees: 65,
    fixedCosts: 50,
    storeCount: 1,
    daysCovered: 30,
    trueNetProfit: 435,
    trueMargin: 0.435,
    rowCount: 30,
    ...partial,
  };
}

describe('synthesizePnl', () => {
  it('returns confidence=low when revenue is zero', () => {
    const r = synthesizePnl({ agg: agg({ revenue: 0, trueMargin: 0, trueNetProfit: 0 }) });
    expect(r.confidence).toBe('low');
    expect(r.text).toBe('');
  });

  it('emits "מעל יעד" when margin meets or exceeds target', () => {
    const r = synthesizePnl({ agg: agg({ trueMargin: 0.42 }), targetMargin: 0.35 });
    expect(r.confidence).toBe('high');
    expect(r.text).toMatch(/רווח נטו 42%/);
    expect(r.text).toMatch(/מעל יעד 35%/);
  });

  it('emits "מתחת ליעד" when margin is below target', () => {
    const r = synthesizePnl({ agg: agg({ trueMargin: 0.20 }), targetMargin: 0.35 });
    expect(r.text).toMatch(/רווח נטו 20%/);
    expect(r.text).toMatch(/מתחת ליעד 35%/);
  });

  it('emits the negative-profit headline when trueNetProfit < 0', () => {
    const r = synthesizePnl({
      agg: agg({ trueMargin: -0.1, trueNetProfit: -100 }),
    });
    expect(r.text).toMatch(/שלילי/);
    expect(r.text).not.toMatch(/מעל יעד/);
    expect(r.text).not.toMatch(/מתחת ליעד/);
  });

  it('defaults target margin to 35% when not provided', () => {
    const r = synthesizePnl({ agg: agg({ trueMargin: 0.36 }) });
    expect(r.text).toMatch(/35%/);
    expect(r.text).toMatch(/מעל יעד/);
  });
});
