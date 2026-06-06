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
});
