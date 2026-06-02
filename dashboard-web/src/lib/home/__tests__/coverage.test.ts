import { describe, it, expect } from 'vitest';
import { computeCoverage, toCoverageChip } from '@/lib/home/adapters';
import type { OrderAttributionRow } from '@/lib/ordersAttribution';

function row(overrides: Partial<OrderAttributionRow>): OrderAttributionRow {
  return {
    date: '2026-05-20', storeId: 'uzoshop', orderId: 'x', totalCad: 10,
    source: '', utmSource: '', utmMedium: '', utmCampaign: '', utmContent: '',
    fbclidPresent: false, gclidPresent: false, referrer: '', utmId: '', utmTerm: '',
    ...overrides,
  } as OrderAttributionRow;
}

describe('computeCoverage (2026-06-02)', () => {
  it('returns 0/0 with no orders (caller renders nothing)', () => {
    expect(computeCoverage([])).toEqual({ total: 0, covered: 0, coverageShare: 0, unknownShare: 0 });
  });

  it('counts fbclid / gclid / utm / source as covered; bare rows as unknown', () => {
    const rows = [
      row({ fbclidPresent: true }),
      row({ gclidPresent: true }),
      row({ utmSource: 'klaviyo' }),
      row({ source: 'meta-paid' }),
      row({}), // unknown
    ];
    const r = computeCoverage(rows);
    expect(r.total).toBe(5);
    expect(r.covered).toBe(4);
    expect(r.coverageShare).toBeCloseTo(0.8, 5);
    expect(r.unknownShare).toBeCloseTo(0.2, 5);
  });

  it('coverageShare + unknownShare always sum to 1 (never redistributed)', () => {
    const rows = [row({ utmCampaign: 'spring' }), row({}), row({}), row({})];
    const r = computeCoverage(rows);
    expect(r.coverageShare + r.unknownShare).toBeCloseTo(1, 9);
  });
});

describe('toCoverageChip (2026-06-02)', () => {
  it('is QUIET when unknown <= 30%', () => {
    const chip = toCoverageChip({ total: 10, covered: 8, coverageShare: 0.8, unknownShare: 0.2 });
    expect(chip).not.toBeNull();
    expect(chip!.prominent).toBe(false);
  });

  it('is PROMINENT when unknown > 30%', () => {
    const chip = toCoverageChip({ total: 10, covered: 6, coverageShare: 0.6, unknownShare: 0.4 });
    expect(chip!.prominent).toBe(true);
  });

  it('is null when there are no orders', () => {
    expect(toCoverageChip({ total: 0, covered: 0, coverageShare: 0, unknownShare: 0 })).toBeNull();
  });
});
