// dashboard-web/src/lib/inngest/__tests__/persistCampaignsLiveRetagFlowV2.test.ts
//
// Phase A.5 v2 — end-to-end test: operator tags campaign C1 to usmile360,
// cron-live-heavy runs, and the in-memory campaigns_daily has EXACTLY
// ONE row for C1 (under usmile360). This is the acceptance test that
// prevents the v1 duplicate-row bug from regressing.

import { describe, it, expect, beforeEach } from 'vitest';
import { persistCampaignsLive, type TikTokAdLiveRow } from '../persistCampaignsLive';

// In-memory campaigns_daily + ads_daily stores keyed by their PKs.
// Simulates Supabase's UPSERT (ON CONFLICT replaces) + DELETE WHERE/IN semantics.
const campaignsDaily = new Map<string, Record<string, unknown>>();
const adsDaily = new Map<string, Record<string, unknown>>();

function parseStoreList(notInValue: string): string[] {
  // The production code passes the negated IN value as `("a","b")` or `("a")`.
  // Strip outer parens + quotes and split.
  return notInValue
    .replace(/^[("]+|[)"]+$/g, '')
    .split(/[)"]*,[("]*/)
    .filter(Boolean);
}

function makeAdminMock() {
  return {
    from: (table: string) => ({
      delete: () => {
        const where: Record<string, unknown> = {};
        const chain = {
          eq: (col: string, v: unknown) => { where[col] = v; return chain; },
          in: (col: string, v: unknown[]) => { where[col] = v; return chain; },
          not: (col: string, op: string, v: string) => {
            const keepStores = parseStoreList(v);
            const target = table === 'campaigns_daily' ? campaignsDaily : adsDaily;
            const toDelete: string[] = [];
            for (const [key, row] of target) {
              const platformMatch = where.platform === undefined || row.platform === where.platform;
              const dateMatch = row.date === where.date;
              // The "in" list applies to either campaign_id or ad_id depending on the table.
              const inCol = where.campaign_id ? 'campaign_id' : (where.ad_id ? 'ad_id' : null);
              if (!inCol) continue;
              const inListMatch = (where[inCol] as unknown[]).includes(row[inCol]);
              const storeNotInKeepList = !keepStores.includes(row.store_id as string);
              if (platformMatch && dateMatch && inListMatch && storeNotInKeepList) {
                toDelete.push(key);
              }
            }
            for (const k of toDelete) target.delete(k);
            return Promise.resolve({ error: null });
          },
        };
        return chain;
      },
      upsert: async (rows: Array<Record<string, unknown>>, opts?: { onConflict?: string }) => {
        const target = table === 'campaigns_daily' ? campaignsDaily : adsDaily;
        const conflictCols = (opts?.onConflict ?? '').split(',').map(c => c.trim());
        for (const row of rows) {
          const pk = conflictCols.map(c => String(row[c])).join('|');
          target.set(pk, row);
        }
        return { error: null };
      },
    }),
    rpc: async () => ({ error: null }),
  };
}

function baseTtRow(storeId: string): TikTokAdLiveRow {
  return {
    storeId,
    campaignId: 'C1',
    campaignName: 'קרוסלות - usmile360',
    adSetId: 'AG1',
    adSetName: 'AG1Name',
    adId: 'A1',
    adName: 'A1Name',
    spend: 10,
    impressions: 100,
    clicks: 5,
    conversions: 1,
    conversionValue: 50,
    effectiveStatus: 'ADGROUP_STATUS_DELIVERY_OK',
  } as TikTokAdLiveRow;
}

const emptyMeta = { adsetRows: [], adRows: [], budgets: { currency: 'USD', campaigns: {}, adSets: {} } };
const emptyGoogle = { adGroupRows: [], adRows: [] };

beforeEach(() => {
  campaignsDaily.clear();
  adsDaily.clear();
});

describe('Phase A.5 v2 acceptance — no duplicate rows after re-tag flow', () => {
  it('1. Initial tick (campaign under uzoshop, unmapped) writes exactly 1 row', async () => {
    await persistCampaignsLive({
      storeId: 'uzoshop',
      dateStr: '2026-05-29',
      admin: makeAdminMock() as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>,
      getFx: async () => 1,
      meta: emptyMeta,
      google: emptyGoogle,
      tiktok: { adRows: [baseTtRow('uzoshop')] },
    });

    const ttRows = Array.from(campaignsDaily.values()).filter(
      r => r.platform === 'tiktok' && r.campaign_id === 'C1' && r.date === '2026-05-29',
    );
    expect(ttRows).toHaveLength(1);
    expect(ttRows[0].store_id).toBe('uzoshop');

    const ttAds = Array.from(adsDaily.values()).filter(
      r => r.ad_id === 'A1' && r.date === '2026-05-29',
    );
    expect(ttAds).toHaveLength(1);
    expect(ttAds[0].store_id).toBe('uzoshop');
  });

  it('2. Re-tag tick (uzoshop → usmile360) replaces the row — still exactly 1', async () => {
    // Seed: initial state from test 1
    const initialAdmin = makeAdminMock();
    await persistCampaignsLive({
      storeId: 'uzoshop',
      dateStr: '2026-05-29',
      admin: initialAdmin as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>,
      getFx: async () => 1,
      meta: emptyMeta,
      google: emptyGoogle,
      tiktok: { adRows: [baseTtRow('uzoshop')] },
    });

    // Confirm we start with 1 uzoshop row
    let ttRows = Array.from(campaignsDaily.values()).filter(
      r => r.platform === 'tiktok' && r.campaign_id === 'C1' && r.date === '2026-05-29',
    );
    expect(ttRows).toHaveLength(1);
    expect(ttRows[0].store_id).toBe('uzoshop');

    // Re-tag tick: same date, but the fetcher now sees the campaign-store-map
    // and attaches storeId='usmile360' to the row.
    await persistCampaignsLive({
      storeId: 'uzoshop',
      dateStr: '2026-05-29',
      admin: makeAdminMock() as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>,
      getFx: async () => 1,
      meta: emptyMeta,
      google: emptyGoogle,
      tiktok: { adRows: [baseTtRow('usmile360')] },
    });

    // Final state: exactly 1 row, under usmile360 (uzoshop row was DELETEd)
    ttRows = Array.from(campaignsDaily.values()).filter(
      r => r.platform === 'tiktok' && r.campaign_id === 'C1' && r.date === '2026-05-29',
    );
    expect(ttRows).toHaveLength(1);
    expect(ttRows[0].store_id).toBe('usmile360');

    const ttAds = Array.from(adsDaily.values()).filter(
      r => r.ad_id === 'A1' && r.date === '2026-05-29',
    );
    expect(ttAds).toHaveLength(1);
    expect(ttAds[0].store_id).toBe('usmile360');
  });

  it('3. Re-tag again (usmile360 → zolplus) replaces — still exactly 1', async () => {
    // Seed: tick 1 (uzoshop) + tick 2 (usmile360)
    for (const sid of ['uzoshop', 'usmile360']) {
      await persistCampaignsLive({
        storeId: 'uzoshop',
        dateStr: '2026-05-29',
        admin: makeAdminMock() as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>,
        getFx: async () => 1,
        meta: emptyMeta,
        google: emptyGoogle,
        tiktok: { adRows: [baseTtRow(sid)] },
      });
    }

    // Tick 3: re-tag to zolplus
    await persistCampaignsLive({
      storeId: 'uzoshop',
      dateStr: '2026-05-29',
      admin: makeAdminMock() as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>,
      getFx: async () => 1,
      meta: emptyMeta,
      google: emptyGoogle,
      tiktok: { adRows: [baseTtRow('zolplus')] },
    });

    const ttRows = Array.from(campaignsDaily.values()).filter(
      r => r.platform === 'tiktok' && r.campaign_id === 'C1' && r.date === '2026-05-29',
    );
    expect(ttRows).toHaveLength(1);
    expect(ttRows[0].store_id).toBe('zolplus');
  });

  it('4. Untag flow (usmile360 → unmapped → back to uzoshop) still exactly 1', async () => {
    // Tick 1: tag → usmile360
    await persistCampaignsLive({
      storeId: 'uzoshop',
      dateStr: '2026-05-29',
      admin: makeAdminMock() as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>,
      getFx: async () => 1,
      meta: emptyMeta,
      google: emptyGoogle,
      tiktok: { adRows: [baseTtRow('usmile360')] },
    });

    // Tick 2: untag → fetcher resolves to fallback (uzoshop = function-arg)
    await persistCampaignsLive({
      storeId: 'uzoshop',
      dateStr: '2026-05-29',
      admin: makeAdminMock() as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>,
      getFx: async () => 1,
      meta: emptyMeta,
      google: emptyGoogle,
      tiktok: { adRows: [baseTtRow('uzoshop')] },
    });

    const ttRows = Array.from(campaignsDaily.values()).filter(
      r => r.platform === 'tiktok' && r.campaign_id === 'C1' && r.date === '2026-05-29',
    );
    expect(ttRows).toHaveLength(1);
    expect(ttRows[0].store_id).toBe('uzoshop');
  });

  it('5. Multiple campaigns with different stores in same tick — no cross-contamination', async () => {
    // 3 campaigns, each tagged to a different store
    await persistCampaignsLive({
      storeId: 'uzoshop',
      dateStr: '2026-05-29',
      admin: makeAdminMock() as unknown as ReturnType<typeof import('@supabase/supabase-js').createClient>,
      getFx: async () => 1,
      meta: emptyMeta,
      google: emptyGoogle,
      tiktok: {
        adRows: [
          { ...baseTtRow('uzoshop'), campaignId: 'CA', adId: 'A_A', adSetId: 'AG_A' } as TikTokAdLiveRow,
          { ...baseTtRow('usmile360'), campaignId: 'CB', adId: 'A_B', adSetId: 'AG_B' } as TikTokAdLiveRow,
          { ...baseTtRow('zolplus'), campaignId: 'CC', adId: 'A_C', adSetId: 'AG_C' } as TikTokAdLiveRow,
        ],
      },
    });

    const allTt = Array.from(campaignsDaily.values()).filter(
      r => r.platform === 'tiktok' && r.date === '2026-05-29',
    );
    expect(allTt).toHaveLength(3);

    const byCampaign = new Map<string, string>();
    for (const row of allTt) {
      byCampaign.set(row.campaign_id as string, row.store_id as string);
    }
    expect(byCampaign.get('CA')).toBe('uzoshop');
    expect(byCampaign.get('CB')).toBe('usmile360');
    expect(byCampaign.get('CC')).toBe('zolplus');
  });
});
