import { describe, it, expect } from 'vitest';
import { computeCoverage, toCoverageChip } from '@/lib/home/adapters';
import type { OrderAttributionRow } from '@/lib/ordersAttribution';

function row(overrides: Partial<OrderAttributionRow>): OrderAttributionRow {
  // Default `source: 'direct'` mirrors PRODUCTION: the writer's catch-all
  // (classifyOrderAttribution in fetchers/shopify.ts) is 'direct', never ''.
  // No cast — the object must fully satisfy OrderAttributionRow so the type
  // guards the fixture shape (real field is `referringSite`, not `referrer`).
  return {
    date: '2026-05-20', storeId: 'uzoshop', storeName: 'uzoshop', orderId: 'x', totalCad: 10,
    source: 'direct', utmSource: '', utmMedium: '', utmCampaign: '', utmContent: '',
    fbclidPresent: false, gclidPresent: false, referringSite: '', utmId: '', utmTerm: '',
    lineItems: [],
    ...overrides,
  };
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
      row({}), // source:'direct' (default) → unknown
    ];
    const r = computeCoverage(rows);
    expect(r.total).toBe(5);
    expect(r.covered).toBe(4);
    expect(r.coverageShare).toBeCloseTo(0.8, 5);
    expect(r.unknownShare).toBeCloseTo(0.2, 5);
  });

  it("treats 'direct' and '' source as UNKNOWN, not covered", () => {
    // 'direct' is the writer's catch-all for an unattributed order; '' is the
    // declared-but-never-emitted missing value. Both belong in the UNKNOWN
    // bucket — neither carries a real attribution signal.
    expect(computeCoverage([row({ source: 'direct' })]).covered).toBe(0);
    expect(computeCoverage([row({ source: '' })]).covered).toBe(0); // defensive
  });

  it('counts attributed channels (organic / referral) as COVERED', () => {
    expect(computeCoverage([row({ source: 'meta-organic' })]).covered).toBe(1);
    expect(computeCoverage([row({ source: 'other-referral' })]).covered).toBe(1);
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
