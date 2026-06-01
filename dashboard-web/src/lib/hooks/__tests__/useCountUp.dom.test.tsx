import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCountUp } from '../useCountUp';

/**
 * Drives `requestAnimationFrame` manually so we can assert the eased
 * progression deterministically, and installs a controllable
 * `prefers-reduced-motion` matchMedia stub per test.
 */
let rafQueue: FrameRequestCallback[] = [];
let rafId = 0;

function flushFrame(ts: number) {
  const cbs = rafQueue;
  rafQueue = [];
  act(() => {
    cbs.forEach((cb) => cb(ts));
  });
}

function installReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: query.includes('prefers-reduced-motion') ? reduce : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  rafQueue = [];
  rafId = 0;
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    rafQueue.push(cb);
    return ++rafId;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useCountUp', () => {
  it('reduced-motion → returns the final value immediately (no animation)', () => {
    installReducedMotion(true);
    const { result } = renderHook(() => useCountUp(1172));
    // Lazy init already returns the target; the effect confirms it.
    act(() => {}); // flush the mount effect
    expect(result.current).toBe(1172);
    // No frame was scheduled because we never enter the animation branch.
    expect(rafQueue.length).toBe(0);
  });

  it('animates from 0 toward the target, settling exactly on it', () => {
    installReducedMotion(false);
    const { result } = renderHook(() => useCountUp(100, { durationMs: 1000 }));
    // First client render starts at 0.
    expect(result.current).toBe(0);
    // t=0 establishes the start timestamp; value still 0.
    flushFrame(0);
    expect(result.current).toBe(0);
    // Halfway (t=500/1000): eased value is between 0 and 100, and past linear
    // midpoint because ease-out is front-loaded (1-(1-.5)^3 = 0.875 → 87.5).
    flushFrame(500);
    expect(result.current).toBeGreaterThan(50);
    expect(result.current).toBeLessThan(100);
    // At/after the full duration it lands EXACTLY on the target.
    flushFrame(1000);
    expect(result.current).toBe(100);
  });

  it('null target → returns 0 (caller renders the em-dash placeholder)', () => {
    installReducedMotion(false);
    const { result } = renderHook(() => useCountUp(null));
    expect(result.current).toBe(0);
    expect(rafQueue.length).toBe(0);
  });

  it('retargets from the currently-displayed value, not back to 0', () => {
    installReducedMotion(false);
    const { result, rerender } = renderHook(
      ({ t }: { t: number }) => useCountUp(t, { durationMs: 1000 }),
      { initialProps: { t: 100 } },
    );
    flushFrame(0);
    flushFrame(1000); // settle on 100
    expect(result.current).toBe(100);
    // New target — the next animation must START from 100, never snap to 0.
    rerender({ t: 200 });
    flushFrame(2000);
    expect(result.current).toBeGreaterThanOrEqual(100);
    flushFrame(3000);
    expect(result.current).toBe(200);
  });
});
