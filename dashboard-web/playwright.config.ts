// dashboard-web/playwright.config.ts
//
// Task 6.3 (UI/UX Design-System Overhaul) — Playwright + image-snapshot
// visual-regression CI gate.
//
// Single-mode (dark) app: per [[ui-ux-overhaul-plan]] the dashboard does NOT
// ship a light mode, so we only run the chromium project with `colorScheme:
// 'dark'`. Viewport is locked to 1440×900 — the canonical mockup-04-final.html
// design width. Other widths (mobile / tablet) are out of scope for v1 of the
// visual gate; revisit if the dashboard ever gets a true responsive QA pass.
//
// Thresholds tuned for sub-pixel font-rendering noise: 0.2 colour-channel
// tolerance + 100 max diff pixels is the lowest-noise pair that still flags
// real layout breaks (verified empirically against Wave 1-5 mockup-04-final
// renders). Anti-aliasing differences across CI runners typically register
// 30-60 px; 100 keeps a comfortable margin without masking 1-row breaks.
//
// webServer block boots `next dev` and waits for http://localhost:3000.
// On CI it always boots a fresh server; on a developer's laptop we reuse the
// existing dev server (saves the 8-15 s boot every iteration).

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html'], ['github']] : 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    // Single-mode app — dashboard has no light theme.
    colorScheme: 'dark',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
      },
    },
  ],
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 100,
      threshold: 0.2,
      // Mask out network-dependent / time-dependent regions (freshness chips,
      // "updated 2m ago" labels) at the spec level via `mask:` rather than
      // here — global masks make it too easy to hide real regressions.
      animations: 'disabled',
    },
  },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
