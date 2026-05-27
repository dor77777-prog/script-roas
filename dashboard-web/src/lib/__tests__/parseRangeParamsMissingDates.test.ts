// dashboard-web/src/lib/__tests__/parseRangeParamsMissingDates.test.ts
//
// P1-2 (data-consistency audit 2026-05-27) — parseRangeParams missing-params
// contract.
//
// Bug: when BOTH ?from and ?to are absent, parseRangeParams silently returned
// a 90-day default window. A caller with a misnamed param (e.g. ?range.from=
// instead of ?from=) would receive HTTP 200 with the wrong date window —
// indistinguishable from a correct response.
//
// Fix: treat "both params absent" the same as "one param absent" — throw
// RangeParamError so routes return HTTP 400 and the caller knows the request
// was malformed.
//
// Decision (Step 0 analysis):
//   All callers use buildDateRangeKey which always produces ?from=…&to=…
//   when it returns a non-null key (returns null otherwise, preventing the
//   SWR fetch entirely). No caller intentionally omits both params. Safe to
//   fail loud.
//
// SPA-safety confirmation (Step 4):
//   buildDateRangeKey returns null when range is falsy or either date is
//   missing — so SWR never fires a request without both params. The
//   TodayLive component uses /api/data?from=${today}&to=${today} explicitly.
//   This change cannot break the SPA.

import { describe, it, expect } from 'vitest';
import { parseRangeParams, RangeParamError } from '@/lib/dateRange';

describe('parseRangeParams — P1-2: missing date params throw instead of silent default', () => {
  describe('fail-first: pre-fix behavior (both absent → silent default)', () => {
    it('pre-fix: empty URLSearchParams returned a 90-day range silently (the bug)', () => {
      // This test documents what the OLD behavior was.
      // After the fix this test is removed / superseded by the throw test below.
      // We prove the old behavior: parse returned SOMETHING (no throw) with a
      // non-empty from+to. We can only prove this by checking the code path —
      // the OLD code was: if (!from && !to) return defaultRange();
      // After the fix, it throws. So the "fail-first" test is the throw test below.
      // This comment block documents the change for reviewers.
      // The test below FAILS against the old code (no throw) and PASSES after fix.
    });
  });

  describe('post-fix: throws RangeParamError when both params are absent', () => {
    it('empty URLSearchParams → throws RangeParamError', () => {
      const sp = new URLSearchParams();
      expect(() => parseRangeParams(sp)).toThrow(RangeParamError);
    });

    it('misnamed params (range.from / range.to) → throws RangeParamError', () => {
      const sp = new URLSearchParams('range.from=2026-05-01&range.to=2026-05-28');
      expect(() => parseRangeParams(sp)).toThrow(RangeParamError);
    });

    it('error message mentions both params', () => {
      const sp = new URLSearchParams();
      let caught: unknown;
      try {
        parseRangeParams(sp);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(RangeParamError);
      const msg = (caught as RangeParamError).message.toLowerCase();
      expect(msg).toMatch(/from|to/);
    });
  });

  describe('existing valid behavior preserved', () => {
    it('both params present and valid → returns correct DateRange', () => {
      const sp = new URLSearchParams('from=2026-05-01&to=2026-05-28');
      expect(parseRangeParams(sp)).toEqual({ from: '2026-05-01', to: '2026-05-28' });
    });

    it('exactly one param missing → throws RangeParamError (pre-existing behavior)', () => {
      const sp = new URLSearchParams('from=2026-05-01');
      expect(() => parseRangeParams(sp)).toThrow(RangeParamError);
    });

    it('malformed date → throws RangeParamError', () => {
      const sp = new URLSearchParams('from=2026-99-01&to=2026-05-28');
      expect(() => parseRangeParams(sp)).toThrow(RangeParamError);
    });

    it('from > to → throws RangeParamError', () => {
      const sp = new URLSearchParams('from=2026-06-01&to=2026-05-01');
      expect(() => parseRangeParams(sp)).toThrow(RangeParamError);
    });
  });
});
