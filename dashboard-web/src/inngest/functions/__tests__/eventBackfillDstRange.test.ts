/**
 * Audit fix 2026-05-24 (AUDIT INN-14, Phase 12.2.2) — locks the
 * DST-safe-dateRange contract for eventBackfill.
 *
 * Pre-fix surface (per .planning/AUDIT.md §Phase 12.2 + raw-returns/
 * inngest_eventBackfill.json #INN-14):
 *   `dateRange` used UTC-ms-arithmetic (`d = new Date(d.getTime() + 24h)`)
 *   to step day-by-day. Across IL DST transitions (IDT⇄IST, last
 *   Friday in March + last Sunday in October), a 24h UTC step lands
 *   on the wrong local calendar day — potentially skipping a date or
 *   duplicating one. A backfill spanning the boundary silently missed
 *   or double-processed a day of data for every store in the range.
 *
 * Post-fix: component-based arithmetic on the YYYY-MM-DD string. The
 * year/month/day fields advance via integer increment with month-carry
 * via `new Date(Date.UTC(y, m, 0)).getUTCDate()` (the UTC-arithmetic
 * call is for days-in-month lookup ONLY, which is DST-immune). The
 * output is timezone-agnostic and matches the IL operator's mental
 * model (calendar days, not solar days).
 *
 * Evidence pack: .planning/phases/12-codebase-audit-baseline/raw-returns/
 *   inngest_eventBackfill.json (finding INN-14).
 *
 * Test coverage (4 tests):
 *   1. Autumn DST (2026-10-23 → 2026-10-31, transition 2026-10-25):
 *      exactly 9 distinct IL calendar day strings, no skips/dupes.
 *   2. Spring DST (2026-03-25 → 2026-04-02, transition 2026-03-27):
 *      exactly 9 strings.
 *   3. Single-date: dateRange('2026-05-20', '2026-05-20') → exactly
 *      one string '2026-05-20'.
 *   4. Normal non-DST week: dateRange('2026-05-01', '2026-05-07') →
 *      exactly 7 strings.
 */
import { describe, it, expect } from 'vitest';
import { dateRange } from '../eventBackfill';

function collect(from: string, to: string): string[] {
  return Array.from(dateRange(from, to));
}

describe('eventBackfill dateRange (INN-14 DST-safe)', () => {
  it('IL autumn DST week (2026-10-23 → 2026-10-31) yields 9 distinct calendar days', () => {
    // IDT (UTC+3) → IST (UTC+2) transition typically on last Sunday of
    // October. In 2026 that's 2026-10-25. Pre-fix UTC-ms arithmetic
    // could either land on 2026-10-24 twice (the 25h day boundary) or
    // skip 2026-10-25 entirely depending on the start instant.
    const dates = collect('2026-10-23', '2026-10-31');
    expect(dates).toEqual([
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28',
      '2026-10-29',
      '2026-10-30',
      '2026-10-31',
    ]);
    expect(new Set(dates).size).toBe(9); // no duplicates
  });

  it('IL spring DST week (2026-03-25 → 2026-04-02) yields 9 distinct calendar days', () => {
    // IST (UTC+2) → IDT (UTC+3) transition typically last Friday of
    // March. In 2026 that's 2026-03-27. Pre-fix arithmetic could
    // skip 2026-03-27 OR duplicate the preceding day (23h clock day).
    const dates = collect('2026-03-25', '2026-04-02');
    expect(dates).toEqual([
      '2026-03-25',
      '2026-03-26',
      '2026-03-27',
      '2026-03-28',
      '2026-03-29',
      '2026-03-30',
      '2026-03-31',
      '2026-04-01',
      '2026-04-02',
    ]);
    expect(new Set(dates).size).toBe(9);
  });

  it('single-date range yields exactly one calendar day', () => {
    const dates = collect('2026-05-20', '2026-05-20');
    expect(dates).toEqual(['2026-05-20']);
  });

  it('non-DST week (2026-05-01 → 2026-05-07) yields 7 distinct calendar days', () => {
    const dates = collect('2026-05-01', '2026-05-07');
    expect(dates).toEqual([
      '2026-05-01',
      '2026-05-02',
      '2026-05-03',
      '2026-05-04',
      '2026-05-05',
      '2026-05-06',
      '2026-05-07',
    ]);
    expect(new Set(dates).size).toBe(7);
  });

  it('cross-month boundary (2026-05-30 → 2026-06-02) handles month-carry correctly', () => {
    // Defensive: component-arithmetic must advance month + reset day
    // when the day exceeds the source-month's last day.
    const dates = collect('2026-05-30', '2026-06-02');
    expect(dates).toEqual([
      '2026-05-30',
      '2026-05-31',
      '2026-06-01',
      '2026-06-02',
    ]);
  });

  it('cross-year boundary (2026-12-30 → 2027-01-02) handles year-carry correctly', () => {
    const dates = collect('2026-12-30', '2027-01-02');
    expect(dates).toEqual([
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
    ]);
  });
});
