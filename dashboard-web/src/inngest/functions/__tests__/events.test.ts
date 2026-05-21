/**
 * Phase 05.6 Plan 10 — tests for `event/sync-now` and `event/backfill` Inngest
 * event functions.
 *
 * Coverage map (7 tests, matching 05.6-10-PLAN.md Task 1 behaviour list):
 *   Test 1 — eventSyncNow has id 'event-sync-now' and trigger
 *            {event: 'event/sync-now'}.
 *   Test 2 — eventSyncNow with event.data = {storeId: 'uzoshop'} invokes
 *            runDailyForStore('uzoshop', <today-in-Jerusalem>, {step}).
 *   Test 3 — eventSyncNow with event.data = {storeId: 'uzoshop', date:
 *            '2026-05-15'} invokes runDailyForStore for that date.
 *   Test 4 — eventBackfill has id 'event-backfill' and trigger
 *            {event: 'event/backfill'}.
 *   Test 5 — eventBackfill with event.data = {from: '2026-05-15', to:
 *            '2026-05-17', storeIds: ['uzoshop','zolplus']} invokes
 *            runDailyForStore 6 times (3 dates × 2 stores).
 *   Test 6 — eventBackfill rejects payloads where from < '2026-05-01'
 *            (D-A3 history boundary). Error message contains 'D-A3' or
 *            '2026-05-01' or 'history boundary'.
 *   Test 7 — eventBackfill rejects empty storeIds array. Error message
 *            contains 'storeIds'.
 *
 * Mock strategy:
 *   - `runDailyForStore` from '../cronDaily' is mocked with `vi.mock`.
 *     Each test asserts invocation count + args via `runDailyForStoreMock`.
 *   - A minimal `step.run` stub records ids and immediately invokes the
 *     callback — mirrors cronDaily.test.ts:makeMockStep semantics.
 *
 * Inngest function-shape introspection:
 *   InngestFunction objects carry their config at `fn.opts.{id, triggers}`.
 *   Tests 1 + 4 read those fields directly. `sanitizeTriggers` (per
 *   Inngest.cjs:561) normalises single-trigger input to a one-element array.
 *
 * Notes:
 *   - We do NOT spin up Inngest's dev server or signing layer; the handler
 *     body is the inner `async ({ event, step }) => {...}` function — the
 *     internals of `runDailyForStore` are out of scope here (covered by
 *     cronDaily.test.ts plan 08).
 *   - Test 5's count assertion is "exactly 6" — independent of whether the
 *     implementation wraps each call in an outer step.run or uses a
 *     prefixing step shim (CHECK.md W6). Both wiring choices invoke
 *     runDailyForStore six times.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock — replaces `runDailyForStore` from '../cronDaily'.
//
// vi.hoisted lets the factory close over a real `vi.fn()` (defined here)
// AND the test file's `beforeEach` reset it via the same reference.
// ---------------------------------------------------------------------------
const runDailyForStoreMock = vi.hoisted(() =>
  vi.fn(async (storeId: string, date: string) => ({
    storeId,
    date,
    shopifyRevenueCad: 0,
    fbSpendCad: 0,
    gaSpendCad: 0,
    totalSpendCad: 0,
    roas: 0,
    grossProfitCad: 0,
    cogsCad: 0,
    netProfitCad: 0,
    overridesApplied: { meta: false, google: false },
    productRowCount: 0,
    metaCampaignRowCount: 0,
    googleCampaignRowCount: 0,
  })),
);

vi.mock('../cronDaily', () => ({
  runDailyForStore: runDailyForStoreMock,
}));

// ---- SUT imports (after mock) ----------------------------------------------

import { eventSyncNow } from '../eventSyncNow';
import { eventBackfill } from '../eventBackfill';

// ---------------------------------------------------------------------------
// Shared helpers — mirror cronDaily.test.ts pattern for cohesion.
// ---------------------------------------------------------------------------

/**
 * Minimal step.run stub. Records id, immediately invokes callback. No
 * retry, no memoization. Matches Inngest's `step.run(id, fn)` shape for
 * shape-assertion purposes.
 */
function makeMockStep(): {
  step: { run: (id: string, cb: () => Promise<unknown>) => Promise<unknown> };
  ids: string[];
} {
  const ids: string[] = [];
  const step = {
    run: async (id: string, cb: () => Promise<unknown>) => {
      ids.push(id);
      return await cb();
    },
  };
  return { step, ids };
}

function readFunctionId(fn: unknown): string | undefined {
  return (fn as { opts?: { id?: string } }).opts?.id;
}

function readEventTrigger(fn: unknown): string | undefined {
  const triggers = (fn as { opts?: { triggers?: Array<{ event?: string }> } })
    .opts?.triggers;
  if (!triggers || triggers.length === 0) return undefined;
  return triggers[0]?.event;
}

/**
 * Format today in Asia/Jerusalem the same way the implementation does
 * (Intl.DateTimeFormat en-CA). Used as the expected default for Test 2.
 */
function todayJerusalem(): string {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jerusalem',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return fmt.format(new Date());
}

beforeEach(() => {
  runDailyForStoreMock.mockClear();
});

// ===========================================================================
// eventSyncNow tests
// ===========================================================================

describe('eventSyncNow — function shape + handler', () => {
  it("Test 1: id === 'event-sync-now' and trigger { event: 'event/sync-now' }", () => {
    expect(readFunctionId(eventSyncNow)).toBe('event-sync-now');
    expect(readEventTrigger(eventSyncNow)).toBe('event/sync-now');
  });

  it('Test 2: handler with {storeId: "uzoshop"} (no date) invokes runDailyForStore for today in Jerusalem', async () => {
    const { step } = makeMockStep();
    const today = todayJerusalem();

    // InngestFunction objects expose a `.fn` property containing the user
    // handler. We access it via the opts surface used by cronDaily.test.ts
    // (`fn.opts.fn` per Inngest's InngestFunction shape).
    const handler = (eventSyncNow as unknown as { fn: (ctx: { event: { data: unknown }; step: unknown }) => Promise<unknown> }).fn;
    await handler({ event: { data: { storeId: 'uzoshop' } }, step });

    expect(runDailyForStoreMock).toHaveBeenCalledTimes(1);
    expect(runDailyForStoreMock).toHaveBeenCalledWith(
      'uzoshop',
      today,
      expect.objectContaining({ step }),
    );
  });

  it('Test 3: handler with {storeId: "uzoshop", date: "2026-05-15"} invokes runDailyForStore for that date', async () => {
    const { step } = makeMockStep();
    const handler = (eventSyncNow as unknown as { fn: (ctx: { event: { data: unknown }; step: unknown }) => Promise<unknown> }).fn;
    await handler({
      event: { data: { storeId: 'uzoshop', date: '2026-05-15' } },
      step,
    });

    expect(runDailyForStoreMock).toHaveBeenCalledTimes(1);
    expect(runDailyForStoreMock).toHaveBeenCalledWith(
      'uzoshop',
      '2026-05-15',
      expect.objectContaining({ step }),
    );
  });
});

// ===========================================================================
// eventBackfill tests
// ===========================================================================

describe('eventBackfill — function shape + handler', () => {
  it("Test 4: id === 'event-backfill' and trigger { event: 'event/backfill' }", () => {
    expect(readFunctionId(eventBackfill)).toBe('event-backfill');
    expect(readEventTrigger(eventBackfill)).toBe('event/backfill');
  });

  it('Test 5: handler with {from: "2026-05-15", to: "2026-05-17", storeIds: ["uzoshop","zolplus"]} invokes runDailyForStore 6 times (3 dates × 2 stores)', async () => {
    const { step } = makeMockStep();
    const handler = (eventBackfill as unknown as { fn: (ctx: { event: { data: unknown }; step: unknown }) => Promise<unknown> }).fn;
    await handler({
      event: {
        data: {
          from: '2026-05-15',
          to: '2026-05-17',
          storeIds: ['uzoshop', 'zolplus'],
        },
      },
      step,
    });

    // 3 dates (15, 16, 17) × 2 stores (uzoshop, zolplus) = 6 invocations.
    expect(runDailyForStoreMock).toHaveBeenCalledTimes(6);

    // Spot-check that all 6 (date, store) pairs were dispatched.
    const calls = runDailyForStoreMock.mock.calls.map(
      ([storeId, date]) => `${date}|${storeId}`,
    );
    expect(new Set(calls)).toEqual(
      new Set([
        '2026-05-15|uzoshop',
        '2026-05-15|zolplus',
        '2026-05-16|uzoshop',
        '2026-05-16|zolplus',
        '2026-05-17|uzoshop',
        '2026-05-17|zolplus',
      ]),
    );
  });

  it("Test 6: handler rejects payloads with from < '2026-05-01' (D-A3 history boundary)", async () => {
    const { step } = makeMockStep();
    const handler = (eventBackfill as unknown as { fn: (ctx: { event: { data: unknown }; step: unknown }) => Promise<unknown> }).fn;

    await expect(
      handler({
        event: {
          data: {
            from: '2026-04-30',
            to: '2026-05-02',
            storeIds: ['uzoshop'],
          },
        },
        step,
      }),
    ).rejects.toThrow(/2026-05-01|D-A3|history boundary/);

    // No fetch dispatched when validation rejects.
    expect(runDailyForStoreMock).not.toHaveBeenCalled();
  });

  it('Test 7: handler rejects empty storeIds array', async () => {
    const { step } = makeMockStep();
    const handler = (eventBackfill as unknown as { fn: (ctx: { event: { data: unknown }; step: unknown }) => Promise<unknown> }).fn;

    await expect(
      handler({
        event: {
          data: {
            from: '2026-05-15',
            to: '2026-05-17',
            storeIds: [],
          },
        },
        step,
      }),
    ).rejects.toThrow(/storeIds/);

    expect(runDailyForStoreMock).not.toHaveBeenCalled();
  });
});
