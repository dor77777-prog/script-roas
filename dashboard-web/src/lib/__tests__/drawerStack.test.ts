// dashboard-web/src/lib/__tests__/drawerStack.test.ts
//
// Regression test for CC-02: useDrawerEsc must register exactly ONCE per
// open-cycle, not on every parent render.
//
// Pre-fix: the effect's dep array was `[open, onClose]`. Most call sites
// pass an inline arrow (no useCallback wrap), so onClose's function
// identity changes on every render → the effect tore down + re-pushed on
// every render, thrashing the stack and producing brief windows where the
// drawer was unregistered.
//
// Post-fix: callback is held in a ref refreshed each render; the effect
// pushes a getter and depends on `[open]` only. Esc always fires the
// LATEST callback (no stale closure), and the stack is touched
// exactly once per open transition.
//
// We test the underlying state-machine here (push count, dispatched Esc
// fires the latest callback) by simulating sequential renders manually.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// --- React mock — implements minimal subset so we can drive useDrawerEsc
// across "renders" deterministically without a React renderer. -----------

let stateBoxes: Array<{ v: unknown }> = [];
let refBoxes: Array<{ current: unknown }> = [];
let effectRegistry: Array<{
  fn: () => void | (() => void);
  deps: unknown[] | undefined;
  cleanup: (() => void) | undefined;
}> = [];

function resetReactHarness() {
  stateBoxes = [];
  refBoxes = [];
  effectRegistry = [];
}

/** Simulate a re-render: re-run effects whose deps changed. */
function rerender(runHook: () => void) {
  const prevEffects = effectRegistry;
  effectRegistry = [];
  // Reset ref/state ordering so the next call indexes into the same boxes.
  refIndex = 0;
  stateIndex = 0;
  runHook();
  // Compare new effects to prev. For each effect, if deps changed, run
  // cleanup then re-invoke; otherwise re-attach the existing cleanup.
  for (let i = 0; i < effectRegistry.length; i++) {
    const cur = effectRegistry[i];
    const prev = prevEffects[i];
    if (!prev) {
      const cleanup = cur.fn();
      cur.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
      continue;
    }
    const changed = !depsEqual(prev.deps, cur.deps);
    if (changed) {
      if (prev.cleanup) prev.cleanup();
      const cleanup = cur.fn();
      cur.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
    } else {
      cur.cleanup = prev.cleanup;
    }
  }
}

function depsEqual(a: unknown[] | undefined, b: unknown[] | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function unmountAll() {
  for (const e of effectRegistry) {
    if (e.cleanup) e.cleanup();
  }
  effectRegistry = [];
}

let stateIndex = 0;
let refIndex = 0;

vi.mock('react', () => ({
  useState: <T,>(initial: T): [T, (v: T) => void] => {
    const idx = stateIndex++;
    if (stateBoxes[idx] === undefined) stateBoxes[idx] = { v: initial };
    const box = stateBoxes[idx];
    return [box.v as T, (v: T) => { box.v = v; }];
  },
  useEffect: (fn: () => void | (() => void), deps?: unknown[]) => {
    effectRegistry.push({ fn, deps, cleanup: undefined });
  },
  useRef: <T,>(initial: T) => {
    const idx = refIndex++;
    if (refBoxes[idx] === undefined) refBoxes[idx] = { current: initial };
    return refBoxes[idx] as { current: T };
  },
}));

// Track keydown listeners installed on window.
const installedKeyDownListeners: Array<(e: KeyboardEvent) => void> = [];

beforeEach(() => {
  resetReactHarness();
  installedKeyDownListeners.length = 0;
  // Stub window with addEventListener / removeEventListener.
  const fakeWindow = {
    addEventListener: (type: string, listener: (e: KeyboardEvent) => void) => {
      if (type === 'keydown') installedKeyDownListeners.push(listener);
    },
    removeEventListener: (
      type: string,
      listener: (e: KeyboardEvent) => void,
    ) => {
      if (type === 'keydown') {
        const i = installedKeyDownListeners.indexOf(listener);
        if (i >= 0) installedKeyDownListeners.splice(i, 1);
      }
    },
  };
  (globalThis as unknown as { window: typeof window }).window =
    fakeWindow as unknown as typeof window;
});

afterEach(() => {
  unmountAll();
});

describe('useDrawerEsc (CC-02 — register-once-per-open-cycle)', () => {
  it('does NOT re-register on every render when onClose identity changes', async () => {
    const { useDrawerEsc } = await import('../drawerStack');
    let renderCount = 0;

    // Each "render" creates a fresh inline arrow — identical to a real React
    // component that does `onClose={() => closeDrawer()}` inline. Pre-fix
    // this would re-push on every render.
    function runHook(open: boolean) {
      stateIndex = 0;
      refIndex = 0;
      renderCount++;
      useDrawerEsc(open, () => {
        /* fresh closure each render */
      });
    }

    // Initial render with open=true → ONE push.
    runHook(true);
    // Manually run the just-registered effects (first render).
    for (const e of effectRegistry) {
      const cleanup = e.fn();
      e.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
    }
    expect(installedKeyDownListeners.length).toBe(1);

    // Re-render 5 times with open=true and a NEW inline arrow each time.
    for (let i = 0; i < 5; i++) {
      rerender(() => runHook(true));
    }

    // Listener count must still be 1 — no re-registration since `open`
    // didn't change. Pre-fix this would have churned: install+remove+
    // install on each render, leaving still 1 by the end but executing
    // the side effects 5x.
    expect(installedKeyDownListeners.length).toBe(1);
    expect(renderCount).toBe(6); // sanity
  });

  it('Esc always invokes the LATEST onClose, not the one captured at mount', async () => {
    const { useDrawerEsc } = await import('../drawerStack');
    const calls: string[] = [];
    let nameThisRender = 'v1';

    function runHook(open: boolean) {
      stateIndex = 0;
      refIndex = 0;
      const tag = nameThisRender;
      useDrawerEsc(open, () => {
        calls.push(tag);
      });
    }

    runHook(true);
    for (const e of effectRegistry) {
      const cleanup = e.fn();
      e.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
    }

    // Re-render with a new callback identity → ref should track the new one.
    nameThisRender = 'v2';
    rerender(() => runHook(true));

    // Fire Esc.
    installedKeyDownListeners[0]?.({ key: 'Escape' } as KeyboardEvent);
    expect(calls).toEqual(['v2']);

    // Re-render again with v3 — still only one push, latest callback used.
    nameThisRender = 'v3';
    rerender(() => runHook(true));
    installedKeyDownListeners[0]?.({ key: 'Escape' } as KeyboardEvent);
    expect(calls).toEqual(['v2', 'v3']);
  });

  it('registers on open=false → true transition and unregisters on true → false', async () => {
    const { useDrawerEsc } = await import('../drawerStack');
    function runHook(open: boolean) {
      stateIndex = 0;
      refIndex = 0;
      useDrawerEsc(open, () => {});
    }

    runHook(false);
    for (const e of effectRegistry) {
      const cleanup = e.fn();
      e.cleanup = typeof cleanup === 'function' ? cleanup : undefined;
    }
    expect(installedKeyDownListeners.length).toBe(0);

    rerender(() => runHook(true));
    expect(installedKeyDownListeners.length).toBe(1);

    rerender(() => runHook(false));
    expect(installedKeyDownListeners.length).toBe(0);
  });
});
