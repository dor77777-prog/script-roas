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
  resolveTheme,
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
  // Theme resolution: `choice` is what the user picked ('system' | 'light' |
  // 'dark'), persisted in localStorage. `resolved` is the concrete paint
  // value ('light' | 'dark') derived from choice + the OS prefers-color-scheme
  // signal at runtime. Writing `data-theme` on <html> is the effect's sole
  // job; the pre-paint inline script in layout.tsx ensures the first frame is
  // correct before React hydrates.
  const [choice, setChoiceState] = useState<ThemeChoice>(() => readStoredTheme());

  const [osPrefersDark, setOsPrefersDark] = useState(true); // default dark to match the FOUC fallback in layout
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    setOsPrefersDark(mq.matches);
    const on = (e: MediaQueryListEvent) => setOsPrefersDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  const resolved = resolveTheme(choice, osPrefersDark);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', resolved);
  }, [resolved]);

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
