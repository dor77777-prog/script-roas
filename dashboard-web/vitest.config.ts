import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    // Node environment — Phase 2 tests are pure functions, no DOM needed.
    //
    // The `include` glob accepts both .test.ts AND .test.tsx so a future
    // hook test (e.g. useSWR wrapper) lands inside the suite without anyone
    // having to remember to widen the glob first. The IN-03 finding flagged
    // that a .tsx test in this path used to be silently skipped.
    //
    // IMPORTANT — when adding the first JSX/JSDOM test:
    //   1. Most React-render tests need `environment: 'jsdom'` (not 'node').
    //      Switching the project-wide default WOULD re-run the existing
    //      pure-function tests under JSDOM (~5x slower for no benefit).
    //      Instead, create a SECOND vitest config — e.g.
    //      `vitest.config.dom.ts` — with `environment: 'jsdom'` and an
    //      include glob limited to component tests, then wire it through
    //      either a Vitest projects file or a `test:components` npm script.
    //   2. Add `@testing-library/react` + `@testing-library/jest-dom` deps.
    //   3. Configure setupFiles for jest-dom matchers.
    environment: 'node',
    // Phase 05.6 adds src/lib/fetchers/__tests__/ — the TS fetcher ports
    // (meta, googleAds, fx, manualOverrides, shopify) live in a sibling
    // sub-directory. Globbing src/lib/**/__tests__ keeps both locations
    // picked up by `npm run test` without per-fetcher config churn.
    include: ['src/lib/**/__tests__/**/*.test.{ts,tsx}'],
    globals: false, // explicit imports — not relying on describe/it globals
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
