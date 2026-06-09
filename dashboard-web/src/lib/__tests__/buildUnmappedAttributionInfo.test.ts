/**
 * buildUnmappedAttributionInfo.test.ts — 2026-06-09
 *
 * Pins the campaigns-TABLE Google PMax fix. The canonical `analyzeAttribution`
 * already supports Google at campaign grain (T0, 2026-06-02), and the
 * CampaignDrawer already renders Google's deterministic attribution — but the
 * Campaigns TABLE hid it because `useCampaignTrueRevenue` short-circuits any
 * campaign with no product mapping (`mappedIds.length === 0 → continue`), and
 * Google PMax can never be product-mapped (the picker is Meta/TikTok-only).
 *
 * `buildUnmappedAttributionInfo` is the pure decision the hook now applies in
 * that gate: for an UNMAPPED campaign with a real deterministic match, emit an
 * attribution-only TrueRevenueInfo so the table cell's `useAttr` path renders
 * the deterministic ROAS + trust. Scope is GOOGLE ONLY (operator decision
 * 2026-06-09) — unmapped Meta/TikTok rows stay byte-identical ("—" + the
 * map-products nudge).
 */

import { describe, expect, it } from 'vitest';
import { buildUnmappedAttributionInfo } from '@/lib/hooks/useCampaignTrueRevenue';
import type { AttributionAnalysis } from '@/lib/attributionAnalysis';

function makeAttribution(overrides: Partial<AttributionAnalysis> = {}): AttributionAnalysis {
  return {
    deterministicRevenue: 120,
    deterministicOrders: 2,
    modeledRevenue: 0,
    coverage: 1.2,
    coverageExceedsClamp: false,
    trust: { level: 'high', label: 'אמין', score: 92 },
    reasons: [],
    recommendation: '',
    roasInterval: null,
    windowStability: null,
    outlierDays: [],
    ...overrides,
  };
}

const GOOGLE = { platform: 'Google', conversionValue: 100, spend: 50 };

describe('buildUnmappedAttributionInfo', () => {
  it('emits an attribution-only TrueRevenueInfo for an unmapped Google campaign with deterministic revenue', () => {
    const info = buildUnmappedAttributionInfo(GOOGLE, makeAttribution({ deterministicRevenue: 120 }));
    expect(info).not.toBeNull();
    expect(info!.trueRevenue).toBe(120); // → ROAS Det. = 120/50 = 2.4 in the table
    expect(info!.deterministicRevenue).toBe(120);
    expect(info!.mappedCount).toBe(0);
    expect(info!.metaClaim).toBe(100);
    expect(info!.spend).toBe(50);
    expect(info!.attribution).not.toBeNull();
    // No product allocation for an unmapped campaign.
    expect(info!.productTotals).toEqual({ revenue: 0, units: 0, orders: 0 });
  });

  it('returns null when attribution is null (no orders pipeline / no match)', () => {
    expect(buildUnmappedAttributionInfo(GOOGLE, null)).toBeNull();
  });

  it('with deterministicRevenue 0 still carries the verdict (Problem A — Health Score reads this; trueRevenue=0)', () => {
    // 2026-06-09: a 0-match Google campaign must surface its real "unknown"
    // verdict to the Health Score (not fall back to a 70% prior + stale
    // "probably Google"). So we now emit info with trueRevenue=0 carrying the
    // analysis, instead of returning null.
    const unknownAttr = makeAttribution({
      deterministicRevenue: 0,
      deterministicOrders: 0,
      trust: { level: 'unknown', label: 'לא ניתן לקבוע', score: 30 },
    });
    const info = buildUnmappedAttributionInfo(GOOGLE, unknownAttr);
    expect(info).not.toBeNull();
    expect(info!.trueRevenue).toBe(0);
    expect(info!.deterministicRevenue).toBe(0);
    expect(info!.attribution).toBe(unknownAttr); // same verdict object the panel shows
  });

  it('returns null when spend is 0 (no meaningful ROAS — avoids a divide-by-zero tooltip)', () => {
    const info = buildUnmappedAttributionInfo(
      { platform: 'Google', conversionValue: 100, spend: 0 },
      makeAttribution({ deterministicRevenue: 120 }),
    );
    expect(info).toBeNull();
  });

  it('returns null for unmapped Meta (Google-only scope — Meta/TikTok unchanged)', () => {
    const info = buildUnmappedAttributionInfo(
      { platform: 'Meta', conversionValue: 100, spend: 50 },
      makeAttribution({ deterministicRevenue: 200 }),
    );
    expect(info).toBeNull();
  });

  it('returns null for unmapped TikTok (Google-only scope)', () => {
    const info = buildUnmappedAttributionInfo(
      { platform: 'TikTok', conversionValue: 100, spend: 50 },
      makeAttribution({ deterministicRevenue: 200 }),
    );
    expect(info).toBeNull();
  });
});
