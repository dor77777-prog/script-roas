import { describe, expect, it, vi } from 'vitest';
import { runTickOnce } from '@/inngest/functions/cronTickOrchestrator';

describe('runTickOnce()', () => {
  it('fans out meta + google + tiktok events for all stale stores (Phase C)', async () => {
    const sendEvent = vi.fn().mockResolvedValue({ ids: [] });
    const upsertSnapshot = vi.fn().mockResolvedValue(undefined);
    const loadFreshness = vi.fn().mockResolvedValue([]);
    const loadMetaBucState = async () => ({
      uzoshop: { pct: 5, etaMinutes: 0 },
      zolplus: { pct: 5, etaMinutes: 0 },
      usmile360: { pct: 0, etaMinutes: 0 },
    });
    const result = await runTickOnce({
      nowMs: new Date('2026-05-29T14:30:42.000Z').getTime(),
      sendEvent,
      upsertSnapshot,
      loadFreshness,
      loadMetaBuc: loadMetaBucState,
    });
    expect(result.tickId).toBe('2026-05-29T14:30');
    // 3 stores × 3 platforms (meta + google + tiktok) × 2 scopes (status + hot_metrics) = 18.
    // Google + TikTok BUC defaults to { pct: 0, etaMinutes: 0 } → always passes layers 1+2;
    // freshness=[] → Number.MAX_SAFE_INTEGER staleness → always passes layer 3.
    expect(result.fanOutCount).toBe(18);
    expect(sendEvent).toHaveBeenCalledTimes(1);
    const [events] = sendEvent.mock.calls[0];
    expect(events).toHaveLength(18);
    const names = new Set(events.map((e: { name: string }) => e.name));
    expect(names).toEqual(new Set(['meta/job.requested', 'google/job.requested', 'tiktok/job.requested']));
    expect(upsertSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      tick_id: '2026-05-29T14:30',
      fan_out_count: 18,
    }));
  });

  it('emits only google + tiktok events when meta is BUC-skipped (pct >= 80 → infinite cooldown)', async () => {
    const sendEvent = vi.fn().mockResolvedValue({ ids: [] });
    const upsertSnapshot = vi.fn().mockResolvedValue(undefined);
    const result = await runTickOnce({
      nowMs: new Date('2026-05-29T14:30:42.000Z').getTime(),
      sendEvent,
      upsertSnapshot,
      loadFreshness: async () => [],
      loadMetaBuc: async () => ({
        uzoshop: { pct: 90, etaMinutes: 0 },
        zolplus: { pct: 95, etaMinutes: 0 },
        usmile360: { pct: 80, etaMinutes: 0 },
      }),
    });
    // Meta skipped for all 3 stores (pct >= 80 OR pct >= 95 hard gate).
    // Google + TikTok still fan out (BUC defaults to { pct: 0 }):
    //   3 stores × 2 platforms × 2 scopes = 12.
    expect(result.fanOutCount).toBe(12);
    expect(sendEvent).toHaveBeenCalledTimes(1);
    const [events] = sendEvent.mock.calls[0];
    const metaEvents = events.filter((e: { name: string }) => e.name === 'meta/job.requested');
    expect(metaEvents).toHaveLength(0);
    expect(upsertSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      fan_out_count: 12,
    }));
  });
});
