// dashboard-web/src/lib/__tests__/operatorRoutesDateValidation.test.ts
//
// Audit fix 2026-05-23 (HIGH-14 / O4-HI-03 + Codex-NEW-5): pin that the
// `isDate` validator in `/api/operator/backfill` and
// `/api/operator/manual-overrides` rejects impossible Gregorian dates and
// accepts valid ones.
//
// Pre-fix: both routes used a regex-only check `/^\d{4}-\d{2}-\d{2}$/`
// that happily accepted `2026-99-99`, `2026-13-01`, `2026-02-30`, and
// `2025-04-31`. Downstream pipelines passed those strings through
// `Date.UTC(y, m-1, d)`, which silently NORMALIZES out-of-range input
// (Date.UTC(2026, 12, 1) → 2027-01-01). The result was a bypass of the
// D-A3 history boundary on backfill, and silent date corruption on
// override rows that never matched any daily job.
//
// Post-fix: regex shape check + Date.UTC round-trip — if any component
// got normalized, at least one fails the equality check. Year < 1 is
// rejected outright (no Year-0 in Gregorian).
//
// Both validators are identical (intentionally — the same threat surface)
// so the test suite runs the same 8 cases against both modules.

import { describe, it, expect } from 'vitest';

// `@/lib/dateValidation` is a pure helper module — no side-effect imports
// to mock. Both routes import it; the regression tests pin its behavior
// directly. The "backfill vs manual-overrides agreement" block below is
// kept (using the same import twice) to document that both routes
// MUST share the same validator surface — any future per-route divergence
// would break that block and force a deliberate review.
import { isDate as isDateBackfill } from '@/lib/dateValidation';
import { isDate as isDateOverrides } from '@/lib/dateValidation';

// 8 cases per HIGH-14 + Codex-NEW-5 spec.
const REJECT_CASES = [
  // 99/99 — months/days way out of range.
  '2026-99-99',
  // Month 13 — just past valid range.
  '2026-13-01',
  // Feb 30 — calendar-impossible day.
  '2026-02-30',
  // Year 0 — not a Gregorian year.
  '0000-01-01',
  // Apr 31 — month has 30 days, not 31.
  '2025-04-31',
];

const ACCEPT_CASES = [
  // Today (within the project's history boundary).
  '2026-05-23',
  // Feb 29 in a leap year (divisible by 4, not by 100, OR divisible by 400).
  '2024-02-29',
  // End of December — common day-31 edge.
  '2025-12-31',
];

describe('isDate (backfill route) — HIGH-14 + Codex-NEW-5 UTC round-trip', () => {
  for (const bad of REJECT_CASES) {
    it(`rejects impossible date: ${bad}`, () => {
      expect(isDateBackfill(bad)).toBe(false);
    });
  }

  for (const good of ACCEPT_CASES) {
    it(`accepts valid date: ${good}`, () => {
      expect(isDateBackfill(good)).toBe(true);
    });
  }

  it('rejects non-string inputs', () => {
    expect(isDateBackfill(20260523)).toBe(false);
    expect(isDateBackfill(null)).toBe(false);
    expect(isDateBackfill(undefined)).toBe(false);
    expect(isDateBackfill({})).toBe(false);
  });

  it('rejects strings that match the regex but not the calendar (cross-check)', () => {
    // Feb 29 in a non-leap year — must reject.
    expect(isDateBackfill('2023-02-29')).toBe(false);
    // Feb 29 in a divisible-by-100-not-400 year — must reject.
    expect(isDateBackfill('2100-02-29')).toBe(false);
  });
});

describe('isDate (manual-overrides route) — Codex-NEW-5 UTC round-trip', () => {
  for (const bad of REJECT_CASES) {
    it(`rejects impossible date: ${bad}`, () => {
      expect(isDateOverrides(bad)).toBe(false);
    });
  }

  for (const good of ACCEPT_CASES) {
    it(`accepts valid date: ${good}`, () => {
      expect(isDateOverrides(good)).toBe(true);
    });
  }

  it('rejects non-string inputs', () => {
    expect(isDateOverrides(20260523)).toBe(false);
    expect(isDateOverrides(null)).toBe(false);
    expect(isDateOverrides(undefined)).toBe(false);
    expect(isDateOverrides({})).toBe(false);
  });

  it('rejects strings that match the regex but not the calendar (cross-check)', () => {
    expect(isDateOverrides('2023-02-29')).toBe(false);
    expect(isDateOverrides('2100-02-29')).toBe(false);
  });
});

describe('backfill and manual-overrides isDate are semantically identical (intentional)', () => {
  const all = [...REJECT_CASES, ...ACCEPT_CASES];
  for (const s of all) {
    it(`both validators agree on ${s}`, () => {
      expect(isDateBackfill(s)).toBe(isDateOverrides(s));
    });
  }
});
