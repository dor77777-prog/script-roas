import { describe, expect, it, vi } from 'vitest';
import { runTickOnce } from '@/inngest/functions/cronTickOrchestrator';

describe('runTickOnce()', () => {
  it('fans out 3 meta/job.requested events when all stores are stale + BUC OK', async () => {
    const sendEvent = vi.fn().mockResolvedValue({ ids: ['e1', 'e2', 'e3'] });
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
    expect(result.fanOutCount).toBe(3);
    expect(sendEvent).toHaveBeenCalledTimes(1);
    const [events] = sendEvent.mock.calls[0];
    expect(events).toHaveLength(3);
    expect(events[0].name).toBe('meta/job.requested');
    expect(upsertSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      tick_id: '2026-05-29T14:30',
      fan_out_count: 3,
    }));
  });

  it('emits no events when all 3 stores are BUC-skipped (pct >= 80 → infinite cooldown)', async () => {
    const sendEvent = vi.fn();
    const upsertSnapshot = vi.fn();
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
    expect(result.fanOutCount).toBe(0);
    expect(sendEvent).not.toHaveBeenCalled();
    expect(upsertSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      fan_out_count: 0,
    }));
  });
});
