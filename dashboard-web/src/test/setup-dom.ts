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
// Provide a minimal stub that reports light mode for every query EXCEPT
// `prefers-reduced-motion: reduce`, which reports `true` so count-up
// animations (useCountUp) render their FINAL value synchronously in tests —
// otherwise rAF-driven numbers would read 0 at assertion time and break the
// dozens of existing hero/per-store number expectations. (A test runner with
// no real frames is the textbook reduced-motion environment anyway.)
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: (query: string): MediaQueryList => ({
      matches: query.includes('prefers-reduced-motion'),
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

// jsdom does not implement ResizeObserver. Radix's Tooltip/Popover `Arrow`
// (via `@radix-ui/react-use-size`) constructs one on mount to track the arrow
// box; without a stub the component throws `ResizeObserver is not defined`.
// A no-op observer is sufficient for these DOM tests (we assert on roles/text,
// not measured geometry).
if (typeof globalThis !== 'undefined' && typeof (globalThis as { ResizeObserver?: unknown }).ResizeObserver === 'undefined') {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  (globalThis as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverStub;
}

// jsdom does not implement Element.prototype.scrollIntoView. Components
// that use it for keyboard navigation (e.g. CommandPalette scrolling the
// active option into view) crash without a stub.
if (
  typeof Element !== 'undefined' &&
  typeof (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView !== 'function'
) {
  (Element.prototype as { scrollIntoView: () => void }).scrollIntoView = function () {};
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
