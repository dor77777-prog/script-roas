// dashboard-web/src/lib/__tests__/fetchCurrentCampaignStatusesRegistry.test.ts
//
// Phase D Task 7 — fetchCurrentCampaignStatuses reads campaign_registry
// (not campaigns_daily) and broadcasts each campaign's effective_status
// to all of its adsets.
//
// P0-1 (2026-06-10): the ad_set tuple source for the broadcast is now
// adset_registry (ONE row per ad_set — bounded), replacing the previous
// date-UNBOUNDED scan of campaigns_daily's per-day rows, which would have
// silently truncated at paginate()'s 50k ceiling (dropping the NEWEST
// ad_sets, since the scan was date-ASC). The VALUE semantics are unchanged:
// the CAMPAIGN's registry status is broadcast to each ad_set key — the
// adset_registry row's own effective_status is deliberately NOT used.

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

  it("reads from campaign_registry then broadcasts via adset_registry (not campaigns_daily — P0-1)", async () => {
    const registryChain = buildChain([
      {
        store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1',
        effective_status: 'PAUSED',
        last_seen_at: '2026-05-30T10:00:00Z',
      },
    ]);
    const adsetsChain = buildChain([
      { store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1', adset_id: 'AS1' },
      { store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1', adset_id: 'AS2' },
    ]);
    fromMock
      .mockReturnValueOnce(registryChain)
      .mockReturnValueOnce(adsetsChain);

    const result = await fetchCurrentCampaignStatuses();

    expect(fromMock).toHaveBeenNthCalledWith(1, 'campaign_registry');
    // Second call to .from is for the ad_set broadcast. P0-1: it reads
    // adset_registry (one bounded row per ad_set) — NOT campaigns_daily,
    // whose date-unbounded per-day rows would truncate at the 50k ceiling.
    expect(fromMock).toHaveBeenNthCalledWith(2, 'adset_registry');

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
      { store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1', adset_id: 'AS1' },
      { store_id: 'uzoshop', platform: 'meta', campaign_id: 'C2', adset_id: 'AS2' },
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

  it("broadcasts the CAMPAIGN's status — the adset_registry row's own effective_status is ignored", async () => {
    const registryChain = buildChain([
      {
        store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1',
        effective_status: 'ACTIVE', last_seen_at: '2026-05-30T10:00:00Z',
      },
    ]);
    // The adset_registry row carries its OWN (different) status; the map's
    // value semantics are CAMPAIGN-level (Phase 12.5.x operator decision —
    // the "כבוי" chip reflects the parent campaign's state), so the
    // campaign_registry status must win.
    const adsetsChain = buildChain([
      {
        store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1', adset_id: 'AS1',
        effective_status: 'PAUSED', last_seen_at: '2026-05-31T11:00:00Z',
      },
    ]);
    fromMock
      .mockReturnValueOnce(registryChain)
      .mockReturnValueOnce(adsetsChain);

    const result = await fetchCurrentCampaignStatuses();
    expect(result['uzoshop::Meta::C1::AS1']).toEqual({
      status: 'ACTIVE', updatedAt: '2026-05-30T10:00:00Z',
    });
  });

  it("dedupes defensively if the same (campaign, ad_set) tuple repeats", async () => {
    const registryChain = buildChain([
      {
        store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1',
        effective_status: 'PAUSED', last_seen_at: '2026-05-30T10:00:00Z',
      },
    ]);
    // adset_registry's PK makes duplicates impossible in practice — the
    // dedup guard is kept defensively (and pinned here).
    const adsetsChain = buildChain([
      { store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1', adset_id: 'AS1' },
      { store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1', adset_id: 'AS1' },
      { store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1', adset_id: 'AS1' },
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
