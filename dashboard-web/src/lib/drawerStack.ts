'use client';

import { useEffect, useRef } from 'react';

/**
 * Tiny drawer stack used to coordinate Esc handling between nested drawers.
 *
 * Problem: each drawer historically registered its own
 * `window.addEventListener('keydown', ...)` for Esc. When drawer B opens on
 * top of drawer A and the user presses Esc, both window listeners fire in
 * the same tick and the entire drilldown stack collapses in one keystroke
 * (#WR-01). The fix is to make Esc address only the topmost open drawer.
 *
 * Implementation: a module-level array of getter functions. Each drawer
 * pushes a getter that always reads the LATEST onClose ref on this tick;
 * pops on close. A single shared window listener is installed lazily on
 * first push and removed on last pop, calling only the top entry's
 * current callback.
 *
 * Use via `useDrawerEsc(open, onClose)` — drop-in replacement for each
 * drawer's previous Esc useEffect.
 */

/** Each entry is a getter: when Esc fires we ask for the latest callback.
 *  Storing the callback directly would freeze the closure at push time, so a
 *  parent that re-creates `onClose` every render (no useCallback wrapping)
 *  would address a stale closure on Esc. The getter indirection lets us key
 *  the effect on `[open]` only (CC-02) without leaking stale callbacks. */
const stack: Array<() => () => void> = [];
let listenerInstalled = false;

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  const topGetter = stack[stack.length - 1];
  if (topGetter) {
    const cb = topGetter();
    if (cb) cb();
  }
}

function ensureListener() {
  if (listenerInstalled) return;
  window.addEventListener('keydown', onKeyDown);
  listenerInstalled = true;
}

function maybeRemoveListener() {
  if (stack.length > 0 || !listenerInstalled) return;
  window.removeEventListener('keydown', onKeyDown);
  listenerInstalled = false;
}

function pushDrawer(getter: () => () => void): () => void {
  stack.push(getter);
  ensureListener();
  return function pop() {
    const i = stack.lastIndexOf(getter);
    if (i >= 0) stack.splice(i, 1);
    maybeRemoveListener();
  };
}

/**
 * React hook: registers `onClose` as Esc-handler while `open` is true.
 * Only the topmost open drawer responds to Esc.
 *
 * Audit fix 2026-05-23 (CC-02): the original implementation included
 * `onClose` in the useEffect dep array. Most call sites pass an inline
 * arrow (no useCallback wrap), so the function identity changes on every
 * parent render — the effect tore down + re-pushed on every render,
 * thrashing the stack and producing brief windows where the drawer was
 * NOT registered. We now store the callback in a ref refreshed every
 * render, push a getter that reads the ref, and key the effect on
 * `[open]` only — register-once-per-open-cycle semantics.
 */
export function useDrawerEsc(open: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  // Refresh the ref every render so the getter inside pushDrawer always
  // reads the latest closure (state from the most recent render).
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const pop = pushDrawer(() => onCloseRef.current);
    return pop;
    // Intentional: do NOT depend on `onClose`. The getter pattern keeps the
    // latest callback live without re-pushing on every parent render. (CC-02)
  }, [open]);
}
