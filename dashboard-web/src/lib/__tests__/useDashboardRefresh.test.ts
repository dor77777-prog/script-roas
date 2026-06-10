// dashboard-web/src/lib/__tests__/useDashboardRefresh.test.ts
//
// Regression tests for the global dashboard refresh hook.
//
//   d/CR-03 — cache-bust string was computed ONCE outside the polling loop,
//     so every iteration reused the same `_t=...` URL. A CDN keying on the
//     full URL would happily serve a cached probe response across the entire
//     90s window, defeating the cache bust. Fix: compute Date.now() inside
//     the loop so every fetch is a distinct URL.
//
//   d/MD-04 — the hook never aborted in-flight fetches on unmount. A refresh
//     started right before navigation would still run its poll + mutate(),
//     leaking work + producing setState-on-unmounted warnings. Fix: wire an
//     AbortController per call, pass signal to fetch, and abort() in cleanup.
//
// These are JS-level tests (no React renderer) — we invoke the hook through
// a tiny harness that mimics the React useEffect / useCallback contract.
// That keeps the test fast and lets us assert the exact fetch URLs.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// SWR mock — useSWRConfig().mutate is what the hook depends on.
// ---------------------------------------------------------------------------
const mutateMock = vi.fn();
vi.mock('swr', () => ({
  useSWRConfig: () => ({ mutate: mutateMock }),
}));

// ---------------------------------------------------------------------------
// React mock — implements the minimal subset (useState / useEffect /
// useCallback / useRef) so the hook runs deterministically without a React
// renderer. We track cleanup callbacks so the test can manually trigger
// "unmount" to exercise d/MD-04.
// ---------------------------------------------------------------------------
type StateBox = { v: unknown };
const stateBoxes: StateBox[] = [];
const effectCleanups: Array<() => void> = [];

function resetReactHarness() {
  stateBoxes.length = 0;
  effectCleanups.length = 0;
}

vi.mock('react', async () => {
  return {
    useState: <T,>(initial: T): [T, (v: T) => void] => {
      const box: StateBox = { v: initial };
      stateBoxes.push(box);
      return [box.v as T, (v: T) => { box.v = v; }];
    },
    useEffect: (fn: () => void | (() => void)) => {
      const cleanup = fn();
      if (typeof cleanup === 'function') {
        effectCleanups.push(cleanup);
      }
    },
    useCallback: <T,>(fn: T) => fn,
    useRef: <T,>(initial: T) => ({ current: initial }),
  };
});

// Import AFTER mocks are set up.
import { useDashboardRefresh } from '../useDashboardRefresh';

// ---------------------------------------------------------------------------
// fetch mock — track every URL the hook requested. We seed responses so the
// poll loop exits on the second iteration (writeTs > triggerTime).
// ---------------------------------------------------------------------------

let fetchCalls: Array<{ url: string; signal?: AbortSignal }> = [];
let fetchImpl: (url: string, init?: RequestInit) => Promise<Response>;

beforeEach(() => {
  vi.useFakeTimers();
  resetReactHarness();
  mutateMock.mockReset();
  fetchCalls = [];
  // Default impl: sync-now succeeds 200; probe returns a writeAt past the
  // trigger time on the SECOND poll. First poll returns stale writeAt to
  // force at least 2 iterations so we can verify the URL changes each time.
  let probeIter = 0;
  fetchImpl = async (url: string, init?: RequestInit) => {
    fetchCalls.push({ url, signal: init?.signal as AbortSignal | undefined });
    if (url.startsWith('/api/operator/sync-now')) {
      return new Response(JSON.stringify({}), { status: 202 });
    }
    if (url.startsWith('/api/data')) {
      probeIter++;
      // First iteration: stale write. Second+: fresh (well past Date.now()
      // at trigger time so the hook breaks out).
      const writeAt =
        probeIter === 1
          ? new Date(Date.now() - 60_000).toISOString()
          : new Date(Date.now() + 60_000).toISOString();
      return new Response(JSON.stringify({ dataLastWriteAt: writeAt }), {
        status: 200,
      });
    }
    return new Response('', { status: 404 });
  };
  globalThis.fetch = ((url: string, init?: RequestInit) =>
    fetchImpl(url, init)) as typeof fetch;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useDashboardRefresh (d/CR-03 — cache-bust is per-iteration)', () => {
  it('uses a unique _t cache-bust value on every poll iteration', async () => {
    const { refresh } = useDashboardRefresh();
    // Kick off the refresh — but don't await yet; we need to drive the timers.
    const done = refresh();
    // Let the sync-now POST resolve.
    await Promise.resolve();
    await Promise.resolve();

    // First poll tick.
    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.resolve();
    // Second poll tick (should produce a fresh dataLastWriteAt and break out).
    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.resolve();
    await done;

    const probeUrls = fetchCalls
      .map(c => c.url)
      .filter(u => u.startsWith('/api/data'));
    expect(probeUrls.length).toBeGreaterThanOrEqual(2);
    // Each probe URL must be UNIQUE — Date.now() advances between iterations.
    const unique = new Set(probeUrls);
    expect(unique.size).toBe(probeUrls.length);
    // Sanity: every probe URL carries a VALID 1-day from/to (P1-20,
    // 2026-06-10 — /api/data without range params 400s since P1-2, so the
    // old bare `?_t=` probe never set backendDone and every press ran the
    // full 180s watchdog) plus the cache-bust.
    for (const u of probeUrls) {
      expect(u).toMatch(/^\/api\/data\?from=\d{4}-\d{2}-\d{2}&to=\d{4}-\d{2}-\d{2}&_t=\d+$/);
      const m = u.match(/from=(\d{4}-\d{2}-\d{2})&to=(\d{4}-\d{2}-\d{2})/)!;
      expect(m[1]).toBe(m[2]); // 1-day window — cheapest valid probe
    }
  });
});

describe('useDashboardRefresh (d/MD-04 — aborts in-flight on unmount)', () => {
  it('aborts active fetches when the cleanup runs', async () => {
    const { refresh } = useDashboardRefresh();
    // We need a long-running probe to be in-flight when unmount fires.
    // Stub fetch to return a never-resolving probe.
    let probeAbortedFlag = false;
    fetchImpl = async (url: string, init?: RequestInit) => {
      fetchCalls.push({ url, signal: init?.signal as AbortSignal | undefined });
      if (url.startsWith('/api/operator/sync-now')) {
        return new Response(JSON.stringify({}), { status: 202 });
      }
      // Probe: never resolves on its own; rejects when signal aborts.
      return await new Promise<Response>((_, reject) => {
        const sig = init?.signal as AbortSignal | undefined;
        if (sig) {
          sig.addEventListener('abort', () => {
            probeAbortedFlag = true;
            reject(new DOMException('aborted', 'AbortError'));
          });
        }
      });
    };

    const done = refresh();
    await Promise.resolve();
    await Promise.resolve();
    // Advance one poll tick so the probe fetch starts.
    await vi.advanceTimersByTimeAsync(5_000);
    await Promise.resolve();

    // Simulate unmount → run the registered cleanup.
    expect(effectCleanups.length).toBeGreaterThan(0);
    for (const c of effectCleanups) c();

    // Let the abort propagate.
    await Promise.resolve();
    await Promise.resolve();
    await done;

    expect(probeAbortedFlag).toBe(true);
    // mutate must NOT be called when the hook unmounted mid-refresh.
    expect(mutateMock).not.toHaveBeenCalled();
  });
});
