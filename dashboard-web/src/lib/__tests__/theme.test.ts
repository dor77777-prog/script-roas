// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  THEME_STORAGE_KEY,
  resolveTheme,
  readStoredTheme,
  writeStoredTheme,
  type ThemeChoice,
  type ResolvedTheme,
} from '../theme';

describe('theme — resolve + persistence', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.clear();
    }
  });

  describe('resolveTheme', () => {
    it('returns "light" when choice = system and OS prefers light', () => {
      const result: ResolvedTheme = resolveTheme('system', false);
      expect(result).toBe('light');
    });

    it('returns "dark" when choice = system and OS prefers dark', () => {
      const result: ResolvedTheme = resolveTheme('system', true);
      expect(result).toBe('dark');
    });

    it('returns "light" when choice = light regardless of OS', () => {
      expect(resolveTheme('light', true)).toBe('light');
      expect(resolveTheme('light', false)).toBe('light');
    });

    it('returns "dark" when choice = dark regardless of OS', () => {
      expect(resolveTheme('dark', true)).toBe('dark');
      expect(resolveTheme('dark', false)).toBe('dark');
    });
  });

  describe('readStoredTheme', () => {
    it('returns "system" when nothing stored', () => {
      expect(readStoredTheme()).toBe('system');
    });

    it('returns the stored value when present and valid', () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
      expect(readStoredTheme()).toBe('dark');
    });

    it('returns "system" on garbage stored value (defensive)', () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, 'rainbow');
      expect(readStoredTheme()).toBe('system');
    });
  });

  describe('writeStoredTheme', () => {
    it('persists the choice to localStorage', () => {
      writeStoredTheme('dark');
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    });

    it('round-trips all three values', () => {
      const cases: ThemeChoice[] = ['system', 'light', 'dark'];
      for (const c of cases) {
        writeStoredTheme(c);
        expect(readStoredTheme()).toBe(c);
      }
    });
  });
});
