// dashboard-web/src/lib/__tests__/postgresReadersCampaignsEnriched.test.ts
//
// Phase D Task 5 — fetchCampaignsFromPostgres should select from
// campaigns_enriched (not campaigns_daily) and surface the 6 reg_* columns
// onto each CampaignRow.

import { describe, expect, it, vi, beforeEach } from 'vitest';

// Hoist + capture so we can assert which table .from() was called with.
const fromMock = vi.fn();
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ from: fromMock }),
}));
vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({ from: fromMock }),
}));

import { fetchCampaignsFromPostgres } from '@/lib/postgresReaders';

function buildSupabaseChain(rows: Record<string, unknown>[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'gte', 'lte', 'order', 'not', 'eq']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.range = vi.fn(() => Promise.resolve({ data: rows, error: null }));
  return chain;
}

describe('fetchCampaignsFromPostgres → campaigns_enriched', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects from 'campaigns_enriched' (not campaigns_daily)", async () => {
    fromMock.mockReturnValue(buildSupabaseChain([]));
    await fetchCampaignsFromPostgres();
    expect(fromMock).toHaveBeenCalledWith('campaigns_enriched');
  });

  it('threads reg_* columns onto CampaignRow as camelCase reg* fields', async () => {
    fromMock.mockReturnValue(
      buildSupabaseChain([
        {
          date: '2026-05-30',
          store_id: 'uzoshop',
          platform: 'meta',
          campaign_id: 'C1',
          campaign_name: 'Test',
          ad_set_id: 'A1',
          ad_set_name: 'AS',
          spend_cad: 10,
          impressions: 100,
          clicks: 5,
          conversions: 1,
          conversion_value_cad: 25,
          campaign_budget_cad: null,
          ad_set_budget_cad: null,
          budget_type: null,
          effective_status: 'ACTIVE',
          last_live_tick_at: '2026-05-30T10:00:00Z',
          reg_configured_status: 'ENABLED',
          reg_effective_status: 'ACTIVE',
          reg_delivery_status: 'DELIVERING',
          reg_first_seen_at: '2026-05-20T00:00:00Z',
          reg_status_changed_at: '2026-05-28T12:00:00Z',
          reg_last_status_success_at: '2026-05-30T09:50:00Z',
        },
      ]),
    );

    const rows = await fetchCampaignsFromPostgres({
      range: { from: '2026-05-30', to: '2026-05-30' },
    });
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.effectiveStatus).toBe('ACTIVE'); // legacy field preserved
    expect(r.regConfiguredStatus).toBe('ENABLED');
    expect(r.regEffectiveStatus).toBe('ACTIVE');
    expect(r.regDeliveryStatus).toBe('DELIVERING');
    expect(r.regFirstSeenAt).toBe('2026-05-20T00:00:00Z');
    expect(r.regStatusChangedAt).toBe('2026-05-28T12:00:00Z');
    expect(r.regLastStatusSuccessAt).toBe('2026-05-30T09:50:00Z');
  });

  it('PREFERS the registry name (reg_campaign_name / reg_ad_set_name) over the per-day name', async () => {
    fromMock.mockReturnValue(
      buildSupabaseChain([
        {
          date: '2026-05-30',
          store_id: 'uzoshop',
          platform: 'meta',
          campaign_id: 'C1',
          campaign_name: 'OLD campaign name', // stale per-day name
          reg_campaign_name: 'NEW campaign name', // registry current name
          ad_set_id: 'A1',
          ad_set_name: 'OLD adset name',
          reg_ad_set_name: 'NEW adset name',
          spend_cad: 10,
          impressions: 100,
          clicks: 5,
          conversions: 1,
          conversion_value_cad: 25,
          effective_status: 'ACTIVE',
        },
      ]),
    );
    const rows = await fetchCampaignsFromPostgres({
      range: { from: '2026-05-30', to: '2026-05-30' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].campaignName).toBe('NEW campaign name');
    expect(rows[0].adSetName).toBe('NEW adset name');
  });

  it('falls back to the per-day name when the registry alias is null', async () => {
    fromMock.mockReturnValue(
      buildSupabaseChain([
        {
          date: '2026-05-30',
          store_id: 'uzoshop',
          platform: 'meta',
          campaign_id: 'C1',
          campaign_name: 'Daily campaign name',
          reg_campaign_name: null, // registry LEFT JOIN miss
          ad_set_id: 'A1',
          ad_set_name: 'Daily adset name',
          reg_ad_set_name: null,
          spend_cad: 10,
          impressions: 100,
          clicks: 5,
          conversions: 1,
          conversion_value_cad: 25,
          effective_status: 'ACTIVE',
        },
      ]),
    );
    const rows = await fetchCampaignsFromPostgres({
      range: { from: '2026-05-30', to: '2026-05-30' },
    });
    expect(rows[0].campaignName).toBe('Daily campaign name');
    expect(rows[0].adSetName).toBe('Daily adset name');
  });

  it('returns null for reg_* when the LEFT JOIN missed (defensive path)', async () => {
    fromMock.mockReturnValue(
      buildSupabaseChain([
        {
          date: '2026-05-30',
          store_id: 'uzoshop',
          platform: 'meta',
          campaign_id: 'C2',
          campaign_name: 'Missing',
          ad_set_id: 'A',
          ad_set_name: 'A',
          spend_cad: 1,
          impressions: 1,
          clicks: 1,
          conversions: 0,
          conversion_value_cad: 0,
          effective_status: 'ACTIVE',
          reg_configured_status: null,
          reg_effective_status: null,
          reg_delivery_status: null,
          reg_first_seen_at: null,
          reg_status_changed_at: null,
          reg_last_status_success_at: null,
        },
      ]),
    );
    const rows = await fetchCampaignsFromPostgres({
      range: { from: '2026-05-30', to: '2026-05-30' },
    });
    expect(rows[0].regEffectiveStatus).toBeNull();
    expect(rows[0].regDeliveryStatus).toBeNull();
  });
});
