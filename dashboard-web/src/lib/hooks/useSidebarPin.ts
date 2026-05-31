'use client';

/**
 * Wave 5 Task 5.8 — sidebar pin/expand state.
 *
 * Centralises the sticky "is the sidebar pinned open?" preference so the
 * <Sidebar/> rail body and any future consumer (a power-user "pin" toggle
 * in the command palette, a future keyboard-help page, etc.) share one
 * source of truth instead of each duplicating their own localStorage
 * read/write dance.
 *
 * Contract:
 *   - `pinned` starts `false` (collapsed icon-rail). The localStorage
 *     hydration runs inside `useEffect`, so the first SSR paint and the
 *     first client render both yield the same value — no hydration mismatch.
 *     A user with `sidebar:pinned=true` will briefly see the 72px rail
 *     before it expands on hydration; this single-frame flicker is
 *     acceptable per Task 5.8 spec (the alternative — reading localStorage
 *     during render — would trigger React's strict-mode warning and break
 *     SSR).
 *   - `togglePin()` flips the flag and writes the new value to
 *     localStorage. Stable identity via useCallback so it can be safely
 *     listed in dependency arrays (e.g. the global ⌘\ keyboard listener).
 *   - SSR-safe: every localStorage touch is guarded by
 *     `typeof window !== 'undefined'` because Next.js renders this code
 *     on the server during the initial HTML pass.
 */

import { useCallback, useEffect, useState } from 'react';

const STORAGE_KEY = 'sidebar:pinned';

export function useSidebarPin(): {
  pinned: boolean;
  togglePin: () => void;
} {
  const [pinned, setPinned] = useState<boolean>(false);

  // Hydrate from localStorage on mount. We deliberately do NOT read inside
  // useState's initializer — that would diverge between SSR (no window)
  // and the first client render, triggering a hydration mismatch warning
  // and a forced re-render. The single-frame flicker is the documented
  // tradeoff (see hook-level docstring).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY);
      if (stored === 'true') setPinned(true);
    } catch {
      // localStorage can throw in private-browsing / iframe-sandboxed
      // contexts. Silently fall through — the user just gets the default
      // collapsed state, which is the safe failure mode.
    }
  }, []);

  const togglePin = useCallback(() => {
    setPinned(prev => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(STORAGE_KEY, next ? 'true' : 'false');
        } catch {
          // See hydration comment above — write failures are non-fatal.
        }
      }
      return next;
    });
  }, []);

  return { pinned, togglePin };
}
