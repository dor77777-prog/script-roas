// dashboard-web/src/lib/registries/__tests__/phase4FanOutEquality.test.ts
//
// Phase 4a — fan-out EQUIVALENCE guard.
//
// The every-10-minute tick orchestrator is being cut over from a hardcoded
// `STORES` const to enumerating the active store list from the DB
// (`loadActiveStoreIds`). `buildEvents` is already store-list-driven, so the
// ONLY thing that changes is WHERE the store list comes from. This test pins
// that equivalence: for the SAME 3 store ids, building from a hardcoded array
// must deep-equal building from a DB-style loop. It also characterizes the
// exact maximal fan-out (count + sorted tuples) so any drift surfaces here,
// and proves that adding a 4th store grows the fan-out by exactly one
// per-store delta — the whole point of self-serve stores.
//
// This is a CHARACTERIZATION guard, not a behavior change: it must PASS
// against current code.

import { describe, expect, it } from 'vitest';
import { buildEvents } from '@/lib/registries/priorityBuilder';
import type { StoreId } from '@/lib/registries/types';

const TICK_ID = '2026-06-07T10:30';
const NOW_MS = new Date('2026-06-07T10:30:42.000Z').getTime();

// Low BUC pct + empty freshness ⇒ nothing is skipped ⇒ MAXIMAL fan-out:
// every (store × platform × scope) combination emits an event.
function bucLow(stores: StoreId[]) {
  const out: Record<string, { pct: number; etaMinutes: number }> = {};
  for (const s of stores) out[s] = { pct: 0, etaMinutes: 0 };
  return out;
}

function build(stores: StoreId[]) {
  return buildEvents({
    stores,
    freshness: [], // empty ⇒ MAX_SAFE_INTEGER staleness ⇒ always passes Layer 3
    metaBucStateByStore: bucLow(stores),
    googleBucStateByStore: bucLow(stores),
    tiktokBucStateByStore: bucLow(stores),
    tickId: TICK_ID,
    nowMs: NOW_MS,
  });
}

const HARDCODED_3: StoreId[] = ['uzoshop', 'zolplus', 'usmile360'];

// A "DB list" path that yields the SAME 3 ids (e.g. via a Promise loop /
// .map() over DB rows). The ids are identical → buildEvents output must be
// byte-for-byte identical.
const FROM_DB_LOOP_3: StoreId[] = ['uzoshop', 'zolplus', 'usmile360'].map((s) => s);

// Per-store maximal fan-out = 3 platforms (meta + google + tiktok)
// × 2 scopes (status + hot_metrics) = 6 events.
const PER_STORE_DELTA = 6;

function tuples(events: ReturnType<typeof buildEvents>): string[] {
  return events
    .map((e) => `${e.data.store_id}:${e.name}:${e.data.scope}`)
    .sort();
}

describe('Phase 4a fan-out equality guard', () => {
  it('hardcoded-3 list deep-equals DB-loop-3 list (the equivalence guarantee)', () => {
    const fromHardcoded = build(HARDCODED_3);
    const fromDbLoop = build(FROM_DB_LOOP_3);
    expect(fromDbLoop).toEqual(fromHardcoded);
  });

  it('3 stores produce the exact maximal fan-out: 18 events (3 × 3 platforms × 2 scopes)', () => {
    const events = build(HARDCODED_3);
    expect(events).toHaveLength(18);

    const names = new Set(events.map((e) => e.name));
    expect(names).toEqual(
      new Set(['meta/job.requested', 'google/job.requested', 'tiktok/job.requested']),
    );

    expect(tuples(events)).toEqual([
      'usmile360:google/job.requested:hot_metrics',
      'usmile360:google/job.requested:status',
      'usmile360:meta/job.requested:hot_metrics',
      'usmile360:meta/job.requested:status',
      'usmile360:tiktok/job.requested:hot_metrics',
      'usmile360:tiktok/job.requested:status',
      'uzoshop:google/job.requested:hot_metrics',
      'uzoshop:google/job.requested:status',
      'uzoshop:meta/job.requested:hot_metrics',
      'uzoshop:meta/job.requested:status',
      'uzoshop:tiktok/job.requested:hot_metrics',
      'uzoshop:tiktok/job.requested:status',
      'zolplus:google/job.requested:hot_metrics',
      'zolplus:google/job.requested:status',
      'zolplus:meta/job.requested:hot_metrics',
      'zolplus:meta/job.requested:status',
      'zolplus:tiktok/job.requested:hot_metrics',
      'zolplus:tiktok/job.requested:status',
    ]);
  });

  it('adding a 4th store grows the fan-out by exactly one per-store delta (+6 → 24)', () => {
    const three = build(HARDCODED_3);
    const four = build([...HARDCODED_3, 'newstore']);

    expect(four).toHaveLength(three.length + PER_STORE_DELTA);
    expect(four).toHaveLength(24);

    // The delta is precisely the 4th store's 6 tuples — no existing store's
    // events change.
    const newStoreTuples = tuples(four).filter((t) => t.startsWith('newstore:'));
    expect(newStoreTuples).toEqual([
      'newstore:google/job.requested:hot_metrics',
      'newstore:google/job.requested:status',
      'newstore:meta/job.requested:hot_metrics',
      'newstore:meta/job.requested:status',
      'newstore:tiktok/job.requested:hot_metrics',
      'newstore:tiktok/job.requested:status',
    ]);

    // Existing 3 stores' tuples are unchanged by the addition.
    const existingTuples = tuples(four).filter((t) => !t.startsWith('newstore:'));
    expect(existingTuples).toEqual(tuples(three));
  });
});
