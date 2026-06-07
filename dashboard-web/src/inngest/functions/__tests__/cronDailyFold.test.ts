/**
 * Self-serve stores Phase 4b, Task 8 — cron-daily scheduler→worker fold.
 *
 * The OLD factory (`makeCronDaily` + `cronDailyFunctions`) is kept on disk as
 * a revert lever; these tests cover the NEW pair that replaces it once T9
 * registers them in serve():
 *
 *   - cronDailyScheduler: STATIC cron trigger (unchanged 'TZ=Asia/Jerusalem
 *     5 0 * * *'); loads the active store list at runtime via
 *     loadActiveStoreIds; emits ONE `cron/daily.store.requested` event per
 *     store (built by the planStoreJobs oracle).
 *   - cronDailyWorker: event-driven; concurrency-keyed by `event.data.storeId`;
 *     calls the EXISTING `runDailyForStore(storeId, date, {step})` handler.
 *
 * Run explicitly (the inngest tree is outside the lib glob):
 *   npx vitest run src/inngest/functions/__tests__/cronDailyFold.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the active-store loader so the scheduler test is DB-independent.
vi.mock('@/lib/getStores', () => ({
  loadActiveStoreIds: vi.fn(),
}));

import { cronDailyScheduler, cronDailyWorker, runCronDailyWorker } from '@/inngest/functions/cronDaily';
import { loadActiveStoreIds } from '@/lib/getStores';
import { planStoreJobs } from '@/lib/inngest/planStoreJobs';

type SentEvent = { name: string; id: string; data: unknown };

// Step stub capturing step.run results + step.sendEvent payloads. Mirrors the
// orchestrator's contract: step.run executes the callback (idempotent reads);
// step.sendEvent records what would be fanned out.
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

const yesterday = (): string =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(Date.now() - 24 * 60 * 60 * 1000));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('cronDailyScheduler', () => {
  it('keeps the exact daily cron trigger', () => {
    const cfg = (cronDailyScheduler as unknown as {
      opts: { id: string; triggers: Array<{ cron?: string }> };
    }).opts;
    expect(cfg.id).toBe('cron-daily-scheduler');
    expect(cfg.triggers).toContainEqual({ cron: 'TZ=Asia/Jerusalem 5 0 * * *' });
  });

  it('emits exactly one event per active store with planStoreJobs names/ids/data (3 stores)', async () => {
    (loadActiveStoreIds as ReturnType<typeof vi.fn>).mockResolvedValue([
      'uzoshop',
      'zolplus',
      'usmile360',
    ]);
    const { step, sent } = makeStepStub();

    const result = await (cronDailyScheduler as unknown as {
      fn: (ctx: { step: typeof step }) => Promise<{ enqueued: number }>;
    }).fn({ step });

    expect(result.enqueued).toBe(3);
    expect(step.sendEvent).toHaveBeenCalledTimes(1);
    expect(sent).toHaveLength(1);
    const date = yesterday();
    const expected = planStoreJobs(['uzoshop', 'zolplus', 'usmile360'], {
      family: 'daily',
      date,
    });
    expect(sent[0].events).toEqual(
      expected.map((j) => ({ name: j.eventName, id: j.id, data: j.data })),
    );
    expect(sent[0].events.map((e) => e.name)).toEqual([
      'cron/daily.store.requested',
      'cron/daily.store.requested',
      'cron/daily.store.requested',
    ]);
  });

  it('fans out a 4th store with no deploy (4 stores → 4 events)', async () => {
    (loadActiveStoreIds as ReturnType<typeof vi.fn>).mockResolvedValue([
      'uzoshop',
      'zolplus',
      'usmile360',
      'newstore',
    ]);
    const { step, sent } = makeStepStub();
    const result = await (cronDailyScheduler as unknown as {
      fn: (ctx: { step: typeof step }) => Promise<{ enqueued: number }>;
    }).fn({ step });
    expect(result.enqueued).toBe(4);
    expect(sent[0].events).toHaveLength(4);
    expect(sent[0].events[3].data).toEqual({ storeId: 'newstore', date: yesterday() });
  });

  it('emits nothing when there are no active stores', async () => {
    (loadActiveStoreIds as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const { step } = makeStepStub();
    const result = await (cronDailyScheduler as unknown as {
      fn: (ctx: { step: typeof step }) => Promise<{ enqueued: number }>;
    }).fn({ step });
    expect(result.enqueued).toBe(0);
    expect(step.sendEvent).not.toHaveBeenCalled();
  });
});

describe('cronDailyWorker', () => {
  it('is event-driven on cron/daily.store.requested, concurrency-keyed by storeId, retries 1', () => {
    const cfg = (cronDailyWorker as unknown as {
      opts: {
        id: string;
        triggers: Array<{ event?: string }>;
        concurrency: Array<{ key: string; limit: number }>;
        retries: number;
      };
    }).opts;
    expect(cfg.id).toBe('cron-daily-worker');
    expect(cfg.concurrency).toEqual([{ key: 'event.data.storeId', limit: 1 }]);
    expect(cfg.retries).toBe(1);
    expect(cfg.triggers).toContainEqual({ event: 'cron/daily.store.requested' });
  });

  it('worker core invokes the handler with (storeId, date, {step})', async () => {
    // runCronDailyWorker is the injectable pure core the binding wraps. We pass
    // a vi.fn() handler so the assertion does not run the real fetch+persist
    // pipeline (the co-located binding's in-module handler call can't be
    // intercepted by a module mock).
    const { step } = makeStepStub();
    const handler = vi.fn().mockResolvedValue({ storeId: 'zolplus' });
    await runCronDailyWorker(
      { data: { storeId: 'zolplus', date: '2026-06-06' } },
      step as never,
      handler as never,
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('zolplus', '2026-06-06', { step });
  });
});
