// dashboard-web/src/lib/__tests__/rangeClamp.test.ts
//
// HIGH-3 audit fix (2026-05-23): pin the contract of the shared range
// clamp helpers consumed by Filters.tsx (custom-range branch) and
// CampaignsTable.tsx (in-toolbar range picker — currently keeps its
// own inline duplicate, optional consumption per the audit plan).
//
// Pre-fix Filters bug: `onChange={e => onChange({range: {from: e.target.value}})}`
// allowed three classes of bad input to cascade into 6 SWR keys:
//   1. empty '' → wiped the range to empty string, /api/data 400'd
//   2. future date → broke cohort/cross-store comparisons (assume to<=today)
//   3. from > to → backwards range, downstream queries returned no rows
//
// Post-fix: all 3 are intercepted by clampDateToToday + applyFromCandidate
// + applyToCandidate. The 3 helpers are PURE — these tests cover them
// directly without standing up the Filters component.

import { describe, expect, it } from 'vitest';
import {
  applyFromCandidate,
  applyToCandidate,
  clampDateToToday,
} from '@/lib/rangeClamp';
import type { DateRange } from '@/lib/types';

const TODAY = '2026-05-23';

describe('clampDateToToday — pure clamp helper', () => {
  it('returns null for empty input (caller should no-op state)', () => {
    expect(clampDateToToday('', TODAY)).toBeNull();
  });

  it('returns null for malformed input (browser paste / bad agent)', () => {
    expect(clampDateToToday('not-a-date', TODAY)).toBeNull();
    expect(clampDateToToday('2026-05', TODAY)).toBeNull();
    expect(clampDateToToday('20260523', TODAY)).toBeNull();
  });

  it('returns the candidate unchanged when in-range', () => {
    expect(clampDateToToday('2026-05-23', TODAY)).toBe('2026-05-23');
    expect(clampDateToToday('2026-05-22', TODAY)).toBe('2026-05-22');
    expect(clampDateToToday('2024-01-01', TODAY)).toBe('2024-01-01');
  });

  it('clamps a future date to today', () => {
    expect(clampDateToToday('2026-05-24', TODAY)).toBe(TODAY);
    expect(clampDateToToday('2027-12-31', TODAY)).toBe(TODAY);
    expect(clampDateToToday('2099-01-01', TODAY)).toBe(TODAY);
  });

  it('handles year boundary (today=YYYY-12-31, candidate=YYYY+1-01-01)', () => {
    expect(clampDateToToday('2027-01-01', '2026-12-31')).toBe('2026-12-31');
  });
});

describe('applyFromCandidate — clamp + swap-on-invert', () => {
  const range: DateRange = { from: '2026-05-15', to: '2026-05-20' };

  it('empty input returns null (caller no-ops)', () => {
    expect(applyFromCandidate(range, '', TODAY)).toBeNull();
  });

  it('non-YYYY-MM-DD shape returns null', () => {
    // Bad shapes (no hyphens, wrong digit counts) are rejected by the
    // regex guard. Impossible-date NUMBERS that match the shape
    // (2026-99-99) are NOT rejected here — they're lexicographically
    // greater than any real today, so they clamp to today. That's a
    // safe outcome: SWR keys still receive a valid YYYY-MM-DD. The
    // strict calendar-validity check is HIGH-14's job (separate fix
    // on /api/operator/* routes where the value reaches the DB).
    expect(applyFromCandidate(range, '', TODAY)).toBeNull();
    expect(applyFromCandidate(range, 'not-a-date', TODAY)).toBeNull();
    expect(applyFromCandidate(range, '20260523', TODAY)).toBeNull();
  });

  it('impossible-date shape clamps to today (safe downstream outcome)', () => {
    // 2026-99-99 matches the regex but is lex-greater than any real
    // date → clamps to today, swap-on-invert collapses to single day.
    const out = applyFromCandidate(range, '2026-99-99', TODAY);
    expect(out).toEqual({ from: TODAY, to: TODAY });
  });

  it('in-range candidate updates only `from`, preserves `to`', () => {
    const out = applyFromCandidate(range, '2026-05-10', TODAY);
    expect(out).toEqual({ from: '2026-05-10', to: '2026-05-20' });
  });

  it('future date clamps to today first, then applies', () => {
    // Picked future date → clamped to today → today > range.to → swap to single day.
    const out = applyFromCandidate(range, '2026-12-31', TODAY);
    expect(out).toEqual({ from: TODAY, to: TODAY });
  });

  it('from > to inverts to single-day range at `from`', () => {
    // User picked from=2026-05-22 while to=2026-05-20 → collapse.
    const out = applyFromCandidate(range, '2026-05-22', TODAY);
    expect(out).toEqual({ from: '2026-05-22', to: '2026-05-22' });
  });

  it('from === to is NOT a swap (boundary case)', () => {
    const out = applyFromCandidate(range, '2026-05-20', TODAY);
    // safe = '2026-05-20', range.to = '2026-05-20', safe > range.to is false → update from only.
    expect(out).toEqual({ from: '2026-05-20', to: '2026-05-20' });
  });
});

describe('applyToCandidate — clamp + swap-on-invert (symmetric)', () => {
  const range: DateRange = { from: '2026-05-15', to: '2026-05-20' };

  it('empty input returns null', () => {
    expect(applyToCandidate(range, '', TODAY)).toBeNull();
  });

  it('in-range candidate updates only `to`, preserves `from`', () => {
    const out = applyToCandidate(range, '2026-05-22', TODAY);
    expect(out).toEqual({ from: '2026-05-15', to: '2026-05-22' });
  });

  it('future date clamps to today first, then applies', () => {
    // today (2026-05-23) > range.from (2026-05-15) → just updates to.
    const out = applyToCandidate(range, '2027-01-01', TODAY);
    expect(out).toEqual({ from: '2026-05-15', to: TODAY });
  });

  it('to < from inverts to single-day range at `to`', () => {
    // User picked to=2026-05-10 while from=2026-05-15 → collapse.
    const out = applyToCandidate(range, '2026-05-10', TODAY);
    expect(out).toEqual({ from: '2026-05-10', to: '2026-05-10' });
  });

  it('downstream-keys invariant: result is always valid YYYY-MM-DD', () => {
    // Pin the contract that downstream SWR keys consume — any non-null
    // result MUST be canonical YYYY-MM-DD format so /api/data + 5 sibling
    // routes don't 400.
    const cases: string[] = [
      '2026-05-15',
      '2026-05-23',
      '2027-12-31',
      '1970-01-01',
    ];
    for (const candidate of cases) {
      const out = applyToCandidate(range, candidate, TODAY);
      expect(out).not.toBeNull();
      expect(out!.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(out!.to).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(out!.from <= out!.to).toBe(true);
      expect(out!.to <= TODAY).toBe(true);
    }
  });
});
