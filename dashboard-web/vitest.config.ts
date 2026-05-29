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
    // Phase 05.6 plan 08 added a second top-level path — `src/inngest/**` —
    // so Inngest function tests (e.g. src/inngest/functions/__tests__/cronDaily.test.ts)
    // are picked up alongside the lib fetcher suites. Same rationale as the
    // plan-03 widening: a new top-level source directory means the include
    // glob must explicitly enumerate it or its tests silently skip.
    //
    // refund-visibility UX (Task 2) adds source-string lock tests under
    // src/components/__tests__/ — same Node environment, no DOM needed,
    // so no second vitest config required. Widening the glob here is the
    // correct approach (same rationale as plan-03 and plan-08 above).
    //
    // chart-palette rebrand (2026-05-29) adds a CSS parity test under
    // src/app/__tests__/ (globals-chart-vars.test.ts). Same Node environment
    // (reads CSS via fs.readFileSync), so same rationale applies.
    //
    // Excludes (added 2026-05-28): dom-config glob patterns are explicitly
    // excluded so a file at src/components/ui/__tests__/Badge.test.tsx
    // (created by Plan 1 Foundation Task 9+) doesn't run twice — once under
    // node here and once under jsdom in vitest.config.dom.ts.
    include: [
      'src/lib/**/__tests__/**/*.test.{ts,tsx}',
      'src/inngest/**/__tests__/**/*.test.{ts,tsx}',
      'src/components/**/__tests__/**/*.test.{ts,tsx}',
      'src/app/**/__tests__/**/*.test.{ts,tsx}',
    ],
    exclude: [
      // Vitest's defaults — must be repeated when we set `exclude` explicitly,
      // because `exclude` replaces the defaults rather than extending them.
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      // Test files owned by the jsdom config (vitest.config.dom.ts). Without
      // these excludes, every component test would be picked up by both
      // configs and fail under node env (no DOM). Added 2026-05-28 alongside
      // the introduction of vitest.config.dom.ts.
      'src/components/**/__tests__/*.dom.test.{ts,tsx}',
      'src/components/ui/**/__tests__/*.test.{ts,tsx}',
      'src/lib/**/__tests__/*.dom.test.{ts,tsx}',
    ],
    globals: false, // explicit imports — not relying on describe/it globals
    // Provide a URL for jsdom so localStorage is fully functional when a
    // test file uses the // @vitest-environment jsdom per-file directive.
    // Without a URL, jsdom stubs localStorage without a working .clear().
    environmentOptions: {
      jsdom: {
        url: 'http://localhost/',
      },
    },
    // Node 25 ships a built-in `localStorage` stub (requires --localstorage-file
    // to actually work). When a test file uses // @vitest-environment jsdom,
    // vitest sets up jsdom but cannot override `localStorage` because Node's
    // broken stub is already present and `localStorage` is not in vitest's
    // KEYS allowlist for `populateGlobal`. The setup file below replaces the
    // stub with a fully-functional Map-backed implementation before any test
    // file runs, so per-file jsdom tests have working localStorage.
    setupFiles: ['./src/test/setup-node.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
