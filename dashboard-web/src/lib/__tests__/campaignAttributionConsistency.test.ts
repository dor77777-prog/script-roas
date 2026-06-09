/**
 * campaignAttributionConsistency.test.ts — 2026-06-09 (Problem A)
 *
 * The Campaign Health Score and the drawer's Attribution panel must tell ONE
 * story about a campaign's attribution certainty. Before this fix, an unmapped
 * Google campaign with 0 click-id matches produced:
 *   - Attribution panel (analyzeAttribution directly): trust 30 "לא ניתן לקבוע"
 *   - Health Score (trueRevenueInfo undefined): attribution-clarity neutral 50
 *     + stale reason "אין נתוני attribution (כנראה Google או שלא נסרק)", and a
 *     profitability modulator labeled "אמינות 70%".
 * → three conflicting trust figures (70/50/30) for one campaign.
 *
 * The fix threads the SAME analyzeAttribution verdict (via
 * buildUnmappedAttributionInfo) into the Health Score. This suite pins that the
 * Health Score's attribution component now EQUALS the analyzeAttribution trust,
 * the stale "probably Google" string is gone, and the profitability modulator
 * is no longer labeled with the colliding word "אמינות".
 */

import { describe, expect, it } from 'vitest';
import { analyzeAttribution } from '@/lib/attributionAnalysis';
import { buildUnmappedAttributionInfo } from '@/lib/hooks/useCampaignTrueRevenue';
import { computeCampaignHealth, type HealthScoreInputs } from '@/lib/campaignHealthScore';
import type { Aggregated } from '@/lib/campaignsAggregator';
import { makeOrder } from './fixtures';

const RANGE = { from: '2026-06-01', to: '2026-06-09' };

function googleAggregated(patch: Partial<Aggregated> = {}): Aggregated {
  return {
    key: 'uzoshop::Google::G1',
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    platform: 'Google',
    campaignId: 'G1',
    campaignName: 'PMax — Brand',
    adSetId: undefined,
    adSetName: undefined,
    spend: 111,
    impressions: 4000,
    clicks: 120,
    conversions: 2,
    conversionValue: 264, // platform ROAS 2.37
    campaignBudgetCad: null,
    adSetBudgetCad: null,
    budgetType: '',
    lastActiveDate: '2026-06-09',
    effectiveStatus: 'ENABLED',
    lastLiveTickAt: null,
    regConfiguredStatus: null,
    regEffectiveStatus: null,
    regDeliveryStatus: null,
    regFirstSeenAt: null,
    regStatusChangedAt: null,
    regLastStatusSuccessAt: null,
    ...patch,
  } as Aggregated;
}

describe('campaign attribution cross-panel consistency (Problem A)', () => {
  it('Health Score attribution component equals the analyzeAttribution verdict (30/unknown), no stale "probably Google"', () => {
    // Same inputs the drawer's Attribution panel uses: Google campaign,
    // metaClaim 264, a present-but-non-matching order → 0 click-id matches.
    const analysis = analyzeAttribution(
      { campaignName: 'PMax — Brand', campaignId: 'G1', storeId: 'uzoshop', platform: 'Google', metaClaim: 264, spend: 111 },
      [makeOrder({ source: 'direct', utmId: '', utmCampaign: '', storeId: 'uzoshop', totalCad: 50, date: '2026-06-05' })],
      RANGE.from,
      RANGE.to,
    );
    expect(analysis).not.toBeNull();
    expect(analysis!.trust.level).toBe('unknown');
    expect(analysis!.trust.score).toBe(30);

    // The Health Score reads this same verdict via buildUnmappedAttributionInfo.
    const info = buildUnmappedAttributionInfo(
      { platform: 'Google', conversionValue: 264, spend: 111 },
      analysis,
    )!;
    expect(info).not.toBeNull();

    const inputs: HealthScoreInputs = {
      aggregated: googleAggregated(),
      trueRevenueInfo: info,
      cpmRoasAnalysis: undefined,
    };
    const health = computeCampaignHealth(inputs);

    // attribution component (reasons[3]) reconciles to the panel's verdict.
    expect(health.components.attributionClarity).toBe(30);
    const attributionReason = health.reasons[3];
    expect(attributionReason).toContain('לא ניתן לקבוע');
    // The stale / conflicting strings must be gone.
    expect(attributionReason).not.toContain('כנראה Google');
    expect(attributionReason).not.toContain('נייטרלי');
  });

  it('profitability reason no longer labels its platform-prior modulator with the colliding word "אמינות"', () => {
    const analysis = analyzeAttribution(
      { campaignName: 'PMax — Brand', campaignId: 'G1', storeId: 'uzoshop', platform: 'Google', metaClaim: 264, spend: 111 },
      [makeOrder({ source: 'direct', utmId: '', utmCampaign: '', storeId: 'uzoshop', totalCad: 50, date: '2026-06-05' })],
      RANGE.from,
      RANGE.to,
    );
    const info = buildUnmappedAttributionInfo(
      { platform: 'Google', conversionValue: 264, spend: 111 },
      analysis,
    )!;
    const health = computeCampaignHealth({ aggregated: googleAggregated(), trueRevenueInfo: info, cpmRoasAnalysis: undefined });
    const profitReason = health.reasons[0];
    // Platform-prior branch (det 0 → no click-id), so the modulator is the
    // platform-report prior — labeled distinctly, NOT "אמינות NN%".
    expect(profitReason).toContain('מהימנות-דיווח');
    expect(profitReason).not.toMatch(/× אמינות \d+%/);
  });

  it('genuinely no-analysis campaign (info undefined) falls to a neutral with no platform blame', () => {
    const health = computeCampaignHealth({ aggregated: googleAggregated(), trueRevenueInfo: undefined, cpmRoasAnalysis: undefined });
    const attributionReason = health.reasons[3];
    expect(health.components.attributionClarity).toBe(50);
    expect(attributionReason).not.toContain('כנראה Google');
  });
});
