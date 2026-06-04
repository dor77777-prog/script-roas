/**
 * BUG #2 regression — auto-refresh must update data IN PLACE, never blanking
 * the cached value to `undefined` for the duration of the refetch.
 *
 * Root cause (confirmed against swr 2.4.x internals): a global
 * `mutate(() => true, undefined, { revalidate: true })` passes THREE args, so
 * SWR does NOT take its "no data → just revalidate" early path. Instead, with
 * `populateCache` defaulting to `true`, it synchronously runs
 * `set({ data: undefined, ... })` for every matched key BEFORE the revalidation
 * resolves (see the upstream comment "Data can be `undefined` here."). Any
 * consumer that gates a loading/empty branch on `!data` then re-renders that
 * branch → the mounted view (open drawer / expanded sub-view / scroll position
 * / sub-selection) UNMOUNTS and REMOUNTS → the operator's screen resets.
 *
 * The fix calls `mutate(() => true)` with NO data arg (SWR's bound mutate then
 * receives < 3 args and takes the early "just revalidate" path) so it
 * revalidates in the BACKGROUND and keeps the previous data on screen
 * throughout the refetch.
 *
 * This test renders the exact wiring (useAutoRefresh → global mutate) over a
 * real SWRConfig cache and asserts that across a refresh tick:
 *   - the consumer's `data` is never observed as `undefined` after first load, and
 *   - the mounted live subtree is NOT torn down (mount counter stays at 1).
 */
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { useEffect, useRef } from 'react';
import useSWR, { SWRConfig, useSWRConfig } from 'swr';
import { useAutoRefresh } from '@/lib/hooks/useAutoRefresh';

// A consumer that mirrors how real Dashboard tabs gate their loading branch:
// `!data` renders a skeleton (a brand-new subtree), otherwise the live view.
// We track how many times the LIVE subtree mounts; a blip to `!data` would
// unmount it and bump the counter on remount.
function Consumer({
  swrKey,
  onLiveMount,
  onData,
}: {
  swrKey: string;
  onLiveMount: () => void;
  onData: (d: string | undefined) => void;
}) {
  const { data } = useSWR<string>(swrKey, () => Promise.resolve('LIVE-DATA'), {
    revalidateOnFocus: false,
  });
  // Record every observed value of `data` so the test can assert it never
  // blips back to undefined after the first successful load.
  onData(data);
  if (!data) {
    return <div data-testid="loading">loading…</div>;
  }
  return <LiveView onMount={onLiveMount} value={data} />;
}

function LiveView({ onMount, value }: { onMount: () => void; value: string }) {
  const mounted = useRef(false);
  useEffect(() => {
    // Only count true (re)mounts, not value-prop re-renders.
    if (!mounted.current) {
      mounted.current = true;
      onMount();
    }
    return () => {
      mounted.current = false;
    };
  }, [onMount]);
  return <div data-testid="live">{value}</div>;
}

// Drives the global auto-refresh exactly like Dashboard does. `refreshRef` is
// populated with the mutate-callback so the test can fire a tick deterministically
// and inspect the result.
function RefreshHarness({
  swrKey,
  onLiveMount,
  onData,
  refreshRef,
}: {
  swrKey: string;
  onLiveMount: () => void;
  onData: (d: string | undefined) => void;
  refreshRef: { current: (() => void) | null };
}) {
  const { mutate: swrMutate } = useSWRConfig();
  // The FIXED wiring under test. (The buggy version passed `undefined` +
  // { revalidate: true } as the 2nd/3rd args, which SWR turns into a
  // synchronous `set({ data: undefined })` before revalidation resolves.)
  const refresh = () => {
    void swrMutate(() => true);
  };
  refreshRef.current = refresh;
  useAutoRefresh(refresh, { intervalMs: 60_000 });
  return <Consumer swrKey={swrKey} onLiveMount={onLiveMount} onData={onData} />;
}

async function flush(): Promise<void> {
  // Flush a few microtask turns so SWR's revalidation promise chain settles.
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
}

describe('useAutoRefresh — refresh updates in place (no view reset)', () => {
  it('does NOT blank cached data to undefined on a global revalidate, so the live view stays mounted', async () => {
    const onLiveMount = vi.fn();
    const observed: Array<string | undefined> = [];
    const refreshRef: { current: (() => void) | null } = { current: null };
    const swrKey = '/api/test-key';

    // Fresh provider cache per test so keys don't leak between cases.
    render(
      <SWRConfig value={{ provider: () => new Map() }}>
        <RefreshHarness
          swrKey={swrKey}
          onLiveMount={onLiveMount}
          onData={(d) => observed.push(d)}
          refreshRef={refreshRef}
        />
      </SWRConfig>,
    );

    // Initial load resolves → live view mounts once.
    await waitFor(() => expect(screen.queryByTestId('live')).not.toBeNull());
    expect(onLiveMount).toHaveBeenCalledTimes(1);

    // Mark the boundary: everything observed from here is "during/after refresh".
    const observedBeforeRefresh = observed.length;

    // Fire an auto-refresh tick (the same callback useAutoRefresh runs every 60s
    // and on visibilitychange), then let the revalidation settle.
    await act(async () => {
      refreshRef.current?.();
      await flush();
    });

    // The loading branch must NEVER reappear, and `data` must never blip to
    // undefined after the first load.
    expect(screen.queryByTestId('loading')).toBeNull();
    expect(screen.queryByTestId('live')).not.toBeNull();
    const observedDuringRefresh = observed.slice(observedBeforeRefresh);
    expect(observedDuringRefresh.every((d) => d !== undefined)).toBe(true);

    // The live subtree was never torn down → still exactly one mount.
    expect(onLiveMount).toHaveBeenCalledTimes(1);
  });

  it('fires the refresh callback on the 60s interval tick', async () => {
    vi.useFakeTimers();
    try {
      const ticks: number[] = [];
      function TickHarness() {
        useAutoRefresh(() => ticks.push(Date.now()), { intervalMs: 60_000 });
        return null;
      }
      render(<TickHarness />);
      expect(ticks).toHaveLength(0);
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(ticks).toHaveLength(1);
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      expect(ticks).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });
});
