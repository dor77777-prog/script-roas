import { describe, expect, it } from 'vitest';
import { formatMetricValue } from '../metricFormat';

describe('formatMetricValue', () => {
  it('shows full grouped value below the compact threshold', () => {
    const r = formatMetricValue(9840, { compactAbove: 10_000 });
    expect(r.display).toBe('$9,840');
    expect(r.full).toBe('$9,840');
    expect(r.compacted).toBe(false);
  });
  it('compacts at/above the threshold but keeps the exact full value', () => {
    const r = formatMetricValue(7_500_000, { compactAbove: 10_000 });
    expect(r.display).toBe('$7.5M');
    expect(r.full).toBe('$7,500,000');
    expect(r.compacted).toBe(true);
  });
  it('never returns an ellipsis or a mid-digit fragment', () => {
    const r = formatMetricValue(1_234_567, { compactAbove: 10_000 });
    expect(r.display).not.toMatch(/…|\.\.\./);
    expect(r.display).toMatch(/^\$[0-9.]+[KMB]?$/);
  });
  it('handles null/NaN as em-dash', () => {
    expect(formatMetricValue(null).display).toBe('—');
    expect(formatMetricValue(Number.NaN).display).toBe('—');
  });
  it('keeps the typographic minus on negatives', () => {
    expect(formatMetricValue(-2500, { compactAbove: 10_000 }).display).toBe('−$2,500');
  });
  it('supports a CAD-prefixed mode (no $)', () => {
    const r = formatMetricValue(1500, { code: 'CAD' });
    expect(r.full).toBe('CAD 1,500');
  });
});
