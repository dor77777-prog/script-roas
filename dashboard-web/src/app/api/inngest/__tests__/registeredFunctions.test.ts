/**
 * Self-serve stores Phase 4b (Task 9) — registered-set guard for the atomic
 * serve() cutover.
 *
 * Asserts that `inngestFunctions` (the single-source-of-truth array consumed by
 * serve() in route.ts):
 *   - REGISTERS the 6 new scheduler/worker ids that replace the 3 factories;
 *   - does NOT register any of the OLD per-store factory ids
 *     (cron-daily-{store} / cron-live-{store} / cron-yesterday-refresh-{store});
 *   - still REGISTERS every OTHER untouched function (orchestrator, platform
 *     workers, canary, whatsapp, cohort, event-driven, …).
 *
 * This is the hermetic guard that the factory→pair cutover happened together,
 * so Inngest's PUT-on-deploy de-registers old + registers new atomically.
 *
 * Run explicitly (this tree is outside the lib glob):
 *   npx vitest run src/app/api/inngest/__tests__/registeredFunctions.test.ts
 */
import { describe, it, expect } from 'vitest';
import { inngestFunctions } from '@/app/api/inngest/route';

// `.opts.id` is the configured (unprefixed) function id — same accessor the
// cron*Fold tests use to assert scheduler/worker ids.
function registeredIds(): string[] {
  return inngestFunctions.map((f) => (f as { opts: { id: string } }).opts.id);
}

// STORES = ['uzoshop', 'zolplus', 'usmile360'] (cronDaily.ts). The old
// factories minted one function per store via `cron-{family}-{storeId}`.
const STORES = ['uzoshop', 'zolplus', 'usmile360'] as const;

const NEW_PAIR_IDS = [
  'cron-daily-scheduler',
  'cron-daily-worker',
  'cron-live-scheduler',
  'cron-live-worker',
  'cron-yesterday-refresh-scheduler',
  'cron-yesterday-refresh-worker',
] as const;

const OLD_FACTORY_IDS = STORES.flatMap((s) => [
  `cron-daily-${s}`,
  `cron-live-${s}`,
  `cron-yesterday-refresh-${s}`,
]);

// Other functions that MUST remain registered after the cutover.
const UNTOUCHED_IDS = [
  'cron-tick-orchestrator',
  'meta-worker',
  'google-worker',
  'tiktok-worker',
  'event-sync-now',
  'event-backfill',
  'cron-oauth-canary',
  'event-whatsapp-send-now',
];

describe('serve() registered function set — Phase 4b cutover', () => {
  it('registers all 6 new scheduler/worker ids', () => {
    const ids = registeredIds();
    for (const id of NEW_PAIR_IDS) {
      expect(ids).toContain(id);
    }
  });

  it('does NOT register any old per-store factory id', () => {
    const ids = registeredIds();
    for (const oldId of OLD_FACTORY_IDS) {
      expect(ids).not.toContain(oldId);
    }
  });

  it('keeps every other (untouched) function registered', () => {
    const ids = registeredIds();
    for (const id of UNTOUCHED_IDS) {
      expect(ids).toContain(id);
    }
  });

  it('registers exactly one function per id (no duplicates)', () => {
    const ids = registeredIds();
    expect(new Set(ids).size).toBe(ids.length);
  });
});
