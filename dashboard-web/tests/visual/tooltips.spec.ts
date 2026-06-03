// dashboard-web/tests/visual/tooltips.spec.ts
//
// Tooltip-system-redesign — Phase 1 · Task 1.5.
//
// Behavioural (NOT pixel-snapshot) Playwright gate for the redesigned
// HelpTooltip primitive. Three things, in BOTH themes (the suite runs every
// spec under the `chromium-dark` + `chromium-light` projects — see
// playwright.config.ts):
//
//   (a) KEYBOARD — focus a simple help trigger → a role="tooltip" appears →
//       Esc dismisses it → focus stays on the trigger (never yanked away).
//   (b) TOUCH — under coarse-pointer / hasTouch emulation the SAME call-site
//       auto-selects the ⓘ toggletip (mode C) / bottom Sheet (mode D). Tap ⓘ →
//       a role="dialog" opens → tap the scrim (or ✕) closes it → the labelled
//       subject's OWN action never fired (the toggletip separates reveal from
//       activation — no double-tap trap).
//
// HARNESS — deterministic, data-free:
//   The live dashboard's real help chips (CoverageChip, GoalTracker, …) only
//   render against a populated Supabase env. To stay stable in CI and locally
//   we anchor on the `/dev/primitives` showcase route, which renders a small
//   HelpTooltip section (testids `help-simple-trigger` / `help-rich-trigger`)
//   with NO network dependency. The same route already backs states.spec.ts.
//
//   When pointed at a deployed env (PLAYWRIGHT_BASE_URL) the spec ALSO
//   sanity-checks the real hero `coverage-chip` HelpTooltip if it's present
//   (it's data-gated, so the check skips cleanly when there are no orders).
//
// TOUCH BREAKPOINT — the primitive's touch branch is driven by
//   `useIsMobile()` = `matchMedia('(max-width: 767px)')`. Playwright's
//   `hasTouch` + a ≤767px viewport flips it; we create a dedicated phone-sized
//   context for the touch tests (the project default is 1440 desktop).
//
// Theme is forced per-project via the same localStorage['roas-theme']
// addInitScript used by contrast.axe.spec.ts / overflow.spec.ts, so both the
// dark and the light project exercise every assertion below.

import { expect, test, type Page } from '@playwright/test';

const PRIMITIVES_URL = '/dev/primitives';
const HOME_URL = '/';
const SETTLE_MS = 1000;

/** Force the app theme to match the running project (dark / light). */
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

async function gotoPrimitives(page: Page) {
  await page.goto(PRIMITIVES_URL, { waitUntil: 'commit' });
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.evaluate(() => document.fonts?.ready);
  // Wait for the HelpTooltip harness section to mount, then a hydration
  // settle. In dev mode the page recompiles on first hit and React can detach
  // /re-attach nodes mid-hydration; settling here keeps the trigger element
  // stably attached before we focus / tap it (no "element not attached" flake).
  await page.getByTestId('help-simple-trigger').waitFor({ state: 'visible' });
  await page.waitForTimeout(SETTLE_MS);
}

// ---------------------------------------------------------------------------
// (a) Keyboard — desktop simple tooltip: focus → tooltip → Esc → focus intact.
// ---------------------------------------------------------------------------
test.describe('HelpTooltip — keyboard (desktop simple → role=tooltip)', () => {
  test('focus opens a tooltip, Esc closes it, focus unchanged', async ({
    page,
  }) => {
    // Radix Tooltip opens on a REAL focus event, which only fires when the
    // document believes it is focused. Under `fullyParallel` several Chromium
    // pages share the OS foreground, so a backgrounded page may not receive
    // genuine focus and the tooltip silently no-ops. Pin focus-emulation ON via
    // CDP so this page always counts as focused regardless of who's foreground
    // — the deterministic way to test focus behaviour in a parallel suite.
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });

    await gotoPrimitives(page);

    const trigger = page.getByTestId('help-simple-trigger');
    await expect(trigger).toBeVisible();

    // Scope to OUR tooltip by its help text — the primitives canvas also
    // renders a separate always-open showcase tooltip ("tooltip content"),
    // so a bare getByRole('tooltip') is ambiguous.
    const tip = page.getByRole('tooltip').filter({ hasText: 'עזרה' });

    // It is NOT open before focus.
    await expect(tip).toHaveCount(0);

    // Keyboard focus the trigger (no pointer) — Radix Tooltip opens on focus,
    // which is the keyboard-user path we're guarding. Poll-and-re-focus so a
    // single dropped focus event (dev-mode cold-attach of the JS chunk, or a
    // momentarily-backgrounded page) self-heals instead of flaking; the
    // contract under test is "focus → a role=tooltip appears", which this still
    // asserts honestly.
    await expect(async () => {
      // Blur first so each attempt is a genuine focus TRANSITION (re-focusing
      // an already-focused element fires no new focus event).
      await trigger.evaluate((el: HTMLElement) => el.blur());
      await trigger.focus();
      await expect(trigger).toBeFocused();
      await expect(tip).toBeVisible({ timeout: 1500 });
    }).toPass({ timeout: 10_000 });

    // The simple tooltip must NOT contain a focusable element (the a11y
    // contract enforced by tooltipFocusableGuard — re-asserted live).
    expect(
      await tip.locator('a, button, input, select, textarea, [tabindex]').count(),
    ).toBe(0);

    // Esc dismisses the tooltip…
    await page.keyboard.press('Escape');
    await expect(tip).toHaveCount(0);

    // …and focus stays exactly where it was (never yanked into the bubble).
    await expect(trigger).toBeFocused();
  });
});

// ---------------------------------------------------------------------------
// (b) Touch — coarse pointer / hasTouch: tap ⓘ → dialog → dismiss; the
//     underlying subject action never fires.
// ---------------------------------------------------------------------------
test.describe('HelpTooltip — touch (coarse pointer → ⓘ toggletip / sheet)', () => {
  // A phone-sized, touch-enabled context so useIsMobile() (max-width:767px)
  // flips the primitive into its touch branch.
  test.use({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });

  test('tap ⓘ opens a dialog, dismiss closes it, underlying action not fired', async ({
    page,
  }) => {
    await gotoPrimitives(page);

    // The simple call-site now renders the subject + a paired ⓘ button.
    const subject = page.getByTestId('help-simple-trigger');
    await expect(subject).toBeVisible();

    // The ⓘ affordance is a sibling button with the Hebrew help aria-label.
    const info = page.getByRole('button', { name: /הסבר|מידע|help/i }).first();
    await expect(info).toBeVisible();

    // Tap the ⓘ (touch tap, not the subject) → a role=dialog popover opens.
    await info.tap();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('עזרה');

    // The subject's OWN onClick must NOT have fired — the toggletip separates
    // reveal from activation (no first-tap-reveals / second-tap-acts trap).
    await expect(subject).not.toHaveAttribute('data-underlying-fired', 'true');

    // Tap-outside (the document body, away from the popover) closes it.
    await page.mouse.click(5, 5);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Still no underlying activation after the whole interaction.
    await expect(subject).not.toHaveAttribute('data-underlying-fired', 'true');
  });

  test('rich help on touch escalates to a bottom Sheet with a visible close', async ({
    page,
  }) => {
    await gotoPrimitives(page);

    const subject = page.getByTestId('help-rich-trigger');
    await expect(subject).toBeVisible();

    // The rich call-site (title + block body) → long-rich → ⓘ → bottom Sheet.
    const info = page
      .getByRole('button', { name: /כותרת|מידע|הסבר|help/i })
      .last();
    await expect(info).toBeVisible();

    await info.tap();

    // The Sheet is a Radix Dialog (role=dialog) with the rich body + a close.
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('גוף עשיר');

    const close = sheet.getByRole('button', { name: /סגור|close/i });
    await expect(close).toBeVisible();

    // Underlying NC-ROAS action never fired from opening the help.
    await expect(subject).not.toHaveAttribute('data-underlying-fired', 'true');

    // Esc closes the focus-trapped sheet (Radix Dialog default).
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(subject).not.toHaveAttribute('data-underlying-fired', 'true');
  });
});

// ---------------------------------------------------------------------------
// (c) Live deploy sanity — the real hero coverage-chip HelpTooltip, when a
//     populated env renders it. Skips cleanly on no-data / local.
// ---------------------------------------------------------------------------
test.describe('HelpTooltip — live coverage-chip (prod/preview only)', () => {
  test('hero coverage chip opens a role=tooltip on hover', async ({ page }) => {
    test.skip(
      !process.env.PLAYWRIGHT_BASE_URL,
      'live coverage-chip check only meaningful against a populated deploy',
    );
    await page.goto(HOME_URL, { waitUntil: 'commit' });
    await page.waitForLoadState('domcontentloaded').catch(() => {});
    await page.waitForTimeout(2500);
    await page.evaluate(() => document.fonts?.ready);

    const chip = page.getByTestId('coverage-chip');
    const present = (await chip.count()) > 0;
    test.skip(!present, 'coverage-chip not rendered in this env (no orders)');

    await chip.hover();
    const tip = page.getByRole('tooltip');
    await expect(tip).toBeVisible();
    await expect(tip).toContainText('כיסוי');
  });
});
