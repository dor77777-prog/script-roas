// dashboard-web/tests/visual/pages.spec.ts
//
// Task 6.3 — full-page visual snapshots for every top-level page tab.
//
// Tab routing: the in-app Sidebar drives `?tab=…` via lib/urlState.ts. We
// navigate directly to the URL so the snapshot reflects the page in its
// shareable "first load" state, not after a click sequence.
//
// `trends` and `archive` are now SEPARATE top-level tabs (the old "analysis"
// wrapper was removed 2026-06-01). Each is reachable directly via `?tab=trends`
// / `?tab=archive` — no sub-tab click needed to screenshot either view.
//
// Operator page (/operator) is a sibling Next.js route — NOT a TabKey on
// the main dashboard. Its 4 sub-tabs (health / sync / activity / danger)
// are Radix Tabs without URL persistence, so each spec clicks the trigger
// and waits for the panel to mount.
//
// IMPORTANT — environment caveat:
//   This dashboard is heavily DB-dependent. Pages render real data from
//   Supabase / Inngest / cron-fed daily tables. Snapshot stability assumes
//   the CI environment supplies a seeded fixture DB (or the dev server is
//   booted with mock providers). In a "no-data" environment most pages
//   degrade to skeletons + empty states; the baseline is generated from
//   that environment via `npm run test:visual:update` and CI compares to
//   the same shape.
//
// Navigation note:
//   Pages use SWR (15 s refresh) + Inngest pings; the network never goes
//   "idle". We use `waitUntil: 'commit'` for `page.goto` and then wait
//   for `domcontentloaded` + a fixed 2.5 s settle window so the initial
//   data hydration finishes before the screenshot is taken. This is the
//   lowest-flake combo that still catches real first-paint regressions.
//
// Masking note:
//   Live regions (StatusPill, OperatorRefreshButton, FreshnessBadge,
//   SyncIndicator) update on a 15-30 s SWR cadence — their pixel content
//   changes between runs even when no code has changed. We pass them as
//   Playwright `mask:` locators so the gate flags real visual regressions
//   without flaking on the next health-summary tick.

import { expect, test, type Page, type Locator } from '@playwright/test';

const SETTLE_MS = 2500;

async function gotoAndSettle(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(SETTLE_MS);
  // Wait for web-fonts so digit metrics stabilize across runs.
  await page.evaluate(() => document.fonts?.ready);
}

/** SWR-polled regions we mask on every full-page snapshot. */
function liveMasks(page: Page): Locator[] {
  return [
    page.getByTestId('operator-status-pill'),
    page.getByTestId('operator-refresh-button'),
    page.locator('[data-testid="freshness-badge"]'),
    page.locator('[data-testid="sync-indicator"]'),
  ];
}

function snap(page: Page, name: string) {
  return expect(page).toHaveScreenshot(name, {
    fullPage: true,
    mask: liveMasks(page),
  });
}

/**
 * Operator pages render entire panels of live data (StatusEventsFeed,
 * CronTickSnapshotsViewer, TokenFailuresTable) that are SWR-polled.
 * We can't sanely testid-mask every row, so the operator snapshots use
 * a higher pixel tolerance — the gate still catches structural / token
 * regressions (changing a tile background, a font, etc.) but tolerates
 * row-level churn from the next status_events tick.
 *
 * Threshold derivation: empirically, idle operator tabs drift ~20-30 k
 * pixels between back-to-back runs (0.02-0.05 of a 1440×900 fullPage
 * capture). 80 k is ~2× that worst case, well below the size of any
 * real component-level visual change (a single 200×60 card edit alone
 * is ~12 k pixels).
 */
function snapOperator(page: Page, name: string) {
  return expect(page).toHaveScreenshot(name, {
    fullPage: true,
    mask: liveMasks(page),
    maxDiffPixels: 80_000,
  });
}

test.describe('top-level pages — full snapshots', () => {
  test('home tab', async ({ page }) => {
    await gotoAndSettle(page, '/');
    await snap(page, 'home.png');
  });

  test('P&L tab', async ({ page }) => {
    await gotoAndSettle(page, '/?tab=pnl');
    await snap(page, 'home-pnls-tab.png');
  });

  test('Trends tab', async ({ page }) => {
    await gotoAndSettle(page, '/?tab=trends');
    await snap(page, 'home-trends.png');
  });

  test('Archive tab (טבלאות אופטימיזציה)', async ({ page }) => {
    await gotoAndSettle(page, '/?tab=archive');
    await snap(page, 'home-archive.png');
  });

  test('Detail tab', async ({ page }) => {
    await gotoAndSettle(page, '/?tab=detail');
    await snap(page, 'home-detail.png');
  });

  test('Campaigns tab', async ({ page }) => {
    await gotoAndSettle(page, '/?tab=campaigns');
    await snap(page, 'home-campaigns.png');
  });

  test('Products tab', async ({ page }) => {
    await gotoAndSettle(page, '/?tab=products');
    await snap(page, 'home-products.png');
  });
});

test.describe('operator console — sub-tabs', () => {
  test('operator → health (default tab)', async ({ page }) => {
    await gotoAndSettle(page, '/operator');
    await snapOperator(page, 'operator-health.png');
  });

  test('operator → sync', async ({ page }) => {
    await gotoAndSettle(page, '/operator');
    await page.getByRole('tab', { name: 'סנכרון' }).click();
    await page.waitForTimeout(SETTLE_MS);
    await snapOperator(page, 'operator-sync.png');
  });

  test('operator → activity', async ({ page }) => {
    await gotoAndSettle(page, '/operator');
    await page.getByRole('tab', { name: 'פעילות' }).click();
    await page.waitForTimeout(SETTLE_MS);
    await snapOperator(page, 'operator-activity.png');
  });

  test('operator → danger', async ({ page }) => {
    await gotoAndSettle(page, '/operator');
    await page.getByRole('tab', { name: 'מסוכן' }).click();
    await page.waitForTimeout(SETTLE_MS);
    await snapOperator(page, 'operator-danger.png');
  });
});
