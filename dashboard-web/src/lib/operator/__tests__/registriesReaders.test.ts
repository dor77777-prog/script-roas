import { describe, expect, it, vi } from 'vitest';
import { fetchStatusEvents, fetchCronTickSnapshots } from '@/lib/operator/registriesReaders';

describe('fetchStatusEvents()', () => {
  it('reads campaign_status_events ordered by occurred_at DESC LIMIT 50', async () => {
    const order = vi.fn().mockReturnThis();
    const limit = vi.fn().mockResolvedValue({ data: [{ id: 1 }], error: null });
    const select = vi.fn().mockReturnValue({ order, limit });
    order.mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ select });
    const admin = { from } as unknown as Parameters<typeof fetchStatusEvents>[0];
    const out = await fetchStatusEvents(admin);
    expect(from).toHaveBeenCalledWith('campaign_status_events');
    expect(order).toHaveBeenCalledWith('occurred_at', { ascending: false });
    expect(limit).toHaveBeenCalledWith(50);
    expect(out).toEqual([{ id: 1 }]);
  });
});

describe('fetchCronTickSnapshots()', () => {
  it('reads cron_tick_snapshots ordered by tick_id DESC LIMIT 144', async () => {
    const order = vi.fn().mockReturnThis();
    const limit = vi.fn().mockResolvedValue({ data: [{ tick_id: 'T' }], error: null });
    const select = vi.fn().mockReturnValue({ order, limit });
    order.mockReturnValue({ limit });
    const from = vi.fn().mockReturnValue({ select });
    const admin = { from } as unknown as Parameters<typeof fetchCronTickSnapshots>[0];
    const out = await fetchCronTickSnapshots(admin);
    expect(from).toHaveBeenCalledWith('cron_tick_snapshots');
    expect(order).toHaveBeenCalledWith('tick_id', { ascending: false });
    expect(limit).toHaveBeenCalledWith(144);
    expect(out).toEqual([{ tick_id: 'T' }]);
  });
});
