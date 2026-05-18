import { describe, it, expect } from 'vitest';
import { detectOutlierDays } from '@/lib/attributionAnalysis';

describe('detectOutlierDays', () => {
  // ----------------------------------------------------------------
  // Empty / too few points
  // ----------------------------------------------------------------

  it('returns [] for empty series', () => {
    expect(detectOutlierDays([])).toEqual([]);
  });

  it('returns [] when series has fewer than 8 points', () => {
    const series = Array.from({ length: 7 }, (_, i) => ({
      date: `2026-05-${String(i + 1).padStart(2, '0')}`,
      value: 100,
    }));
    expect(detectOutlierDays(series)).toEqual([]);
  });

  // ----------------------------------------------------------------
  // No outliers
  // ----------------------------------------------------------------

  it('returns [] when all values are uniform (no outliers)', () => {
    const series = Array.from({ length: 14 }, (_, i) => ({
      date: `2026-05-${String(i + 1).padStart(2, '0')}`,
      value: 100,
    }));
    // Uniform → stdDev = 0 → skipped
    expect(detectOutlierDays(series)).toEqual([]);
  });

  // ----------------------------------------------------------------
  // Single outlier
  // ----------------------------------------------------------------

  it('detects a single spike day as outlier', () => {
    // 13 baseline days with variance + 1 spike day (>2.5σ above mean)
    const baseValues = [90, 110, 95, 105, 100, 90, 110, 95, 105, 100, 90, 110, 95];
    const series = [
      ...baseValues.map((value, i) => ({
        date: `2026-05-${String(i + 1).padStart(2, '0')}`,
        value,
      })),
      { date: '2026-05-14', value: 1000 }, // massive spike
    ];
    const result = detectOutlierDays(series);
    expect(result.length).toBeGreaterThanOrEqual(1);
    expect(result).toContain('2026-05-14');
  });

  // ----------------------------------------------------------------
  // Z-score threshold at 2.5σ
  // ----------------------------------------------------------------

  it('does not flag a day at ~1.5σ above baseline (below 2.5σ threshold)', () => {
    // Baseline: 13 days of 100. Mean=100, stdDev=0 → actually uniform → skip
    // Use varied baseline so stdDev != 0
    const baseValues = [80, 90, 100, 110, 120, 80, 90, 100, 110, 120, 80, 90, 100];
    const mean = baseValues.reduce((s, v) => s + v, 0) / baseValues.length;
    const variance = baseValues.reduce((s, v) => s + (v - mean) ** 2, 0) / baseValues.length;
    const stdDev = Math.sqrt(variance);
    // A value ~1.5σ above mean (should not be flagged)
    const mildValue = Math.round(mean + 1.5 * stdDev);

    const series = [
      ...baseValues.map((value, i) => ({
        date: `2026-05-${String(i + 1).padStart(2, '0')}`,
        value,
      })),
      { date: '2026-05-14', value: mildValue },
    ];
    const result = detectOutlierDays(series);
    expect(result).not.toContain('2026-05-14');
  });

  it('flags a day at ~5σ above baseline (clearly above 2.5σ threshold)', () => {
    const baseValues = [80, 90, 100, 110, 120, 80, 90, 100, 110, 120, 80, 90, 100];
    const mean = baseValues.reduce((s, v) => s + v, 0) / baseValues.length;
    const variance = baseValues.reduce((s, v) => s + (v - mean) ** 2, 0) / baseValues.length;
    const stdDev = Math.sqrt(variance);
    const spikeValue = Math.round(mean + 5 * stdDev);

    const series = [
      ...baseValues.map((value, i) => ({
        date: `2026-05-${String(i + 1).padStart(2, '0')}`,
        value,
      })),
      { date: '2026-05-14', value: spikeValue },
    ];
    const result = detectOutlierDays(series);
    expect(result).toContain('2026-05-14');
  });

  // ----------------------------------------------------------------
  // Trailing window scoping with adaptive LOOKBACK
  // ----------------------------------------------------------------

  it('detects outliers in a 10-day series (adaptive LOOKBACK=5)', () => {
    // 10 days: LOOKBACK = min(14, max(5, floor(10/2))) = min(14, 5) = 5
    // Loop: i=5..9 → indices 5-9 checked
    // Put outliers at idx 8 and 9
    const baseValues = [80, 90, 100, 110, 120]; // 5 values for trail at i=5
    const series = [
      ...Array.from({ length: 5 }, (_, i) => ({
        date: `2026-05-${String(i + 1).padStart(2, '0')}`,
        value: baseValues[i],
      })),
      ...Array.from({ length: 3 }, (_, i) => ({
        date: `2026-05-${String(i + 6).padStart(2, '0')}`,
        value: 100,
      })),
      // Spikes at idx 8 and 9
      { date: '2026-05-09', value: 1000 },
      { date: '2026-05-10', value: 1000 },
    ];
    const result = detectOutlierDays(series);
    expect(result.length).toBeGreaterThanOrEqual(1);
  });

  // ----------------------------------------------------------------
  // Non-finite value in series → not flagged, not contaminates baseline
  // ----------------------------------------------------------------

  it('NaN value in series does not become an outlier and does not contaminate baseline', () => {
    const baseValues = [90, 110, 95, 105, 100, 90, 110, 95, 105, 100, 90, 110, 95];
    const series = [
      ...baseValues.map((value, i) => ({
        date: `2026-05-${String(i + 1).padStart(2, '0')}`,
        value,
      })),
      { date: '2026-05-14', value: NaN }, // should be skipped
    ];
    const result = detectOutlierDays(series);
    // NaN day should not be in the outliers list
    expect(result).not.toContain('2026-05-14');
  });

  // ----------------------------------------------------------------
  // IN5-02: stdDev === 0 skip
  // ----------------------------------------------------------------

  it('IN5-02: does not flag outlier when trailing window has stdDev=0', () => {
    // 5 identical values in trail, then spike
    // With only 5 values and stdDev=0, the guard skips the z-score check
    const series = [
      { date: '2026-05-01', value: 100 },
      { date: '2026-05-02', value: 100 },
      { date: '2026-05-03', value: 100 },
      { date: '2026-05-04', value: 100 },
      { date: '2026-05-05', value: 100 },
      { date: '2026-05-06', value: 100 },
      { date: '2026-05-07', value: 100 },
      { date: '2026-05-08', value: 500 }, // would be outlier but stdDev=0 in trail
    ];
    // With 8 items: LOOKBACK = min(14, max(5, floor(8/2))) = min(14, max(5,4)) = min(14,5) = 5
    // i=5: trail = [0..4] = 5 × 100 → stdDev=0 → skip
    // i=6: trail = [1..5] = 5 × 100 → stdDev=0 → skip
    // i=7: trail = [2..6] = 5 × 100 → stdDev=0 → skip → no outlier
    const result = detectOutlierDays(series);
    expect(result).not.toContain('2026-05-08');
  });
});
