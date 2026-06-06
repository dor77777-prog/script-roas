/**
 * buildAllInsights — ads-off suppression (Phase 4).
 *
 * When a (store,platform) is OFF in adStateMap, per-platform insights (campaign-
 * died, creative-fatigue, early-warning) for that pair must NOT be emitted.
 * When a store is FULLY off (all applicable platforms off), store-level anomaly
 * insights for that store must NOT be emitted.
 * Empty map ({}) → all insights emitted as before (no regression).
 */
import { describe, it, expect } from 'vitest';
import { buildAllInsights } from '@/lib/insights';
import type { DailyRow } from '@/lib/types';
import type { CampaignRow } from '@/lib/campaigns';
import type { AdRow } from '@/lib/ads';
import type { AdStateMap, AdPlatform } from '@/lib/adState';

// ---- Fixed date seam --------------------------------------------------------
const TODAY = '2026-06-04';

function addDays(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

// ---- DailyRow factory -------------------------------------------------------
function dailyRow(patch: Partial<DailyRow> & { date: string }): DailyRow {
  return {
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    fbSpend: 0,
    gaSpend: 0,
    ttSpend: 0,
    totalSpend: 100,
    revenue: 500,
    roas: 5,
    grossProfit: 0,
    cogs: 0,
    netProfit: 0,
    hasCogs: false,
    grossRevenue: null,
    refundDeduction: null,
    fbImpressions: null,
    gaImpressions: null,
    ttImpressions: null,
    ...patch,
  };
}

// ---- CampaignRow factory (for campaign-died) --------------------------------
function campaignRow(patch: Partial<CampaignRow> & { date: string }): CampaignRow {
  return {
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    platform: 'Meta',
    campaignId: 'c1',
    campaignName: 'TestCampaign',
    adSetId: 'as1',
    adSetName: 'as1',
    spend: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    conversionValue: 0,
    campaignBudgetCad: null,
    adSetBudgetCad: null,
    budgetType: '',
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

/** Build an established campaign that "went dark" on today-1. */
function establishedDiedCampaign(
  patch: Partial<CampaignRow> = {},
): CampaignRow[] {
  const rows: CampaignRow[] = [];
  for (let k = 2; k <= 11; k++) {
    rows.push(campaignRow({ date: addDays(TODAY, -k), spend: 200, ...patch }));
  }
  rows.push(campaignRow({ date: addDays(TODAY, -1), spend: 0, ...patch }));
  return rows;
}

// ---- AdRow factory (for fatigue) --------------------------------------------
function adRow(patch: Partial<AdRow> & { date: string }): AdRow {
  return {
    storeId: 'uzoshop',
    storeName: 'uzoshop',
    platform: 'Meta',
    campaignId: 'camp-1',
    campaignName: 'Camp One',
    adSetId: 'as-1',
    adSetName: 'AdSet One',
    adId: 'ad-1',
    adName: 'Hero Video',
    spend: 0,
    impressions: 0,
    clicks: 0,
    conversions: 0,
    conversionValue: 0,
    regConfiguredStatus: null,
    regEffectiveStatus: null,
    regDeliveryStatus: null,
    regFirstSeenAt: null,
    regStatusChangedAt: null,
    regLastStatusSuccessAt: null,
    ...patch,
  };
}

/** Build a 12-day fatigued ad window: CTR drops, CPM rises. */
function fatigueWindow(patch: Partial<AdRow> = {}): AdRow[] {
  const rows: AdRow[] = [];
  for (let i = 0; i < 6; i++) {
    rows.push(adRow({
      date: addDays('2026-04-01', i),
      impressions: 1000, clicks: 30, spend: 5,
      ...patch,
    }));
  }
  for (let i = 6; i < 12; i++) {
    rows.push(adRow({
      date: addDays('2026-04-01', i),
      impressions: 1000, clicks: 18, spend: 7,
      ...patch,
    }));
  }
  return rows;
}

// ---- Helpers for store-level rec inputs (rebalance + underperformance) ------

/**
 * Build CampaignRow[] that trigger rec-rebalance-uzoshop:
 *  Meta ROAS 4.0, Google ROAS 1.5 → ratio 2.67 > 1.6 threshold, both spend ≥200.
 */
function rebalanceCampaigns(): CampaignRow[] {
  // Use dates 2 days ago so they fall within the 14-day lookback
  // (generateRecommendations uses real todayInIsrael(), so anchor to today-2)
  const now = new Date();
  const day = (offset: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  return [
    // Meta campaigns: 240 spend, value 960 → ROAS 4.0
    campaignRow({ date: day(-1), storeId: 'uzoshop', storeName: 'uzoshop', platform: 'Meta', campaignId: 'meta-1', spend: 120, conversionValue: 480 }),
    campaignRow({ date: day(-2), storeId: 'uzoshop', storeName: 'uzoshop', platform: 'Meta', campaignId: 'meta-1', spend: 120, conversionValue: 480 }),
    // Google campaigns: 240 spend, value 360 → ROAS 1.5
    campaignRow({ date: day(-1), storeId: 'uzoshop', storeName: 'uzoshop', platform: 'Google', campaignId: 'goog-1', spend: 120, conversionValue: 180 }),
    campaignRow({ date: day(-2), storeId: 'uzoshop', storeName: 'uzoshop', platform: 'Google', campaignId: 'goog-1', spend: 120, conversionValue: 180 }),
  ];
}

/**
 * Build DailyRow[] that trigger rec-store-uzoshop (underperformance vs. avg).
 * usmile360 ROAS ~5, uzoshop ROAS ~1.0 → uzoshop < 70% of blended avg.
 * Both stores have ≥200 spend in the 14-day window.
 */
function underperformanceRows(): DailyRow[] {
  const now = new Date();
  const day = (offset: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() + offset);
    return d.toISOString().slice(0, 10);
  };

  const rows: DailyRow[] = [];
  for (let i = 1; i <= 7; i++) {
    // usmile360: ROAS 5.0
    rows.push(dailyRow({
      date: day(-i),
      storeId: 'usmile360',
      storeName: 'usmile360',
      totalSpend: 50,
      revenue: 250,
    }));
    // uzoshop: ROAS 0.8 (way below blended average → triggers underperformance)
    rows.push(dailyRow({
      date: day(-i),
      storeId: 'uzoshop',
      storeName: 'uzoshop',
      totalSpend: 50,
      revenue: 40,
    }));
  }
  return rows;
}

// ---- Tests ------------------------------------------------------------------

describe('buildAllInsights — ads-off suppression', () => {
  it('(off-1) empty adStateMap → all insights pass through (no regression)', () => {
    const campaigns = establishedDiedCampaign();
    const ads = fatigueWindow();
    const all = buildAllInsights([], campaigns, [], ads, {}, {});
    const died = all.filter((i) => i.id.startsWith('died-'));
    const fat = all.filter((i) => i.id.startsWith('fatigue-'));
    expect(died.length).toBeGreaterThan(0);
    expect(fat.length).toBeGreaterThan(0);
  });

  it('(off-2) uzoshop:meta=false → campaign-died and fatigue insights for uzoshop/Meta suppressed', () => {
    const campaigns = establishedDiedCampaign({ storeId: 'uzoshop', storeName: 'uzoshop', platform: 'Meta' });
    const ads = fatigueWindow({ storeId: 'uzoshop', storeName: 'uzoshop', platform: 'Meta' });
    const map: AdStateMap = { 'uzoshop:meta': false };
    const all = buildAllInsights([], campaigns, [], ads, {}, map);
    const died = all.filter((i) => i.id.startsWith('died-') && i.storeId === 'uzoshop' && i.platform === 'Meta');
    const fat = all.filter((i) => i.id.startsWith('fatigue-') && i.storeId === 'uzoshop' && i.platform === 'Meta');
    expect(died).toHaveLength(0);
    expect(fat).toHaveLength(0);
  });

  it('(off-3) off store/platform suppressed, different store/platform still fires', () => {
    const metaCampaigns = establishedDiedCampaign({
      storeId: 'uzoshop', storeName: 'uzoshop', platform: 'Meta', campaignId: 'c-meta',
    });
    const googleCampaigns = establishedDiedCampaign({
      storeId: 'usmile360', storeName: 'usmile360', platform: 'Google', campaignId: 'c-google',
    });
    const map: AdStateMap = { 'uzoshop:meta': false };
    const applicable: Record<string, AdPlatform[]> = {
      uzoshop: ['meta'],
      usmile360: ['google'],
    };
    const all = buildAllInsights(
      [],
      [...metaCampaigns, ...googleCampaigns],
      [],
      [],
      {},
      map,
      applicable,
    );
    const metaDied = all.filter((i) => i.id.startsWith('died-') && i.storeId === 'uzoshop');
    const googleDied = all.filter((i) => i.id.startsWith('died-') && i.storeId === 'usmile360');
    expect(metaDied).toHaveLength(0);
    expect(googleDied).toHaveLength(1);
  });

  it('(off-4) fully-off store (all platforms off) → anomaly insights for that store suppressed', () => {
    // Build 21 daily rows for uzoshop that trigger a revenue anomaly
    const rows: DailyRow[] = [];
    // 14 baseline days with high revenue, then today with 0 revenue + big spend
    for (let i = 20; i >= 2; i--) {
      rows.push(dailyRow({ date: addDays(TODAY, -i), totalSpend: 100, revenue: 500 }));
    }
    // Force a dead-day anomaly on a past day
    rows.push(dailyRow({ date: addDays(TODAY, -1), totalSpend: 200, revenue: 0 }));

    const map: AdStateMap = { 'uzoshop:meta': false };
    const applicable: Record<string, AdPlatform[]> = { uzoshop: ['meta'] };

    const allOn = buildAllInsights(rows, [], [], [], {}, {}, applicable);
    const allOff = buildAllInsights(rows, [], [], [], {}, map, applicable);

    // With ads on, some uzoshop anomalies exist
    const uzoshopAnomaliesOn = allOn.filter(
      (i) => i.kind === 'anomaly' && (i.storeId === 'uzoshop' || i.scope?.includes('uzoshop')),
    );
    // With uzoshop fully off, those anomalies should be suppressed
    const uzoshopAnomaliesOff = allOff.filter(
      (i) => i.kind === 'anomaly' && i.storeId === 'uzoshop',
    );

    expect(uzoshopAnomaliesOn.length).toBeGreaterThan(0);
    expect(uzoshopAnomaliesOff).toHaveLength(0);
  });

  // ---- Phase 4 review: store-level rec storeId fix ----------------------------

  it('(off-5) store-level recs carry storeId — rec-rebalance and rec-store-underperformance both have storeId set', () => {
    const campaigns = rebalanceCampaigns();
    const rows = underperformanceRows();
    const all = buildAllInsights(rows, campaigns, [], [], {}, {});

    const rebalance = all.find((i) => i.id === 'rec-rebalance-uzoshop');
    const underperf = all.find((i) => i.id === 'rec-store-uzoshop');

    // Both recs must be present (confirms our fixtures trigger them)
    expect(rebalance).toBeDefined();
    expect(underperf).toBeDefined();

    // Both must carry the real storeId (not undefined)
    expect(rebalance?.storeId).toBe('uzoshop');
    expect(underperf?.storeId).toBe('uzoshop');
  });

  it('(off-6) fully-off store → rec-rebalance and rec-store-underperformance suppressed', () => {
    const campaigns = rebalanceCampaigns();
    const rows = underperformanceRows();

    const map: AdStateMap = {
      'uzoshop:meta': false,
      'uzoshop:google': false,
      'uzoshop:tiktok': false,
    };
    const applicable: Record<string, AdPlatform[]> = {
      uzoshop: ['meta', 'google', 'tiktok'],
    };

    // Confirm both recs fire with ads on
    const allOn = buildAllInsights(rows, campaigns, [], [], {}, {}, applicable);
    expect(allOn.find((i) => i.id === 'rec-rebalance-uzoshop')).toBeDefined();
    expect(allOn.find((i) => i.id === 'rec-store-uzoshop')).toBeDefined();

    // With uzoshop fully off, both must be suppressed
    const allOff = buildAllInsights(rows, campaigns, [], [], {}, map, applicable);
    expect(allOff.find((i) => i.id === 'rec-rebalance-uzoshop')).toBeUndefined();
    expect(allOff.find((i) => i.id === 'rec-store-uzoshop')).toBeUndefined();
  });

  it('(off-7) partially-off store → store-level recs NOT suppressed (not fully off)', () => {
    const campaigns = rebalanceCampaigns();
    const rows = underperformanceRows();

    // Only meta off, google still on → store is not fully off
    const map: AdStateMap = { 'uzoshop:meta': false };
    const applicable: Record<string, AdPlatform[]> = {
      uzoshop: ['meta', 'google'],
    };

    const all = buildAllInsights(rows, campaigns, [], [], {}, map, applicable);
    // Store-level recs must still pass through (partial off ≠ full off)
    expect(all.find((i) => i.id === 'rec-rebalance-uzoshop')).toBeDefined();
    expect(all.find((i) => i.id === 'rec-store-uzoshop')).toBeDefined();
  });
});
