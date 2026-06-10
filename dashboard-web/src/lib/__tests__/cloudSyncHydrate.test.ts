// dashboard-web/src/lib/__tests__/cloudSyncHydrate.test.ts
//
// Regression tests for cloudSync's hydrate-loop error tolerance + the
// partner-clear conflict signal.
//
//   d/MD-01 — dispatchChange in the hydrate loop was unprotected. A single
//     misbehaving listener (one that throws inside its handler) would abort
//     the entire loop, leaving any subsequent keys un-hydrated for that
//     poll cycle. Fix: wrap each dispatchChange in try/catch with warn.
//
//   d/CR-07-soft — when a partner clears a key on another device, hydrate
//     silently overwrites the local value. Don't change the merge contract
//     (auto-merge is intentional), but emit a `roas-cloud-clear-conflict`
//     CustomEvent so SyncIndicator (or any listener) can surface a toast.
//
// Strategy: stub window with the minimal surface cloudSync.hydrateFromCloud
// touches (localStorage, dispatchEvent, addEventListener), mock fetch with
// a controlled payload, then assert the dispatched events.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (e: Event) => void;

function makeFakeWindow(): {
  win: typeof window;
  store: Map<string, string>;
  listenersByType: Map<string, Set<Listener>>;
  dispatchEvents: Event[];
} {
  const store = new Map<string, string>();
  const listenersByType = new Map<string, Set<Listener>>();
  const dispatchEvents: Event[] = [];

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
      dispatchEvents.push(ev);
      const ls = listenersByType.get(ev.type);
      if (ls) {
        // Match window.dispatchEvent: invoke each listener in turn; a
        // throw propagates out (which is the behavior we explicitly want
        // to defend against with the d/MD-01 try/catch).
        for (const l of [...ls]) l(ev);
      }
      return true;
    },
  } as unknown as typeof window;
  return { win, store, listenersByType, dispatchEvents };
}

// Stash whatever `window` was before each test (jsdom-less project), restore
// in afterEach. CustomEvent is missing in the node runtime, so polyfill it
// with a tiny shape that matches what cloudSync constructs.
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
  priorWindow = (globalThis as unknown as { window?: unknown }).window;
  priorCustomEvent = (globalThis as unknown as { CustomEvent?: unknown }).CustomEvent;
  priorFetch = globalThis.fetch;
  (globalThis as unknown as { CustomEvent: typeof FakeCustomEvent }).CustomEvent =
    FakeCustomEvent;
});

afterEach(() => {
  (globalThis as unknown as { window?: unknown }).window = priorWindow;
  (globalThis as unknown as { CustomEvent?: unknown }).CustomEvent =
    priorCustomEvent;
  globalThis.fetch = priorFetch as typeof fetch;
});

describe('cloudSync hydrate (d/MD-01 — guarded dispatchChange)', () => {
  it('continues hydrating remaining keys when a listener throws on one event', async () => {
    const fw = makeFakeWindow();
    (globalThis as unknown as { window: typeof window }).window = fw.win;

    // Cloud returns values for TWO keys. The first key's listener will throw;
    // we want to verify the SECOND key still got hydrated (writeLocal +
    // event).
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({
          kv: {
            annotations: [{ id: 'a1' }],
            'monthly-revenue-goal': 5000,
          },
        }),
        { status: 200 },
      )) as typeof fetch;

    // Register a thrown listener on the FIRST key's change event.
    fw.win.addEventListener('roas-annotations-changed', () => {
      throw new Error('intentionally broken listener');
    });

    const { hydrateFromCloud } = await import('@/lib/cloudSync');
    await hydrateFromCloud();

    // Despite the listener throwing on the first key, the second key's
    // value MUST be written to localStorage by the loop.
    expect(fw.store.get('roas-dashboard:monthly-revenue-goal')).toBe('5000');
  });
});

describe('cloudSync hydrate (d/CR-07-soft — clear-conflict event)', () => {
  it('dispatches roas-cloud-clear-conflict when a partner clears a key', async () => {
    const fw = makeFakeWindow();
    (globalThis as unknown as { window: typeof window }).window = fw.win;
    // Seed a local value so the partner-clear has something to remove.
    fw.store.set('roas-dashboard:monthly-revenue-goal', '4000');

    // Cloud returns the key present but explicit null → "partner cleared it".
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ kv: { 'monthly-revenue-goal': null } }),
        { status: 200 },
      )) as typeof fetch;

    const { hydrateFromCloud } = await import('@/lib/cloudSync');
    await hydrateFromCloud();

    // Local value removed.
    expect(fw.store.has('roas-dashboard:monthly-revenue-goal')).toBe(false);
    // Conflict event fired.
    const conflictEvents = fw.dispatchEvents.filter(
      e => e.type === 'roas-cloud-clear-conflict',
    );
    expect(conflictEvents.length).toBe(1);
    const detail = (conflictEvents[0] as FakeCustomEvent<{ key: string }>).detail;
    expect(detail.key).toBe('roas-dashboard:monthly-revenue-goal');
    // Regular change event also fired (so existing listeners re-read).
    const changeEvents = fw.dispatchEvents.filter(
      e => e.type === 'roas-goal-changed',
    );
    expect(changeEvents.length).toBe(1);
  });
});

describe('cloudSync hydrate (P1-18 — equality guard, 2026-06-10 audit)', () => {
  it('does NOT write or dispatch when the cloud value equals the local value', async () => {
    const fw = makeFakeWindow();
    (globalThis as unknown as { window: typeof window }).window = fw.win;
    // Local already holds exactly what the cloud returns.
    fw.store.set('roas-dashboard:monthly-revenue-goal', '5000');

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ kv: { 'monthly-revenue-goal': 5000 } }),
        { status: 200 },
      )) as typeof fetch;

    const { hydrateFromCloud } = await import('@/lib/cloudSync');
    await hydrateFromCloud();

    // Value unchanged AND no change event — pre-fix this dispatched
    // 'roas-goal-changed' (and every other key's event) on EVERY 30s poll,
    // triggering hidden refetch + re-aggregate cascades.
    expect(fw.store.get('roas-dashboard:monthly-revenue-goal')).toBe('5000');
    const changeEvents = fw.dispatchEvents.filter(
      e => e.type === 'roas-goal-changed',
    );
    expect(changeEvents.length).toBe(0);
  });

  it('still writes + dispatches when the cloud value DIFFERS', async () => {
    const fw = makeFakeWindow();
    (globalThis as unknown as { window: typeof window }).window = fw.win;
    fw.store.set('roas-dashboard:monthly-revenue-goal', '4000');

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ kv: { 'monthly-revenue-goal': 5000 } }),
        { status: 200 },
      )) as typeof fetch;

    const { hydrateFromCloud } = await import('@/lib/cloudSync');
    await hydrateFromCloud();

    expect(fw.store.get('roas-dashboard:monthly-revenue-goal')).toBe('5000');
    expect(
      fw.dispatchEvents.filter(e => e.type === 'roas-goal-changed').length,
    ).toBe(1);
  });

  it('a null cloud row with NO local value is a no-op (no clear-conflict storm)', async () => {
    const fw = makeFakeWindow();
    (globalThis as unknown as { window: typeof window }).window = fw.win;
    // No local value at all.

    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ kv: { 'monthly-revenue-goal': null } }),
        { status: 200 },
      )) as typeof fetch;

    const { hydrateFromCloud } = await import('@/lib/cloudSync');
    await hydrateFromCloud();

    // Pre-fix: clear-conflict + change events fired on every poll even with
    // nothing to clear.
    expect(
      fw.dispatchEvents.filter(e => e.type === 'roas-cloud-clear-conflict').length,
    ).toBe(0);
    expect(
      fw.dispatchEvents.filter(e => e.type === 'roas-goal-changed').length,
    ).toBe(0);
  });
});
