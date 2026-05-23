import { describe, expect, it } from 'vitest';
import {
  detectProductCannibalization,
  splitRangeHalves,
  type CampaignDailyForCannibalization,
  type ProductDailyForCannibalization,
} from '@/lib/cannibalizationDetection';
import type { ProductMap } from '@/lib/campaignProductMap';

/**
 * Phase 05.7.x (2026-05-23) — locks the cannibalization-detection
 * algorithm. The verdict drives the operator's "scale or pause"
 * decision in the drawer's CohortComparisonPanel, so the tests
 * pin down:
 *
 *   - Range splitting (even / odd day counts; edge cases)
 *   - Active-days floor (>= 3 in each half)
 *   - Each risk threshold (none / low / medium / high)
 *   - Single-mapped products are SKIPPED (not "cannibalization")
 *   - Cross-store products are isolated
 *   - Marginal ROAS is null when scale-down
 *   - Edge cases: zero revenue, negative revenue, zero spend
 */

const STORE = 'uzoshop';

function k(platform: string, campaignId: string): string {
  return `${STORE}::${platform}::${campaignId}`;
}

function makeCampaignDay(
  date: string,
  campaignId: string,
  spend: number,
  platform = 'Meta',
): CampaignDailyForCannibalization {
  return { date, storeId: STORE, platform, campaignId, spend };
}

function makeProductDay(
  date: string,
  productId: string,
  netRevenue: number,
  productTitle = 'Test Product',
): ProductDailyForCannibalization {
  return { date, storeId: STORE, productId, productTitle, netRevenue };
}

// ---------------------------------------------------------------------------
// splitRangeHalves
// ---------------------------------------------------------------------------

describe('splitRangeHalves', () => {
  it('returns null for a single-day range (cannot split)', () => {
    expect(splitRangeHalves('2026-05-01', '2026-05-01')).toBeNull();
  });

  it('returns null for reversed range', () => {
    expect(splitRangeHalves('2026-05-10', '2026-05-01')).toBeNull();
  });

  it('splits 2-day range cleanly: 1+1', () => {
    const out = splitRangeHalves('2026-05-01', '2026-05-02');
    expect(out).toEqual({
      early: { from: '2026-05-01', to: '2026-05-01' },
      late: { from: '2026-05-02', to: '2026-05-02' },
    });
  });

  it('splits 4-day range evenly: 2+2', () => {
    const out = splitRangeHalves('2026-05-01', '2026-05-04');
    expect(out).toEqual({
      early: { from: '2026-05-01', to: '2026-05-02' },
      late: { from: '2026-05-03', to: '2026-05-04' },
    });
  });

  it('splits 5-day range as 2+3 (early gets the shorter half)', () => {
    const out = splitRangeHalves('2026-05-01', '2026-05-05');
    expect(out).toEqual({
      early: { from: '2026-05-01', to: '2026-05-02' },
      late: { from: '2026-05-03', to: '2026-05-05' },
    });
  });

  it('splits 14-day range evenly: 7+7', () => {
    const out = splitRangeHalves('2026-05-01', '2026-05-14');
    expect(out).toEqual({
      early: { from: '2026-05-01', to: '2026-05-07' },
      late: { from: '2026-05-08', to: '2026-05-14' },
    });
  });
});

// ---------------------------------------------------------------------------
// detectProductCannibalization — basic
// ---------------------------------------------------------------------------

describe('detectProductCannibalization — empty cases', () => {
  it('returns empty when range too short to split', () => {
    const result = detectProductCannibalization({
      range: { from: '2026-05-01', to: '2026-05-01' },
      storeId: STORE,
      productMap: { [k('Meta', 'c1')]: ['p1'], [k('Meta', 'c2')]: ['p1'] },
      campaignsDaily: [],
      productsDaily: [],
    });
    expect(result).toEqual([]);
  });

  it('skips products mapped to only ONE campaign', () => {
    const result = detectProductCannibalization({
      range: { from: '2026-05-01', to: '2026-05-14' },
      storeId: STORE,
      productMap: { [k('Meta', 'c1')]: ['p1'] }, // only one campaign
      campaignsDaily: [],
      productsDaily: [],
    });
    expect(result).toEqual([]);
  });

  it('returns insufficient when each half has < 3 active days', () => {
    // 14-day range, but only 2 active days per half
    const result = detectProductCannibalization({
      range: { from: '2026-05-01', to: '2026-05-14' },
      storeId: STORE,
      productMap: { [k('Meta', 'c1')]: ['p1'], [k('Meta', 'c2')]: ['p1'] },
      campaignsDaily: [
        makeCampaignDay('2026-05-01', 'c1', 100),
        makeCampaignDay('2026-05-02', 'c1', 100),
        makeCampaignDay('2026-05-08', 'c1', 100),
        makeCampaignDay('2026-05-09', 'c1', 100),
      ],
      productsDaily: [
        makeProductDay('2026-05-01', 'p1', 200),
        makeProductDay('2026-05-02', 'p1', 200),
        makeProductDay('2026-05-08', 'p1', 200),
        makeProductDay('2026-05-09', 'p1', 200),
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].risk).toBe('insufficient');
  });

  it('cross-store products are isolated (zolplus map ignored for uzoshop)', () => {
    const result = detectProductCannibalization({
      range: { from: '2026-05-01', to: '2026-05-14' },
      storeId: STORE,
      productMap: {
        [k('Meta', 'c1')]: ['p1'],
        [`zolplus::Meta::c2`]: ['p1'], // different store — should not couple
      },
      campaignsDaily: [],
      productsDaily: [],
    });
    expect(result).toEqual([]); // only one cohort member in uzoshop
  });
});

// ---------------------------------------------------------------------------
// Risk classification — happy paths
// ---------------------------------------------------------------------------

const FULL_RANGE = { from: '2026-05-01', to: '2026-05-14' };

/** Build 7 days of cohort spend in each half (3 active days minimum + extra). */
function buildCampaignDaysHalf(
  campaignId: string,
  totalSpend: number,
  fromDay: number,
  toDay: number,
): CampaignDailyForCannibalization[] {
  const days = toDay - fromDay + 1;
  const perDay = totalSpend / days;
  const out: CampaignDailyForCannibalization[] = [];
  for (let d = fromDay; d <= toDay; d++) {
    out.push(makeCampaignDay(`2026-05-${String(d).padStart(2, '0')}`, campaignId, perDay));
  }
  return out;
}

function buildProductDaysHalf(
  productId: string,
  totalRev: number,
  fromDay: number,
  toDay: number,
): ProductDailyForCannibalization[] {
  const days = toDay - fromDay + 1;
  const perDay = totalRev / days;
  const out: ProductDailyForCannibalization[] = [];
  for (let d = fromDay; d <= toDay; d++) {
    out.push(makeProductDay(`2026-05-${String(d).padStart(2, '0')}`, productId, perDay));
  }
  return out;
}

describe('detectProductCannibalization — risk thresholds', () => {
  const map: ProductMap = {
    [k('Meta', 'c1')]: ['p1'],
    [k('Meta', 'c2')]: ['p1'],
  };

  it('NONE — proportional growth (spend +20%, revenue +20%)', () => {
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: map,
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 100, 1, 7),
        ...buildCampaignDaysHalf('c2', 0, 1, 7),
        ...buildCampaignDaysHalf('c1', 120, 8, 14),
        ...buildCampaignDaysHalf('c2', 0, 8, 14),
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', 300, 1, 7),
        ...buildProductDaysHalf('p1', 360, 8, 14),
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].risk).toBe('none');
    expect(result[0].metrics.spendGrowthPct).toBeCloseTo(0.2, 2);
    expect(result[0].metrics.revenueGrowthPct).toBeCloseTo(0.2, 2);
  });

  it('NONE — spend shrinking (no cannibalization possible without scale-up)', () => {
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: map,
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 200, 1, 7),
        ...buildCampaignDaysHalf('c2', 0, 1, 7),
        ...buildCampaignDaysHalf('c1', 100, 8, 14), // scaled DOWN
        ...buildCampaignDaysHalf('c2', 0, 8, 14),
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', 400, 1, 7),
        ...buildProductDaysHalf('p1', 100, 8, 14),
      ],
    });
    expect(result[0].risk).toBe('none');
  });

  it('LOW — spend +15%, revenue +8% (just over the threshold)', () => {
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: map,
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 100, 1, 7),
        ...buildCampaignDaysHalf('c2', 0, 1, 7),
        ...buildCampaignDaysHalf('c1', 115, 8, 14), // +15%
        ...buildCampaignDaysHalf('c2', 0, 8, 14),
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', 300, 1, 7),
        ...buildProductDaysHalf('p1', 324, 8, 14), // +8%
      ],
    });
    // 8% < 15% * 0.75 = 11.25%, so LOW or worse fires.
    // But 8% is NOT < 15%/2=7.5%, so not medium.
    expect(['low', 'medium']).toContain(result[0].risk);
  });

  it('MEDIUM — spend +30%, revenue +10% (less than half the spend growth)', () => {
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: map,
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 100, 1, 7),
        ...buildCampaignDaysHalf('c2', 0, 1, 7),
        ...buildCampaignDaysHalf('c1', 130, 8, 14), // +30%
        ...buildCampaignDaysHalf('c2', 0, 8, 14),
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', 300, 1, 7),
        ...buildProductDaysHalf('p1', 330, 8, 14), // +10%
      ],
    });
    // 10% < 30%/2 = 15%, AND 30% >= 15% → MEDIUM.
    // Also 10% < 30% * 0.75 = 22.5% → matches LOW too; MEDIUM is checked
    // first so it wins.
    expect(result[0].risk).toBe('medium');
  });

  it('HIGH — spend +50%, revenue +3% (way below 5% floor)', () => {
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: map,
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 100, 1, 7),
        ...buildCampaignDaysHalf('c2', 0, 1, 7),
        ...buildCampaignDaysHalf('c1', 150, 8, 14), // +50%
        ...buildCampaignDaysHalf('c2', 0, 8, 14),
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', 300, 1, 7),
        ...buildProductDaysHalf('p1', 309, 8, 14), // +3%
      ],
    });
    expect(result[0].risk).toBe('high');
  });

  it('HIGH — extreme case: spend +100%, revenue -5%', () => {
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: map,
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 100, 1, 7),
        ...buildCampaignDaysHalf('c2', 0, 1, 7),
        ...buildCampaignDaysHalf('c1', 200, 8, 14), // +100%
        ...buildCampaignDaysHalf('c2', 0, 8, 14),
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', 300, 1, 7),
        ...buildProductDaysHalf('p1', 285, 8, 14), // -5%
      ],
    });
    expect(result[0].risk).toBe('high');
    expect(result[0].metrics.marginalRoas).toBeCloseTo(-0.15, 2); // -15$ revenue per +100$ spend
  });
});

// ---------------------------------------------------------------------------
// Marginal ROAS
// ---------------------------------------------------------------------------

describe('detectProductCannibalization — marginal ROAS', () => {
  const map: ProductMap = {
    [k('Meta', 'c1')]: ['p1'],
    [k('Meta', 'c2')]: ['p1'],
  };

  it('reports marginalRoas when spend grew', () => {
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: map,
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 100, 1, 7),
        ...buildCampaignDaysHalf('c2', 0, 1, 7),
        ...buildCampaignDaysHalf('c1', 200, 8, 14),
        ...buildCampaignDaysHalf('c2', 0, 8, 14),
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', 300, 1, 7),
        ...buildProductDaysHalf('p1', 450, 8, 14),
      ],
    });
    // Δspend = 100, Δrev = 150 → marginalRoas = 1.5
    expect(result[0].metrics.marginalRoas).toBeCloseTo(1.5, 2);
  });

  it('marginalRoas is null when spend did NOT grow', () => {
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: map,
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 200, 1, 7),
        ...buildCampaignDaysHalf('c2', 0, 1, 7),
        ...buildCampaignDaysHalf('c1', 100, 8, 14), // scaled down
        ...buildCampaignDaysHalf('c2', 0, 8, 14),
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', 400, 1, 7),
        ...buildProductDaysHalf('p1', 200, 8, 14),
      ],
    });
    expect(result[0].metrics.marginalRoas).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Multi-product + multi-platform cohorts
// ---------------------------------------------------------------------------

describe('detectProductCannibalization — realistic cohorts', () => {
  it('returns one verdict per multi-mapped product', () => {
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: {
        [k('Meta', 'c1')]: ['p1', 'p2'],
        [k('Meta', 'c2')]: ['p1'],
        [k('Meta', 'c3')]: ['p2'],
        [k('Meta', 'c4')]: ['p3'], // p3 only in c4 — single-mapped, skipped
      },
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 100, 1, 7),
        ...buildCampaignDaysHalf('c2', 100, 1, 7),
        ...buildCampaignDaysHalf('c3', 100, 1, 7),
        ...buildCampaignDaysHalf('c1', 100, 8, 14),
        ...buildCampaignDaysHalf('c2', 100, 8, 14),
        ...buildCampaignDaysHalf('c3', 100, 8, 14),
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', 300, 1, 7),
        ...buildProductDaysHalf('p1', 300, 8, 14),
        ...buildProductDaysHalf('p2', 200, 1, 7),
        ...buildProductDaysHalf('p2', 200, 8, 14),
      ],
    });
    expect(result).toHaveLength(2); // p1 + p2, NOT p3
    expect(result.map(v => v.productId).sort()).toEqual(['p1', 'p2']);
  });

  it('handles 4 Meta + 3 TikTok cohort on the same product', () => {
    const map: ProductMap = {};
    for (let i = 1; i <= 4; i++) map[k('Meta', `m${i}`)] = ['microscope'];
    for (let i = 1; i <= 3; i++) map[k('TikTok', `t${i}`)] = ['microscope'];

    const campaignsDaily: CampaignDailyForCannibalization[] = [];
    for (let i = 1; i <= 4; i++) {
      campaignsDaily.push(...buildCampaignDaysHalf(`m${i}`, 50, 1, 7));
      campaignsDaily.push(...buildCampaignDaysHalf(`m${i}`, 100, 8, 14)); // each Meta doubled
    }
    for (let i = 1; i <= 3; i++) {
      campaignsDaily.push(
        ...buildCampaignDaysHalf(`t${i}`, 30, 1, 7).map(d => ({ ...d, platform: 'TikTok' })),
      );
      campaignsDaily.push(
        ...buildCampaignDaysHalf(`t${i}`, 50, 8, 14).map(d => ({ ...d, platform: 'TikTok' })),
      );
    }
    const productsDaily = [
      ...buildProductDaysHalf('microscope', 800, 1, 7),
      ...buildProductDaysHalf('microscope', 1000, 8, 14), // only +25% revenue vs much bigger spend
    ];
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: map,
      campaignsDaily,
      productsDaily,
    });
    expect(result).toHaveLength(1);
    expect(result[0].productId).toBe('microscope');
    expect(result[0].cohortKeys).toHaveLength(7); // 4 Meta + 3 TikTok
    // Spend doubled (~+100%) vs revenue +25% → high risk.
    expect(['medium', 'high']).toContain(result[0].risk);
  });
});

// ---------------------------------------------------------------------------
// Edge: zero / negative revenue
// ---------------------------------------------------------------------------

describe('detectProductCannibalization — edge revenue', () => {
  const map: ProductMap = {
    [k('Meta', 'c1')]: ['p1'],
    [k('Meta', 'c2')]: ['p1'],
  };

  it('handles negative revenue half (refund-heavy week)', () => {
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: map,
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 100, 1, 7),
        ...buildCampaignDaysHalf('c2', 0, 1, 7),
        ...buildCampaignDaysHalf('c1', 150, 8, 14),
        ...buildCampaignDaysHalf('c2', 0, 8, 14),
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', 300, 1, 7),
        // Late half NEGATIVE (refunds on prior orders > new sales).
        ...buildProductDaysHalf('p1', -50, 8, 14),
      ],
    });
    expect(result).toHaveLength(1);
    expect(['medium', 'high']).toContain(result[0].risk);
    // marginalRoas should be defined (spend grew) and NEGATIVE.
    expect(result[0].metrics.marginalRoas).toBeLessThan(0);
  });

  it('does NOT mark insufficient when early spend is positive but early rev is 0', () => {
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: map,
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 100, 1, 7),
        ...buildCampaignDaysHalf('c2', 0, 1, 7),
        ...buildCampaignDaysHalf('c1', 150, 8, 14),
        ...buildCampaignDaysHalf('c2', 0, 8, 14),
      ],
      productsDaily: [
        // No revenue in early half — but spend exists, so we can compute.
        // revenueGrowthPct → Infinity → not cannibalization.
        ...buildProductDaysHalf('p1', 0, 1, 7),
        ...buildProductDaysHalf('p1', 200, 8, 14),
      ],
    });
    expect(result[0].risk).toBe('none'); // revenue grew from 0 → 200, no cannibalization
  });
});

// ---------------------------------------------------------------------------
// Composition-change guard — locks audit HIGH-03 fix (2026-05-23)
//
// The old half-over-half cohort-total comparison conflated "we scaled A"
// with "we launched B" / "we paused B". Verifies the new
// 'composition_changed' verdict fires when a material member is missing
// from one half, and that the legacy thresholds still fire when the
// composition is stable.
// ---------------------------------------------------------------------------

describe('detectProductCannibalization — composition-change guard (audit HIGH-03)', () => {
  const map: ProductMap = {
    [k('Meta', 'c1')]: ['p1'],
    [k('Meta', 'c2')]: ['p1'],
  };

  it('emits composition_changed when a material member is launched mid-range', () => {
    // c1 ran throughout. c2 started in the LATE half only.
    // Pre-fix: cohort spend doubled → falsely flagged HIGH cannibalization.
    // Post-fix: c2's share in late half = 50% >= 20% material AND c2's
    //           early active-days = 0 < 3 → composition_changed.
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: map,
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 100, 1, 7),
        ...buildCampaignDaysHalf('c2', 0, 1, 7), // not running
        ...buildCampaignDaysHalf('c1', 100, 8, 14),
        ...buildCampaignDaysHalf('c2', 100, 8, 14), // launched
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', 300, 1, 7),
        ...buildProductDaysHalf('p1', 310, 8, 14), // ~flat revenue
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].risk).toBe('composition_changed');
    // No marginal ROAS for composition_changed.
    expect(result[0].metrics.marginalRoas).toBeNull();
  });

  it('emits composition_changed when a material member is paused mid-range', () => {
    // c1 ran throughout. c2 ran in EARLY half only (paused going into late).
    // Pre-fix: cohort spend halved → falsely flagged NONE (scale-down).
    // Post-fix: c2 had ≥20% share in early but 0 days in late → composition_changed.
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: map,
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 100, 1, 7),
        ...buildCampaignDaysHalf('c2', 100, 1, 7), // running
        ...buildCampaignDaysHalf('c1', 130, 8, 14),
        ...buildCampaignDaysHalf('c2', 0, 8, 14),  // paused
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', 400, 1, 7),
        ...buildProductDaysHalf('p1', 200, 8, 14),
      ],
    });
    expect(result[0].risk).toBe('composition_changed');
  });

  it('still applies HIGH when composition is stable (no member added/dropped)', () => {
    // BOTH c1 and c2 run throughout. Spend grows materially, revenue is flat.
    // Composition guard should NOT fire — classic HIGH cannibalization.
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: map,
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 100, 1, 7),
        ...buildCampaignDaysHalf('c2', 100, 1, 7),
        ...buildCampaignDaysHalf('c1', 150, 8, 14),
        ...buildCampaignDaysHalf('c2', 150, 8, 14),
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', 600, 1, 7),
        ...buildProductDaysHalf('p1', 605, 8, 14), // ~flat
      ],
    });
    expect(result[0].risk).toBe('high');
  });

  it('does NOT fire composition_changed for a non-material member', () => {
    // c1 contributes >99% of spend in both halves; c2 contributes <1%.
    // c2 only ran in late half — but it's not material, so the guard
    // doesn't trigger. Legacy threshold applies (c1 scaled 50% on flat rev).
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: map,
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 1000, 1, 7),
        ...buildCampaignDaysHalf('c2', 0, 1, 7),
        ...buildCampaignDaysHalf('c1', 1500, 8, 14),
        ...buildCampaignDaysHalf('c2', 5, 8, 14), // tiny test spend; <1% material
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', 3000, 1, 7),
        ...buildProductDaysHalf('p1', 3000, 8, 14),
      ],
    });
    expect(result[0].risk).not.toBe('composition_changed');
    // c1 alone drove the analysis; spend +50%, revenue 0% → should be HIGH.
    expect(result[0].risk).toBe('high');
  });
});
