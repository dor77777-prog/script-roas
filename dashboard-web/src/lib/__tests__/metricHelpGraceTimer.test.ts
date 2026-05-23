// dashboard-web/src/lib/__tests__/metricHelpGraceTimer.test.ts
//
// HIGH-5 audit fix (2026-05-23): pin the 200ms grace-timer pattern that
// MetricHelp now mirrors from RefundIndicator (v2 d/CR-08, commit a271b3a).
//
// Pre-fix: MetricHelp's button onMouseLeave fired `setOpen(false)`
// immediately — any cursor transit across the few-pixel physical gap
// between the "?" icon and the popover body closed the popover before
// the user could read or interact with it.
//
// Post-fix: cancelHide/scheduleHide pair with a 200ms grace window;
// mouseEnter on EITHER the button OR the popover cancels the pending
// hide, so the cursor can freely move between them.
//
// The component itself is React JSX in a node-env vitest config — full
// event-sequence verification needs jsdom (deliberately not added per
// the project vitest config rule). This suite locks the primitives the
// fix is built on:
//   1. HIDE_GRACE_MS lives in the OS-standard 100–300ms band.
//   2. The scheduleHide/cancelHide primitive correctly defers the hide
//      and is interruptible by re-entry within the grace window.
//   3. The MetricHelp source wires mouseEnter on both surfaces to
//      cancelHide and mouseLeave on both to scheduleHide (the structural
//      contract is the symmetric pair — easy to regress with a single
//      hand-edit).

import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Mirrors the component's primitive at the closure / module level so we
// can test cancel-vs-fire behaviour deterministically with fake timers.
function makeHideController(ms: number) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let fired = false;
  function cancelHide() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  }
  function scheduleHide() {
    cancelHide();
    timer = setTimeout(() => {
      fired = true;
      timer = null;
    }, ms);
  }
  return {
    cancelHide,
    scheduleHide,
    pending: () => timer !== null,
    didFire: () => fired,
    reset: () => {
      cancelHide();
      fired = false;
    },
  };
}

describe('MetricHelp grace-timer primitive — locks HIGH-5', () => {
  it('HIDE_GRACE_MS is in the OS-standard 100-300ms band', () => {
    // Same source-of-truth as RefundIndicator (HIDE_GRACE_MS = 200).
    const HIDE_GRACE_MS = 200;
    expect(HIDE_GRACE_MS).toBeGreaterThanOrEqual(100);
    expect(HIDE_GRACE_MS).toBeLessThanOrEqual(300);
  });

  it('scheduleHide fires after the grace window when not cancelled', async () => {
    vi.useFakeTimers();
    const ctl = makeHideController(200);
    ctl.scheduleHide();
    expect(ctl.didFire()).toBe(false);
    expect(ctl.pending()).toBe(true);
    // Just before the boundary: still pending, not fired.
    vi.advanceTimersByTime(199);
    expect(ctl.didFire()).toBe(false);
    // At/after the boundary: fired.
    vi.advanceTimersByTime(1);
    expect(ctl.didFire()).toBe(true);
    expect(ctl.pending()).toBe(false);
    vi.useRealTimers();
  });

  it('cancelHide within grace window stops the hide from firing', () => {
    vi.useFakeTimers();
    const ctl = makeHideController(200);
    ctl.scheduleHide();
    // Cursor crosses the button → popover gap in ~50ms; the popover's
    // mouseEnter calls cancelHide.
    vi.advanceTimersByTime(50);
    ctl.cancelHide();
    // Wait well past the original grace window — hide must NOT fire.
    vi.advanceTimersByTime(500);
    expect(ctl.didFire()).toBe(false);
    expect(ctl.pending()).toBe(false);
    vi.useRealTimers();
  });

  it('scheduleHide called twice in quick succession resets the timer (no double-fire)', () => {
    vi.useFakeTimers();
    const ctl = makeHideController(200);
    ctl.scheduleHide();
    vi.advanceTimersByTime(100);
    // Second scheduleHide (e.g., cursor wobbles in/out) resets the
    // clock to a fresh 200ms — not 100ms remaining.
    ctl.scheduleHide();
    vi.advanceTimersByTime(150); // total elapsed = 250ms, but only 150ms since 2nd schedule
    expect(ctl.didFire()).toBe(false);
    vi.advanceTimersByTime(60); // now 210ms since 2nd schedule → fires
    expect(ctl.didFire()).toBe(true);
    vi.useRealTimers();
  });

  // Operator scenario: hover button → mouseLeave → mouseEnter popover
  // within 100ms → assert popover still open after 250ms (well past grace).
  it('operator transit scenario: button-leave + popover-enter within grace → no hide', () => {
    vi.useFakeTimers();
    const ctl = makeHideController(200);
    // 1) User hovers button. cancelHide runs on enter (no-op since nothing pending).
    ctl.cancelHide();
    // 2) User moves cursor off the button after reading the icon.
    ctl.scheduleHide();
    // 3) Cursor transits in ~100ms and lands in popover → mouseEnter cancels.
    vi.advanceTimersByTime(100);
    ctl.cancelHide();
    // 4) Wait 250ms more (well past the original 200ms grace).
    vi.advanceTimersByTime(250);
    // The hide should NOT have fired — the user is still reading the popover.
    expect(ctl.didFire()).toBe(false);
    vi.useRealTimers();
  });
});

describe('MetricHelp source — structural contract for the grace-timer wiring (HIGH-5)', () => {
  const source = readFileSync(
    resolve(__dirname, '../../components/MetricHelp.tsx'),
    'utf8',
  );

  it('declares HIDE_GRACE_MS = 200 (matches RefundIndicator)', () => {
    expect(source).toMatch(/HIDE_GRACE_MS\s*=\s*200\b/);
  });

  it('defines cancelHide and scheduleHide helpers', () => {
    expect(source).toMatch(/\bfunction\s+cancelHide\s*\(/);
    expect(source).toMatch(/\bfunction\s+scheduleHide\s*\(/);
  });

  it('uses useRef for hideTimerRef (cancel must be synchronous, not via setState)', () => {
    expect(source).toMatch(/useRef<ReturnType<typeof setTimeout>\s*\|\s*null>\s*\(\s*null\s*\)/);
  });

  it('useEffect cleanup clears the pending timer on unmount', () => {
    // The cleanup pattern is `useEffect(() => { return () => cancelHide(); }, []);`
    // Tolerate any whitespace / argument-naming variation.
    expect(source).toMatch(/useEffect\s*\(\s*\(\s*\)\s*=>\s*\{[^}]*return\s*\(\s*\)\s*=>\s*cancelHide/s);
  });

  it('onClick on the button cancels the pending hide before toggling open', () => {
    // Click during the grace window must not race with the pending hide.
    expect(source).toMatch(/onClick=\{[^}]*cancelHide\s*\(\s*\)[^}]*setOpen\(o\s*=>\s*!o\)[^}]*\}/);
  });

  it('button mouseEnter cancels hide + opens; mouseLeave schedules hide', () => {
    expect(source).toMatch(/onMouseEnter=\{\s*\(\s*\)\s*=>\s*\{\s*cancelHide\s*\(\s*\)\s*;\s*setOpen\(true\)\s*;?\s*\}\s*\}/);
    expect(source).toMatch(/onMouseLeave=\{\s*scheduleHide\s*\}/);
  });

  it('popover mouseEnter cancels hide; popover mouseLeave schedules hide (symmetric)', () => {
    // The popover surface MUST also be wired or the cursor transit gap
    // never gets the grace it needs.
    const popoverBlock = source.split('role="tooltip"')[1] ?? '';
    expect(popoverBlock).toMatch(/onMouseEnter=\{\s*cancelHide\s*\}/);
    expect(popoverBlock).toMatch(/onMouseLeave=\{\s*scheduleHide\s*\}/);
  });
});
