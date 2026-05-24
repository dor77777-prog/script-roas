/**
 * Audit fix 2026-05-24 (AUDIT INN-16, Phase 12.1.1) — locks the systemic-
 * failure abort contract for eventBackfill.
 *
 * Pre-fix: the per-pair catch silently swallowed every error and continued
 * the loop. A schema-level RLS denial would burn through all 63 pairs of
 * a backfill with the same error message and never escalate to Inngest's
 * retry/DLQ machinery (the throw never reached the outer handler).
 *
 * Fix: track consecutive identical error messages; on the 3rd consecutive
 * identical, THROW to surface the failure to Inngest. Also `console.warn`
 * every per-pair failure for operator visibility in Inngest run logs.
 *
 * Cross-ref: 12-trycatch-sweep.md CAT-29.
 * Evidence pack: .planning/phases/12-codebase-audit-baseline/raw-returns/
 *   inngest_eventBackfill.json (INN-16).
 *
 * Test coverage (3 tests):
 *   1. aborts after 3 consecutive identical errors (INN-16) — handler
 *      throws after the 3rd identical failure; pair indices 4-5 never
 *      invoked.
 *   2. console.warn is called for each per-pair failure (alternating
 *      errors don't abort) — counter resets on different message.
 *   3. happy path still completes when no errors — sanity.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// Hoisted mock — replaces `runDailyForStore` from '../cronDaily'.
//
// Per the events.test.ts pattern, we vi.mock at module-init time so
// eventBackfill.ts's import resolves to our spy. The spy's behavior is
// controlled per-test via .mockRejectedValueOnce / .mockResolvedValue.
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

// ---- SUT import (after mock) ----------------------------------------------

import { eventBackfill } from '../eventBackfill';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal step.run stub. Records id, immediately invokes callback.
 * Same shape as events.test.ts:makeMockStep.
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

type BackfillHandler = (ctx: {
  event: { data: unknown };
  step: unknown;
}) => Promise<unknown>;

function getHandler(): BackfillHandler {
  return (eventBackfill as unknown as { fn: BackfillHandler }).fn;
}

beforeEach(() => {
  runDailyForStoreMock.mockReset();
});

// ===========================================================================

describe('eventBackfill systemic-failure abort (INN-16)', () => {
  it('aborts after 3 consecutive identical errors (INN-16)', async () => {
    // Scenario: a schema-level RLS denial means EVERY pair throws the
    // same Error('RLS denied'). Pre-fix the handler iterates all 5
    // pairs, swallows each error, and returns a results array. Post-
    // fix the handler throws after the 3rd consecutive identical
    // error — escalating to Inngest's retry/DLQ machinery.
    runDailyForStoreMock.mockRejectedValue(new Error('RLS denied'));

    // Suppress the expected console.warn noise during the test.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { step } = makeMockStep();
    const handler = getHandler();

    // 5-day × 1-store backfill = 5 pairs. Throw should fire at pair 3.
    await expect(
      handler({
        event: {
          data: {
            from: '2026-05-15',
            to: '2026-05-19',
            storeIds: ['uzoshop'],
          },
        },
        step,
      }),
    ).rejects.toThrow(
      /systemic failure \(3 consecutive identical errors\): RLS denied/,
    );

    // Pairs 4 and 5 must never be invoked — proves the abort fired.
    expect(runDailyForStoreMock).toHaveBeenCalledTimes(3);

    // Each failure was console.warn'd for operator visibility.
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });

  it('console.warn is called for each per-pair failure (alternating errors don\'t abort)', async () => {
    // Scenario: 5 different alternating errors (a/b/a/b/a). The systemic-
    // failure counter resets on each different message → handler does
    // NOT throw and completes normally with failureCount === 5.
    // This pins (a) console.warn fires per failure, (b) the abort is
    // SPECIFICALLY 3 CONSECUTIVE IDENTICAL, not 3 cumulative.
    runDailyForStoreMock.mockRejectedValueOnce(new Error('a'));
    runDailyForStoreMock.mockRejectedValueOnce(new Error('b'));
    runDailyForStoreMock.mockRejectedValueOnce(new Error('a'));
    runDailyForStoreMock.mockRejectedValueOnce(new Error('b'));
    runDailyForStoreMock.mockRejectedValueOnce(new Error('a'));

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { step } = makeMockStep();
    const handler = getHandler();

    // Handler should NOT throw — alternating errors never accumulate 3
    // consecutive identical.
    const result = (await handler({
      event: {
        data: {
          from: '2026-05-15',
          to: '2026-05-19',
          storeIds: ['uzoshop'],
        },
      },
      step,
    })) as {
      successCount: number;
      failureCount: number;
      totalPairs: number;
      results: Array<{ ok: boolean; error?: string }>;
    };

    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(5);
    expect(result.totalPairs).toBe(5);
    expect(runDailyForStoreMock).toHaveBeenCalledTimes(5);
    expect(warnSpy).toHaveBeenCalledTimes(5);

    // Sanity: every warn message contains the per-pair error.
    const warnMessages = warnSpy.mock.calls.map((c) => String(c[0]));
    expect(warnMessages.some((m) => /backfill.*failed.*a/.test(m))).toBe(true);
    expect(warnMessages.some((m) => /backfill.*failed.*b/.test(m))).toBe(true);
  });

  it('happy path still completes when no errors', async () => {
    // Sanity test: the systemic-failure machinery must not regress the
    // happy path. 3 successful pairs → handler returns normally with
    // successCount === 3 and no console.warn calls.
    // (mockReset in beforeEach already set the default success behavior.)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    const { step } = makeMockStep();
    const handler = getHandler();

    const result = (await handler({
      event: {
        data: {
          from: '2026-05-15',
          to: '2026-05-17',
          storeIds: ['uzoshop'],
        },
      },
      step,
    })) as {
      successCount: number;
      failureCount: number;
      totalPairs: number;
    };

    expect(result.successCount).toBe(3);
    expect(result.failureCount).toBe(0);
    expect(result.totalPairs).toBe(3);
    expect(runDailyForStoreMock).toHaveBeenCalledTimes(3);
    expect(warnSpy).not.toHaveBeenCalled();
  });
});
