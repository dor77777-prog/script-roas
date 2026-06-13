'use client';

import { useEffect } from 'react';

/**
 * Cmd/Ctrl + . (period) toggles a data attribute on <html> that CSS uses to
 * dim the sidebar + header chrome. Used before client screen-shares. State
 * is ephemeral and resets on next page load.
 *
 * Chord history (reskin-w2, 2026-06-12): this used to bind Cmd/Ctrl+\ — the
 * SAME chord the Sidebar binds for its pin-toggle. Both listeners are
 * document-level, so a single ⌘\ keypress fired BOTH (pin AND dim). The pin
 * is the more discoverable/primary affordance (it has a visible footer button
 * + tooltip hint), so it keeps ⌘\; focus-mode moves to ⌘. (period), a chord
 * nothing else in the app binds. There is no on-screen hint for this shortcut
 * (it's an operator power-move documented only here), so no UI copy changes.
 */
export function FocusMode() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '.' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const root = document.documentElement;
        const isOn = root.getAttribute('data-focus-mode') === 'on';
        if (isOn) root.removeAttribute('data-focus-mode');
        else root.setAttribute('data-focus-mode', 'on');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return null;
}
