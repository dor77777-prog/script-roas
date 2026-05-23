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

  it('LOW — spend +25%, revenue +14% (audit HIGH-04: lands in LOW tier post-raise)', () => {
    // Audit fix 2026-05-23 (HIGH-04 multi-mapping): LOW threshold raised
    // from +10% to +20% spend growth to clear day-of-week noise.
    // The LOW tier sits in the window:
    //   spend ≥ +20%  AND  spend/2 ≤ rev < spend*0.75  AND  abs delta ≥ $50
    // i.e., between MEDIUM (rev < spend/2) and HIGH (rev < 5%).
    // Scenario: spend +25% / revenue +14% — rev (14%) is ABOVE spend/2 (12.5%)
    // so NOT MEDIUM, and BELOW spend*0.75 (18.75%) so LOW. Absolute delta
    // $250 > $50 floor.
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: map,
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 1000, 1, 7),
        ...buildCampaignDaysHalf('c2', 0, 1, 7),
        ...buildCampaignDaysHalf('c1', 1250, 8, 14), // +25%, $250 delta
        ...buildCampaignDaysHalf('c2', 0, 8, 14),
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', 3000, 1, 7),
        ...buildProductDaysHalf('p1', 3420, 8, 14), // +14%
      ],
    });
    expect(result[0].risk).toBe('low');
  });

  it('NONE — spend +15% (below new LOW floor of +20%) — audit HIGH-04', () => {
    // Pin the new threshold's lower edge — used to fire LOW pre-fix.
    // Post-fix: +15% is between MEDIUM's range start (15%) and LOW's
    // new floor (20%). Revenue +8% qualifies as MEDIUM by underperform
    // (8% < 15%/2 = 7.5%? NO, 8>=7.5) → revGrowth ≥ spend/2 → not MEDIUM.
    // Also revGrowth ≥ spend*0.75 = 11.25%? NO, 8<11.25 → would have been
    // LOW under old threshold. Now blocked by +20% floor → NONE.
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
    expect(result[0].risk).toBe('none');
  });

  it('NONE — LOW threshold blocked by $50 absolute delta floor (audit HIGH-04)', () => {
    // Scenario designed to trigger LOW (spendGrowth≥20%, revGrowth<spend*0.75,
    // revGrowth≥spend/2) but with absolute spend delta < $50.
    // Spend $100 → $125 = +25%, $25 delta. Revenue $300 → $345 = +15%.
    // - spend/2 = 12.5%, 15% > 12.5% → NOT MEDIUM ✓
    // - spend*0.75 = 18.75%, 15% < 18.75% → would be LOW
    // - $25 absolute delta < $50 floor → blocked → NONE.
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: map,
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 100, 1, 7),
        ...buildCampaignDaysHalf('c2', 0, 1, 7),
        ...buildCampaignDaysHalf('c1', 125, 8, 14), // +25%, $25 delta
        ...buildCampaignDaysHalf('c2', 0, 8, 14),
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', 300, 1, 7),
        ...buildProductDaysHalf('p1', 345, 8, 14), // +15%
      ],
    });
    expect(result[0].risk).toBe('none');
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
        // Audit fix 2026-05-23 (HIGH-11): revenueGrowthPct → null
        // (pre-fix Infinity) → not cannibalization, an explicit
        // incrementality verdict.
        ...buildProductDaysHalf('p1', 0, 1, 7),
        ...buildProductDaysHalf('p1', 200, 8, 14),
      ],
    });
    expect(result[0].risk).toBe('none'); // revenue grew from 0 → 200, no cannibalization
    // Pin the new null sentinel — pre-fix this was Infinity.
    expect(result[0].metrics.revenueGrowthPct).toBeNull();
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

// ---------------------------------------------------------------------------
// Rebalanced mid-range guard — locks audit b/HI-04 fix (2026-05-23)
//
// The HIGH-03 composition-stability guard caught members entirely missing
// from one half (paused/launched). HIGH-04 widens it to catch members that
// are active in BOTH halves but had their share-of-cohort flip ≥2× — i.e.,
// the cohort was REBALANCED, not scaled. The half-over-half comparison is
// just as unfair in that scenario, so it should also emit composition_changed.
// ---------------------------------------------------------------------------

describe('detectProductCannibalization — rebalanced mid-range guard (audit b/HI-04)', () => {
  const map: ProductMap = {
    [k('Meta', 'c1')]: ['p1'],
    [k('Meta', 'c2')]: ['p1'],
  };

  it('POSITIVE: fires composition_changed when c2 share triples (7% → 21%) — both halves active', () => {
    // Scenario: c1 was dominant early (~93% share), c2 was a small test
    // (~7% share). In the late half, c2 was scaled up — c1 went to 79%,
    // c2 went to 21%. Both ran throughout.
    //
    // Pre-fix: the days-check on c2 passes (active both halves) AND
    // c2's late share = 21% > 20% so it's "material", but the days
    // check returns false — fell through to legacy thresholds.
    // Actually with cohort spend changing too, legacy could fire HIGH
    // or NONE depending on revenue noise. Either way, the verdict is
    // misleading: the operator REALLOCATED, didn't scale.
    //
    // Post-fix: c2's share ratio = 21% / 7% = 3× → shareRatioFlipped
    // → composition_changed fires. (Same for c1's mirror flip: 79% / 93%
    // is < 2× drop, but lateShare=79% is material and earlyShare=93% is
    // material — material gate fires anyway. Both members trigger via
    // different paths; we only need ONE to fire.)
    //
    // Cohort totals chosen: early 1000+75=1075, late 950+250=1200.
    // c1 ran all 14 days; c2 ran all 14 days.
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: map,
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 1000, 1, 7),
        ...buildCampaignDaysHalf('c2', 75, 1, 7),   // 7% of cohort
        ...buildCampaignDaysHalf('c1', 950, 8, 14),
        ...buildCampaignDaysHalf('c2', 250, 8, 14), // 21% of cohort
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', 3000, 1, 7),
        ...buildProductDaysHalf('p1', 3100, 8, 14),
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].risk).toBe('composition_changed');
    // Reason text mentions the share-flip phrasing so the operator
    // understands WHY (vs the missing-half phrasing for paused/launched).
    expect(result[0].reason).toMatch(/הקצאה מחדש|חלק יחסי/);
  });

  it('NEGATIVE: does NOT fire when shares fluctuate within 5-15% (small drift, not rebalancing)', () => {
    // Scenario: c1 ≈ 88-92% in both halves; c2 ≈ 8-12% in both halves.
    // The ratio drift (8%/12% = 1.5×) is BELOW the 2× threshold — and
    // critically c2's smaller share is above the 5% noise floor in
    // both halves, so the relative-share logic checks correctly.
    // Neither material gate fires (c2 never hits 20%) and the share
    // ratio doesn't flip (under 2×). Falls through to legacy thresholds.
    //
    // Legacy: cohort spend grew from 1000 → 1100 = 10% (below 20% LOW
    // floor) → NONE expected.
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: map,
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 880, 1, 7),  // 88%
        ...buildCampaignDaysHalf('c2', 120, 1, 7),  // 12%
        ...buildCampaignDaysHalf('c1', 990, 8, 14), // 90%
        ...buildCampaignDaysHalf('c2', 110, 8, 14), // 10%
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', 3000, 1, 7),
        ...buildProductDaysHalf('p1', 3000, 8, 14),
      ],
    });
    expect(result[0].risk).not.toBe('composition_changed');
  });

  it('NEGATIVE: does NOT fire when the smaller share is below the 5% noise floor', () => {
    // c2 went from 1% → 4% — share quadrupled but the LARGER of early
    // and late is still below 5%, so neither branch of the shareRatioFlipped
    // OR fires (both require the > 0.05 gate). Legitimate "experiment got
    // a tiny bump" pattern that shouldn't trip the guard.
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: map,
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 1000, 1, 7),
        ...buildCampaignDaysHalf('c2', 10, 1, 7),   // 1%
        ...buildCampaignDaysHalf('c1', 1000, 8, 14),
        ...buildCampaignDaysHalf('c2', 42, 8, 14),  // ~4%
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', 3000, 1, 7),
        ...buildProductDaysHalf('p1', 3000, 8, 14),
      ],
    });
    expect(result[0].risk).not.toBe('composition_changed');
  });

  it('LOW threshold $50 absolute floor is STILL honored after b/HI-04 fix', () => {
    // Regression guard: HIGH-04's pre-existing $50 absolute spend delta
    // floor for the LOW tier must keep working after the composition
    // guard widens. Compose a scenario where:
    //   - composition is stable (no share flip, no missing halves)
    //   - spend grew +25% but only by $25 absolute
    //   - revenue grew between spend/2 (12.5%) and spend*0.75 (18.75%)
    // Pre-fix b/HI-04 would have fired LOW; post-fix (HIGH-04 floor)
    // still blocks at $50. b/HI-04 must NOT have inadvertently lowered
    // the floor.
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: map,
      campaignsDaily: [
        ...buildCampaignDaysHalf('c1', 100, 1, 7),
        ...buildCampaignDaysHalf('c2', 0, 1, 7),
        ...buildCampaignDaysHalf('c1', 125, 8, 14), // +$25 delta (< $50 floor)
        ...buildCampaignDaysHalf('c2', 0, 8, 14),
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', 300, 1, 7),
        ...buildProductDaysHalf('p1', 345, 8, 14), // +15%
      ],
    });
    expect(result[0].risk).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// 5+ member cohort + composition_changed — locks audit a/INFO-3 (2026-05-23)
//
// The composition guard was originally tested on 2-member cohorts. With
// 5+ members and a mix of material + immaterial cohort members, the
// guard should still correctly identify the ONE member that was paused
// mid-range and emit composition_changed without being confused by the
// noise from the small members.
// ---------------------------------------------------------------------------

describe('detectProductCannibalization — 5+ member cohort composition_changed (audit a/INFO-3)', () => {
  it('fires composition_changed when 1 of 5 material members is paused mid-range', () => {
    // 5-member cohort. c1+c2 are both material (~40% each in early half,
    // ~50%/0% in late half). c3, c4, c5 are each <5% — non-material noise.
    //
    // Late half: c2 was paused (0 spend, 0 active days). Material member
    // dropped out entirely → composition_changed.
    //
    // Without the guard: cohort spend halved → false NONE (looks like
    // operator scaled down → no cannibalization to worry about). But the
    // truth is they restructured the cohort, so the comparison is unfair.
    const map5: ProductMap = {
      [k('Meta', 'c1')]: ['p1'],
      [k('Meta', 'c2')]: ['p1'],
      [k('Meta', 'c3')]: ['p1'],
      [k('Meta', 'c4')]: ['p1'],
      [k('Meta', 'c5')]: ['p1'],
    };
    const result = detectProductCannibalization({
      range: FULL_RANGE,
      storeId: STORE,
      productMap: map5,
      campaignsDaily: [
        // Early half: c1 + c2 each 40%, c3-c5 each ~7% (just above noise floor).
        ...buildCampaignDaysHalf('c1', 400, 1, 7),
        ...buildCampaignDaysHalf('c2', 400, 1, 7),
        ...buildCampaignDaysHalf('c3', 70, 1, 7),
        ...buildCampaignDaysHalf('c4', 70, 1, 7),
        ...buildCampaignDaysHalf('c5', 70, 1, 7),
        // Late half: c2 paused (0 spend, 0 active days). Others continue.
        ...buildCampaignDaysHalf('c1', 400, 8, 14),
        ...buildCampaignDaysHalf('c2', 0, 8, 14),
        ...buildCampaignDaysHalf('c3', 70, 8, 14),
        ...buildCampaignDaysHalf('c4', 70, 8, 14),
        ...buildCampaignDaysHalf('c5', 70, 8, 14),
      ],
      productsDaily: [
        ...buildProductDaysHalf('p1', 3000, 1, 7),
        ...buildProductDaysHalf('p1', 2000, 8, 14),
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].cohortKeys).toHaveLength(5);
    expect(result[0].risk).toBe('composition_changed');
    // Reason text mentions c2 specifically (the paused material member),
    // not c3/c4/c5 (which are non-material and didn't trigger).
    expect(result[0].reason).toContain('c2');
  });
});
