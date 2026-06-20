/**
 * Self-serve stores — fetchCampaignsFromPostgres must project each campaign
 * row's storeName from the store's DISPLAY name (getStores → stores DB), NOT a
 * hardcoded 3-store map, so a 4th store's campaign spend joins to its per-store
 * card (the home adapter keys campaigns by storeName).
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

const fromMock = vi.fn();
vi.mock('@/lib/supabase', () => ({ getSupabase: () => ({ from: fromMock }) }));
vi.mock('@/lib/supabaseAdmin', () => ({ getSupabaseAdmin: () => ({ from: fromMock }) }));

// Stage a 4th active store so the dynamic name map maps 'pdrn-skin' → 'pdrn skin'.
vi.mock('@/lib/getStores', () => ({
  getStores: vi.fn(async () => [
    { storeId: 'uzoshop',   storeName: 'uzoshop',   brandColor: null, isHeadless: false, hasTikTok: true,  status: 'active', displayOrder: 1, enableCustomerJourney: false },
    { storeId: 'pdrn-skin', storeName: 'pdrn skin', brandColor: null, isHeadless: true,  hasTikTok: true,  status: 'active', displayOrder: 4, enableCustomerJourney: false },
  ]),
  loadActiveStoreIds: vi.fn(async () => ['uzoshop', 'pdrn-skin']),
}));

import { fetchCampaignsFromPostgres } from '@/lib/postgresReaders';
import { __resetPlatformsByStoreCache } from '@/lib/platformsByStore';

function buildSupabaseChain(rows: Record<string, unknown>[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'gte', 'lte', 'order', 'not', 'eq']) chain[m] = vi.fn(() => chain);
  chain.range = vi.fn(() => Promise.resolve({ data: rows, error: null }));
  return chain;
}

beforeEach(() => {
  vi.clearAllMocks();
  __resetPlatformsByStoreCache();
});

describe('fetchCampaignsFromPostgres — self-serve store name projection', () => {
  it("projects a 4th store's storeName as its DISPLAY name, not the slug", async () => {
    fromMock.mockReturnValue(
      buildSupabaseChain([
        {
          date: '2026-05-30', store_id: 'pdrn-skin', platform: 'tiktok',
          campaign_id: 'C1', campaign_name: 'PDRN', ad_set_id: 'A1', ad_set_name: 'AS',
          spend_cad: 12, impressions: 1000, clicks: 5, conversions: 1,
          conversion_value_cad: 30, campaign_budget_cad: null, ad_set_budget_cad: null,
          budget_type: null, effective_status: 'ADGROUP_STATUS_DELIVERY_OK', last_live_tick_at: null,
        },
      ]),
    );
    const rows = await fetchCampaignsFromPostgres({ range: { from: '2026-05-30', to: '2026-05-30' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].storeId).toBe('pdrn-skin');
    expect(rows[0].storeName).toBe('pdrn skin'); // DISPLAY name, not 'pdrn-skin'
  });

  it('still projects the legacy names for the 3 (byte-identical)', async () => {
    fromMock.mockReturnValue(
      buildSupabaseChain([
        {
          date: '2026-05-30', store_id: 'uzoshop', platform: 'meta',
          campaign_id: 'C1', campaign_name: 'X', ad_set_id: 'A1', ad_set_name: 'AS',
          spend_cad: 10, impressions: 100, clicks: 5, conversions: 1,
          conversion_value_cad: 25, campaign_budget_cad: null, ad_set_budget_cad: null,
          budget_type: null, effective_status: 'ACTIVE', last_live_tick_at: null,
        },
      ]),
    );
    const rows = await fetchCampaignsFromPostgres({ range: { from: '2026-05-30', to: '2026-05-30' } });
    expect(rows[0].storeName).toBe('uzoshop');
  });
});
