import { describe, it, expect, afterEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useIsMobile } from '../useIsMobile';

/**
 * Drives `window.matchMedia` so we can assert the hook reflects the breakpoint
 * match and re-renders on a `change` event. The global setup-dom stub returns
 * `matches: false`; here we install a controllable stub per test.
 */
function installMatchMedia(matches: boolean) {
  let handler: ((e: MediaQueryListEvent) => void) | null = null;
  const mql = {
    matches,
    media: '',
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_: string, cb: (e: MediaQueryListEvent) => void) => {
      handler = cb;
    },
    removeEventListener: () => {
      handler = null;
    },
    dispatchEvent: () => false,
  } as unknown as MediaQueryList;
  window.matchMedia = vi.fn().mockReturnValue(mql);
  return {
    fire(next: boolean) {
      (mql as { matches: boolean }).matches = next;
      handler?.({ matches: next } as MediaQueryListEvent);
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('useIsMobile', () => {
  it('returns true when the phone media query matches', () => {
    installMatchMedia(true);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
  });

  it('returns false when the query does not match (desktop)', () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);
  });

  it('passes the custom breakpoint into the media query', () => {
    installMatchMedia(false);
    renderHook(() => useIsMobile(480));
    expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 480px)');
  });
});
