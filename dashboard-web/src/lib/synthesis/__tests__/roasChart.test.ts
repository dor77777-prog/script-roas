// dashboard-web/src/lib/synthesis/__tests__/roasChart.test.ts
//
// Task 3.2 — pure-function tests for synthesizeRoasChart.
// Lives in lib/__tests__/ so it runs under the Node vitest config (no DOM
// needed). The synthesiser is the single source of truth for the chart's
// TL;DR sentence — if these guards regress, the headline can lie about a
// trend.

import { describe, expect, it } from 'vitest';
import {
  synthesizeRoasChart,
  rangeLabelHe,
  type RoasChartPoint,
} from '@/lib/synthesis/roasChart';

function pts(values: Array<number | null>): RoasChartPoint[] {
  return values.map((v, i) => ({
    date: `2026-05-${String(i + 1).padStart(2, '0')}`,
    roas: v,
  }));
}

describe('synthesizeRoasChart', () => {
  it('returns confidence=low when fewer than 3 non-null points', () => {
    const r = synthesizeRoasChart({ points: pts([2.5, null]), range: '7' });
    expect(r.confidence).toBe('low');
    expect(r.text).toBe('');
  });

  it('detects a downtrend > 5% and emits Hebrew "ירד" sentence', () => {
    const r = synthesizeRoasChart({
      points: pts([3.2, 3.1, 3.0, 2.4, 2.3, 2.2, 2.1]),
      range: '7',
    });
    expect(r.confidence).toBe('high');
    expect(r.direction).toBe('down');
    expect(r.text).toMatch(/ROAS ירד/);
    expect(r.text).toMatch(/7 הימים האחרונים/);
  });

  it('detects an uptrend > 5% and emits Hebrew "עלה" sentence', () => {
    const r = synthesizeRoasChart({
      points: pts([2.0, 2.1, 2.2, 3.0, 3.1, 3.2, 3.3]),
      range: '30',
    });
    expect(r.direction).toBe('up');
    expect(r.text).toMatch(/ROAS עלה/);
    expect(r.text).toMatch(/30 הימים האחרונים/);
  });

  it('emits "יציב" when delta is within ±5%', () => {
    const r = synthesizeRoasChart({
      points: pts([2.50, 2.52, 2.51, 2.50, 2.52, 2.51, 2.50]),
      range: 'mtd',
    });
    expect(r.direction).toBe('flat');
    expect(r.text).toMatch(/ROAS יציב/);
  });

  it('clamps delta percent to 1 decimal', () => {
    const r = synthesizeRoasChart({
      points: pts([3.2, 3.1, 3.0, 2.4, 2.3, 2.2, 2.1]),
      range: '7',
    });
    // Match exactly N.N% — never N.NN%.
    expect(r.text).toMatch(/\d+\.\d%/);
  });

  it('picks band=green for an avg in 2.7..3.0', () => {
    const r = synthesizeRoasChart({
      points: pts([2.80, 2.85, 2.90, 2.80, 2.75, 2.78, 2.80]),
      range: '7',
    });
    expect(r.band).toBe('green');
  });

  it('picks band=red for an avg below 2.0', () => {
    const r = synthesizeRoasChart({
      points: pts([1.5, 1.4, 1.6, 1.5, 1.4, 1.5, 1.6]),
      range: '7',
    });
    expect(r.band).toBe('red');
  });

  it('picks band=blue for an avg ≥ 3.0', () => {
    const r = synthesizeRoasChart({
      points: pts([3.5, 3.4, 3.6, 3.5, 3.4, 3.5, 3.6]),
      range: '7',
    });
    expect(r.band).toBe('blue');
  });

  it('skips null points from the average calculation', () => {
    const r = synthesizeRoasChart({
      points: pts([3.0, null, 3.0, null, 3.0]),
      range: '7',
    });
    expect(r.confidence).toBe('high');
    expect(r.anchorMetric).toBe(3.0);
  });
});

describe('rangeLabelHe', () => {
  it('returns Hebrew labels for each range key', () => {
    expect(rangeLabelHe('7')).toBe('7 הימים האחרונים');
    expect(rangeLabelHe('30')).toBe('30 הימים האחרונים');
    expect(rangeLabelHe('90')).toBe('90 הימים האחרונים');
    expect(rangeLabelHe('mtd')).toBe('מתחילת החודש');
    expect(rangeLabelHe('qtd')).toBe('מתחילת הרבעון');
    expect(rangeLabelHe('ytd')).toBe('מתחילת השנה');
    expect(rangeLabelHe('custom')).toBe('בטווח שנבחר');
  });
});
