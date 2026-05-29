/**
 * Phase A.5 Task 5 — persistCampaignsLive honors row.storeId for TikTok.
 *
 * Verifies that TikTok rows in campaigns_daily and ads_daily upserts are
 * written under store_id = r.storeId (from the row) rather than the
 * function-arg storeId, and that the fallback to the arg works when the
 * row's storeId is absent.
 */

import { describe, expect, it, beforeEach } from 'vitest';
import { persistCampaignsLive } from '../persistCampaignsLive';
import type { TikTokAdLiveRow } from '../persistCampaignsLive';

const DATE = '2026-05-29';

const upsertCalls: Array<{ table: string; rows: Array<Record<string, unknown>> }> = [];

function makeAdminMock() {
  return {
    from: (table: string) => ({
      upsert: async (rows: Array<Record<string, unknown>>) => {
        upsertCalls.push({ table, rows });
        return { error: null };
      },
    }),
    rpc: async (_fn: string, _args: unknown) => ({ error: null }),
  };
}

beforeEach(() => {
  upsertCalls.length = 0;
});

function baseMeta() {
  return {
    adsetRows: [] as import('@/lib/fetchers/meta').MetaAdSetRow[],
    adRows: [] as import('../persistCampaignsLive').MetaAdLiveRow[],
    budgets: { currency: 'CAD' as string, campaigns: {} as Record<string, never>, adSets: {} as Record<string, never> },
  };
}

function baseGoogle() {
  return {
    adGroupRows: [] as import('../persistCampaignsLive').GoogleAdGroupLiveRow[],
    adRows: [] as import('../persistCampaignsLive').GoogleAdLiveRow[],
  };
}

/** Minimal valid TikTokAdLiveRow for multi-store tests. */
function makeTikTokRow(overrides: Partial<TikTokAdLiveRow> & { storeId: string }): TikTokAdLiveRow {
  return {
    campaignId: 'C1',
    campaignName: 'Campaign 1',
    adSetId: 'AS1',
    adSetName: 'AdSet 1',
    adId: 'AD1',
    adName: 'Ad 1',
    spend: 10,
    impressions: 100,
    clicks: 5,
    conversions: 1,
    conversionValue: 20,
    ...overrides,
  };
}

describe('persistCampaignsLive — TikTok row.storeId', () => {
  it('multi-store TikTok rows split correctly across campaigns_daily', async () => {
    const row1 = makeTikTokRow({ storeId: 'uzoshop', campaignId: 'C1', adSetId: 'AS1', adId: 'AD1' });
    const row2 = makeTikTokRow({ storeId: 'usmile360', campaignId: 'C2', adSetId: 'AS2', adId: 'AD2' });

    await persistCampaignsLive({
      storeId: 'uzoshop',
      dateStr: DATE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: makeAdminMock() as any,
      getFx: async () => 1,
      meta: baseMeta(),
      google: baseGoogle(),
      tiktok: { adRows: [row1, row2] },
    });

    const campaignsUpsert = upsertCalls.find((u) => u.table === 'campaigns_daily');
    expect(campaignsUpsert).toBeTruthy();

    const rows = campaignsUpsert!.rows;
    const uzoshopRow = rows.find((r) => r.campaign_id === 'C1');
    const usmileRow = rows.find((r) => r.campaign_id === 'C2');

    expect(uzoshopRow).toBeDefined();
    expect(uzoshopRow!.store_id).toBe('uzoshop');

    expect(usmileRow).toBeDefined();
    expect(usmileRow!.store_id).toBe('usmile360');
  });

  it('multi-store TikTok rows split correctly across ads_daily', async () => {
    const row1 = makeTikTokRow({ storeId: 'uzoshop', campaignId: 'C1', adSetId: 'AS1', adId: 'AD1' });
    const row2 = makeTikTokRow({ storeId: 'usmile360', campaignId: 'C2', adSetId: 'AS2', adId: 'AD2' });

    await persistCampaignsLive({
      storeId: 'uzoshop',
      dateStr: DATE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: makeAdminMock() as any,
      getFx: async () => 1,
      meta: baseMeta(),
      google: baseGoogle(),
      tiktok: { adRows: [row1, row2] },
    });

    const adsUpsert = upsertCalls.find((u) => u.table === 'ads_daily');
    expect(adsUpsert).toBeTruthy();

    const rows = adsUpsert!.rows;
    const adFromUzoshop = rows.find((r) => r.ad_id === 'AD1');
    const adFromUsmile = rows.find((r) => r.ad_id === 'AD2');

    expect(adFromUzoshop).toBeDefined();
    expect(adFromUzoshop!.store_id).toBe('uzoshop');

    expect(adFromUsmile).toBeDefined();
    expect(adFromUsmile!.store_id).toBe('usmile360');
  });

  it('falls back to function-arg storeId when row.storeId is missing/undefined', async () => {
    // Cast to any to satisfy the type and simulate a row without storeId
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rowWithoutStoreId = { ...makeTikTokRow({ storeId: 'uzoshop' }), storeId: undefined } as any;

    await persistCampaignsLive({
      storeId: 'uzoshop',
      dateStr: DATE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: makeAdminMock() as any,
      getFx: async () => 1,
      meta: baseMeta(),
      google: baseGoogle(),
      tiktok: { adRows: [rowWithoutStoreId] },
    });

    const adsUpsert = upsertCalls.find((u) => u.table === 'ads_daily');
    expect(adsUpsert).toBeTruthy();

    const row = adsUpsert!.rows[0];
    expect(row).toBeDefined();
    expect(row!.store_id).toBe('uzoshop');
  });
});
