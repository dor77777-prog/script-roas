// dashboard-web/tests/visual/overflow.spec.ts
//
// Wave E — 200%-reflow number-overflow gate.
//
// Asserts that no `.metric-num` element (the overflow-safe class emitted by
// <Money>) clips inside its container at a 200%-reflow viewport. This is the
// reflow / readability backstop (WCAG 1.4.4): a 5-7 digit currency value must
// not get horizontally truncated when the usable width halves. The compact-
// floor logic inside <Money> is what keeps these in-bounds.
//
// WHY VIEWPORT-HALVING, NOT `body { zoom: 2 }`:
//   The earlier version set `document.body.style.zoom = '2'`. `zoom` is a
//   non-standard CSS property whose scaling corrupts the integer
//   scrollWidth/clientWidth metrics — Chromium floors clientWidth to a uniform
//   value while getBoundingClientRect reports the true (larger) box, so even a
//   physically-unclippable cell like "$0" reports scrollWidth>clientWidth.
//   That produced false positives on prod (verified: $0/$37/$133 "overflowing"
//   at zoom=2 but the real cells are not clipped). The WCAG-correct way to
//   simulate 200% zoom is to HALVE the CSS viewport (real reflow), which this
//   spec does: the project viewport is 1440 wide, so we resize to 720. At 720
//   the metric cells reflow honestly and the scrollWidth/clientWidth comparison
//   is meaningful. (Verified on prod 2026-06-01: 0 overflowing at both 1440 and
//   720.)
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

// 200%-reflow width: half of the 1440 design viewport (playwright.config.ts).
const REFLOW_WIDTH = 720;
const REFLOW_HEIGHT = 900;

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
  test(`metric numbers never overflow at 200% reflow on ${route}`, async ({
    page,
  }) => {
    // Halve the usable width BEFORE loading so the page lays out at the
    // reflowed size (real WCAG-1.4.4 200% simulation, not the buggy
    // body.zoom hack — see header).
    await page.setViewportSize({ width: REFLOW_WIDTH, height: REFLOW_HEIGHT });
    await gotoAndSettle(page, route);
    const overflowing = await page.$$eval('.metric-num', (els) =>
      els
        .filter((el) => el.scrollWidth > el.clientWidth + 1)
        .map((el) => (el.textContent || '').slice(0, 40)),
    );
    expect(
      overflowing,
      `clipped .metric-num at 200% reflow (${overflowing.length}): ${overflowing.join(' | ')}`,
    ).toEqual([]);
  });
}
