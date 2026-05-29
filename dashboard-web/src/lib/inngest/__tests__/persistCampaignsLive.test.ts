import { describe, expect, it, vi } from 'vitest';
import { persistCampaignsLive } from '../persistCampaignsLive';

const STORE = 'uzoshop';
const DATE = '2026-05-27';

function makeAdminMock() {
  const upserts: Array<{ table: string; rows: unknown[]; onConflict?: string }> = [];
  const admin = {
    from(table: string) {
      return {
        upsert(rows: unknown[], opts?: { onConflict?: string }) {
          upserts.push({ table, rows: rows as unknown[], onConflict: opts?.onConflict });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { admin, upserts };
}

describe('persistCampaignsLive', () => {
  it('UPSERTs meta adset rows into campaigns_daily with spend_cad + conversion_value_cad after FX conversion', async () => {
    const { admin, upserts } = makeAdminMock();
    await persistCampaignsLive({
      storeId: STORE,
      dateStr: DATE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin as any,
      getFx: async () => 0.5, // 1 ILS = 0.5 CAD (mocked)
      meta: {
        adsetRows: [
          {
            campaignId: 'c1', campaignName: 'Camp 1', adSetId: 'a1', adSetName: 'AdSet 1',
            spend: 100, impressions: 1000, clicks: 50, conversions: 3,
            conversionValue: 250, currency: 'ILS',
          },
        ],
        adRows: [],
        budgets: { currency: 'ILS', campaigns: {}, adSets: {} },
      },
      google: { adGroupRows: [], adRows: [] },
      tiktok: { adRows: [] },
    });
    const campaignsUpsert = upserts.find(u => u.table === 'campaigns_daily');
    expect(campaignsUpsert).toBeTruthy();
    const row = (campaignsUpsert!.rows as Array<{ spend_cad: number; conversion_value_cad: number; impressions: number }>)[0];
    expect(row.spend_cad).toBeCloseTo(50);    // 100 ILS × 0.5
    expect(row.conversion_value_cad).toBeCloseTo(125); // 250 ILS × 0.5
    expect(row.impressions).toBe(1000);
  });

  it('omits spend_cad when FX fails (cadFor returns null) so ON CONFLICT preserves prior value', async () => {
    const { admin, upserts } = makeAdminMock();
    await persistCampaignsLive({
      storeId: STORE,
      dateStr: DATE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin as any,
      getFx: async () => null, // FX outage
      meta: {
        adsetRows: [{ campaignId: 'c1', campaignName: 'C', adSetId: 'a1', adSetName: 'A', spend: 100, impressions: 1, clicks: 1, conversions: 1, conversionValue: 1, currency: 'ILS' }],
        adRows: [],
        budgets: { currency: 'ILS', campaigns: {}, adSets: {} },
      },
      google: { adGroupRows: [], adRows: [] },
      tiktok: { adRows: [] },
    });
    const campaignsUpsert = upserts.find(u => u.table === 'campaigns_daily');
    const row = campaignsUpsert!.rows[0] as Record<string, unknown>;
    expect(row).not.toHaveProperty('spend_cad');
    expect(row).not.toHaveProperty('conversion_value_cad');
    expect(row.impressions).toBe(1); // metric-only columns still update
  });

  it('uses date,store_id,platform,campaign_id,ad_set_id as the campaigns_daily onConflict key', async () => {
    const { admin, upserts } = makeAdminMock();
    await persistCampaignsLive({
      storeId: STORE,
      dateStr: DATE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin as any,
      getFx: async () => 1,
      meta: { adsetRows: [{ campaignId: 'c', campaignName: '', adSetId: 'a', adSetName: '', spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0, currency: 'CAD' }], adRows: [], budgets: { currency: 'CAD', campaigns: {}, adSets: {} } },
      google: { adGroupRows: [], adRows: [] },
      tiktok: { adRows: [] },
    });
    const u = upserts.find(x => x.table === 'campaigns_daily');
    expect(u!.onConflict).toBe('date,store_id,platform,campaign_id,ad_set_id');
  });

  it('UPSERTs ads_daily for ad-level rows from all three platforms in one call', async () => {
    const { admin, upserts } = makeAdminMock();
    await persistCampaignsLive({
      storeId: STORE,
      dateStr: DATE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin as any,
      getFx: async () => 1,
      meta: {
        adsetRows: [],
        adRows: [{ campaignId: 'c', campaignName: '', adSetId: 'a', adSetName: '', adId: 'ad1', adName: 'M-ad', spend: 1, impressions: 1, clicks: 1, conversions: 1, conversionValue: 1, currency: 'CAD' }],
        budgets: { currency: 'CAD', campaigns: {}, adSets: {} },
      },
      google: { adGroupRows: [], adRows: [{ campaignId: 'c', campaignName: '', adSetId: 'a', adSetName: '', adId: 'ad2', adName: 'G-ad', spend: 2, impressions: 2, clicks: 2, conversions: 2, conversionValue: 2, effectiveStatus: 'ENABLED' }] },
      tiktok: { adRows: [{ storeId: STORE, campaignId: 'c', campaignName: '', adSetId: 'a', adSetName: '', adId: 'ad3', adName: 'T-ad', spend: 3, impressions: 3, clicks: 3, conversions: 3, conversionValue: 3, effectiveStatus: 'ADGROUP_STATUS_DELIVERY_OK' }] },
    });
    const adsUpsert = upserts.find(u => u.table === 'ads_daily');
    expect(adsUpsert).toBeTruthy();
    expect(adsUpsert!.rows).toHaveLength(3);
  });

  it('no-op (no UPSERTs) when all three platforms returned empty arrays', async () => {
    const { admin, upserts } = makeAdminMock();
    await persistCampaignsLive({
      storeId: STORE,
      dateStr: DATE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin as any,
      getFx: async () => 1,
      meta: { adsetRows: [], adRows: [], budgets: { currency: 'CAD', campaigns: {}, adSets: {} } },
      google: { adGroupRows: [], adRows: [] },
      tiktok: { adRows: [] },
    });
    expect(upserts).toHaveLength(0);
  });

  it('uses date,store_id,ad_id as the ads_daily onConflict key (no platform — matches real PK)', async () => {
    const { admin, upserts } = makeAdminMock();
    await persistCampaignsLive({
      storeId: STORE,
      dateStr: DATE,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      admin: admin as any,
      getFx: async () => 1,
      meta: {
        adsetRows: [],
        adRows: [{ campaignId: 'c', campaignName: '', adSetId: 'a', adSetName: '', adId: 'ad1', adName: 'M-ad', spend: 1, impressions: 1, clicks: 1, conversions: 1, conversionValue: 1, currency: 'CAD' }],
        budgets: { currency: 'CAD', campaigns: {}, adSets: {} },
      },
      google: { adGroupRows: [], adRows: [] },
      tiktok: { adRows: [] },
    });
    const u = upserts.find(x => x.table === 'ads_daily');
    expect(u!.onConflict).toBe('date,store_id,ad_id');
  });
});

// Also leave a sanity import for vi so the linter doesn't complain on the
// (unused) re-export above.
void vi;
