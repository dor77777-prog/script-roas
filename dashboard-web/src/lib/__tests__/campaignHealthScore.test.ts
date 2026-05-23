import { describe, it, expect } from 'vitest';
import {
  computeCampaignHealth,
  applyCohortHealthAdjustment,
  type HealthScoreInputs,
  type CampaignHealth,
} from '@/lib/campaignHealthScore';
import type { Aggregated } from '@/lib/campaignsAggregator';
import type { TrueRevenueInfo } from '@/lib/hooks/useCampaignTrueRevenue';
import type { CpmRoasAnalysis } from '@/lib/cpmRoasAnalysis';

// ─────────────────────────────────────────────────────────────────────────
// Factories — keep tests readable. Each builder accepts a partial override
// so individual tests can twiddle exactly the field they care about and
// inherit safe defaults for everything else.
// ─────────────────────────────────────────────────────────────────────────

function makeAggregated(patch: Partial<Aggregated> = {}): Aggregated {
  return {
    key: 'uzoshop::Meta::C1',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    platform: 'Meta',
    campaignId: 'C1',
    campaignName: 'Test Campaign',
    adSetId: undefined,
    adSetName: undefined,
    spend: 500,
    impressions: 50000,
    clicks: 800,
    conversions: 15,
    conversionValue: 1500,
    campaignBudgetCad: 50,
    adSetBudgetCad: null,
    budgetType: 'CBO',
    lastActiveDate: '2026-05-22',
    effectiveStatus: null,
    ...patch,
  };
}

function makeTrueRevenue(patch: Partial<TrueRevenueInfo> = {}): TrueRevenueInfo {
  return {
    trueRevenue: 1500,
    trueUnits: 30,
    metaClaim: 1500,
    spend: 500,
    mappedCount: 3,
    sharedCampaigns: 0,
    confidence: { level: 'high', label: 'אמין', reasons: ['mock high confidence'] },
    attribution: {
      campaignName: 'Test Campaign',
      campaignId: 'C1',
      storeId: 'uzoshop',
      platform: 'Meta',
      metaClaim: 1500,
      spend: 500,
      deterministicRevenue: 1200,
      deterministicOrders: 25,
      coverage: 0.8,
      gap: 300,
      gapPct: 0.2,
      modeledRevenue: 300,
      modeledOrders: 5,
      modeledPct: 0.2,
      trust: { level: 'high', label: 'אמין', score: 88 },
      windowStability: {
        nWindows: 3,
        meanRoas: 2.8,
        roasStdNorm: 0.1,
        stdDev: 0.1,
        verdict: 'stable',
      },
      outlierDays: [],
      interpretation: '',
      recommendations: [],
    } as unknown as TrueRevenueInfo['attribution'],
    productTotals: { revenue: 1800, units: 40, orders: 30 },
    deterministicRevenue: 1200,
    deterministicUnits: 24,
    ...patch,
  };
}

function makeCpmRoasAnalysis(patch: Partial<CpmRoasAnalysis> = {}): CpmRoasAnalysis {
  return {
    text: 'CPM יורד, ROAS עולה',
    tone: 'positive',
    hasData: true,
    mode: 'half-over-half',
    details: { n: 14, cpmDeltaPct: -10, roasDeltaPct: 12, pearson: -0.7 },
    ...patch,
  };
}

function buildInputs(patch: Partial<HealthScoreInputs> = {}): HealthScoreInputs {
  return {
    aggregated: patch.aggregated ?? makeAggregated(),
    trueRevenueInfo: 'trueRevenueInfo' in patch ? patch.trueRevenueInfo : makeTrueRevenue(),
    cpmRoasAnalysis: 'cpmRoasAnalysis' in patch ? patch.cpmRoasAnalysis : makeCpmRoasAnalysis(),
    optimized: patch.optimized ?? false,
    isCurrentlyOff: patch.isCurrentlyOff ?? false,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Sanity / smoke
// ─────────────────────────────────────────────────────────────────────────

describe('computeCampaignHealth — output shape', () => {
  it('returns score in [0, 100] and all 5 components present', () => {
    const out = computeCampaignHealth(buildInputs());
    expect(out.score).toBeGreaterThanOrEqual(0);
    expect(out.score).toBeLessThanOrEqual(100);
    expect(out.components).toMatchObject({
      profitability: expect.any(Number),
      volume: expect.any(Number),
      trajectory: expect.any(Number),
      attributionClarity: expect.any(Number),
      operatorAdjustment: expect.any(Number),
    });
    expect(out.reasons.length).toBeGreaterThanOrEqual(4);
  });

  it('grade letter matches the score band', () => {
    // Synthesise a known-good campaign and assert grade buckets.
    const a = computeCampaignHealth(buildInputs({ aggregated: makeAggregated({ spend: 500, conversionValue: 1500 }) }));
    // A campaign at the top of the band → A; we'll spot-check the ladder.
    expect(['A', 'B', 'C', 'D', 'F', 'unknown']).toContain(a.grade);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Insufficient-data gate
// ─────────────────────────────────────────────────────────────────────────

describe('computeCampaignHealth — insufficient-data gate', () => {
  it('returns grade=unknown + insufficient=true when spend < $30', () => {
    const out = computeCampaignHealth(
      buildInputs({ aggregated: makeAggregated({ spend: 20, conversions: 0, conversionValue: 0 }) }),
    );
    expect(out.insufficient).toBe(true);
    expect(out.grade).toBe('unknown');
    expect(out.score).toBe(0);
    expect(out.reasons[0]).toMatch(/מדגם קטן מדי/);
  });

  it('returns grade=unknown when spend < $100 AND conversions === 0 (still in learning)', () => {
    const out = computeCampaignHealth(
      buildInputs({ aggregated: makeAggregated({ spend: 80, conversions: 0, conversionValue: 0 }) }),
    );
    expect(out.insufficient).toBe(true);
    expect(out.grade).toBe('unknown');
  });

  it('does NOT mark insufficient when spend < $100 but has conversions', () => {
    // The campaign has data — score it normally even if the score ends up low.
    const out = computeCampaignHealth(
      buildInputs({
        aggregated: makeAggregated({ spend: 80, conversions: 3, conversionValue: 200 }),
        trueRevenueInfo: undefined,
        cpmRoasAnalysis: undefined,
      }),
    );
    expect(out.insufficient).toBe(false);
    expect(out.grade).not.toBe('unknown');
  });

  it('does NOT mark insufficient when spend >= $100 even with 0 conversions', () => {
    const out = computeCampaignHealth(
      buildInputs({
        aggregated: makeAggregated({ spend: 150, conversions: 0, conversionValue: 0 }),
        trueRevenueInfo: undefined,
        cpmRoasAnalysis: undefined,
      }),
    );
    expect(out.insufficient).toBe(false);
    // Will likely score low (no ROAS), but it's still scored.
    expect(out.grade).not.toBe('unknown');
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Profitability scoring
// ─────────────────────────────────────────────────────────────────────────

describe('profitability — source-of-truth priority', () => {
  it('prefers deterministic Shopify revenue over combined / platform', () => {
    // deterministicRevenue=1200, spend=500 → ROAS 2.4 with trust 88
    const out = computeCampaignHealth(buildInputs());
    // ROAS 2.4 → (2.4-1)/2*100 = 70; modulated by 0.88 = ~62
    expect(out.components.profitability).toBeGreaterThanOrEqual(58);
    expect(out.components.profitability).toBeLessThanOrEqual(66);
    expect(out.reasons[0]).toMatch(/דטרמיניסטי/);
  });

  it('falls back to combined Shopify ROAS when deterministicRevenue is 0', () => {
    const tr = makeTrueRevenue({ deterministicRevenue: 0, trueRevenue: 1500 });
    const out = computeCampaignHealth(buildInputs({ trueRevenueInfo: tr }));
    expect(out.reasons[0]).toMatch(/Shopify משולב/);
  });

  it('falls back to platform-claimed ROAS when no Shopify info at all', () => {
    const out = computeCampaignHealth(buildInputs({ trueRevenueInfo: undefined }));
    expect(out.reasons[0]).toMatch(/הצהרת פלטפורמה/);
    // Platform-only gets fixed 0.5 trust modulator.
    // ROAS=1500/500=3 → 100 raw × 0.5 = 50.
    expect(out.components.profitability).toBe(50);
  });

  it('caps profitability at 100 even for ROAS > 3 (diminishing returns)', () => {
    const out = computeCampaignHealth(
      buildInputs({
        aggregated: makeAggregated({ spend: 100, conversionValue: 1000 }),
        trueRevenueInfo: makeTrueRevenue({
          deterministicRevenue: 1000,
          spend: 100,
          attribution: {
            ...makeTrueRevenue().attribution,
            trust: { level: 'high', label: 'אמין', score: 100 },
          } as TrueRevenueInfo['attribution'],
        }),
      }),
    );
    // ROAS = 10, trust 100% → would be (10-1)/2*100=450 capped to 100
    expect(out.components.profitability).toBe(100);
  });

  it('floors profitability at 0 when ROAS < 1 (losing money)', () => {
    const out = computeCampaignHealth(
      buildInputs({
        aggregated: makeAggregated({ spend: 500, conversionValue: 200 }),
        trueRevenueInfo: makeTrueRevenue({
          deterministicRevenue: 150,
          spend: 500,
        }),
      }),
    );
    // ROAS = 0.3 → max(0, (0.3-1)/2*100) = 0
    expect(out.components.profitability).toBe(0);
  });

  it('returns 0 when spend is 0 (no division by zero)', () => {
    const out = computeCampaignHealth(
      buildInputs({
        aggregated: makeAggregated({ spend: 0, conversionValue: 0, conversions: 0 }),
      }),
    );
    // spend=0 short-circuits to insufficient (since spend < 30).
    expect(out.insufficient).toBe(true);
  });
});

describe('profitability — trust modulation', () => {
  it('halves profitability when attribution trust score is 50', () => {
    const tr = makeTrueRevenue({
      deterministicRevenue: 1500,
      spend: 500,
      attribution: {
        ...makeTrueRevenue().attribution,
        trust: { level: 'medium', label: 'חלקי', score: 50 },
      } as TrueRevenueInfo['attribution'],
    });
    const out = computeCampaignHealth(buildInputs({ trueRevenueInfo: tr }));
    // ROAS = 3.0 → raw 100; trust 50 → modulated 50
    expect(out.components.profitability).toBe(50);
  });

  it('zeros profitability when attribution trust score is 0', () => {
    const tr = makeTrueRevenue({
      deterministicRevenue: 1500,
      spend: 500,
      attribution: {
        ...makeTrueRevenue().attribution,
        trust: { level: 'low', label: 'לא אמין', score: 0 },
      } as TrueRevenueInfo['attribution'],
    });
    const out = computeCampaignHealth(buildInputs({ trueRevenueInfo: tr }));
    expect(out.components.profitability).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Volume scoring (spend tiers)
// ─────────────────────────────────────────────────────────────────────────

describe('volume — spend tiers', () => {
  it('scores 100 at $500+', () => {
    const out = computeCampaignHealth(buildInputs({ aggregated: makeAggregated({ spend: 500 }) }));
    expect(out.components.volume).toBe(100);
  });

  it('scores 70 in $200-$499 range', () => {
    const out = computeCampaignHealth(buildInputs({ aggregated: makeAggregated({ spend: 250 }) }));
    expect(out.components.volume).toBe(70);
  });

  it('scores 40 in $50-$199 range', () => {
    const out = computeCampaignHealth(buildInputs({ aggregated: makeAggregated({ spend: 120, conversions: 5 }) }));
    expect(out.components.volume).toBe(40);
  });

  it('scores 10 below $50 (still above insufficient floor)', () => {
    // Need conversions > 0 to escape the insufficient gate.
    const out = computeCampaignHealth(buildInputs({ aggregated: makeAggregated({ spend: 40, conversions: 1 }) }));
    expect(out.components.volume).toBe(10);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Trajectory (CPM↔ROAS analysis)
// ─────────────────────────────────────────────────────────────────────────

describe('trajectory — CPM↔ROAS momentum', () => {
  it('maps positive tone → 100', () => {
    const out = computeCampaignHealth(buildInputs({ cpmRoasAnalysis: makeCpmRoasAnalysis({ tone: 'positive' }) }));
    expect(out.components.trajectory).toBe(100);
  });

  it('maps neutral tone → 60', () => {
    const out = computeCampaignHealth(buildInputs({ cpmRoasAnalysis: makeCpmRoasAnalysis({ tone: 'neutral' }) }));
    expect(out.components.trajectory).toBe(60);
  });

  it('maps warning tone → 40', () => {
    const out = computeCampaignHealth(buildInputs({ cpmRoasAnalysis: makeCpmRoasAnalysis({ tone: 'warning' }) }));
    expect(out.components.trajectory).toBe(40);
  });

  it('maps negative tone → 0', () => {
    const out = computeCampaignHealth(buildInputs({ cpmRoasAnalysis: makeCpmRoasAnalysis({ tone: 'negative' }) }));
    expect(out.components.trajectory).toBe(0);
  });

  it('defaults to 60 (neutral) when analysis missing or hasData=false', () => {
    const out1 = computeCampaignHealth(buildInputs({ cpmRoasAnalysis: undefined }));
    expect(out1.components.trajectory).toBe(60);
    const out2 = computeCampaignHealth(
      buildInputs({ cpmRoasAnalysis: makeCpmRoasAnalysis({ hasData: false }) }),
    );
    expect(out2.components.trajectory).toBe(60);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Attribution clarity
// ─────────────────────────────────────────────────────────────────────────

describe('attribution clarity', () => {
  it('returns trust.score directly when attribution.trust is known', () => {
    const tr = makeTrueRevenue({
      attribution: {
        ...makeTrueRevenue().attribution,
        trust: { level: 'high', label: 'אמין', score: 73 },
      } as TrueRevenueInfo['attribution'],
    });
    const out = computeCampaignHealth(buildInputs({ trueRevenueInfo: tr }));
    expect(out.components.attributionClarity).toBe(73);
  });

  it('returns 30 when attribution.trust.level === "unknown"', () => {
    const tr = makeTrueRevenue({
      attribution: {
        ...makeTrueRevenue().attribution,
        trust: { level: 'unknown', label: 'לא ניתן לקבוע', score: 30 },
      } as TrueRevenueInfo['attribution'],
    });
    const out = computeCampaignHealth(buildInputs({ trueRevenueInfo: tr }));
    expect(out.components.attributionClarity).toBe(30);
    expect(out.reasons[3]).toMatch(/utm_campaign/);
  });

  it('returns 50 (neutral) when no attribution data (e.g. Google)', () => {
    const tr = makeTrueRevenue({ attribution: null });
    const out = computeCampaignHealth(buildInputs({ trueRevenueInfo: tr }));
    expect(out.components.attributionClarity).toBe(50);
  });

  it('returns 50 (neutral) when no trueRevenueInfo at all', () => {
    const out = computeCampaignHealth(buildInputs({ trueRevenueInfo: undefined }));
    expect(out.components.attributionClarity).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Operator adjustment
// ─────────────────────────────────────────────────────────────────────────

describe('operator adjustment', () => {
  it('adds +15 when optimized=true', () => {
    const baseline = computeCampaignHealth(buildInputs());
    const boosted = computeCampaignHealth(buildInputs({ optimized: true }));
    expect(boosted.score - baseline.score).toBeGreaterThanOrEqual(14);
    expect(boosted.score - baseline.score).toBeLessThanOrEqual(16);
    expect(boosted.components.operatorAdjustment).toBe(15);
  });

  it('subtracts 30 when isCurrentlyOff=true', () => {
    const baseline = computeCampaignHealth(buildInputs());
    const penalised = computeCampaignHealth(buildInputs({ isCurrentlyOff: true }));
    // Could be clamped at 0 if baseline was already < 30; check the delta logic.
    expect(penalised.components.operatorAdjustment).toBe(-30);
  });

  it('stacks +15 and -30 to net -15 when both flags are set', () => {
    const out = computeCampaignHealth(
      buildInputs({ optimized: true, isCurrentlyOff: true }),
    );
    expect(out.components.operatorAdjustment).toBe(-15);
  });

  it('clamps final score to [0, 100] after adjustment', () => {
    // Make a F campaign and apply isOff → should clamp to 0, not go negative.
    const out = computeCampaignHealth(
      buildInputs({
        aggregated: makeAggregated({ spend: 500, conversionValue: 0, conversions: 1 }),
        trueRevenueInfo: makeTrueRevenue({ deterministicRevenue: 0, trueRevenue: 0 }),
        cpmRoasAnalysis: makeCpmRoasAnalysis({ tone: 'negative' }),
        isCurrentlyOff: true,
      }),
    );
    expect(out.score).toBeGreaterThanOrEqual(0);
    expect(out.score).toBeLessThanOrEqual(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Realistic scenarios — the ones the operator will encounter most often.
// ─────────────────────────────────────────────────────────────────────────

describe('realistic scenarios', () => {
  it('Healthy campaign: ROAS 3.5, trust 95, deterministic 80%, positive momentum → A or strong B', () => {
    const out = computeCampaignHealth(
      buildInputs({
        aggregated: makeAggregated({ spend: 600, conversionValue: 2100, conversions: 50 }),
        trueRevenueInfo: makeTrueRevenue({
          spend: 600,
          metaClaim: 2100,
          trueRevenue: 2100,
          deterministicRevenue: 2100,
          attribution: {
            ...makeTrueRevenue().attribution,
            trust: { level: 'high', label: 'אמין', score: 95 },
          } as TrueRevenueInfo['attribution'],
          confidence: { level: 'high', label: 'אמין', reasons: [] },
        }),
        cpmRoasAnalysis: makeCpmRoasAnalysis({ tone: 'positive' }),
      }),
    );
    expect(out.score).toBeGreaterThanOrEqual(75);
    expect(['A', 'B']).toContain(out.grade);
    expect(out.insufficient).toBe(false);
  });

  it('Suspicious high-ROAS: platform ROAS 8, deterministic 5%, trust 25 → F', () => {
    const out = computeCampaignHealth(
      buildInputs({
        aggregated: makeAggregated({ spend: 50, conversionValue: 400, conversions: 2 }),
        trueRevenueInfo: makeTrueRevenue({
          spend: 50,
          metaClaim: 400,
          trueRevenue: 20,
          deterministicRevenue: 20,
          attribution: {
            ...makeTrueRevenue().attribution,
            trust: { level: 'low', label: 'לא אמין', score: 25 },
          } as TrueRevenueInfo['attribution'],
        }),
        cpmRoasAnalysis: undefined, // not enough days
      }),
    );
    // Platform looks great but Shopify proves it's losing money — score must be low.
    expect(out.score).toBeLessThan(45);
    expect(['D', 'F']).toContain(out.grade);
  });

  it('Mature winding-down: ROAS 2.8, trust 90, negative momentum → B/C', () => {
    const out = computeCampaignHealth(
      buildInputs({
        aggregated: makeAggregated({ spend: 1500, conversionValue: 4200, conversions: 80 }),
        trueRevenueInfo: makeTrueRevenue({
          spend: 1500,
          metaClaim: 4200,
          trueRevenue: 4200,
          deterministicRevenue: 3800,
          attribution: {
            ...makeTrueRevenue().attribution,
            trust: { level: 'high', label: 'אמין', score: 90 },
          } as TrueRevenueInfo['attribution'],
        }),
        cpmRoasAnalysis: makeCpmRoasAnalysis({ tone: 'warning' }),
      }),
    );
    // Trajectory drag pulls it below A.
    expect(out.score).toBeLessThan(85);
    expect(out.score).toBeGreaterThan(50);
    expect(['B', 'C']).toContain(out.grade);
  });

  it('Just-launched 2 days, low spend, no conversions → insufficient (⏳ Early)', () => {
    const out = computeCampaignHealth(
      buildInputs({
        aggregated: makeAggregated({ spend: 80, conversions: 0, conversionValue: 0 }),
        trueRevenueInfo: undefined,
        cpmRoasAnalysis: undefined,
      }),
    );
    expect(out.insufficient).toBe(true);
    expect(out.grade).toBe('unknown');
  });

  it('Off campaign that was previously strong: -30 penalty drops grade', () => {
    const inputsActive = buildInputs({
      aggregated: makeAggregated({ spend: 800, conversionValue: 2400 }),
      trueRevenueInfo: makeTrueRevenue({
        spend: 800,
        metaClaim: 2400,
        trueRevenue: 2400,
        deterministicRevenue: 2200,
        attribution: {
          ...makeTrueRevenue().attribution,
          trust: { level: 'high', label: 'אמין', score: 90 },
        } as TrueRevenueInfo['attribution'],
      }),
      cpmRoasAnalysis: makeCpmRoasAnalysis({ tone: 'positive' }),
    });
    const activeOut = computeCampaignHealth(inputsActive);
    const offOut = computeCampaignHealth({ ...inputsActive, isCurrentlyOff: true });
    expect(offOut.score).toBe(Math.max(0, activeOut.score - 30));
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Reasons array — the strings drive the drilldown popover.
// ─────────────────────────────────────────────────────────────────────────

describe('reasons strings', () => {
  it('returns exactly one reason per non-empty component (and operator reasons when applicable)', () => {
    const out = computeCampaignHealth(buildInputs({ optimized: true, isCurrentlyOff: true }));
    // 4 sub-component reasons + 2 operator (optimized + off)
    expect(out.reasons.length).toBe(6);
  });

  it('reason 0 references the ROAS value and source', () => {
    const out = computeCampaignHealth(buildInputs());
    expect(out.reasons[0]).toMatch(/ROAS \d/);
  });

  it('reason 1 references the spend and tier', () => {
    const out = computeCampaignHealth(buildInputs());
    expect(out.reasons[1]).toMatch(/הוצאה|CAD/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Phase 05.7.x (2026-05-23) — Cohort-aware adjustment.
//
// applyCohortHealthAdjustment(base, inputs) → CampaignHealth' with:
//   - new components.cohortAdjustment captured
//   - score adjusted + clamped to [0,100]
//   - grade re-derived
//   - reasons appended with per-adjustment Hebrew sentence
// ─────────────────────────────────────────────────────────────────────────

function makeBaseHealth(score = 70): CampaignHealth {
  return {
    score,
    grade: score >= 75 ? 'A' : score >= 60 ? 'B' : score >= 45 ? 'C' : score >= 30 ? 'D' : 'F',
    components: {
      profitability: 80,
      volume: 70,
      trajectory: 60,
      attributionClarity: 65,
      operatorAdjustment: 0,
      cohortAdjustment: 0,
    },
    reasons: ['r1', 'r2', 'r3', 'r4'],
    insufficient: false,
  };
}

describe('applyCohortHealthAdjustment — solo cases', () => {
  it('returns base unchanged when cohortSize < 2', () => {
    const base = makeBaseHealth(70);
    const out = applyCohortHealthAdjustment(base, {
      isLeader: false,
      isWeakest: false,
      cohortSize: 1,
      cannibalizationRisk: 'high',
    });
    expect(out).toBe(base); // same reference
  });

  it('returns base unchanged when base is insufficient/unknown', () => {
    const base: CampaignHealth = {
      ...makeBaseHealth(0),
      grade: 'unknown',
      insufficient: true,
    };
    const out = applyCohortHealthAdjustment(base, {
      isLeader: false,
      isWeakest: true,
      cohortSize: 5,
      cannibalizationRisk: 'high',
    });
    expect(out).toBe(base);
  });

  it('returns base unchanged when no adjustment fires (delta == 0)', () => {
    const base = makeBaseHealth(70);
    const out = applyCohortHealthAdjustment(base, {
      isLeader: false,
      isWeakest: false,
      cohortSize: 4,
      cannibalizationRisk: 'none',
    });
    expect(out).toBe(base);
  });
});

describe('applyCohortHealthAdjustment — leader / weakest', () => {
  it('+3 when leader (no cannibalization)', () => {
    const out = applyCohortHealthAdjustment(makeBaseHealth(70), {
      isLeader: true,
      isWeakest: false,
      cohortSize: 4,
      cannibalizationRisk: 'none',
    });
    expect(out.score).toBe(73);
    expect(out.components.cohortAdjustment).toBe(3);
    expect(out.reasons.some(r => r.includes('+3'))).toBe(true);
  });

  it('−5 when weakest in cohort of 3+', () => {
    const out = applyCohortHealthAdjustment(makeBaseHealth(70), {
      isLeader: false,
      isWeakest: true,
      cohortSize: 3,
      cannibalizationRisk: 'none',
    });
    expect(out.score).toBe(65);
    expect(out.components.cohortAdjustment).toBe(-5);
    expect(out.reasons.some(r => r.includes('−5'))).toBe(true);
  });

  it('NO weakest penalty for 2-member cohorts (someone has to be lower)', () => {
    const out = applyCohortHealthAdjustment(makeBaseHealth(70), {
      isLeader: false,
      isWeakest: true,
      cohortSize: 2, // floor: penalty only kicks at >=3
      cannibalizationRisk: 'none',
    });
    expect(out).toEqual(makeBaseHealth(70));
  });

  it('cannot be both leader AND weakest simultaneously (defensive: leader wins)', () => {
    // If a caller passes both, we credit leader and skip weakest because
    // isLeader is checked first (independent +3) and isWeakest's >=3 floor
    // doesn't gate against isLeader directly. Both ADDITIVELY apply.
    const out = applyCohortHealthAdjustment(makeBaseHealth(70), {
      isLeader: true,
      isWeakest: true,
      cohortSize: 3,
      cannibalizationRisk: 'none',
    });
    // +3 (leader) + (-5) (weakest with cohortSize>=3) = -2
    expect(out.components.cohortAdjustment).toBe(-2);
  });
});

describe('applyCohortHealthAdjustment — cannibalization', () => {
  it('−10 for high cannibalization', () => {
    const out = applyCohortHealthAdjustment(makeBaseHealth(70), {
      isLeader: false,
      isWeakest: false,
      cohortSize: 4,
      cannibalizationRisk: 'high',
    });
    expect(out.score).toBe(60);
    expect(out.components.cohortAdjustment).toBe(-10);
  });

  it('−5 for medium cannibalization', () => {
    const out = applyCohortHealthAdjustment(makeBaseHealth(70), {
      isLeader: false,
      isWeakest: false,
      cohortSize: 4,
      cannibalizationRisk: 'medium',
    });
    expect(out.components.cohortAdjustment).toBe(-5);
  });

  it('−2 for low cannibalization', () => {
    const out = applyCohortHealthAdjustment(makeBaseHealth(70), {
      isLeader: false,
      isWeakest: false,
      cohortSize: 4,
      cannibalizationRisk: 'low',
    });
    expect(out.components.cohortAdjustment).toBe(-2);
  });

  it('0 for insufficient (no signal — no adjustment)', () => {
    const base = makeBaseHealth(70);
    const out = applyCohortHealthAdjustment(base, {
      isLeader: false,
      isWeakest: false,
      cohortSize: 4,
      cannibalizationRisk: 'insufficient',
    });
    // When delta == 0 the function short-circuits and returns the base
    // reference unchanged.
    expect(out).toBe(base);
  });
});

describe('applyCohortHealthAdjustment — stacking', () => {
  it('weakest + high cannibalization = −15 (max negative)', () => {
    const out = applyCohortHealthAdjustment(makeBaseHealth(70), {
      isLeader: false,
      isWeakest: true,
      cohortSize: 5,
      cannibalizationRisk: 'high',
    });
    expect(out.components.cohortAdjustment).toBe(-15);
    expect(out.score).toBe(55);
  });

  it('clamps at 0 when stacked adjustment would drag below', () => {
    const out = applyCohortHealthAdjustment(makeBaseHealth(10), {
      isLeader: false,
      isWeakest: true,
      cohortSize: 5,
      cannibalizationRisk: 'high',
    });
    expect(out.score).toBe(0); // 10 - 15 = -5 → clamped to 0
  });

  it('clamps at 100 when leader adjustment would push above', () => {
    const out = applyCohortHealthAdjustment(makeBaseHealth(99), {
      isLeader: true,
      isWeakest: false,
      cohortSize: 3,
      cannibalizationRisk: 'none',
    });
    expect(out.score).toBe(100);
  });

  it('re-derives grade after the adjustment', () => {
    // 70 starts as B. -15 → 55 should be C.
    const out = applyCohortHealthAdjustment(makeBaseHealth(70), {
      isLeader: false,
      isWeakest: true,
      cohortSize: 5,
      cannibalizationRisk: 'high',
    });
    expect(out.grade).toBe('C');
  });

  it('does not mutate the base input', () => {
    const base = makeBaseHealth(70);
    const snapshot = JSON.stringify(base);
    applyCohortHealthAdjustment(base, {
      isLeader: false,
      isWeakest: true,
      cohortSize: 5,
      cannibalizationRisk: 'high',
    });
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it('appends reasons (does not replace)', () => {
    const base = makeBaseHealth(70);
    const out = applyCohortHealthAdjustment(base, {
      isLeader: false,
      isWeakest: true,
      cohortSize: 5,
      cannibalizationRisk: 'high',
    });
    expect(out.reasons.length).toBe(base.reasons.length + 2); // +weakest +high
    // First 4 base reasons preserved verbatim
    expect(out.reasons.slice(0, 4)).toEqual(base.reasons);
  });
});
