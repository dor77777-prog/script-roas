// dashboard-web/src/lib/__tests__/postgresReadersAdsEnriched.test.ts
//
// Phase D Task 6 — fetchAdsFromPostgres selects from ads_enriched and
// surfaces 6 reg_* columns onto AdRow.

import { describe, expect, it, vi, beforeEach } from 'vitest';

const fromMock = vi.fn();
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ from: fromMock }),
}));
vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({ from: fromMock }),
}));

import { fetchAdsFromPostgres } from '@/lib/postgresReaders';

function buildSupabaseChain(rows: Record<string, unknown>[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'gte', 'lte', 'order', 'not', 'eq']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.range = vi.fn(() => Promise.resolve({ data: rows, error: null }));
  return chain;
}

describe('fetchAdsFromPostgres → ads_enriched', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects from 'ads_enriched' (not ads_daily)", async () => {
    fromMock.mockReturnValue(buildSupabaseChain([]));
    await fetchAdsFromPostgres();
    expect(fromMock).toHaveBeenCalledWith('ads_enriched');
  });

  it('threads reg_* columns onto AdRow', async () => {
    fromMock.mockReturnValue(
      buildSupabaseChain([
        {
          date: '2026-05-30',
          store_id: 'uzoshop',
          platform: 'meta',
          campaign_id: 'C1',
          campaign_name: 'C',
          ad_set_id: 'A1',
          ad_set_name: 'AS',
          ad_id: 'AD1',
          ad_name: 'A',
          spend_cad: 10,
          impressions: 100,
          clicks: 5,
          conversions: 1,
          conversion_value_cad: 25,
          reg_configured_status: 'ENABLED',
          reg_effective_status: 'ACTIVE',
          reg_delivery_status: 'DELIVERING',
          reg_first_seen_at: '2026-05-20T00:00:00Z',
          reg_status_changed_at: '2026-05-28T12:00:00Z',
          reg_last_status_success_at: '2026-05-30T09:50:00Z',
        },
      ]),
    );
    const rows = await fetchAdsFromPostgres({
      range: { from: '2026-05-30', to: '2026-05-30' },
    });
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.regEffectiveStatus).toBe('ACTIVE');
    expect(r.regDeliveryStatus).toBe('DELIVERING');
    expect(r.regConfiguredStatus).toBe('ENABLED');
  });

  it('PREFERS the registry names (reg_campaign_name / reg_ad_set_name / reg_ad_name) over per-day names', async () => {
    fromMock.mockReturnValue(
      buildSupabaseChain([
        {
          date: '2026-05-30',
          store_id: 'uzoshop',
          platform: 'meta',
          campaign_id: 'C1',
          campaign_name: 'OLD campaign',
          reg_campaign_name: 'NEW campaign',
          ad_set_id: 'A1',
          ad_set_name: 'OLD adset',
          reg_ad_set_name: 'NEW adset',
          ad_id: 'AD1',
          ad_name: 'OLD ad',
          reg_ad_name: 'NEW ad',
          spend_cad: 10,
          impressions: 100,
          clicks: 5,
          conversions: 1,
          conversion_value_cad: 25,
        },
      ]),
    );
    const rows = await fetchAdsFromPostgres({
      range: { from: '2026-05-30', to: '2026-05-30' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].campaignName).toBe('NEW campaign');
    expect(rows[0].adSetName).toBe('NEW adset');
    expect(rows[0].adName).toBe('NEW ad');
  });

  it('falls back to per-day names when registry aliases are null', async () => {
    fromMock.mockReturnValue(
      buildSupabaseChain([
        {
          date: '2026-05-30',
          store_id: 'uzoshop',
          platform: 'meta',
          campaign_id: 'C1',
          campaign_name: 'Daily campaign',
          reg_campaign_name: null,
          ad_set_id: 'A1',
          ad_set_name: 'Daily adset',
          reg_ad_set_name: null,
          ad_id: 'AD1',
          ad_name: 'Daily ad',
          reg_ad_name: null,
          spend_cad: 10,
          impressions: 100,
          clicks: 5,
          conversions: 1,
          conversion_value_cad: 25,
        },
      ]),
    );
    const rows = await fetchAdsFromPostgres({
      range: { from: '2026-05-30', to: '2026-05-30' },
    });
    expect(rows[0].campaignName).toBe('Daily campaign');
    expect(rows[0].adSetName).toBe('Daily adset');
    expect(rows[0].adName).toBe('Daily ad');
  });

  it('returns null for reg_* when the LEFT JOIN missed (defensive path)', async () => {
    fromMock.mockReturnValue(
      buildSupabaseChain([
        {
          date: '2026-05-30',
          store_id: 'uzoshop',
          platform: 'meta',
          campaign_id: 'C2',
          campaign_name: 'C',
          ad_set_id: 'A1',
          ad_set_name: 'A',
          ad_id: 'AD2',
          ad_name: 'A',
          spend_cad: 1,
          impressions: 1,
          clicks: 1,
          conversions: 0,
          conversion_value_cad: 0,
          reg_configured_status: null,
          reg_effective_status: null,
          reg_delivery_status: null,
          reg_first_seen_at: null,
          reg_status_changed_at: null,
          reg_last_status_success_at: null,
        },
      ]),
    );
    const rows = await fetchAdsFromPostgres({
      range: { from: '2026-05-30', to: '2026-05-30' },
    });
    expect(rows[0].regEffectiveStatus).toBeNull();
    expect(rows[0].regDeliveryStatus).toBeNull();
  });
});
