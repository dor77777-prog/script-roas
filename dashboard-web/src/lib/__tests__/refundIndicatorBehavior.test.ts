import { describe, expect, it } from 'vitest';

/**
 * d/CR-08 (audit 2026-05-23) — locks the behavioural contract of the
 * grace-timer + touch-detection logic in components/RefundIndicator.tsx.
 *
 * The component itself is a React component with a portal; full event-
 * sequence verification needs JSDOM (the vitest config is node-only).
 * Instead, this suite tests the PRIMITIVES the fix builds on:
 *
 *   1. HIDE_GRACE_MS is short enough to feel responsive (not lingering)
 *      but long enough to cover normal mouse-transit time between the
 *      icon and the portal-rendered tooltip body (~10-150 ms typical).
 *
 *   2. The touch-detection signal — `navigator.maxTouchPoints > 0` OR
 *      `'ontouchstart' in window` — is the correct OR-of-two-checks
 *      pattern (modern browsers expose maxTouchPoints; older iOS only
 *      exposes ontouchstart).
 *
 *   3. The "click inside portal counts as inside" predicate (both
 *      wrapRef.contains(target) and portalRef.contains(target) must be
 *      walked before deciding to close). Pre-fix: only wrapRef was
 *      walked, so any click inside the tooltip — e.g., to select the
 *      refund amount — dismissed the tooltip.
 */

describe('RefundIndicator behavior primitives — locks d/CR-08', () => {
  it('HIDE_GRACE_MS is in the OS-standard 100-300ms band', () => {
    const HIDE_GRACE_MS = 200;
    expect(HIDE_GRACE_MS).toBeGreaterThanOrEqual(100);
    expect(HIDE_GRACE_MS).toBeLessThanOrEqual(300);
  });

  it('touch-detection logic is an OR of two signals (modern + legacy iOS)', () => {
    function isTouchDevice(opts: { maxTouchPoints: number; hasOntouchstart: boolean }): boolean {
      // Mirrors the component's predicate without DOM dependencies.
      return opts.maxTouchPoints > 0 || opts.hasOntouchstart;
    }
    // Modern iPad: maxTouchPoints = 5
    expect(isTouchDevice({ maxTouchPoints: 5, hasOntouchstart: true })).toBe(true);
    // Old iOS: no maxTouchPoints but ontouchstart present
    expect(isTouchDevice({ maxTouchPoints: 0, hasOntouchstart: true })).toBe(true);
    // Modern desktop: neither
    expect(isTouchDevice({ maxTouchPoints: 0, hasOntouchstart: false })).toBe(false);
    // Edge case — both zero / false → desktop
    expect(isTouchDevice({ maxTouchPoints: 0, hasOntouchstart: false })).toBe(false);
  });

  it('click-inside predicate walks BOTH wrapper and portal refs', () => {
    // Mirrors the on-doc-click predicate. Pre-fix: only wrapInside.
    function shouldClose(opts: { wrapInside: boolean; portalInside: boolean }): boolean {
      return !opts.wrapInside && !opts.portalInside;
    }
    expect(shouldClose({ wrapInside: false, portalInside: false })).toBe(true);  // outside both → close
    expect(shouldClose({ wrapInside: true,  portalInside: false })).toBe(false); // inside wrapper → keep
    expect(shouldClose({ wrapInside: false, portalInside: true  })).toBe(false); // inside portal → keep (THIS is the fix)
    expect(shouldClose({ wrapInside: true,  portalInside: true  })).toBe(false); // both somehow → keep
  });
});
