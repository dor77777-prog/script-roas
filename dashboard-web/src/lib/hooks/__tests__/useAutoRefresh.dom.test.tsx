import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAutoRefresh } from '@/lib/hooks/useAutoRefresh';

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => state,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility('visible');
});

afterEach(() => {
  vi.useRealTimers();
  setVisibility('visible');
});

describe('useAutoRefresh', () => {
  it('does not call onRefresh immediately on mount', () => {
    const onRefresh = vi.fn();
    renderHook(() => useAutoRefresh(onRefresh, { intervalMs: 1000 }));
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('calls onRefresh once per interval, repeatedly', () => {
    const onRefresh = vi.fn();
    renderHook(() => useAutoRefresh(onRefresh, { intervalMs: 1000 }));

    act(() => { vi.advanceTimersByTime(1000); });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    act(() => { vi.advanceTimersByTime(1000); });
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it('calls onRefresh when the document becomes visible (return-to-tab / reopen)', () => {
    const onRefresh = vi.fn();
    renderHook(() => useAutoRefresh(onRefresh, { intervalMs: 1000 }));

    setVisibility('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('does NOT call onRefresh on visibilitychange while the document is hidden', () => {
    const onRefresh = vi.fn();
    renderHook(() => useAutoRefresh(onRefresh, { intervalMs: 1000 }));

    setVisibility('hidden');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('stops firing after unmount (interval cleared + listener removed)', () => {
    const onRefresh = vi.fn();
    const { unmount } = renderHook(() => useAutoRefresh(onRefresh, { intervalMs: 1000 }));

    unmount();

    act(() => { vi.advanceTimersByTime(5000); });
    setVisibility('visible');
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });

    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('always invokes the latest onRefresh callback without re-subscribing', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useAutoRefresh(cb, { intervalMs: 1000 }), {
      initialProps: { cb: first },
    });

    rerender({ cb: second });
    act(() => { vi.advanceTimersByTime(1000); });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });
});
