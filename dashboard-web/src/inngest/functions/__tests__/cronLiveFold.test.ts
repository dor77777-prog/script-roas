/**
 * Self-serve stores Phase 4b, Task 8 — cron-live scheduler→worker fold.
 *
 * OLD factory (`makeCronLive` + `cronLiveFunctions`) kept on disk as a revert
 * lever; these tests cover the NEW pair:
 *
 *   - cronLiveScheduler: STATIC cron 'TZ=Asia/Jerusalem *\/10 * * * *';
 *     loads active stores at runtime; emits ONE `cron/live.store.requested`
 *     event per store. Live carries NO date — the scheduler passes a `tickId`
 *     (10-min bucket) to planStoreJobs purely as a collision-free id
 *     discriminator across the every-10-min cadence.
 *   - cronLiveWorker: event-driven; concurrency-keyed by `event.data.storeId`;
 *     calls `runLiveForStore(storeId, {step})` (no date).
 *
 * Run explicitly:
 *   npx vitest run src/inngest/functions/__tests__/cronLiveFold.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/getStores', () => ({
  loadActiveStoreIds: vi.fn(),
}));

import { cronLiveScheduler, cronLiveWorker, runCronLiveWorker } from '@/inngest/functions/cronLive';
import { loadActiveStoreIds } from '@/lib/getStores';
import { planStoreJobs } from '@/lib/inngest/planStoreJobs';

type SentEvent = { name: string; id: string; data: unknown };

function makeStepStub() {
  const sent: Array<{ label: string; events: SentEvent[] }> = [];
  const step = {
    run: vi.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
    sendEvent: vi.fn(async (label: string, events: SentEvent[]) => {
      sent.push({ label, events });
      return { ids: events.map((e) => e.id) };
    }),
  };
  return { step, sent };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cronLiveScheduler', () => {
  it('keeps the exact live cron trigger', () => {
    const cfg = (cronLiveScheduler as unknown as {
      opts: { id: string; triggers: Array<{ cron?: string }> };
    }).opts;
    expect(cfg.id).toBe('cron-live-scheduler');
    expect(cfg.triggers).toContainEqual({ cron: 'TZ=Asia/Jerusalem */10 * * * *' });
  });

  it('emits one event per active store, with NO date in payload and tick-discriminated ids (3 stores)', async () => {
    (loadActiveStoreIds as ReturnType<typeof vi.fn>).mockResolvedValue([
      'uzoshop',
      'zolplus',
      'usmile360',
    ]);
    const { step, sent } = makeStepStub();
    const result = await (cronLiveScheduler as unknown as {
      fn: (ctx: { step: typeof step }) => Promise<{ enqueued: number }>;
    }).fn({ step });

    expect(result.enqueued).toBe(3);
    expect(step.sendEvent).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
    const events = sent[0].events;
    // Live payloads carry NO date.
    for (const e of events) {
      expect(e.name).toBe('cron/live.store.requested');
      expect((e.data as { date?: string }).date).toBeUndefined();
    }
    expect(events.map((e) => (e.data as { storeId: string }).storeId)).toEqual([
      'uzoshop',
      'zolplus',
      'usmile360',
    ]);
    // Ids must match planStoreJobs's tick-discriminator shape for SOME tickId.
    // Re-derive using the same tickId embedded in the emitted id suffix so the
    // assertion is exact rather than approximate.
    const tickId = events[0].id.replace(/^cron-live-uzoshop-/, '');
    expect(tickId).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    const expected = planStoreJobs(['uzoshop', 'zolplus', 'usmile360'], {
      family: 'live',
      tickId,
    });
    expect(events).toEqual(
      expected.map((j) => ({ name: j.eventName, id: j.id, data: j.data })),
    );
  });

  it('fans out a 4th store with no deploy (4 stores → 4 events)', async () => {
    (loadActiveStoreIds as ReturnType<typeof vi.fn>).mockResolvedValue([
      'uzoshop',
      'zolplus',
      'usmile360',
      'newstore',
    ]);
    const { step, sent } = makeStepStub();
    const result = await (cronLiveScheduler as unknown as {
      fn: (ctx: { step: typeof step }) => Promise<{ enqueued: number }>;
    }).fn({ step });
    expect(result.enqueued).toBe(4);
    expect(sent[0].events).toHaveLength(4);
    expect((sent[0].events[3].data as { storeId: string }).storeId).toBe('newstore');
  });

  it('emits nothing when there are no active stores', async () => {
    (loadActiveStoreIds as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const { step } = makeStepStub();
    const result = await (cronLiveScheduler as unknown as {
      fn: (ctx: { step: typeof step }) => Promise<{ enqueued: number }>;
    }).fn({ step });
    expect(result.enqueued).toBe(0);
    expect(step.sendEvent).not.toHaveBeenCalled();
  });
});

describe('cronLiveWorker', () => {
  it('is event-driven on cron/live.store.requested, concurrency-keyed by storeId, retries 1', () => {
    const cfg = (cronLiveWorker as unknown as {
      opts: {
        id: string;
        triggers: Array<{ event?: string }>;
        concurrency: Array<{ key: string; limit: number }>;
        retries: number;
      };
    }).opts;
    expect(cfg.id).toBe('cron-live-worker');
    expect(cfg.concurrency).toEqual([{ key: 'event.data.storeId', limit: 1 }]);
    expect(cfg.retries).toBe(1);
    expect(cfg.triggers).toContainEqual({ event: 'cron/live.store.requested' });
  });

  it('worker core invokes the handler with (storeId, {step}) — no date', async () => {
    const { step } = makeStepStub();
    const handler = vi.fn().mockResolvedValue({ storeId: 'uzoshop' });
    await runCronLiveWorker(
      { data: { storeId: 'uzoshop' } },
      step as never,
      handler as never,
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('uzoshop', { step });
  });
});
