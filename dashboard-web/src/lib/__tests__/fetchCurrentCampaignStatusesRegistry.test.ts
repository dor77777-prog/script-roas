// dashboard-web/src/lib/__tests__/fetchCurrentCampaignStatusesRegistry.test.ts
//
// Phase D Task 7 — fetchCurrentCampaignStatuses reads campaign_registry
// (not campaigns_daily) and broadcasts each campaign's effective_status
// to all of its adsets via a second SELECT on campaigns_daily.

import { describe, expect, it, vi, beforeEach } from 'vitest';

const fromMock = vi.fn();
vi.mock('@/lib/supabase', () => ({
  getSupabase: () => ({ from: fromMock }),
}));
vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({ from: fromMock }),
}));

import { fetchCurrentCampaignStatuses } from '@/lib/postgresReaders';

// Each call to .from(table) returns its own chain object.
// We pre-program responses by sequenced fromMock returns.
function buildChain(rows: Record<string, unknown>[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'gte', 'lte', 'order', 'not', 'eq']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.range = vi.fn(() => Promise.resolve({ data: rows, error: null }));
  return chain;
}

describe('fetchCurrentCampaignStatuses → campaign_registry', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("reads from campaign_registry (not campaigns_daily)", async () => {
    const registryChain = buildChain([
      {
        store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1',
        effective_status: 'PAUSED',
        last_seen_at: '2026-05-30T10:00:00Z',
      },
    ]);
    const adsetsChain = buildChain([
      { store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1', ad_set_id: 'AS1' },
      { store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1', ad_set_id: 'AS2' },
    ]);
    fromMock
      .mockReturnValueOnce(registryChain)
      .mockReturnValueOnce(adsetsChain);

    const result = await fetchCurrentCampaignStatuses();

    expect(fromMock).toHaveBeenNthCalledWith(1, 'campaign_registry');
    // Second call to .from is for the ad_set_id broadcast.
    // It should be against 'campaigns_daily' (which carries ad_set_id in its PK).
    expect(fromMock).toHaveBeenNthCalledWith(2, 'campaigns_daily');

    // Key shape: ${storeId}::${TitleCasePlatform}::${campaignId}::${adSetId}
    expect(result['uzoshop::Meta::C1::AS1']).toEqual({
      status: 'PAUSED',
      updatedAt: '2026-05-30T10:00:00Z',
    });
    expect(result['uzoshop::Meta::C1::AS2']).toEqual({
      status: 'PAUSED',
      updatedAt: '2026-05-30T10:00:00Z',
    });
  });

  it("skips campaigns with null effective_status in registry", async () => {
    const registryChain = buildChain([
      {
        store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1',
        effective_status: null, last_seen_at: '2026-05-30T10:00:00Z',
      },
      {
        store_id: 'uzoshop', platform: 'meta', campaign_id: 'C2',
        effective_status: 'ACTIVE', last_seen_at: '2026-05-30T10:00:00Z',
      },
    ]);
    const adsetsChain = buildChain([
      { store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1', ad_set_id: 'AS1' },
      { store_id: 'uzoshop', platform: 'meta', campaign_id: 'C2', ad_set_id: 'AS2' },
    ]);
    fromMock
      .mockReturnValueOnce(registryChain)
      .mockReturnValueOnce(adsetsChain);

    const result = await fetchCurrentCampaignStatuses();

    expect(result['uzoshop::Meta::C1::AS1']).toBeUndefined();
    expect(result['uzoshop::Meta::C2::AS2']).toEqual({
      status: 'ACTIVE',
      updatedAt: '2026-05-30T10:00:00Z',
    });
  });

  it("dedupes when the same (campaign, ad_set) appears multiple times in campaigns_daily lookup", async () => {
    const registryChain = buildChain([
      {
        store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1',
        effective_status: 'PAUSED', last_seen_at: '2026-05-30T10:00:00Z',
      },
    ]);
    // Same (campaign, ad_set) tuple appearing multiple times — one row per date in campaigns_daily.
    const adsetsChain = buildChain([
      { store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1', ad_set_id: 'AS1' },
      { store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1', ad_set_id: 'AS1' },
      { store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1', ad_set_id: 'AS1' },
    ]);
    fromMock
      .mockReturnValueOnce(registryChain)
      .mockReturnValueOnce(adsetsChain);

    const result = await fetchCurrentCampaignStatuses();
    expect(Object.keys(result)).toEqual(['uzoshop::Meta::C1::AS1']);
    expect(result['uzoshop::Meta::C1::AS1']).toEqual({
      status: 'PAUSED', updatedAt: '2026-05-30T10:00:00Z',
    });
  });
});
