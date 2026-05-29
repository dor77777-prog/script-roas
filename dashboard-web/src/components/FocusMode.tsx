'use client';

import { useEffect } from 'react';

/**
 * Cmd/Ctrl + \ toggles a data attribute on <html> that CSS uses to dim
 * the sidebar + header chrome. Used before client screen-shares. State
 * is ephemeral and resets on next page load.
 */
export function FocusMode() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '\\' && (e.metaKey || e.ctrlKey)) {
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
