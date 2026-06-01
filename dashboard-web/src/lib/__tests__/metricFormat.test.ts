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
    // C4a: `code` was renamed to `prefix` (no other callers used `code`).
    const r = formatMetricValue(1500, { prefix: 'CAD' });
    expect(r.full).toBe('CAD 1,500');
  });

  // ── Wave C4a: prefix / locale / decimals so <Money> reproduces every site ──
  it('renders a bare he-IL 0dp value (table cell) — no prefix', () => {
    expect(formatMetricValue(1234, { prefix: 'none', locale: 'he-IL' }).display).toBe('1,234');
  });
  it('renders a bare he-IL 2dp value (cpc/cpm/cpa)', () => {
    expect(
      formatMetricValue(1234.56, { prefix: 'none', locale: 'he-IL', decimals: 2 }).display,
    ).toBe('1,234.56');
  });
  it('normalizes a tiny negative that rounds to zero at 2dp to a non-negative 0.00', () => {
    expect(
      formatMetricValue(-0.004, { prefix: 'none', locale: 'he-IL', decimals: 2 }).display,
    ).toBe('0.00');
  });
  it('renders a $-prefixed en-US compact value (hero)', () => {
    expect(formatMetricValue(4847, { prefix: '$', compactAbove: 1_000_000 }).display).toBe('$4,847');
  });
  it('compacts a huge $ value to $1.2M (hero overflow floor)', () => {
    expect(formatMetricValue(1_200_000, { prefix: '$', compactAbove: 1_000_000 }).display).toBe(
      '$1.2M',
    );
  });
  it('renders a bare en-US 2dp value (hero cpm grouping)', () => {
    expect(formatMetricValue(1234.56, { prefix: 'none', decimals: 2 }).display).toBe('1,234.56');
  });
  it('keeps `full` exact (no compaction) even when `display` compacts', () => {
    const r = formatMetricValue(7_500_000, {
      prefix: 'none',
      locale: 'he-IL',
      compactAbove: 1_000_000,
    });
    expect(r.full).toBe('7,500,000');
    expect(r.display).toBe('7.5M');
    expect(r.compacted).toBe(true);
  });
  it('applies the typographic minus with prefix=none', () => {
    expect(formatMetricValue(-2500, { prefix: 'none', locale: 'he-IL' }).display).toBe('−2,500');
  });
  it('defaults stay $ / en-US / 0dp (back-compat for existing <Money> callers)', () => {
    expect(formatMetricValue(4847).display).toBe('$4,847');
  });
});
