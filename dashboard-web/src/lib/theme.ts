/**
 * Theme persistence + resolution helpers.
 *
 * Theme model:
 *   - ThemeChoice: what the user picked ("system" | "light" | "dark")
 *   - ResolvedTheme: what we actually paint ("light" | "dark") — derived
 *     from ThemeChoice + the OS preference at the moment of resolution.
 *
 * The split lets us persist intent (user picked "system") instead of the
 * resolved value, so if the OS preference flips later, the dashboard
 * follows automatically.
 */
export type ThemeChoice = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'roas-theme';

const VALID_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

/** Reads the persisted choice, defaulting to 'system' for first-time + garbage values. */
export function readStoredTheme(): ThemeChoice {
  if (typeof window === 'undefined') return 'system';
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (raw && (VALID_CHOICES as readonly string[]).includes(raw)) {
    return raw as ThemeChoice;
  }
  return 'system';
}

/** Writes the persisted choice. */
export function writeStoredTheme(choice: ThemeChoice): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(THEME_STORAGE_KEY, choice);
}

/** Resolves a choice + OS-prefers-dark signal into a concrete paint value. */
export function resolveTheme(
  choice: ThemeChoice,
  osPrefersDark: boolean,
): ResolvedTheme {
  if (choice === 'light') return 'light';
  if (choice === 'dark') return 'dark';
  return osPrefersDark ? 'dark' : 'light';
}
