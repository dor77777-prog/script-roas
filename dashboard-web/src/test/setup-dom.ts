import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Node 25 ships a built-in `localStorage` stub that requires a
// `--localstorage-file` CLI flag to actually work. Under jsdom, vitest
// cannot override it because the key is already present in globalThis and
// is not in vitest's `populateGlobal` KEYS allowlist.
// Replace it with a fully-functional Map-backed implementation so that
// components using localStorage (e.g. ThemeProvider) work correctly in tests.
function makeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() { return store.size; },
    key(index: number): string | null { return [...store.keys()][index] ?? null; },
    getItem(key: string): string | null { return store.get(key) ?? null; },
    setItem(key: string, value: string): void { store.set(key, value); },
    removeItem(key: string): void { store.delete(key); },
    clear(): void { store.clear(); },
  };
}
Object.defineProperty(globalThis, 'localStorage', {
  value: makeStorage(),
  writable: true,
  configurable: true,
});

// jsdom does not implement window.matchMedia. Components that read
// OS color-scheme preference (e.g. ThemeProvider) call it on mount.
// Provide a minimal stub that always reports light mode and supports
// addEventListener/removeEventListener so no errors are thrown.
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

// React 19 ships with built-in act() warnings under jsdom. The matcher
// extensions above add expect(...).toBeInTheDocument() etc. and run once
// per test file before describe blocks execute.
//
// @testing-library/react auto-cleanup relies on a global `afterEach`.
// With `globals: false` (our config), the global is not present, so
// cleanup must be called explicitly. Without this, DOM nodes from previous
// tests accumulate and cause "Found multiple elements" errors.
afterEach(() => {
  cleanup();
});
