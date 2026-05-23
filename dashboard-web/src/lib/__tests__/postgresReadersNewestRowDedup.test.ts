/**
 * postgresReadersNewestRowDedup.test.ts — guards the newest-row dedup
 * semantics inside fetchDashboardStateFromPostgres. Backfills AUDIT C-02.
 *
 * Why this file exists (per .planning/AUDIT.md surface 10):
 *   `postgresReaders.ts:445-453` carries a load-bearing comment:
 *     // Match sheets.ts dedup: keep the row with the newest updatedAt.
 *   The PRIMARY KEY (key) on dashboard_state today guarantees one row per
 *   key — but the comment says the logic is forward-compatible if the
 *   schema ever permits per-key history rows. Before this file there was
 *   NO fixture that pushed two rows for the same key with different
 *   updated_at timestamps and asserted the newer one wins; a refactor
 *   that flipped the inequality from `<` to `>` would have shipped
 *   undetected (a/HI-04 class of bug).
 *
 *   The dedup also relies on ISO-8601 strings being lexicographically
 *   comparable as wall-clock instants — true for UTC `Z` strings (since
 *   '2026-05-23T10:00:00Z' < '2026-05-23T11:00:00Z' is true under string
 *   ordering AND under temporal ordering), but false in general (mixed
 *   timezone offsets break the equivalence). The dashboard pipeline only
 *   ever writes UTC-`Z` strings (Supabase `timestamptz` returns them in
 *   that shape) so this fixture pins THAT invariant.
 *
 * Mocking strategy: mirrors the existing postgresReaders.test.ts pattern —
 *   vi.mock('@/lib/supabase') with a chainable query that resolves to the
 *   currently-set mockRows. The fluent .from().select() chain matches the
 *   real fetchDashboardStateFromPostgres call shape (no .gte/.lte for
 *   dashboard_state — it always reads the whole table).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let mockRows: unknown[] = [];
let mockError: { message: string } | null = null;

function setSupabaseRows(rows: unknown[]) {
  mockRows = rows;
  mockError = null;
}

vi.mock('@/lib/supabase', () => {
  const makeQuery = () => {
    const q: Record<string, unknown> = {};
    q.select = vi.fn(() => q);
    q.gte = vi.fn(() => q);
    q.lte = vi.fn(() => q);
    q.order = vi.fn(() => q);
    q.range = vi.fn(() => q);
    q.then = (
      resolve: (v: { data: unknown[] | null; error: { message: string } | null }) => unknown,
    ) =>
      Promise.resolve({
        data: mockError ? null : mockRows,
        error: mockError,
      }).then(resolve);
    return q;
  };
  return {
    getSupabase: () => ({
      from: vi.fn(() => makeQuery()),
    }),
  };
});

import { fetchDashboardStateFromPostgres } from '../postgresReaders';

beforeEach(() => {
  mockRows = [];
  mockError = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('fetchDashboardStateFromPostgres — newest-row dedup (AUDIT C-02)', () => {
  it('keeps the NEWER row when two rows share the same key (older row inserted second)', async () => {
    // Two rows for the same key. The OLDER row is iterated SECOND (after
    // the newer). The dedup logic must skip it; final kv[key] = newer value.
    setSupabaseRows([
      {
        key: 'monthly-revenue-goal',
        value: { amount: 70000 }, // NEW value
        updated_at: '2026-05-23T11:00:00Z',
      },
      {
        key: 'monthly-revenue-goal',
        value: { amount: 50000 }, // OLD value — must be discarded
        updated_at: '2026-05-23T10:00:00Z',
      },
    ]);

    const out = await fetchDashboardStateFromPostgres();

    // Newer row's value wins.
    expect(out.kv['monthly-revenue-goal']).toEqual({ amount: 70000 });
    expect(out.updatedAtByKey['monthly-revenue-goal']).toBe('2026-05-23T11:00:00Z');
  });

  it('keeps the NEWER row when iteration order is reversed (older row first)', async () => {
    // Same data, but iteration order flipped so the OLDER row is seen
    // FIRST. The dedup logic must REPLACE it when the newer row appears.
    setSupabaseRows([
      {
        key: 'monthly-revenue-goal',
        value: { amount: 50000 }, // OLD — temporarily wins on first iteration
        updated_at: '2026-05-23T10:00:00Z',
      },
      {
        key: 'monthly-revenue-goal',
        value: { amount: 70000 }, // NEW — must overwrite
        updated_at: '2026-05-23T11:00:00Z',
      },
    ]);

    const out = await fetchDashboardStateFromPostgres();

    expect(out.kv['monthly-revenue-goal']).toEqual({ amount: 70000 });
    expect(out.updatedAtByKey['monthly-revenue-goal']).toBe('2026-05-23T11:00:00Z');
  });

  it('preserves rows for DIFFERENT keys (no cross-key collision in the dedup map)', async () => {
    // Two rows with different keys MUST both survive — dedup keys on `key`.
    setSupabaseRows([
      {
        key: 'monthly-revenue-goal',
        value: 70000,
        updated_at: '2026-05-23T11:00:00Z',
      },
      {
        key: 'billing-recurring',
        value: [{ id: 'shopify', amount: 79 }],
        updated_at: '2026-05-22T09:00:00Z',
      },
    ]);

    const out = await fetchDashboardStateFromPostgres();

    expect(out.kv['monthly-revenue-goal']).toBe(70000);
    expect(out.kv['billing-recurring']).toEqual([{ id: 'shopify', amount: 79 }]);
    expect(out.updatedAtByKey['monthly-revenue-goal']).toBe('2026-05-23T11:00:00Z');
    expect(out.updatedAtByKey['billing-recurring']).toBe('2026-05-22T09:00:00Z');
  });

  it('correctly resolves three rows for the same key (intermediate write between old and new)', async () => {
    // Three writes for the same key. Sequence: old → middle → new (in
    // INSERTION order). The dedup must end on the newest.
    setSupabaseRows([
      {
        key: 'goal-key',
        value: 'first',
        updated_at: '2026-05-23T08:00:00Z',
      },
      {
        key: 'goal-key',
        value: 'middle',
        updated_at: '2026-05-23T09:30:00Z',
      },
      {
        key: 'goal-key',
        value: 'newest',
        updated_at: '2026-05-23T11:15:00Z',
      },
    ]);

    const out = await fetchDashboardStateFromPostgres();

    expect(out.kv['goal-key']).toBe('newest');
    expect(out.updatedAtByKey['goal-key']).toBe('2026-05-23T11:15:00Z');
  });

  it('lexicographic ISO-8601 comparison works correctly for the dedup string compare', async () => {
    // Pin the load-bearing assumption that ISO-8601 UTC `Z` strings sort
    // lexicographically the same as temporally. The dedup uses
    // `updatedAt < prevAt` (string comparison) — if this assumption ever
    // broke (e.g. mixed-offset strings sneaking in), the newer-wins
    // semantics would silently flip for those rows.
    //
    // Demonstrate via cross-boundary timestamps that ALL of:
    //   '2026-05-23T23:59:59Z' < '2026-05-24T00:00:00Z'
    //   '2026-05-23T10:00:00Z' < '2026-05-23T11:00:00Z'
    //   '2026-04-30T23:00:00Z' < '2026-05-01T00:00:00Z'
    // hold under string comparison (these are the exact comparisons the
    // dedup performs). We exercise this through the reader by pushing
    // pairs of rows across a midnight + a month boundary.

    // Same-day across hours.
    expect('2026-05-23T10:00:00Z' < '2026-05-23T11:00:00Z').toBe(true);
    // Midnight boundary.
    expect('2026-05-23T23:59:59Z' < '2026-05-24T00:00:00Z').toBe(true);
    // Month boundary.
    expect('2026-04-30T23:00:00Z' < '2026-05-01T00:00:00Z').toBe(true);

    // End-to-end via the reader: midnight-crossing pair where the older
    // row is at 23:59 and the newer row is at 00:00 next day.
    setSupabaseRows([
      {
        key: 'boundary-test',
        value: 'older',
        updated_at: '2026-05-23T23:59:59Z',
      },
      {
        key: 'boundary-test',
        value: 'newer',
        updated_at: '2026-05-24T00:00:00Z',
      },
    ]);

    const out = await fetchDashboardStateFromPostgres();

    // String compare correctly identifies the 24th as newer than the 23rd.
    expect(out.kv['boundary-test']).toBe('newer');
    expect(out.updatedAtByKey['boundary-test']).toBe('2026-05-24T00:00:00Z');
  });

  it('handles empty updated_at by treating the row as oldest (empty string < any timestamp)', async () => {
    // Edge: a row with NULL/missing updated_at gets coerced to '' (line 444:
    //   `const updatedAt = r.updated_at ? String(r.updated_at) : '';`).
    // Empty string is < every populated ISO timestamp, so a row with a
    // missing updated_at is always treated as the older row and must be
    // overwritten by any real timestamp.
    setSupabaseRows([
      {
        key: 'maybe-missing',
        value: 'with-ts',
        updated_at: '2026-05-23T10:00:00Z',
      },
      {
        key: 'maybe-missing',
        value: 'no-ts',
        updated_at: null,
      },
    ]);

    const out = await fetchDashboardStateFromPostgres();

    // The row WITH a timestamp wins — the null-timestamp row was processed
    // second but its empty string `''` is < '2026-05-23T10:00:00Z', so it
    // is correctly skipped.
    expect(out.kv['maybe-missing']).toBe('with-ts');
    expect(out.updatedAtByKey['maybe-missing']).toBe('2026-05-23T10:00:00Z');
  });
});
