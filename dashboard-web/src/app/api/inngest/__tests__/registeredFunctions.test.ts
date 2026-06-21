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

// Scheduler/worker pairs still registered with Inngest (not yet migrated to
// Vercel Cron + QStash). Stage 2 (Tasks 2.1–2.3) migrated the live/daily/
// yesterday pairs off Inngest, so this list is now empty — the remaining
// Inngest-resident functions are the tick orchestrator + platform workers (Task
// 2.4) and the operator-button event functions (Stage 3), asserted via
// UNTOUCHED_IDS below.
const NEW_PAIR_IDS: readonly string[] = [];

const OLD_FACTORY_IDS = STORES.flatMap((s) => [
  `cron-daily-${s}`,
  `cron-live-${s}`,
  `cron-yesterday-refresh-${s}`,
]);

// Other functions that MUST remain registered after the cutover.
// Stage 2 Task 2.4 moved cron-tick-orchestrator + the 3 platform workers off
// Inngest (see MIGRATED_TO_VERCEL_CRON_IDS); only the operator-button event
// functions remain Inngest-resident until Stage 3.
const UNTOUCHED_IDS = [
  'event-sync-now',
  'event-backfill',
  // event-whatsapp-send-now (operator button) stays registered until Stage 3.
  'event-whatsapp-send-now',
];

// Inngest → Vercel Cron migration (Stage 1): these standalone crons now run on
// Vercel Cron (/api/cron/*) and MUST NOT be registered with Inngest anymore.
// Their createFunction exports remain on disk for rollback but are unregistered.
const MIGRATED_TO_VERCEL_CRON_IDS = [
  'cron-oauth-canary', // → /api/cron/oauth-canary (Task 1.2)
  'cron-cohort-refresh', // → /api/cron/cohort (Task 1.3)
  'whatsapp-noon', // → /api/cron/whatsapp?slot=noon (Task 1.1)
  'whatsapp-evening', // → /api/cron/whatsapp?slot=evening (Task 1.1)
  'whatsapp-eod', // → /api/cron/whatsapp?slot=eod (Task 1.1)
  // Stage 2 — heavy pipeline scheduler+worker pairs now run on Vercel Cron +
  // QStash. Their createFunction exports remain on disk for rollback but are
  // unregistered.
  'cron-live-scheduler', // → /api/cron/live (Task 2.1)
  'cron-live-worker', // → /api/worker/live-store (Task 2.1)
  'cron-daily-scheduler', // → /api/cron/daily (Task 2.2)
  'cron-daily-worker', // → /api/worker/daily-store (Task 2.2)
  'cron-yesterday-refresh-scheduler', // → /api/cron/yesterday (Task 2.3)
  'cron-yesterday-refresh-worker', // → /api/worker/yesterday-store (Task 2.3)
  // Stage 2 Task 2.4 — tick orchestrator + platform workers now run on Vercel
  // Cron (/api/cron/tick) + QStash (/api/worker/{meta,google,tiktok}). Their
  // createFunction exports remain on disk for rollback but are unregistered.
  'cron-tick-orchestrator', // → /api/cron/tick (Task 2.4)
  'meta-worker', // → /api/worker/meta (Task 2.4)
  'google-worker', // → /api/worker/google (Task 2.4)
  'tiktok-worker', // → /api/worker/tiktok (Task 2.4)
];

describe('serve() registered function set — Phase 4b cutover', () => {
  it('registers every still-Inngest-resident scheduler/worker pair', () => {
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

  it('does NOT register crons migrated to Vercel Cron + QStash (Stages 1–2)', () => {
    const ids = registeredIds();
    for (const id of MIGRATED_TO_VERCEL_CRON_IDS) {
      expect(ids).not.toContain(id);
    }
  });

  it('registers exactly one function per id (no duplicates)', () => {
    const ids = registeredIds();
    expect(new Set(ids).size).toBe(ids.length);
  });
});
