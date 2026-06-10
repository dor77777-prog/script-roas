/**
 * Self-serve stores Phase 4b, Task 8 — cron-yesterday-refresh scheduler→worker
 * fold.
 *
 * OLD factory (`makeCronYesterdayRefresh` + `cronYesterdayRefreshFunctions`)
 * kept on disk as a revert lever; these tests cover the NEW pair:
 *
 *   - cronYesterdayRefreshScheduler: STATIC every-2h cron (even hours,
 *     Asia/Jerusalem); loads active stores at runtime; emits ONE
 *     `cron/yesterday.store.requested` event per store carrying yesterday's IL
 *     date. The factory used N STAGGERED cron strings (5-min offsets) to avoid
 *     a thundering herd on Meta's shared rate limit; the fold REPRODUCES that
 *     spacing via a per-store `step.sleep('stagger-{i}', '{i*5}m')` BEFORE each
 *     `step.sendEvent` at the OUTER function level (step.sendEvent must never be
 *     nested inside step.run). The first store (i=0) is not delayed.
 *   - cronYesterdayRefreshWorker: event-driven; concurrency-keyed by
 *     `event.data.storeId`; calls `runDailyForStore(storeId, date, {step})`.
 *
 * Run explicitly:
 *   npx vitest run src/inngest/functions/__tests__/cronYesterdayFold.test.ts
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/getStores', () => ({
  loadActiveStoreIds: vi.fn(),
}));

import {
  cronYesterdayRefreshScheduler,
  cronYesterdayRefreshWorker,
  runCronYesterdayRefreshWorker,
} from '@/inngest/functions/cronYesterdayRefresh';
import { loadActiveStoreIds } from '@/lib/getStores';
import { planStoreJobs } from '@/lib/inngest/planStoreJobs';

type SentEvent = { name: string; id: string; data: unknown };

function makeStepStub() {
  const sent: Array<{ label: string; events: SentEvent[] }> = [];
  const sleeps: Array<{ label: string; duration: string }> = [];
  const step = {
    run: vi.fn(async (_label: string, fn: () => Promise<unknown>) => fn()),
    sleep: vi.fn(async (label: string, duration: string) => {
      sleeps.push({ label, duration });
    }),
    sendEvent: vi.fn(async (label: string, events: SentEvent[]) => {
      sent.push({ label, events });
      return { ids: events.map((e) => e.id) };
    }),
  };
  return { step, sent, sleeps };
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

describe('cronYesterdayRefreshScheduler', () => {
  it('keeps an every-2h even-hour cron trigger', () => {
    const cfg = (cronYesterdayRefreshScheduler as unknown as {
      opts: { id: string; triggers: Array<{ cron?: string }> };
    }).opts;
    expect(cfg.id).toBe('cron-yesterday-refresh-scheduler');
    const cron = cfg.triggers.find((t) => t.cron)?.cron ?? '';
    expect(cron).toContain('TZ=Asia/Jerusalem');
    // even-hour list preserved from the factory's CRON_STAGGER cadence.
    expect(cron).toContain('0,2,4,6,8,10,12,14,16,18,20,22');
  });

  it('emits one yesterday event per active store with planStoreJobs names/ids/data (3 stores)', async () => {
    (loadActiveStoreIds as ReturnType<typeof vi.fn>).mockResolvedValue([
      'uzoshop',
      'zolplus',
      'usmile360',
    ]);
    const { step, sent } = makeStepStub();
    const result = await (cronYesterdayRefreshScheduler as unknown as {
      fn: (ctx: { step: typeof step }) => Promise<{ enqueued: number }>;
    }).fn({ step });

    expect(result.enqueued).toBe(3);
    // One event per store (each sent individually due to the per-store stagger).
    const allEvents = sent.flatMap((s) => s.events);
    expect(allEvents).toHaveLength(3);
    const date = yesterday();
    // P0-2 (2026-06-10): the scheduler now appends an hour-bucket tickId
    // ('hHH', UTC) to every event id so the 12 daily fires emit UNIQUE ids —
    // date-only ids were deduped by Inngest's 24h event-id idempotency and
    // fires 2-12 silently no-oped. The PAYLOAD stays date-only (worker
    // contract unchanged); only the id carries the per-fire discriminator.
    const hourBucket = 'h' + new Date().toISOString().slice(11, 13);
    const expected = planStoreJobs(['uzoshop', 'zolplus', 'usmile360'], {
      family: 'yesterday',
      date,
      tickId: hourBucket,
    });
    expect(allEvents).toEqual(
      expected.map((j) => ({ name: j.eventName, id: j.id, data: j.data })),
    );
    // Each id ends with the per-fire hour bucket — the dedupe-breaking shape.
    for (const e of allEvents) {
      expect(e.name).toBe('cron/yesterday.store.requested');
      expect(e.id).toMatch(/-h\d{2}$/);
    }
  });

  it('reproduces the 5-min anti-thundering-herd stagger (first store undelayed)', async () => {
    (loadActiveStoreIds as ReturnType<typeof vi.fn>).mockResolvedValue([
      'uzoshop',
      'zolplus',
      'usmile360',
    ]);
    const { step, sleeps } = makeStepStub();
    await (cronYesterdayRefreshScheduler as unknown as {
      fn: (ctx: { step: typeof step }) => Promise<{ enqueued: number }>;
    }).fn({ step });
    // Stores 2..N get a 5-min-incremented sleep; store 0 (i=0 → '0m') may be a
    // no-op sleep or omitted. Assert the 5/10 spacing exists for the 2nd/3rd.
    const durations = sleeps.map((s) => s.duration);
    expect(durations).toContain('5m');
    expect(durations).toContain('10m');
    expect(durations).not.toContain('15m'); // only 3 stores
  });

  it('fans out a 4th store with no deploy (4 stores → 4 events)', async () => {
    (loadActiveStoreIds as ReturnType<typeof vi.fn>).mockResolvedValue([
      'uzoshop',
      'zolplus',
      'usmile360',
      'newstore',
    ]);
    const { step, sent } = makeStepStub();
    const result = await (cronYesterdayRefreshScheduler as unknown as {
      fn: (ctx: { step: typeof step }) => Promise<{ enqueued: number }>;
    }).fn({ step });
    expect(result.enqueued).toBe(4);
    const allEvents = sent.flatMap((s) => s.events);
    expect(allEvents).toHaveLength(4);
    expect((allEvents[3].data as { storeId: string }).storeId).toBe('newstore');
  });

  it('emits nothing when there are no active stores', async () => {
    (loadActiveStoreIds as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    const { step } = makeStepStub();
    const result = await (cronYesterdayRefreshScheduler as unknown as {
      fn: (ctx: { step: typeof step }) => Promise<{ enqueued: number }>;
    }).fn({ step });
    expect(result.enqueued).toBe(0);
    expect(step.sendEvent).not.toHaveBeenCalled();
  });
});

describe('cronYesterdayRefreshWorker', () => {
  it('is event-driven on cron/yesterday.store.requested, concurrency-keyed by storeId, retries 1', () => {
    const cfg = (cronYesterdayRefreshWorker as unknown as {
      opts: {
        id: string;
        triggers: Array<{ event?: string }>;
        concurrency: Array<{ key: string; limit: number }>;
        retries: number;
      };
    }).opts;
    expect(cfg.id).toBe('cron-yesterday-refresh-worker');
    expect(cfg.concurrency).toEqual([{ key: 'event.data.storeId', limit: 1 }]);
    expect(cfg.retries).toBe(1);
    expect(cfg.triggers).toContainEqual({ event: 'cron/yesterday.store.requested' });
  });

  it('worker core invokes the handler with (storeId, date, {step})', async () => {
    const { step } = makeStepStub();
    const handler = vi.fn().mockResolvedValue({ storeId: 'usmile360' });
    await runCronYesterdayRefreshWorker(
      { data: { storeId: 'usmile360', date: '2026-06-06' } },
      step as never,
      handler as never,
    );
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith('usmile360', '2026-06-06', { step });
  });
});
