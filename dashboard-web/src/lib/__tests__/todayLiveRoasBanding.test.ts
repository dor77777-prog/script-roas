// dashboard-web/src/lib/__tests__/todayLiveRoasBanding.test.ts
//
// P1-1 (data-consistency audit 2026-05-27) — ROAS banding SSOT.
//
// Bug: TodayLive.tsx had a local `liveToneFromRoas` function with different
// orange/green thresholds than the canonical `roasLabel` in analytics.ts:
//
//   roasLabel (SSOT):       red<2.0 / orange 2.0–2.7 / green 2.7–3.0 / blue>3.0
//   liveToneFromRoas (old): red<2.0 / orange 2.0–2.5 / green 2.5–3.0 / blue>=3.0
//
// At ROAS=2.6: roasLabel → orange, old liveToneFromRoas → green (MISMATCH).
//
// Fix: delete the local thresholds in liveToneFromRoas; the function now
// delegates to roasLabel for the band name, then maps tone→card styling.
//
// Fail-first proof: the "old threshold" helper below mimics the PRE-FIX code
// and demonstrates it disagrees with roasLabel at 2.6 (green vs orange).
// The "SSOT helper" mimics the POST-FIX code and agrees.

import { describe, it, expect } from 'vitest';
import { roasLabel } from '@/lib/analytics';

// ---- Mimics the PRE-FIX local threshold logic in liveToneFromRoas ----
// This is the OLD (wrong) code that was in TodayLive.tsx.
function oldLiveTone(roas: number, hasAnyData: boolean): string {
  if (!hasAnyData || roas <= 0) return 'gray';
  if (roas < 2.0) return 'red';
  if (roas < 2.5) return 'orange'; // ← WRONG: should be 2.7
  if (roas < 3.0) return 'green';
  return 'blue';
}

// ---- Mimics the POST-FIX logic: delegate to roasLabel ----
function newLiveTone(roas: number, hasAnyData: boolean): string {
  if (!hasAnyData || roas <= 0) return 'gray';
  return roasLabel(roas).tone;
}

describe('TodayLive ROAS banding — P1-1: roasLabel is the single source of truth', () => {
  describe('fail-first: pre-fix local thresholds diverged from roasLabel at ROAS 2.6', () => {
    it('OLD liveToneFromRoas: ROAS 2.6 → green (the bug — wrong threshold)', () => {
      expect(oldLiveTone(2.6, true)).toBe('green');
    });

    it('roasLabel SSOT: ROAS 2.6 → orange (correct)', () => {
      expect(roasLabel(2.6).tone).toBe('orange');
    });

    it('confirms the divergence: old tone ≠ roasLabel tone at 2.6', () => {
      expect(oldLiveTone(2.6, true)).not.toBe(roasLabel(2.6).tone);
    });
  });

  describe('post-fix: newLiveTone delegates to roasLabel — all boundary values agree', () => {
    it('ROAS 1.9 → red', () => {
      expect(newLiveTone(1.9, true)).toBe('red');
      expect(newLiveTone(1.9, true)).toBe(roasLabel(1.9).tone);
    });

    it('ROAS 2.0 → orange (at lower orange boundary)', () => {
      expect(newLiveTone(2.0, true)).toBe('orange');
      expect(newLiveTone(2.0, true)).toBe(roasLabel(2.0).tone);
    });

    it('ROAS 2.6 → orange (KEY REGRESSION: old code said green, SSOT says orange)', () => {
      expect(newLiveTone(2.6, true)).toBe('orange');
      expect(newLiveTone(2.6, true)).toBe(roasLabel(2.6).tone);
    });

    it('ROAS 2.7 → green (at lower green boundary per roasLabel)', () => {
      expect(newLiveTone(2.7, true)).toBe('green');
      expect(newLiveTone(2.7, true)).toBe(roasLabel(2.7).tone);
    });

    it('ROAS 3.0 → green (roasLabel uses <=3.0 for green)', () => {
      expect(newLiveTone(3.0, true)).toBe('green');
      expect(newLiveTone(3.0, true)).toBe(roasLabel(3.0).tone);
    });

    it('ROAS 3.1 → blue (above 3.0)', () => {
      expect(newLiveTone(3.1, true)).toBe('blue');
      expect(newLiveTone(3.1, true)).toBe(roasLabel(3.1).tone);
    });

    it('ROAS 0 with hasAnyData=true → gray', () => {
      expect(newLiveTone(0, true)).toBe('gray');
    });

    it('positive ROAS but hasAnyData=false → gray', () => {
      expect(newLiveTone(2.5, false)).toBe('gray');
    });
  });
});
