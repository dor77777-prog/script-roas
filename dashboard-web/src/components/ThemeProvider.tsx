'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  readStoredTheme,
  writeStoredTheme,
  type ThemeChoice,
  type ResolvedTheme,
} from '@/lib/theme';

type ThemeContextValue = {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  setChoice: (next: ThemeChoice) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // 2026-05-31 single-mode flip: the dashboard now ships dark-only. We
  // still expose `choice` / `setChoice` (and persist them via
  // `writeStoredTheme`) because Sidebar + CommandPalette render the
  // theme-toggle UI and the Sidebar DOM tests assert against it. The
  // resolved value is hard-pinned to 'dark' and the DOM-write effect
  // always forces <html data-theme="dark">, so the previous
  // matchMedia(prefers-color-scheme) subscription + osPrefersDark state +
  // resolveTheme() call were unreachable — dropped to remove the live
  // listener cost and the misleading reactivity.
  const [choice, setChoiceState] = useState<ThemeChoice>(() => readStoredTheme());

  const resolved: ResolvedTheme = 'dark';

  useEffect(() => {
    // Re-assert dark on every mount so stale localStorage values (from
    // before the flip) cannot demote a running session to a non-existent
    // light palette. `<html data-theme="dark">` is also hard-coded in
    // layout.tsx for the first paint.
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', 'dark');
  }, []);

  const setChoice = useCallback((next: ThemeChoice) => {
    setChoiceState(next);
    writeStoredTheme(next);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ choice, resolved, setChoice }),
    [choice, resolved],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
