/**
 * A9-06 + A9-07 (2026-05-27) — leader/risk badge selection for PerStoreCards.
 *
 * A9-06: leader must be the EXPLICIT max-by-ROAS, not the first element of a
 *        list that relied on an implicit upstream desc-sort.
 * A9-07: when ALL stores are below ROAS 2.0 (red zone), do NOT show a
 *        celebratory trophy — but still flag the lowest store as risky.
 */
import { describe, it, expect } from 'vitest';
import { selectLeaderAndRisk } from '@/components/PerStoreCards';

describe('selectLeaderAndRisk', () => {
  it('picks the explicit max-by-ROAS regardless of input order (A9-06)', () => {
    const r = selectLeaderAndRisk([
      { store: 'a', roas: 2.1 },
      { store: 'b', roas: 4.0 }, // max, not first
      { store: 'c', roas: 3.0 },
    ]);
    expect(r.topStore).toBe('b');
  });

  it('does NOT show a trophy when all stores are below 2.0, but still flags the lowest as risky (A9-07)', () => {
    const r = selectLeaderAndRisk([
      { store: 'a', roas: 1.8 },
      { store: 'b', roas: 1.2 }, // lowest
      { store: 'c', roas: 1.5 },
    ]);
    expect(r.topStore).toBe(null);
    expect(r.riskyStore).toBe('b');
  });

  it('shows the trophy when the leader clears 2.0 and risk on a sub-2.0 lowest', () => {
    const r = selectLeaderAndRisk([
      { store: 'a', roas: 3.5 }, // leader
      { store: 'b', roas: 1.4 }, // risky
    ]);
    expect(r.topStore).toBe('a');
    expect(r.riskyStore).toBe('b');
  });

  it('flags no risk when every store is at or above 2.0', () => {
    const r = selectLeaderAndRisk([
      { store: 'a', roas: 4.0 },
      { store: 'b', roas: 2.0 },
    ]);
    expect(r.topStore).toBe('a');
    expect(r.riskyStore).toBe(null);
  });

  it('returns no badges for a single positive-ROAS store', () => {
    const r = selectLeaderAndRisk([{ store: 'a', roas: 5.0 }]);
    expect(r).toEqual({ topStore: null, riskyStore: null });
  });

  it('ignores zero/negative-ROAS stores when counting eligibility', () => {
    // Only one store with positive ROAS → no badges.
    const r = selectLeaderAndRisk([
      { store: 'a', roas: 3.0 },
      { store: 'b', roas: 0 },
    ]);
    expect(r).toEqual({ topStore: null, riskyStore: null });
  });
});
