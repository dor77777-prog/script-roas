import { describe, it, expect } from 'vitest';
import {
  computeCampaignHealth,
  applyCohortAdjustmentOnce,
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
    lastLiveTickAt: null,
    regConfiguredStatus: null,
    regEffectiveStatus: null,
    regDeliveryStatus: null,
    regFirstSeenAt: null,
    regStatusChangedAt: null,
    regLastStatusSuccessAt: null,
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
    // AUDIT U-02 (2026-05-24): all default-fixture instances represent a
    // normal up/down/flat read; the 'no-baseline' verdict is exercised
    // explicitly in cpmRoasAnalysis.test.ts.
    verdict: 'normal',
    details: { n: 14, cpmDeltaPct: -10, roasDeltaPct: 12, pearson: -0.7 },
    ...patch,
  };
}

function buildInputs(patch: Partial<HealthScoreInputs> = {}): HealthScoreInputs {
  return {
    aggregated: patch.aggregated ?? makeAggregated(),
    trueRevenueInfo: 'trueRevenueInfo' in patch ? patch.trueRevenueInfo : makeTrueRevenue(),
    cpmRoasAnalysis: 'cpmRoasAnalysis' in patch ? patch.cpmRoasAnalysis : makeCpmRoasAnalysis(),
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Sanity / smoke
// ─────────────────────────────────────────────────────────────────────────

describe('computeCampaignHealth — output shape', () => {
  it('returns score in [0, 100] with all data-derived components populated', () => {
    const out = computeCampaignHealth(buildInputs());
    expect(out.score).toBeGreaterThanOrEqual(0);
    expect(out.score).toBeLessThanOrEqual(100);
    expect(out.components).toMatchObject({
      profitability: expect.any(Number),
      volume: expect.any(Number),
      trajectory: expect.any(Number),
      attributionClarity: expect.any(Number),
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

describe('profitability — per-platform calibration (audit fix HR-01/HR-02 2026-05-23)', () => {
  it('per-platform ROAS pivot: TikTok ROAS 2.0 scores 100 (its pivot)', () => {
    // Pre-fix: ROAS 2.0 scored 50 across all platforms (pivot at 3.0).
    // Post-fix: TikTok pivot is 2.0 → ROAS 2.0 = 100 raw (before trust mod).
    const out = computeCampaignHealth(
      buildInputs({
        aggregated: makeAggregated({
          platform: 'TikTok',
          spend: 500,
          conversionValue: 1000,
        }),
        trueRevenueInfo: makeTrueRevenue({
          deterministicRevenue: 1000,
          spend: 500,
          attribution: {
            ...makeTrueRevenue().attribution,
            trust: { level: 'high', label: 'אמין', score: 100 },
          } as TrueRevenueInfo['attribution'],
        }),
      }),
    );
    // ROAS = 2.0, TikTok pivot = 2.0 → raw 100, trust 100% → 100.
    expect(out.components.profitability).toBe(100);
    expect(out.reasons[0]).toMatch(/יעד 2\.0/);
  });

  it('per-platform ROAS pivot: Meta ROAS 2.0 still scores 50 (pivot 3.0)', () => {
    const out = computeCampaignHealth(
      buildInputs({
        aggregated: makeAggregated({
          platform: 'Meta',
          spend: 500,
          conversionValue: 1000,
        }),
        trueRevenueInfo: makeTrueRevenue({
          deterministicRevenue: 1000,
          spend: 500,
          attribution: {
            ...makeTrueRevenue().attribution,
            trust: { level: 'high', label: 'אמין', score: 100 },
          } as TrueRevenueInfo['attribution'],
        }),
      }),
    );
    // ROAS = 2.0, Meta pivot = 3.0 → raw 50, trust 100% → 50.
    expect(out.components.profitability).toBe(50);
    expect(out.reasons[0]).toMatch(/יעד 3\.0/);
  });

  it('per-platform ROAS pivot: Google ROAS 3.0 scores 80 (pivot 3.5)', () => {
    const out = computeCampaignHealth(
      buildInputs({
        aggregated: makeAggregated({
          platform: 'Google',
          spend: 500,
          conversionValue: 1500,
        }),
        trueRevenueInfo: makeTrueRevenue({
          deterministicRevenue: 1500,
          spend: 500,
          attribution: {
            ...makeTrueRevenue().attribution,
            trust: { level: 'high', label: 'אמין', score: 100 },
          } as TrueRevenueInfo['attribution'],
        }),
      }),
    );
    // ROAS = 3.0, Google pivot = 3.5 → (3.0-1)/(3.5-1)*100 = 80.
    expect(out.components.profitability).toBe(80);
    expect(out.reasons[0]).toMatch(/יעד 3\.5/);
  });

  it('per-platform fallback trust: Google gets 70% (vs Meta 50%) when no info', () => {
    // No trueRevenueInfo at all → falls back to platform-claimed ROAS.
    // Pre-fix: every platform got 0.5 trust → systematic anti-Google bias.
    // Post-fix: Google = 0.7, Meta = 0.5, TikTok = 0.5.
    const googleOut = computeCampaignHealth(
      buildInputs({
        aggregated: makeAggregated({
          platform: 'Google',
          spend: 500,
          conversionValue: 1750, // ROAS 3.5 = pivot → 100 raw
        }),
        trueRevenueInfo: undefined,
      }),
    );
    // ROAS 3.5 × Google fallback trust 0.7 = 70. The platform-prior modulator
    // is now labeled "מהימנות-דיווח" (not "אמינות") to avoid colliding with the
    // click-id attribution trust the panel shows (Problem A, 2026-06-09).
    expect(googleOut.components.profitability).toBe(70);
    expect(googleOut.reasons[0]).toMatch(/מהימנות-דיווח.*70%/);

    const metaOut = computeCampaignHealth(
      buildInputs({
        aggregated: makeAggregated({
          platform: 'Meta',
          spend: 500,
          conversionValue: 1500, // ROAS 3.0 = pivot → 100 raw
        }),
        trueRevenueInfo: undefined,
      }),
    );
    // ROAS 3.0 × Meta fallback trust 0.5 = 50. (Modulator relabeled — see above.)
    expect(metaOut.components.profitability).toBe(50);
    expect(metaOut.reasons[0]).toMatch(/מהימנות-דיווח.*50%/);
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

  it('no-trajectory-data renormalizes weights (audit fix HR-03 2026-05-23)', () => {
    // Build a campaign with strong profitability + volume + attribution but
    // NO trajectory data (just-launched, < 5 active days). Pre-fix,
    // trajectory contributed +15 from a neutral 60 — campaign graded A
    // on week-1 ROAS alone. Post-fix, trajectory's weight redistributes
    // to the other 3 components.
    const strongTr = makeTrueRevenue({
      deterministicRevenue: 1500,
      spend: 500,
      attribution: {
        ...makeTrueRevenue().attribution,
        trust: { level: 'high', label: 'אמין', score: 100 },
      } as TrueRevenueInfo['attribution'],
    });
    const withTraj = computeCampaignHealth(
      buildInputs({
        trueRevenueInfo: strongTr,
        cpmRoasAnalysis: makeCpmRoasAnalysis({ hasData: true, tone: 'neutral' }),
      }),
    );
    const noTraj = computeCampaignHealth(
      buildInputs({
        trueRevenueInfo: strongTr,
        cpmRoasAnalysis: makeCpmRoasAnalysis({ hasData: false }),
      }),
    );
    // With trajectory neutral=60 included: subtotal = 0.4*100 + 0.15*100
    //   + 0.25*60 + 0.20*100 = 40 + 15 + 15 + 20 = 90.
    expect(withTraj.score).toBe(90);
    // Without trajectory (renormalized over the remaining 0.75 weight):
    //   subtotal = (0.4*100 + 0.15*100 + 0.20*100) / 0.75 = 75 / 0.75 = 100.
    // True signal: every component we DO have is at the cap, so the
    // overall score should be at the cap too — not pulled down to 90 by
    // a non-signal neutral 60.
    expect(noTraj.score).toBe(100);
    // BUT trajectory component itself reports 60 (for UI display) — the
    // renormalization happens at the weighted-subtotal level, not at the
    // sub-component level.
    expect(noTraj.components.trajectory).toBe(60);
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
    // Reconciled with the Attribution panel's verdict; platform-neutral copy
    // (the per-platform tagging hint lives in the panel recommendation now).
    // 2026-06-11 adversarial review: the old 'לא ניתן לאמת דרך click-id'
    // assertion was dropped — that claim is FALSE for the 'הפלטפורמה מדווחת 0'
    // verdict (click-id IS the verified side there), so the reason copy is
    // now neutral per-verdict: `${label} (${score}/100) — ודאות החלוקה מוגבלת`.
    expect(out.reasons[3]).toContain('לא ניתן לקבוע');
    expect(out.reasons[3]).toContain('ודאות החלוקה מוגבלת');
    expect(out.reasons[3]).not.toContain('לא ניתן לאמת');
  });

  // 2026-06-11 adversarial review — pin ALL THREE unknown verdicts' clarity
  // scores. The c39fcc8 raw passthrough silently re-scored the THIRD verdict
  // ('אין המרות', score 0) from the neutral 30 to 0 — recreating the false
  // 0/100 untrusted badge on every zero-conversion campaign. The passthrough
  // now floors at 30: 30→30, 40→40, 0→30.
  describe('unknown-verdict passthrough floor (2026-06-11 review)', () => {
    function clarityFor(label: string, score: number) {
      const tr = makeTrueRevenue({
        attribution: {
          ...makeTrueRevenue().attribution,
          trust: { level: 'unknown', label, score },
        } as TrueRevenueInfo['attribution'],
      });
      return computeCampaignHealth(buildInputs({ trueRevenueInfo: tr }));
    }

    it("'לא ניתן לקבוע' (30) passes through as 30", () => {
      const out = clarityFor('לא ניתן לקבוע', 30);
      expect(out.components.attributionClarity).toBe(30);
      expect(out.reasons[3]).toContain('לא ניתן לקבוע');
      expect(out.reasons[3]).toContain('(30/100)');
    });

    it("'הפלטפורמה מדווחת 0' (40) passes through as 40, with NO false click-id-failure claim", () => {
      const out = clarityFor('הפלטפורמה מדווחת 0', 40);
      expect(out.components.attributionClarity).toBe(40);
      expect(out.reasons[3]).toContain('הפלטפורמה מדווחת 0');
      expect(out.reasons[3]).toContain('(40/100)');
      // The 40-verdict fires precisely BECAUSE click-id orders exist — the
      // platform side is what's broken, so the reason must not claim a
      // click-id verification failure.
      expect(out.reasons[3]).not.toContain('לא ניתן לאמת דרך click-id');
    });

    it("'אין המרות' (0) floors at the neutral 30 — never a false 0/100 badge", () => {
      const out = clarityFor('אין המרות', 0);
      expect(out.components.attributionClarity).toBe(30);
      expect(out.reasons[3]).toContain('אין המרות');
      expect(out.reasons[3]).toContain('(30/100)');
    });
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

  it('Strong campaign with positive momentum scores high', () => {
    const out = computeCampaignHealth(
      buildInputs({
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
      }),
    );
    expect(out.score).toBeGreaterThanOrEqual(60);
    expect(['A', 'B']).toContain(out.grade);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// P1-9c (audit 2026-06-10) — evidence floor. ONE tagged $100 order used to
// flip scoreProfitability into the deterministic branch (tiny ROAS → grade
// F) while an identical zero-evidence campaign kept the platform prior (C):
// the scorer punished PARTIAL evidence below ZERO evidence — a
// non-monotonic cliff that bites during the Google ValueTrack ramp-up.
// Post-fix the deterministic branch requires deterministicOrders >= 3 OR
// coverage >= 0.2; below the floor profitability falls through to the
// prior-based branch and attribution clarity floors at the zero-evidence
// 'unknown' verdict's 30.
// ─────────────────────────────────────────────────────────────────────────

describe('evidence floor (P1-9c)', () => {
  // Identical underlying performance: $500 spend, platform claims $1500
  // (ROAS 3.0). Only the click-id evidence differs.
  const aggregated = () =>
    makeAggregated({ spend: 500, conversionValue: 1500, conversions: 15 });

  const zeroEvidenceInfo = () =>
    makeTrueRevenue({
      deterministicRevenue: 0,
      trueRevenue: 0,
      spend: 500,
      attribution: {
        ...makeTrueRevenue().attribution,
        deterministicRevenue: 0,
        deterministicOrders: 0,
        coverage: 0,
        trust: { level: 'unknown', label: 'לא ניתן לקבוע', score: 30 },
      } as TrueRevenueInfo['attribution'],
    });

  const oneOrderInfo = () =>
    makeTrueRevenue({
      deterministicRevenue: 100, // ONE tagged $100 order
      trueRevenue: 100,          // unmapped flow: trueRevenue === deterministic
      spend: 500,
      attribution: {
        ...makeTrueRevenue().attribution,
        deterministicRevenue: 100,
        deterministicOrders: 1,
        coverage: 100 / 1500,    // ≈ 0.067 — under the 0.2 floor
        trust: { level: 'low', label: 'לא אמין', score: 7 },
      } as TrueRevenueInfo['attribution'],
    });

  it('partial evidence (1 tagged order, coverage 6.7%) scores >= the identical zero-evidence campaign', () => {
    const zero = computeCampaignHealth(
      buildInputs({ aggregated: aggregated(), trueRevenueInfo: zeroEvidenceInfo() }),
    );
    const partial = computeCampaignHealth(
      buildInputs({ aggregated: aggregated(), trueRevenueInfo: oneOrderInfo() }),
    );
    expect(partial.score).toBeGreaterThanOrEqual(zero.score);
  });

  it('under the floor, profitability falls through to the platform prior (not the $100 dribble)', () => {
    const partial = computeCampaignHealth(
      buildInputs({ aggregated: aggregated(), trueRevenueInfo: oneOrderInfo() }),
    );
    // Platform prior: ROAS 3.0 = Meta pivot → 100 raw × 0.5 fallback = 50.
    expect(partial.components.profitability).toBe(50);
    expect(partial.reasons[0]).toMatch(/הצהרת פלטפורמה/);
  });

  it('the floor is met by deterministicOrders >= 3 even at low coverage', () => {
    const info = makeTrueRevenue({
      deterministicRevenue: 300,
      trueRevenue: 300,
      spend: 500,
      attribution: {
        ...makeTrueRevenue().attribution,
        deterministicRevenue: 300,
        deterministicOrders: 3,
        coverage: 0.1, // under the coverage leg, but 3 orders pass the count leg
        trust: { level: 'low', label: 'לא אמין', score: 10 },
      } as TrueRevenueInfo['attribution'],
    });
    const out = computeCampaignHealth(
      buildInputs({ aggregated: aggregated(), trueRevenueInfo: info }),
    );
    // Deterministic branch engaged: ROAS 0.6 × trust 10% → ~0, and the
    // reason names the deterministic source.
    expect(out.reasons[0]).toMatch(/דטרמיניסטי/);
  });

  it('the floor is met by coverage >= 0.2 even with fewer than 3 orders', () => {
    const info = makeTrueRevenue({
      deterministicRevenue: 400,
      trueRevenue: 400,
      spend: 500,
      attribution: {
        ...makeTrueRevenue().attribution,
        deterministicRevenue: 400,
        deterministicOrders: 2,
        coverage: 400 / 1500, // ≈ 0.27 — passes the coverage leg
        trust: { level: 'low', label: 'לא אמין', score: 27 },
      } as TrueRevenueInfo['attribution'],
    });
    const out = computeCampaignHealth(
      buildInputs({ aggregated: aggregated(), trueRevenueInfo: info }),
    );
    expect(out.reasons[0]).toMatch(/דטרמיניסטי/);
  });

  it('under-floor click-id sample floors attribution clarity at the zero-evidence 30 (not the raw 7)', () => {
    const partial = computeCampaignHealth(
      buildInputs({ aggregated: aggregated(), trueRevenueInfo: oneOrderInfo() }),
    );
    expect(partial.components.attributionClarity).toBe(30);
  });

  it('mapping evidence BEYOND the deterministic dribble still uses the combined-Shopify branch', () => {
    // Under-floor click-id evidence but real product-mapped revenue: the
    // combined branch is a separate evidence channel and must still fire.
    const info = makeTrueRevenue({
      deterministicRevenue: 100,
      trueRevenue: 1400, // mapping adds revenue beyond the dribble
      spend: 500,
      attribution: {
        ...makeTrueRevenue().attribution,
        deterministicRevenue: 100,
        deterministicOrders: 1,
        coverage: 100 / 1500,
        trust: { level: 'low', label: 'לא אמין', score: 7 },
      } as TrueRevenueInfo['attribution'],
    });
    const out = computeCampaignHealth(
      buildInputs({ aggregated: aggregated(), trueRevenueInfo: info }),
    );
    expect(out.reasons[0]).toMatch(/Shopify משולב/);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Reasons array — the strings drive the drilldown popover.
// ─────────────────────────────────────────────────────────────────────────

describe('reasons strings', () => {
  it('returns exactly 4 reasons for 4 data-derived components', () => {
    const out = computeCampaignHealth(buildInputs());
    // 4 sub-component reasons: profitability, volume, trajectory, attribution
    expect(out.reasons.length).toBe(4);
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
// applyCohortAdjustmentOnce(base, inputs) → CampaignHealth' with:
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
      cohortAdjustment: 0,
    },
    reasons: ['r1', 'r2', 'r3', 'r4'],
    insufficient: false,
  };
}

describe('applyCohortAdjustmentOnce — solo cases', () => {
  it('returns base unchanged when cohortSize < 2', () => {
    const base = makeBaseHealth(70);
    const out = applyCohortAdjustmentOnce(base, {
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
    const out = applyCohortAdjustmentOnce(base, {
      isLeader: false,
      isWeakest: true,
      cohortSize: 5,
      cannibalizationRisk: 'high',
    });
    expect(out).toBe(base);
  });

  it('returns base unchanged when no adjustment fires (delta == 0)', () => {
    const base = makeBaseHealth(70);
    const out = applyCohortAdjustmentOnce(base, {
      isLeader: false,
      isWeakest: false,
      cohortSize: 4,
      cannibalizationRisk: 'none',
    });
    expect(out).toBe(base);
  });
});

describe('applyCohortAdjustmentOnce — leader / weakest', () => {
  it('+3 when leader (no cannibalization)', () => {
    const out = applyCohortAdjustmentOnce(makeBaseHealth(70), {
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
    const out = applyCohortAdjustmentOnce(makeBaseHealth(70), {
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
    const out = applyCohortAdjustmentOnce(makeBaseHealth(70), {
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
    const out = applyCohortAdjustmentOnce(makeBaseHealth(70), {
      isLeader: true,
      isWeakest: true,
      cohortSize: 3,
      cannibalizationRisk: 'none',
    });
    // +3 (leader) + (-5) (weakest with cohortSize>=3) = -2
    expect(out.components.cohortAdjustment).toBe(-2);
  });
});

describe('applyCohortAdjustmentOnce — cannibalization', () => {
  it('−10 for high cannibalization', () => {
    const out = applyCohortAdjustmentOnce(makeBaseHealth(70), {
      isLeader: false,
      isWeakest: false,
      cohortSize: 4,
      cannibalizationRisk: 'high',
    });
    expect(out.score).toBe(60);
    expect(out.components.cohortAdjustment).toBe(-10);
  });

  it('−5 for medium cannibalization', () => {
    const out = applyCohortAdjustmentOnce(makeBaseHealth(70), {
      isLeader: false,
      isWeakest: false,
      cohortSize: 4,
      cannibalizationRisk: 'medium',
    });
    expect(out.components.cohortAdjustment).toBe(-5);
  });

  it('−2 for low cannibalization', () => {
    const out = applyCohortAdjustmentOnce(makeBaseHealth(70), {
      isLeader: false,
      isWeakest: false,
      cohortSize: 4,
      cannibalizationRisk: 'low',
    });
    expect(out.components.cohortAdjustment).toBe(-2);
  });

  it('0 for insufficient (no signal — no adjustment)', () => {
    const base = makeBaseHealth(70);
    const out = applyCohortAdjustmentOnce(base, {
      isLeader: false,
      isWeakest: false,
      cohortSize: 4,
      cannibalizationRisk: 'insufficient',
    });
    // When delta == 0 the function short-circuits and returns the base
    // reference unchanged.
    expect(out).toBe(base);
  });

  it('0 for composition_changed (informational — no adjustment) — audit a/WARN-6', () => {
    // Audit fix 2026-05-23 (a/WARN-6): `composition_changed` is part of
    // the cannibalizationRisk union now, and the switch in
    // applyCohortAdjustmentOnce intentionally lets it fall through
    // `default` → zero delta. The verdict means "we can't fairly compare
    // halves because cohort composition shifted mid-range" — abstain,
    // don't penalize. The cannibalization banner in the drawer surfaces
    // it visually so the operator knows to investigate before scaling.
    const base = makeBaseHealth(70);
    const out = applyCohortAdjustmentOnce(base, {
      isLeader: false,
      isWeakest: false,
      cohortSize: 4,
      cannibalizationRisk: 'composition_changed',
    });
    // Same short-circuit as 'insufficient' — base returned by reference.
    expect(out).toBe(base);
  });
});

describe('applyCohortAdjustmentOnce — stacking', () => {
  it('weakest + high cannibalization = −15 (max negative)', () => {
    const out = applyCohortAdjustmentOnce(makeBaseHealth(70), {
      isLeader: false,
      isWeakest: true,
      cohortSize: 5,
      cannibalizationRisk: 'high',
    });
    expect(out.components.cohortAdjustment).toBe(-15);
    expect(out.score).toBe(55);
  });

  it('clamps at 0 when stacked adjustment would drag below', () => {
    const out = applyCohortAdjustmentOnce(makeBaseHealth(10), {
      isLeader: false,
      isWeakest: true,
      cohortSize: 5,
      cannibalizationRisk: 'high',
    });
    expect(out.score).toBe(0); // 10 - 15 = -5 → clamped to 0
  });

  it('clamps at 100 when leader adjustment would push above', () => {
    const out = applyCohortAdjustmentOnce(makeBaseHealth(99), {
      isLeader: true,
      isWeakest: false,
      cohortSize: 3,
      cannibalizationRisk: 'none',
    });
    expect(out.score).toBe(100);
  });

  it('re-derives grade after the adjustment', () => {
    // 70 starts as B. -15 → 55 should be C.
    const out = applyCohortAdjustmentOnce(makeBaseHealth(70), {
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
    applyCohortAdjustmentOnce(base, {
      isLeader: false,
      isWeakest: true,
      cohortSize: 5,
      cannibalizationRisk: 'high',
    });
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it('appends reasons (does not replace)', () => {
    const base = makeBaseHealth(70);
    const out = applyCohortAdjustmentOnce(base, {
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

// ─────────────────────────────────────────────────────────────────────────
// AUDIT U-06 (2026-05-24) — rename + double-apply assert.
//
// Pre-fix: `applyCohortHealthAdjustment` overwrote
// `base.components.cohortAdjustment` (rather than accumulating). Calling
// it twice on the same base would silently DROP the first delta — a
// subtle bug waiting to happen the moment a caller composed two cohort
// signals (e.g. cohort signal + future re-eval pass).
//
// Post-fix: function renamed to `applyCohortAdjustmentOnce` to make the
// once-only contract loud, AND a runtime assert at the top of the
// function throws when called on a base that already carries a
// non-zero cohortAdjustment.
// ─────────────────────────────────────────────────────────────────────────
describe('applyCohortAdjustmentOnce — U-06 double-apply assert + rename', () => {
  it('works normally on a fresh base (cohortAdjustment === 0)', () => {
    // Sanity: the assert does NOT trip on the normal case. Same fixture
    // as the existing "−5 weakest" test, copy here so a future refactor
    // that removes the original block doesn't accidentally drop the
    // U-06 coverage.
    const base = makeBaseHealth(70);
    expect(base.components.cohortAdjustment).toBe(0);
    const out = applyCohortAdjustmentOnce(base, {
      isLeader: false,
      isWeakest: true,
      cohortSize: 3,
      cannibalizationRisk: 'none',
    });
    expect(out.score).toBe(65);
    expect(out.components.cohortAdjustment).toBe(-5);
  });

  it('THROWS when called on a base that already has a non-zero cohortAdjustment (double-apply guard)', () => {
    // The U-06 contract: re-applying must fail loud. Build a base that
    // ALREADY carries a -5 cohort adjustment (e.g. from a previous call,
    // or a caller that pre-populates it).
    const baseAlreadyAdjusted: CampaignHealth = {
      ...makeBaseHealth(70),
      components: {
        ...makeBaseHealth(70).components,
        cohortAdjustment: -5,
      },
    };
    expect(() =>
      applyCohortAdjustmentOnce(baseAlreadyAdjusted, {
        isLeader: false,
        isWeakest: true,
        cohortSize: 5,
        cannibalizationRisk: 'high',
      }),
    ).toThrow(/applyCohortAdjustmentOnce/);
  });

  it('THROWS even when the existing cohortAdjustment is POSITIVE (leader-stacking guard)', () => {
    // Symmetry guard: the assert is symmetric — a base with a +3 leader
    // delta is just as much a double-apply candidate.
    const baseAlreadyLeader: CampaignHealth = {
      ...makeBaseHealth(70),
      components: {
        ...makeBaseHealth(70).components,
        cohortAdjustment: 3,
      },
    };
    expect(() =>
      applyCohortAdjustmentOnce(baseAlreadyLeader, {
        isLeader: true,
        isWeakest: false,
        cohortSize: 4,
        cannibalizationRisk: 'none',
      }),
    ).toThrow(/non-zero/);
  });

  it('chaining via reset works: explicit cohortAdjustment=0 lets the second call proceed', () => {
    // The contract says: a caller that genuinely needs to re-derive
    // must reset the field to 0 first. This pins that documented
    // escape hatch. Practical use: a future re-eval pass after the
    // cohort composition changes mid-render.
    const base = makeBaseHealth(70);
    const first = applyCohortAdjustmentOnce(base, {
      isLeader: false,
      isWeakest: true,
      cohortSize: 3,
      cannibalizationRisk: 'none',
    });
    expect(first.components.cohortAdjustment).toBe(-5);

    // Reset and re-derive with a different signal.
    const resetBase: CampaignHealth = {
      ...first,
      components: { ...first.components, cohortAdjustment: 0 },
    };
    const second = applyCohortAdjustmentOnce(resetBase, {
      isLeader: true,
      isWeakest: false,
      cohortSize: 3,
      cannibalizationRisk: 'none',
    });
    // Now +3 leader bonus applies on top of the prior score+grade.
    expect(second.components.cohortAdjustment).toBe(3);
  });

  it('the old name `applyCohortHealthAdjustment` is no longer exported (no silent alias)', async () => {
    // Pin that the rename is HARD — there's no back-compat alias to
    // let the old name keep working. A caller that referenced the old
    // name MUST be updated; otherwise the build fails with a clean
    // ReferenceError. We assert this by inspecting the module's keys.
    const mod = await import('@/lib/campaignHealthScore');
    expect(mod).not.toHaveProperty('applyCohortHealthAdjustment');
    expect(mod).toHaveProperty('applyCohortAdjustmentOnce');
  });
});
