'use client';

import { useEffect } from 'react';

/**
 * Tiny drawer stack used to coordinate Esc handling between nested drawers.
 *
 * Problem: each drawer historically registered its own
 * `window.addEventListener('keydown', ...)` for Esc. When drawer B opens on
 * top of drawer A and the user presses Esc, both window listeners fire in
 * the same tick and the entire drilldown stack collapses in one keystroke
 * (#WR-01). The fix is to make Esc address only the topmost open drawer.
 *
 * Implementation: a module-level array of onClose callbacks. Each drawer
 * pushes itself on open and pops on close. A single shared window listener
 * is installed lazily on first push and removed on last pop, calling only
 * the top entry.
 *
 * Use via `useDrawerEsc(open, onClose)` — drop-in replacement for each
 * drawer's previous Esc useEffect.
 */

const stack: Array<() => void> = [];
let listenerInstalled = false;

function onKeyDown(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  const top = stack[stack.length - 1];
  if (top) top();
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

function pushDrawer(onClose: () => void): () => void {
  stack.push(onClose);
  ensureListener();
  return function pop() {
    const i = stack.lastIndexOf(onClose);
    if (i >= 0) stack.splice(i, 1);
    maybeRemoveListener();
  };
}

/** React hook: registers `onClose` as Esc-handler while `open` is true.
 *  Only the topmost open drawer responds to Esc. */
export function useDrawerEsc(open: boolean, onClose: () => void) {
  useEffect(() => {
    if (!open) return;
    const pop = pushDrawer(onClose);
    return pop;
  }, [open, onClose]);
}
