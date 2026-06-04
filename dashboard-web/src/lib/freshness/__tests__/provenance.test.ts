import { describe, it, expect } from 'vitest';
import { provenanceForRange } from '@/lib/freshness/provenance';

/**
 * DQ-4 — provenanceForRange.
 *
 * A range of daily rows is FINALIZED only when every row that carries a
 * defined `isFinalized` flag is true; if any defined flag is false the range
 * is still a LIVE estimate; if NO row carries a defined flag the verdict is
 * UNKNOWN (back-compat: historical rows have null → downstream renders
 * nothing). `anyLiveTick` flips on the moment any row has a non-null
 * `lastLiveTickAt`. `allFinalized` requires at least one defined flag AND
 * every defined flag true.
 */
describe('provenanceForRange (DQ-4)', () => {
  it('all-finalized → verdict finalized, allFinalized true', () => {
    const r = provenanceForRange([
      { isFinalized: true },
      { isFinalized: true },
      { isFinalized: true },
    ]);
    expect(r.verdict).toBe('finalized');
    expect(r.allFinalized).toBe(true);
    expect(r.anyLiveTick).toBe(false);
  });

  it('some-not-final → verdict live_estimate, allFinalized false', () => {
    const r = provenanceForRange([
      { isFinalized: true },
      { isFinalized: false },
      { isFinalized: true },
    ]);
    expect(r.verdict).toBe('live_estimate');
    expect(r.allFinalized).toBe(false);
  });

  it('all-null → verdict unknown, allFinalized false', () => {
    const r = provenanceForRange([
      { isFinalized: null },
      { isFinalized: null },
    ]);
    expect(r.verdict).toBe('unknown');
    expect(r.allFinalized).toBe(false);
    expect(r.anyLiveTick).toBe(false);
  });

  it('mixed null + true → ignores the null, verdict finalized', () => {
    const r = provenanceForRange([
      { isFinalized: null },
      { isFinalized: true },
    ]);
    expect(r.verdict).toBe('finalized');
    expect(r.allFinalized).toBe(true);
  });

  it('mixed null + false → verdict live_estimate', () => {
    const r = provenanceForRange([
      { isFinalized: null },
      { isFinalized: false },
    ]);
    expect(r.verdict).toBe('live_estimate');
    expect(r.allFinalized).toBe(false);
  });

  it('undefined isFinalized is treated like null (not defined)', () => {
    const r = provenanceForRange([
      { isFinalized: undefined },
      { /* field omitted entirely */ },
    ]);
    expect(r.verdict).toBe('unknown');
    expect(r.allFinalized).toBe(false);
  });

  it('empty input → verdict unknown', () => {
    const r = provenanceForRange([]);
    expect(r.verdict).toBe('unknown');
    expect(r.allFinalized).toBe(false);
    expect(r.anyLiveTick).toBe(false);
  });

  it('anyLiveTick true when ANY row has a non-null lastLiveTickAt', () => {
    const r = provenanceForRange([
      { isFinalized: true, lastLiveTickAt: null },
      { isFinalized: true, lastLiveTickAt: '2026-06-04T12:00:00-04:00' },
    ]);
    expect(r.anyLiveTick).toBe(true);
    expect(r.verdict).toBe('finalized'); // live tick does not override finalized flags
  });

  it('anyLiveTick false when every lastLiveTickAt is null/undefined', () => {
    const r = provenanceForRange([
      { isFinalized: false, lastLiveTickAt: null },
      { isFinalized: false },
    ]);
    expect(r.anyLiveTick).toBe(false);
  });

  it('live_estimate can carry a live tick (typical today-in-progress range)', () => {
    const r = provenanceForRange([
      { isFinalized: false, lastLiveTickAt: '2026-06-05T09:30:00-04:00' },
    ]);
    expect(r.verdict).toBe('live_estimate');
    expect(r.anyLiveTick).toBe(true);
    expect(r.allFinalized).toBe(false);
  });
});
