// dashboard-web/tests/visual/overflow.spec.ts
//
// Wave E — 200%-zoom number-overflow gate.
//
// Asserts that no `.metric-num` element (the overflow-safe class emitted by
// <Money>) clips inside its container when the page is zoomed to 200%. This
// is the reflow / readability backstop: at 200% zoom a 5-7 digit currency
// value must not get horizontally truncated. The compact-floor logic inside
// <Money> is what should keep these in-bounds even at 2× zoom.
//
// ENVIRONMENT — meaningful only against a populated env:
//   Real 5-7 digit values only render against prod/preview (PLAYWRIGHT_BASE_URL).
//   Locally there is no Supabase data, so `.metric-num` cells are empty and
//   this gate passes vacuously. Run it against the deploy:
//     PLAYWRIGHT_BASE_URL=https://roas-dashboard-smoky.vercel.app \
//       npm run test:visual:overflow
//
// Theme is forced per-project (chromium-dark / chromium-light) via the same
// localStorage['roas-theme'] addInitScript used by contrast.axe.spec.ts.

import { expect, test, type Page } from '@playwright/test';

// Data-dense tabs where wide currency numbers actually render.
const ROUTES = ['/', '/?tab=campaigns', '/?tab=products'] as const;

const SETTLE_MS = 2500;

async function gotoAndSettle(page: Page, url: string) {
  await page.goto(url, { waitUntil: 'commit' });
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForTimeout(SETTLE_MS);
  // Wait for web-fonts so digit metrics stabilize across runs.
  await page.evaluate(() => document.fonts?.ready);
}

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
  test(`metric numbers never overflow at 200% zoom on ${route}`, async ({
    page,
  }) => {
    await gotoAndSettle(page, route);
    // `zoom` is a non-standard CSS property (Chromium-supported) not in the
    // typed CSSStyleDeclaration, so cast through unknown for the assignment.
    await page.evaluate(() => {
      (document.body.style as unknown as Record<string, string>).zoom = '2';
    });
    await page.waitForTimeout(300);
    const overflowing = await page.$$eval('.metric-num', (els) =>
      els
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => (el.textContent || '').slice(0, 40)),
    );
    expect(
      overflowing,
      `clipped .metric-num at 200%: ${overflowing.join(' | ')}`,
    ).toEqual([]);
  });
}
