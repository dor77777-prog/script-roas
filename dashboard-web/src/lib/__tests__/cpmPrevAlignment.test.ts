import { describe, expect, it } from 'vitest';
import {
  dayOffsetFromRangeStart,
  indexPrevByDateOffset,
} from '@/lib/cpmRoasAnalysis';

/**
 * Regression suite for c/CR-01 (audit-2026-05-23-v2): the CPM
 * "vs previous period" overlay must align by CALENDAR OFFSET, not by
 * surviving-array index. When current and prev both pre-filter zero-
 * impression days, a naive `prev[i]` pairing silently warps the overlay
 * whenever the two windows have a different number of active days.
 */
describe('dayOffsetFromRangeStart', () => {
  it('returns 0 for the same day as rangeFrom', () => {
    expect(dayOffsetFromRangeStart('2026-05-01', '2026-05-01')).toBe(0);
  });

  it('returns the correct positive offset for later days', () => {
    expect(dayOffsetFromRangeStart('2026-05-08', '2026-05-01')).toBe(7);
  });

  it('handles month boundaries', () => {
    expect(dayOffsetFromRangeStart('2026-06-01', '2026-05-25')).toBe(7);
  });

  it('handles year boundaries', () => {
    expect(dayOffsetFromRangeStart('2027-01-02', '2026-12-30')).toBe(3);
  });
});

describe('indexPrevByDateOffset', () => {
  it('returns an empty map for null/undefined input', () => {
    expect(indexPrevByDateOffset(null, '2026-05-01').size).toBe(0);
    expect(indexPrevByDateOffset(undefined, '2026-05-01').size).toBe(0);
    expect(indexPrevByDateOffset([], '2026-05-01').size).toBe(0);
  });

  it('indexes a series by days-from-rangeFrom', () => {
    const prev = [
      { date: '2026-04-01', cpm: 10 },
      { date: '2026-04-03', cpm: 12 },
      { date: '2026-04-07', cpm: 15 },
    ];
    const indexed = indexPrevByDateOffset(prev, '2026-04-01');
    expect(indexed.size).toBe(3);
    expect(indexed.get(0)).toEqual({ date: '2026-04-01', cpm: 10 });
    expect(indexed.get(2)).toEqual({ date: '2026-04-03', cpm: 12 });
    expect(indexed.get(6)).toEqual({ date: '2026-04-07', cpm: 15 });
    // Missing days stay missing — this is the key property the chart relies on.
    expect(indexed.get(1)).toBeUndefined();
    expect(indexed.get(3)).toBeUndefined();
  });

  it('preserves all fields on the indexed entries', () => {
    const prev = [
      { date: '2026-04-01', cpm: 10, roas: 2.5, extra: 'preserved' },
    ];
    const indexed = indexPrevByDateOffset(prev, '2026-04-01');
    expect(indexed.get(0)).toEqual({
      date: '2026-04-01',
      cpm: 10,
      roas: 2.5,
      extra: 'preserved',
    });
  });
});

describe('CPM prev-period alignment (c/CR-01 regression)', () => {
  it('pairs by calendar day even when active-day counts differ', () => {
    // Scenario: current 7-day window 2026-05-01..2026-05-07 was paused on
    // day 2 (2026-05-02), so cpmDaily has 6 points. Prev 7-day window
    // 2026-04-24..2026-04-30 was fully active, so cpmDailyPrev has 7
    // points. Naive prev[i] pairing would put prev day-2 against current
    // day-2 (which is actually current calendar day 3, since day 2 is
    // missing) — a 1-day calendar shift on every subsequent point.
    const curRange = { from: '2026-05-01' };
    const prevRange = { from: '2026-04-24' };
    const cpmDaily = [
      { date: '2026-05-01', cpm: 10 }, // offset 0
      // 2026-05-02 paused — missing
      { date: '2026-05-03', cpm: 12 }, // offset 2
      { date: '2026-05-04', cpm: 13 }, // offset 3
      { date: '2026-05-05', cpm: 14 }, // offset 4
      { date: '2026-05-06', cpm: 15 }, // offset 5
      { date: '2026-05-07', cpm: 16 }, // offset 6
    ];
    const cpmDailyPrev = [
      { date: '2026-04-24', cpm: 8 },  // offset 0
      { date: '2026-04-25', cpm: 9 },  // offset 1
      { date: '2026-04-26', cpm: 10 }, // offset 2
      { date: '2026-04-27', cpm: 11 }, // offset 3
      { date: '2026-04-28', cpm: 12 }, // offset 4
      { date: '2026-04-29', cpm: 13 }, // offset 5
      { date: '2026-04-30', cpm: 14 }, // offset 6
    ];
    const prevByOffset = indexPrevByDateOffset(cpmDailyPrev, prevRange.from);
    const paired = cpmDaily.map(d => {
      const offset = dayOffsetFromRangeStart(d.date, curRange.from);
      const prev = prevByOffset.get(offset);
      return { date: d.date, cpm: d.cpm, prevCpm: prev?.cpm ?? null, prevDate: prev?.date ?? null };
    });

    // Day 1 of current (offset 0) pairs with day 1 of prev (offset 0).
    expect(paired[0]).toEqual({ date: '2026-05-01', cpm: 10, prevCpm: 8, prevDate: '2026-04-24' });

    // Day 3 of current is offset 2 — must pair with prev's offset 2 (day 3 of prev),
    // NOT with prev[1] (which would have been the naive-index bug).
    expect(paired[1]).toEqual({ date: '2026-05-03', cpm: 12, prevCpm: 10, prevDate: '2026-04-26' });

    // Last day of current (offset 6) pairs with prev's offset 6.
    expect(paired[5]).toEqual({ date: '2026-05-07', cpm: 16, prevCpm: 14, prevDate: '2026-04-30' });
  });

  it('returns null prev when the prev window has no matching offset', () => {
    // Current has data on day 4 (offset 3); prev was paused on day 4 of its
    // window. The naive index lookup would shift everything; the helper
    // correctly returns null so the chart breaks the dashed line at the gap.
    const cpmDaily = [
      { date: '2026-05-01', cpm: 10 }, // offset 0
      { date: '2026-05-04', cpm: 12 }, // offset 3 — prev has no day at offset 3
    ];
    const cpmDailyPrev = [
      { date: '2026-04-24', cpm: 9 }, // offset 0
      // offset 3 (2026-04-27) missing on purpose
      { date: '2026-04-28', cpm: 11 }, // offset 4
    ];
    const prevByOffset = indexPrevByDateOffset(cpmDailyPrev, '2026-04-24');
    const paired = cpmDaily.map(d => {
      const offset = dayOffsetFromRangeStart(d.date, '2026-05-01');
      const prev = prevByOffset.get(offset);
      return { date: d.date, prevCpm: prev?.cpm ?? null };
    });
    expect(paired[0].prevCpm).toBe(9);
    // No match for offset 3 — must stay null.
    expect(paired[1].prevCpm).toBeNull();
  });
});
