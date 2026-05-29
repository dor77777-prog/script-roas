/**
 * Global setup for the node-environment vitest config.
 *
 * Node 25 ships a built-in `localStorage` stub that requires a
 * `--localstorage-file` CLI flag to work. When a test file uses the
 * `// @vitest-environment jsdom` per-file directive, vitest sets up a jsdom
 * window — but jsdom's `localStorage` is not copied into `globalThis` because
 * the key is already present (Node's broken stub), and vitest's `populateGlobal`
 * only overrides keys that are in its KEYS allowlist (which does not include
 * `localStorage`).
 *
 * This setup file replaces the built-in stub with a fully-functional
 * Map-backed implementation so that per-file jsdom tests have working
 * localStorage (setItem / getItem / removeItem / clear / key / length).
 */

function makeStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    key(index: number): string | null {
      return [...store.keys()][index] ?? null;
    },
    getItem(key: string): string | null {
      return store.get(key) ?? null;
    },
    setItem(key: string, value: string): void {
      store.set(key, value);
    },
    removeItem(key: string): void {
      store.delete(key);
    },
    clear(): void {
      store.clear();
    },
  };
}

// Replace the broken Node 25 localStorage with a real implementation.
Object.defineProperty(globalThis, 'localStorage', {
  value: makeStorage(),
  writable: true,
  configurable: true,
});
