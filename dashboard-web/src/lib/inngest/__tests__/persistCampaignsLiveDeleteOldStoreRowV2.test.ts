// dashboard-web/src/lib/inngest/__tests__/persistCampaignsLiveDeleteOldStoreRowV2.test.ts
//
// Phase A.5 v2 — verifies persistCampaignsLive does DELETE-then-UPSERT for
// TikTok rows. This is the load-bearing test that prevents the v1 rollback
// bug (campaigns_daily duplicate rows when a campaign moves between stores).

import { describe, it, expect, beforeEach } from 'vitest';
import { persistCampaignsLive, type TikTokAdLiveRow } from '../persistCampaignsLive';
import type { SupabaseClient } from '@supabase/supabase-js';

type SqlCall =
  | { op: 'delete'; table: string; filters: Record<string, unknown> }
  | { op: 'upsert'; table: string; rows: Array<Record<string, unknown>> };

const sqlCalls: SqlCall[] = [];

function makeAdminMock() {
  return {
    from(table: string) {
      return {
        // DELETE chain: .eq()/.in()/.not() are chainable; .not() is the
        // terminal call and resolves the Promise.
        delete() {
          const filters: Record<string, unknown> = {};
          const chain: Record<string, unknown> = {
            eq(col: string, v: unknown) {
              filters[col] = v;
              return chain;
            },
            in(col: string, v: unknown[]) {
              filters[col] = v;
              return chain;
            },
            not(col: string, op: string, v: string) {
              // Encode the NOT IN filter so tests can assert on it.
              filters[`${col}_not_${op}`] = v;
              sqlCalls.push({ op: 'delete', table, filters: { ...filters } });
              return Promise.resolve({ error: null });
            },
          };
          return chain;
        },
        async upsert(rows: Array<Record<string, unknown>>) {
          sqlCalls.push({ op: 'upsert', table, rows });
          return { error: null };
        },
      };
    },
  } as unknown as SupabaseClient;
}

beforeEach(() => {
  sqlCalls.length = 0;
});

const baseTtRow: TikTokAdLiveRow = {
  storeId: 'usmile360',
  campaignId: 'C1',
  campaignName: 'Campaign One',
  adSetId: 'AG1',
  adSetName: 'AdGroup One',
  adId: 'A1',
  adName: 'Ad One',
  spend: 10,
  impressions: 100,
  clicks: 5,
  conversions: 1,
  conversionValue: 50,
};

const baseInput: Omit<import('../persistCampaignsLive').PersistCampaignsLiveInput, 'admin' | 'tiktok'> = {
  storeId: 'uzoshop',
  dateStr: '2026-05-29',
  getFx: async () => 1,
  meta: {
    adsetRows: [],
    adRows: [],
    budgets: { currency: 'USD', campaigns: {}, adSets: {} },
  },
  google: { adGroupRows: [], adRows: [] },
};

describe('Phase A.5 v2 — persistCampaignsLive DELETE-then-UPSERT', () => {
  it('1. campaigns_daily DELETE removes other-store rows for the campaigns being written', async () => {
    await persistCampaignsLive({
      ...baseInput,
      admin: makeAdminMock(),
      tiktok: { adRows: [baseTtRow] },
    });

    const cdDel = sqlCalls.find(
      (c): c is Extract<SqlCall, { op: 'delete' }> => c.op === 'delete' && c.table === 'campaigns_daily',
    );
    expect(cdDel).toBeDefined();
    expect(cdDel!.filters.date).toBe('2026-05-29');
    expect(cdDel!.filters.platform).toBe('tiktok');
    expect(cdDel!.filters.campaign_id).toEqual(['C1']);
    // The NOT IN value contains the target store id (usmile360) so the DELETE
    // only removes rows under OTHER store_ids.
    expect(cdDel!.filters.store_id_not_in).toContain('usmile360');
  });

  it('2. campaigns_daily DELETE fires BEFORE the UPSERT (order matters)', async () => {
    await persistCampaignsLive({
      ...baseInput,
      admin: makeAdminMock(),
      tiktok: { adRows: [baseTtRow] },
    });

    const cdDelIdx = sqlCalls.findIndex(
      c => c.op === 'delete' && c.table === 'campaigns_daily',
    );
    const cdUpsertIdx = sqlCalls.findIndex(
      c => c.op === 'upsert' && c.table === 'campaigns_daily',
    );
    expect(cdDelIdx).toBeGreaterThanOrEqual(0);
    expect(cdUpsertIdx).toBeGreaterThanOrEqual(0);
    expect(cdDelIdx).toBeLessThan(cdUpsertIdx);
  });

  it('3. ads_daily also gets DELETE-then-UPSERT for TikTok rows', async () => {
    await persistCampaignsLive({
      ...baseInput,
      admin: makeAdminMock(),
      tiktok: { adRows: [baseTtRow] },
    });

    const adDel = sqlCalls.find(
      (c): c is Extract<SqlCall, { op: 'delete' }> => c.op === 'delete' && c.table === 'ads_daily',
    );
    expect(adDel).toBeDefined();
    expect(adDel!.filters.ad_id).toEqual(['A1']);
    expect(adDel!.filters.store_id_not_in).toContain('usmile360');

    const adDelIdx = sqlCalls.findIndex(c => c.op === 'delete' && c.table === 'ads_daily');
    const adUpsertIdx = sqlCalls.findIndex(c => c.op === 'upsert' && c.table === 'ads_daily');
    expect(adDelIdx).toBeLessThan(adUpsertIdx);
  });

  it('4. No DELETE fires when there are zero TikTok rows', async () => {
    await persistCampaignsLive({
      ...baseInput,
      admin: makeAdminMock(),
      tiktok: { adRows: [] },
    });

    const cdDel = sqlCalls.find(c => c.op === 'delete' && c.table === 'campaigns_daily');
    const adDel = sqlCalls.find(c => c.op === 'delete' && c.table === 'ads_daily');
    expect(cdDel).toBeUndefined();
    expect(adDel).toBeUndefined();
  });

  it('5. TikTok rows write under row.storeId (not function-arg storeId)', async () => {
    await persistCampaignsLive({
      ...baseInput,
      admin: makeAdminMock(),
      tiktok: { adRows: [baseTtRow] },
    });

    const cdUpsert = sqlCalls.find(
      (c): c is Extract<SqlCall, { op: 'upsert' }> => c.op === 'upsert' && c.table === 'campaigns_daily',
    );
    expect(cdUpsert).toBeDefined();
    const ttRowOut = cdUpsert!.rows.find(r => r.platform === 'tiktok' && r.campaign_id === 'C1');
    // Must be usmile360 (row.storeId), NOT uzoshop (function-arg storeId).
    expect(ttRowOut?.store_id).toBe('usmile360');
  });
});
