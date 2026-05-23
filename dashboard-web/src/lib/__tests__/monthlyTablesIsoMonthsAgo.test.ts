import { describe, expect, it } from 'vitest';
import { _isoMonthsAgoFromIlParts } from '@/components/MonthlyTables';

/**
 * Audit fix 2026-05-23 (d/HI-08) — locks the TZ behavior of the
 * MonthlyTables history-range helper.
 *
 * Pre-fix the helper called `today.getFullYear() / getMonth() / getDate()`
 * which return the SERVER/CLIENT local-zone date — not IL. On a non-IL
 * CI worker the resulting `past` date could be off by one day, which
 * leaked into the SWR fetch range and silently dropped edge-day rows.
 *
 * Post-fix the helper takes pre-resolved IL today-parts and does the
 * month math in pure UTC. These tests pin the contract.
 */
describe('MonthlyTables._isoMonthsAgoFromIlParts — TZ-stable month rollback', () => {
  it('subtracts whole months without zone leakage', () => {
    // IL today = 2026-05-23. 1 month ago = 2026-04-23.
    expect(_isoMonthsAgoFromIlParts(1, { y: 2026, m: 5, d: 23 })).toBe('2026-04-23');
    // 17 months ago (the MonthlyTables history window) = 2024-12-23.
    expect(_isoMonthsAgoFromIlParts(17, { y: 2026, m: 5, d: 23 })).toBe('2024-12-23');
  });

  it('handles year rollover correctly', () => {
    // IL today = 2026-01-15. 3 months ago = 2025-10-15.
    expect(_isoMonthsAgoFromIlParts(3, { y: 2026, m: 1, d: 15 })).toBe('2025-10-15');
  });

  it('handles month-with-fewer-days rollover (May 31 → Feb)', () => {
    // 3 months back from May 31 = March 3 in the UTC Date rollover
    // semantic (Feb doesn't have 31 days so it cascades). What matters
    // is the result is STABLE and DOESN'T depend on local zone.
    const result = _isoMonthsAgoFromIlParts(3, { y: 2026, m: 5, d: 31 });
    expect(result).toBe('2026-03-03');
  });

  it('returns the same string regardless of where the function runs', () => {
    // Pure function — the IL today-parts ARE the input. No Date.now()
    // dependency. Any machine in any zone returns the same string for
    // the same input. (Regression guard: if anyone reintroduces a
    // `new Date()` call inside the helper, this test will start
    // flaking under CI in non-IL zones.)
    const a = _isoMonthsAgoFromIlParts(6, { y: 2026, m: 5, d: 23 });
    const b = _isoMonthsAgoFromIlParts(6, { y: 2026, m: 5, d: 23 });
    expect(a).toBe(b);
    expect(a).toBe('2025-11-23');
  });
});
