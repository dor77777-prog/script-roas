// dashboard-web/src/lib/__tests__/cloudSyncRetrySchedule.test.ts
//
// Phase 12.5.x audit fix (2026-05-24, MEDIUM #5) — regression test for the
// extended retry schedule on `cloudSync.postWithRetry`.
//
// Pre-fix: 2 attempts total (initial + one retry after 5s). On a brief
// network blip longer than 5s the second attempt would also fail and the
// push silently dropped, leaving partner devices out of sync indefinitely.
//
// Post-fix: 4 attempts with delays 5s, 15s, 45s (total ~65s window) so a
// transient network outage has multiple chances to succeed before we mark
// the sync state as 'error'.
//
// Strategy: stub window + fetch, call pushCloudKey, advance fake timers
// through the retry schedule, and count fetch calls.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (e: Event) => void;

function makeFakeWindow(): {
  win: typeof window;
  store: Map<string, string>;
  listenersByType: Map<string, Set<Listener>>;
} {
  const store = new Map<string, string>();
  const listenersByType = new Map<string, Set<Listener>>();
  const localStorage: Storage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    removeItem: (k: string) => {
      store.delete(k);
    },
    setItem: (k: string, v: string) => {
      store.set(k, String(v));
    },
  };
  const win = {
    localStorage,
    addEventListener: (type: string, listener: EventListener) => {
      if (!listenersByType.has(type)) listenersByType.set(type, new Set());
      listenersByType.get(type)!.add(listener as Listener);
    },
    removeEventListener: (type: string, listener: EventListener) => {
      listenersByType.get(type)?.delete(listener as Listener);
    },
    dispatchEvent: (ev: Event) => {
      const ls = listenersByType.get(ev.type);
      if (ls) for (const l of [...ls]) l(ev);
      return true;
    },
  } as unknown as typeof window;
  return { win, store, listenersByType };
}

class FakeCustomEvent<T = unknown> extends Event {
  detail: T;
  constructor(type: string, init?: { detail?: T }) {
    super(type);
    this.detail = (init?.detail ?? undefined) as T;
  }
}

let priorWindow: unknown;
let priorCustomEvent: unknown;
let priorFetch: unknown;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  priorWindow = (globalThis as unknown as { window?: unknown }).window;
  priorCustomEvent = (globalThis as unknown as { CustomEvent?: unknown }).CustomEvent;
  priorFetch = globalThis.fetch;
  (globalThis as unknown as { CustomEvent: typeof FakeCustomEvent }).CustomEvent =
    FakeCustomEvent;
});

afterEach(() => {
  vi.useRealTimers();
  (globalThis as unknown as { window?: unknown }).window = priorWindow;
  (globalThis as unknown as { CustomEvent?: unknown }).CustomEvent = priorCustomEvent;
  globalThis.fetch = priorFetch as typeof fetch;
});

describe('cloudSync retry schedule (Phase 12.5.x — MEDIUM #5)', () => {
  it('attempts up to 4 times when fetch keeps failing, then gives up', async () => {
    const fw = makeFakeWindow();
    (globalThis as unknown as { window: typeof window }).window = fw.win;

    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls++;
      return new Response('{"error":"network"}', { status: 500 });
    }) as typeof fetch;

    const { pushCloudKey } = await import('@/lib/cloudSync');
    pushCloudKey('roas-dashboard:billing-recurring', [{ id: 'r1' }]);

    // pushCloudKey schedules the initial post after a 400ms debounce window.
    // Advance past that so the first fetch fires.
    await vi.advanceTimersByTimeAsync(500);
    expect(fetchCalls).toBe(1);

    // After the first failure: retry scheduled at +5s. Advance and assert.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchCalls).toBe(2);

    // After the second failure: retry scheduled at +15s.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchCalls).toBe(3);

    // After the third failure: retry scheduled at +45s.
    await vi.advanceTimersByTimeAsync(45_000);
    expect(fetchCalls).toBe(4);

    // MAX_ATTEMPTS reached — no further retry. Advance a long time and
    // assert the call count hasn't moved.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchCalls).toBe(4);
  });

  it('stops retrying once a fetch succeeds (no over-retry)', async () => {
    const fw = makeFakeWindow();
    (globalThis as unknown as { window: typeof window }).window = fw.win;

    let fetchCalls = 0;
    globalThis.fetch = (async () => {
      fetchCalls++;
      // Fail twice, succeed on the third.
      if (fetchCalls < 3) return new Response('{"error":"network"}', { status: 500 });
      return new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch;

    const { pushCloudKey } = await import('@/lib/cloudSync');
    pushCloudKey('roas-dashboard:billing-recurring', [{ id: 'r1' }]);

    await vi.advanceTimersByTimeAsync(500); // debounce
    expect(fetchCalls).toBe(1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(fetchCalls).toBe(2);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetchCalls).toBe(3); // success on attempt 3

    // No further retry scheduled. Advance past the 45s window — still 3.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchCalls).toBe(3);
  });
});
