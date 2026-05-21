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
    // Phase 05.6 plan 03 widened this glob to also pick up sibling __tests__
    // folders under src/lib/* (e.g. src/lib/fetchers/__tests__/) so the new
    // TS-port test suites run by default. Pre-Phase-05.6 there was only one
    // canonical tests location; with multiple fetcher modules each owning
    // their own __tests__ folder, a single glob would silently skip them.
    //
    // Phase 05.6 plan 09 (cron-live, wave 4) widened it further to
    // `src/**/__tests__/**` so the Inngest function tests at
    // `src/inngest/functions/__tests__/cronLive.test.ts` (and their plan-08
    // sibling `cronDaily.test.ts`) are picked up. Per PLAN.md `<verify>`,
    // `npx vitest run src/inngest/functions/__tests__/cronLive.test.ts` must
    // succeed — that explicit path is still filtered by the include glob
    // (Vitest treats the include glob as a gate, not a hint), so widening is
    // required, not optional. This is forward-compatible with plan 08's
    // identical widening (idempotent string).
    include: ['src/**/__tests__/**/*.test.{ts,tsx}'],
    globals: false, // explicit imports — not relying on describe/it globals
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
