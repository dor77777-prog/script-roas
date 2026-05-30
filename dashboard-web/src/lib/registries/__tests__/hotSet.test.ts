import { describe, expect, it, vi } from 'vitest';
import {
  getHotCampaignIds,
  getHotAdsetIds,
  getHotAdIds,
} from '@/lib/registries/hotSet';

describe('getHotCampaignIds()', () => {
  it('calls the get_hot_campaign_ids RPC and returns the id array', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: ['C1', 'C2'], error: null });
    const admin = { rpc } as unknown as Parameters<typeof getHotCampaignIds>[0]['admin'];
    const out = await getHotCampaignIds({ admin, storeId: 'uzoshop', platform: 'meta' });
    expect(rpc).toHaveBeenCalledWith('get_hot_campaign_ids', { p_store_id: 'uzoshop', p_platform: 'meta' });
    expect(out).toEqual(['C1', 'C2']);
  });

  it('Phase E1.6.1 (2026-05-30): THROWS on RPC error (no more silent soft-fail). Worker outer catch records transient_error so operator sees the cause.', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } });
    const admin = { rpc } as unknown as Parameters<typeof getHotCampaignIds>[0]['admin'];
    await expect(
      getHotCampaignIds({ admin, storeId: 'uzoshop', platform: 'meta' }),
    ).rejects.toThrow('[get_hot_campaign_ids] rpc failed: boom');
  });

  it('returns empty array when data is null with no error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: null });
    const admin = { rpc } as unknown as Parameters<typeof getHotCampaignIds>[0]['admin'];
    expect(await getHotCampaignIds({ admin, storeId: 'uzoshop', platform: 'meta' })).toEqual([]);
  });
});

describe('getHotAdsetIds()', () => {
  it('calls the get_hot_adset_ids RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: ['AS1'], error: null });
    const admin = { rpc } as unknown as Parameters<typeof getHotAdsetIds>[0]['admin'];
    await getHotAdsetIds({ admin, storeId: 'zolplus', platform: 'google' });
    expect(rpc).toHaveBeenCalledWith('get_hot_adset_ids', { p_store_id: 'zolplus', p_platform: 'google' });
  });
});

describe('getHotAdIds()', () => {
  it('calls the get_hot_ad_ids RPC', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: ['AD1'], error: null });
    const admin = { rpc } as unknown as Parameters<typeof getHotAdIds>[0]['admin'];
    await getHotAdIds({ admin, storeId: 'usmile360', platform: 'tiktok' });
    expect(rpc).toHaveBeenCalledWith('get_hot_ad_ids', { p_store_id: 'usmile360', p_platform: 'tiktok' });
  });
});
