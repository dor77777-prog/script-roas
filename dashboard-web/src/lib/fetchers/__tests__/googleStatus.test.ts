import { describe, expect, it, vi } from 'vitest';
import { fetchGoogleStatusForStore } from '@/lib/fetchers/googleStatus';

describe('fetchGoogleStatusForStore()', () => {
  it('returns campaigns + adgroups + ads with status from change_status + entity follow-up', async () => {
    const searchStream = vi.fn();
    // First call: change_status query
    searchStream.mockResolvedValueOnce([
      { campaign: { id: 'GC1' }, change_status: { resource_type: 'CAMPAIGN', resource_name: 'customers/123/campaigns/GC1', last_change_date_time: '2026-05-30 14:00:00' } },
    ]);
    // Second call: campaign entity follow-up
    searchStream.mockResolvedValueOnce([
      { campaign: { id: 'GC1', name: 'G Campaign 1', status: 'ENABLED', serving_status: 'SERVING' } },
    ]);
    const customer = { searchStream } as unknown as Parameters<typeof fetchGoogleStatusForStore>[0]['customer'];
    const out = await fetchGoogleStatusForStore({
      storeId: 'uzoshop',
      customer,
    });
    expect(out.campaigns).toHaveLength(1);
    expect(out.campaigns[0]).toMatchObject({
      store_id: 'uzoshop', platform: 'google',
      campaign_id: 'GC1', configured_status: 'ENABLED', effective_status: 'SERVING',
    });
  });

  it('returns empty when change_status yields no rows', async () => {
    const searchStream = vi.fn().mockResolvedValue([]);
    const customer = { searchStream } as unknown as Parameters<typeof fetchGoogleStatusForStore>[0]['customer'];
    const out = await fetchGoogleStatusForStore({ storeId: 'uzoshop', customer });
    expect(out.campaigns).toHaveLength(0);
    expect(out.adsets).toHaveLength(0);
    expect(out.ads).toHaveLength(0);
  });
});
