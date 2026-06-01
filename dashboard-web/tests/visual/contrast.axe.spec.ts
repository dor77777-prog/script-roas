// dashboard-web/tests/visual/contrast.axe.spec.ts
//
// Wave E — axe color-contrast accessibility gate.
//
// Runs axe-core's `color-contrast` rule over every top-level page tab, in
// BOTH themes. The Playwright project (chromium-dark / chromium-light)
// drives `colorScheme`; this spec ALSO forces localStorage['roas-theme']
// in a beforeEach addInitScript so the app's ThemeProvider paints the
// matching `data-theme` deterministically (colorScheme alone only sets the
// OS preference — explicit choice is robust).
//
// DIVISION OF LABOR — axe vs the static guard:
//   axe reads computed color against the nearest SOLID background only; it
//   cannot reason about the band GRADIENT surfaces (the ROAS health-tinted
//   mesh backgrounds on the hero / per-store cards). Those gradient-vs-text
//   pairs are covered separately by the static `contrastGuard.test.ts`
//   (Wave A), which computes contrast against the resolved gradient stops.
//   This spec owns the solid-surface contrast; that test owns the gradients.
//
// ENVIRONMENT — run against prod/preview, not local:
//   Per the no-localhost-checks rule, run this against the Vercel
//   prod/preview URL via PLAYWRIGHT_BASE_URL. Locally there is no Supabase
//   data, so data-backed cells render empty and the gate is mostly vacuous.
//   Example:
//     PLAYWRIGHT_BASE_URL=https://roas-dashboard-smoky.vercel.app \
//       npm run test:visual:axe

import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Exact route set mirrored from pages.spec.ts (home + main tabs + operator).
const ROUTES = [
  '/',
  '/?tab=campaigns',
  '/?tab=products',
  '/?tab=analysis',
  '/operator',
] as const;

const SETTLE_MS = 2500;

async function gotoAndSettle(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(SETTLE_MS);
  // Wait for web-fonts so digit metrics stabilize across runs.
  await page.evaluate(() => document.fonts?.ready);
}

// Force the theme via the app's own storage key so `data-theme` is set
// regardless of OS colorScheme. Project name tells us which theme to force.
test.beforeEach(async ({ page }, testInfo) => {
  const theme = testInfo.project.name.includes('light') ? 'light' : 'dark';
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem('roas-theme', t);
    } catch {
      // localStorage may be disabled in some sandboxes — ignore.
    }
  }, theme);
});

for (const route of ROUTES) {
  test(`no color-contrast violations on ${route}`, async ({ page }) => {
    await gotoAndSettle(page, route);
    const results = await new AxeBuilder({ page })
      .withRules(['color-contrast'])
      .analyze();
    expect(
      results.violations,
      JSON.stringify(
        results.violations.map((v) => ({
          id: v.id,
          nodes: v.nodes.map((n) => n.target),
        })),
        null,
        2,
      ),
    ).toEqual([]);
  });
}
