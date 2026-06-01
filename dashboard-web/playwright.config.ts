// dashboard-web/playwright.config.ts
//
// Task 6.3 (UI/UX Design-System Overhaul) — Playwright + image-snapshot
// visual-regression CI gate.
//
// Light + Dark: the mesh re-skin SHIPPED both light AND dark mode on
// 2026-05-31, so the stale "single-mode dark app" assumption is gone. We
// run TWO projects — `chromium-dark` (colorScheme 'dark') and
// `chromium-light` (colorScheme 'light') — both at 1440×900, the canonical
// mockup-04-final.html design width. Other widths (mobile / tablet) are out
// of scope for this gate; revisit if the dashboard ever gets a true
// responsive QA pass.
//
// How the theme is forced: `colorScheme` only sets the OS-level
// prefers-color-scheme signal. The app's ThemeProvider persists the user's
// CHOICE in localStorage['roas-theme'] ('system' | 'light' | 'dark') and
// paints `data-theme` on <html> from it. The contrast/overflow specs ALSO
// set localStorage['roas-theme'] in an addInitScript keyed off the project
// name, so the theme is forced deterministically regardless of OS hints.
//
// Thresholds tuned for sub-pixel font-rendering noise: 0.2 colour-channel
// tolerance + 100 max diff pixels is the lowest-noise pair that still flags
// real layout breaks (verified empirically against Wave 1-5 mockup-04-final
// renders). Anti-aliasing differences across CI runners typically register
// 30-60 px; 100 keeps a comfortable margin without masking 1-row breaks.
//
// Prod-pointable: baseURL is overridable via PLAYWRIGHT_BASE_URL so these
// specs can run against the Vercel prod/preview deploy (where real data
// renders). When PLAYWRIGHT_BASE_URL is set we SKIP the local dev webServer
// entirely — local has no Supabase data, so the data-backed gates
// (contrast.axe, overflow) are only meaningful against prod/preview.
// When unset, we fall back to booting `next dev` at localhost:3000.

import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

export default defineConfig({
  testDir: './tests/visual',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [['html'], ['github']] : 'html',
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium-dark',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        colorScheme: 'dark',
      },
    },
    {
      name: 'chromium-light',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        colorScheme: 'light',
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
  // Boot `next dev` only when we're NOT pointed at a deployed URL. When
  // PLAYWRIGHT_BASE_URL is set (prod/preview run) there is nothing to boot.
  webServer: process.env.PLAYWRIGHT_BASE_URL
    ? undefined
    : {
        command: 'npm run dev',
        url: 'http://localhost:3000',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'ignore',
        stderr: 'pipe',
      },
});
