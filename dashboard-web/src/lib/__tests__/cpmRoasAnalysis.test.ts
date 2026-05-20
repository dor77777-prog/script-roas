import { describe, it, expect } from 'vitest';
import { analyzeCpmVsRoas } from '@/lib/cpmRoasAnalysis';

/**
 * Build a 7-day series. Each day overrides any field via the patch arg.
 */
function makeSeries(base: { cpm: number; roas: number }, patches: Partial<{ cpm: number; roas: number }>[] = []) {
  return Array.from({ length: 7 }, (_, i) => {
    const day = String(i + 1).padStart(2, '0');
    return {
      date: `2026-05-${day}`,
      cpm: patches[i]?.cpm ?? base.cpm,
      roas: patches[i]?.roas ?? base.roas,
    };
  });
}

describe('analyzeCpmVsRoas', () => {
  it('returns hasData: false when fewer than 5 valid days are provided', () => {
    const series = makeSeries({ cpm: 5, roas: 2 }).slice(0, 4);
    const result = analyzeCpmVsRoas(series);
    expect(result.hasData).toBe(false);
    expect(result.tone).toBe('neutral');
    expect(result.text).toContain('5 ימים');
  });

  it('filters out days with zero CPM or zero ROAS before checking n', () => {
    // 7 days but 3 with zero ROAS = 4 valid; below threshold.
    const series = makeSeries({ cpm: 5, roas: 2 }, [{}, {}, {}, { roas: 0 }, { roas: 0 }, { roas: 0 }]);
    const result = analyzeCpmVsRoas(series);
    expect(result.hasData).toBe(false);
  });

  it('flags UP/UP — paying more, returning more (positive)', () => {
    // CPM trends up, ROAS trends up
    const series = makeSeries({ cpm: 3, roas: 2 }, [
      { cpm: 3, roas: 2 },
      { cpm: 3.2, roas: 2.1 },
      { cpm: 3.5, roas: 2.2 },
      { cpm: 4, roas: 2.8 },
      { cpm: 4.5, roas: 3.0 },
      { cpm: 5, roas: 3.2 },
      { cpm: 5.5, roas: 3.5 },
    ]);
    const result = analyzeCpmVsRoas(series);
    expect(result.hasData).toBe(true);
    expect(result.tone).toBe('positive');
    expect(result.text).toContain('עובד');
  });

  it('flags UP/DOWN — paying more, returning less (negative)', () => {
    const series = makeSeries({ cpm: 3, roas: 3 }, [
      { cpm: 3, roas: 3 },
      { cpm: 3.5, roas: 2.8 },
      { cpm: 4, roas: 2.5 },
      { cpm: 4.5, roas: 2.2 },
      { cpm: 5, roas: 2 },
      { cpm: 5.5, roas: 1.8 },
      { cpm: 6, roas: 1.5 },
    ]);
    const result = analyzeCpmVsRoas(series);
    expect(result.hasData).toBe(true);
    expect(result.tone).toBe('negative');
    expect(result.text).toContain('דבר רע');
  });

  it('flags DOWN/UP — best case (positive)', () => {
    const series = makeSeries({ cpm: 6, roas: 2 }, [
      { cpm: 6, roas: 2 },
      { cpm: 5.5, roas: 2.2 },
      { cpm: 5, roas: 2.5 },
      { cpm: 4.5, roas: 2.8 },
      { cpm: 4, roas: 3.2 },
      { cpm: 3.5, roas: 3.5 },
      { cpm: 3, roas: 3.8 },
    ]);
    const result = analyzeCpmVsRoas(series);
    expect(result.hasData).toBe(true);
    expect(result.tone).toBe('positive');
    expect(result.text).toContain('האידיאלי');
  });

  it('flags DOWN/DOWN — cheap impressions but non-auction problem (negative)', () => {
    const series = makeSeries({ cpm: 6, roas: 3 }, [
      { cpm: 6, roas: 3 },
      { cpm: 5.5, roas: 2.8 },
      { cpm: 5, roas: 2.5 },
      { cpm: 4.5, roas: 2.2 },
      { cpm: 4, roas: 2 },
      { cpm: 3.5, roas: 1.8 },
      { cpm: 3, roas: 1.5 },
    ]);
    const result = analyzeCpmVsRoas(series);
    expect(result.hasData).toBe(true);
    expect(result.tone).toBe('negative');
    expect(result.text).toContain('לא הצילו');
  });

  it('flags FLAT/FLAT — steady state (neutral)', () => {
    const series = makeSeries({ cpm: 5, roas: 3 });
    const result = analyzeCpmVsRoas(series);
    expect(result.hasData).toBe(true);
    expect(result.tone).toBe('neutral');
    expect(result.text).toContain('סטדי');
  });

  it('flags FLAT/DOWN — creative fatigue (warning)', () => {
    const series = makeSeries({ cpm: 5, roas: 3 }, [
      { roas: 3 },
      { roas: 2.9 },
      { roas: 2.7 },
      { roas: 2.4 },
      { roas: 2.1 },
      { roas: 1.9 },
      { roas: 1.7 },
    ]);
    const result = analyzeCpmVsRoas(series);
    expect(result.hasData).toBe(true);
    expect(result.tone).toBe('warning');
    expect(result.text).toContain('נשחק');
  });

  it('handles equal-length series with zero variance via pearson guard', () => {
    // Both flat = zero variance; pearson returns null; categorize falls
    // to "flat" via the halfOverHalfDelta path (delta = 0)
    const series = makeSeries({ cpm: 5, roas: 2 });
    const result = analyzeCpmVsRoas(series);
    expect(result.details.pearson).toBeNull();
  });

  it('exposes diagnostic deltas in details object', () => {
    const series = makeSeries({ cpm: 5, roas: 2 }, [
      { cpm: 4, roas: 2 },
      { cpm: 4.5, roas: 2 },
      { cpm: 5, roas: 2 },
      { cpm: 6, roas: 2 },
      { cpm: 7, roas: 2 },
      { cpm: 8, roas: 2 },
      { cpm: 9, roas: 2 },
    ]);
    const result = analyzeCpmVsRoas(series);
    expect(result.details.n).toBe(7);
    expect(result.details.cpmDeltaPct).not.toBeNull();
    // Second half (6,7,8,9 mean) is higher than first half (4, 4.5, 5)
    expect(result.details.cpmDeltaPct!).toBeGreaterThan(0);
  });
});
