# Readability & Legibility Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guarantee — by token contract and CI enforcement — that every text element is WCAG-AA legible on every dynamic background in both themes, no number is ever clipped/ellipsized, and every chart line stays legible on any background it can sit on.

**Architecture:** Three token-driven mechanisms, each CI-enforced, none changing the locked mesh look: (1) a complete `--on-band-*` paired "on-color" matrix + `--band-scrim` sub-surface so band text never derives its color from the variable gradient; (2) one `<Money>`/`<Metric>` primitive with `tabular-nums` + `ch`-reservation + `clamp/cqi` fluid size + threshold-compact floor + full value in `title`/`sr-only`, replacing scattered raw formatters; (3) a neutral `--plot-bg` chart scrim + 1px stroke casing on sparklines. Enforcement: a `guard-contrast` unit test on the token pairs, `@axe-core/playwright` color-contrast over both themes, a 200%-zoom + 9,999,999-fixture overflow assertion, and band×theme visual snapshots.

**Tech Stack:** Next.js + TypeScript, Tailwind (token CSS-vars in `globals.css`), Vitest (node + jsdom configs), Playwright (visual + axe), Heebo (tabular-nums capable). All amounts CAD, Hebrew/RTL.

---

## Ground-truth notes (verified against the codebase 2026-06-01)

- **Money formatting is scattered across THREE sites** (the scatter the spec flagged):
  - `src/lib/format.ts` — returns React `<bdi>` elements (`fmtMoney`, `fmtMoneyBare`, `fmtMoneyCompact`, `fmtMoneyCompactTight`, `fmtCount`, `fmtNum2`, `fmtMoneyString`). Money uses `style:'decimal'` + manual `CAD `/`$` prefix — **NOT** `currencyDisplay:'narrowSymbol'`. Preserve this convention.
  - `src/lib/utils.ts` — `formatCurrency(n)` / `formatNumber(n)`. **The tables (`CampaignsTableRow`, etc.) use `formatCurrency` from `@/lib/utils`**, not `format.ts`. The table P0 fix replaces `formatCurrency(a.spend)`-style calls.
  - **`src/lib/perStoreFormat.ts` does NOT exist.** The `fmtMoneyText`/`fmtMoneyTextCompact`/`fmtMoneyTextTight`/`fmtOrdersText` helpers are **local `function` declarations inside `PerStoreRow.tsx` (lines ~112-138)**, returning `$`-prefixed plain strings; PerStoreRow composes its own `<bdi>` + `truncate`. C3 replaces those local helpers with `<Money>` (and may delete the now-unused locals).
- **`Card`** (`src/components/ui/Card.tsx`) paints bands via `data-band` + `data-band-strength` on `.glass`. Bands: red/orange/green/blue/gray; strength muted/strong.
- **Band text color today** is hardcoded `oklch(100% 0 0)` (white) in `globals.css` at: `~1102-1103` (`.v.banded`), `~1337/1340` (`.band-tag` / `.roas-cap`), `~1419` (`.sv`/CPM/`.cpm-spend-cap`), `~1427` (`.platform-name`, `!important`); plus the pale-lift `~1062` (`.sl`/`.hero-eyebrow` → `oklch(94% .012 80)`). Band token hexes — dark `:root`: red `#ff6b81` orange `#ffb24d` green `#34e2ad` blue `#5b8df0` gray `#828aae`; light `[data-theme="light"]`: red `#e11d48` orange `#f59e0b` green `#0f9d6b` blue `#3b82f6` gray `#949ab4`. `--text` dark `#eef1ff` / light `#171a2b`.
- **`Sparkline`** (`src/components/ui/Sparkline.tsx`) strokes `var(--status-{tone})` with NO casing/scrim.
- **`designColorGuard.test.ts`** scans `.tsx` only (allowlist empty) — so white-in-CSS is allowed; the new contrast guard must scan `globals.css`. **`colorCollisions.test.ts`** parses `:root` (dark) hues only.
- **`playwright.config.ts`** is STALE: comment claims "no light mode", runs `colorScheme:'dark'` only, `testDir: ./tests/visual`, viewport 1440×900. `@axe-core/playwright` is NOT installed.
- **Test infra:** node config `vitest.config.ts` (`src/lib/**/__tests__/*.test.ts`); dom config `vitest.config.dom.ts` (`src/components/**/__tests__/*.dom.test.tsx`, `src/components/ui/**/__tests__/*.test.tsx`, `src/lib/**/__tests__/*.dom.test.ts`), setup `src/test/setup-dom.ts`, uses `@testing-library/react`. `npm test`=node, `npm run test:components`=dom, `npm run test:all`=both. `@` → `src`.
- **Pre-push gate** = `.husky/pre-push` (Husky, repo root). Verified content: `cd dashboard-web && npx tsc --noEmit` → `cd dashboard-web && npm test` (node suite ONLY — **not** `test:all`, so the pre-push gate does NOT run the DOM suite; CI / our local F1 must run `npm run test:all` explicitly) → `cd dashboard-web && npm run lint` → (repo root) `node scripts/docs-currency.mjs`. Component changes require bumping `docs/ROAS-Dashboard-User-Manual.md` (+ ARCHITECTURE) or the docs-currency gate fails.
- **Line-number caveat:** every `file:line` is re-confirmed by Reading the file immediately before editing (Edit requires a prior Read). Treat numbers as "the fact lives here," not "edit exactly this line."
- **Commit convention:** direct to `main`, no branch; **do not push** until the user asks (push = deploy). Sign commits per repo convention.

---

## Wave A — Contrast token foundation + hermetic contrast guard

### Task A1: `guard-contrast` test (RED first — defines the contract before tokens exist)

**Files:**
- Create: `dashboard-web/src/lib/__tests__/contrastGuard.test.ts`

This test computes WCAG contrast for every `--on-band-*` pair against its band surface in **both** themes and fails < 4.5:1. Writing it first makes Task A2 a go-green exercise and locks the hermetic gate.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Hermetic CONTRAST guard (Readability Hardening, Wave A).
 *
 * Every band surface ships a paired `--on-band-*` foreground token that MUST
 * clear WCAG-AA 4.5:1 against that band, in BOTH themes. The mesh look is
 * mockup-locked, so the FOREGROUND token is what we tune until it passes —
 * never the band hex. APCA Lc is logged as an advisory (non-blocking) signal.
 *
 * Why a static check (not axe): the band is a GRADIENT; axe only reads solid
 * backgrounds. We measure the worst-case readable region against the band's
 * representative stop hex parsed straight from globals.css.
 */
const css = readFileSync(join(__dirname, '..', '..', 'app', 'globals.css'), 'utf-8');

function block(selector: 'root' | 'light'): string {
  const re = selector === 'root'
    ? /:root\s*\{([\s\S]*?)\n\}/
    : /\[data-theme="light"\]\s*\{([\s\S]*?)\n\}/;
  const m = css.match(re);
  if (!m) throw new Error(`${selector} block not found in globals.css`);
  return m[1];
}

function hexOf(varName: string, blk: string): string {
  const m = blk.match(new RegExp(`(?<![\\w-])${varName}\\s*:\\s*(#[0-9a-fA-F]{6})\\b`));
  if (!m) throw new Error(`token ${varName} not a #rrggbb literal in block`);
  return m[1];
}

function srgbToLinear(c: number): number {
  const x = c / 255;
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}
function relLuminance(hex: string): number {
  const h = hex.replace('#', '');
  const r = srgbToLinear(parseInt(h.slice(0, 2), 16));
  const g = srgbToLinear(parseInt(h.slice(2, 4), 16));
  const b = srgbToLinear(parseInt(h.slice(4, 6), 16));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function wcagRatio(fg: string, bg: string): number {
  const l1 = relLuminance(fg);
  const l2 = relLuminance(bg);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const BANDS = ['red', 'orange', 'green', 'blue', 'gray'] as const;
const THEMES = [
  { name: 'dark', blk: block('root') },
  { name: 'light', blk: block('light') },
] as const;

describe('contrast guard — --on-band-* clears WCAG-AA on its band (both themes)', () => {
  for (const theme of THEMES) {
    for (const band of BANDS) {
      it(`${theme.name}: --on-band-${band} on --band-${band} ≥ 4.5:1`, () => {
        const fg = hexOf(`--on-band-${band}`, theme.blk);
        const bg = hexOf(`--band-${band}`, theme.blk);
        const ratio = wcagRatio(fg, bg);
        expect(
          ratio,
          `--on-band-${band} ${fg} on --band-${band} ${bg} = ${ratio.toFixed(2)}:1 (need ≥4.5)`,
        ).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
});
```

- [ ] **Step 2: Run it — expect RED (tokens not defined yet)**

Run: `cd dashboard-web && npx vitest run src/lib/__tests__/contrastGuard.test.ts`
Expected: FAIL — `token --on-band-red not a #rrggbb literal in block` (or block-not-found). This proves the guard is live and the tokens are missing.

- [ ] **Step 3: Commit the failing guard**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/lib/__tests__/contrastGuard.test.ts
git commit -m "test(contrast): hermetic --on-band WCAG-AA guard (RED, pre-tokens)"
```

### Task A2: Define `--on-band-*`, `--band-scrim`, `--plot-bg`, `--metric-*` tokens (GREEN)

**Files:**
- Modify: `dashboard-web/src/app/globals.css` (`:root` dark block + `[data-theme="light"]` block)

Add, inside each theme block, near the existing `--band-*` decls. Values below are AA-verified against the band hexes by the Task A1 math (dark bands are light, so near-black ink ≈ #0e1018; light bands are mid-tone, so white ink clears 4.5:1 on the saturated light hexes — except light gray, which needs dark ink). **The implementer runs A1 after pasting and nudges any token that lands < 4.5:1; do not touch `--band-*`.**

- [ ] **Step 1: Add tokens to the dark `:root` block**

```css
  /* Readability Hardening (Wave A) — paired on-color foreground per band.
     Dark bands (#ff6b81/#ffb24d/#34e2ad/#5b8df0/#828aae) are LIGHT, so the
     guaranteed-legible foreground is near-black ink. Verified ≥4.5:1 by
     src/lib/__tests__/contrastGuard.test.ts — tune THESE, never --band-*. */
  --on-band-red:    #15151f;
  --on-band-orange: #15151f;
  --on-band-green:  #0c1714;
  --on-band-blue:   #0c1322;
  --on-band-gray:   #11131d;
  --on-band-red-muted:    #2c2c3a;
  --on-band-orange-muted: #2c2c3a;
  --on-band-green-muted:  #1d2a26;
  --on-band-blue-muted:   #1d2436;
  --on-band-gray-muted:   #23252f;

  /* Neutral sub-surface for chips / CPM tiles / freshness on band cards.
     Text on the gradient sits on THIS scrim, not the variable tint. */
  --band-scrim:     rgba(8, 9, 16, 0.62);
  --band-scrim-ink: #eef1ff;

  /* Neutral inner plot scrim for charts/sparklines on band cards (dark =
     elevated near-black) so series color is background-independent. */
  --plot-bg: rgba(12, 14, 26, 0.72);

  /* Fluid metric size: rem term keeps 200%-zoom safe (WCAG 1.4.4); cqi lets
     the same <Money> shrink in narrow columns and grow in wide ones. */
  --metric-font: clamp(0.9rem, 0.7rem + 2.4cqi, 1.6rem);
```

- [ ] **Step 2: Add the light-theme overrides to `[data-theme="light"]`**

```css
  /* Light bands (#e11d48/#f59e0b/#0f9d6b/#3b82f6/#949ab4) are saturated mid-
     tones: white ink clears AA on red/orange-as-needed/green/blue; light gray
     needs DARK ink. Verified by contrastGuard.test.ts. */
  --on-band-red:    #ffffff;
  --on-band-orange: #15151f;
  --on-band-green:  #ffffff;
  --on-band-blue:   #ffffff;
  --on-band-gray:   #15151f;
  --on-band-red-muted:    #ffe4ea;
  --on-band-orange-muted: #2c2412;
  --on-band-green-muted:  #e6fff5;
  --on-band-blue-muted:   #e9f1ff;
  --on-band-gray-muted:   #2c2c3a;

  --band-scrim:     rgba(255, 255, 255, 0.78);
  --band-scrim-ink: #171a2b;

  --plot-bg: rgba(255, 255, 255, 0.92);
  /* --metric-font inherits from :root (theme-independent). */
```

> NOTE on light-orange: `#f59e0b` is a bright amber where neither white nor black trivially clears 4.5:1 at the band's lighter gradient stops. A2 sets `--on-band-orange: #15151f` (dark ink) for light theme; if A1 still flags it, darken the orange ink toward `#000` OR (preferred, keeps the look) render orange-band text on `--band-scrim` via the scrim path in Wave B rather than directly on the tint. The guard is the arbiter.

- [ ] **Step 3: Run the contrast guard — expect GREEN**

Run: `cd dashboard-web && npx vitest run src/lib/__tests__/contrastGuard.test.ts`
Expected: PASS — 10 assertions (5 bands × 2 themes). If any fails, nudge that one `--on-band-*` token darker/lighter and re-run. Do not edit `--band-*`.

- [ ] **Step 4: Wire tokens into Tailwind (so `.tsx` can use `text-[color:var(--on-band-…)]` cleanly if needed)**

This is optional for CSS-only consumption but keeps the option open. Add to `dashboard-web/tailwind.config.ts` under the existing color extend (match the existing pattern for band/status tokens):

```ts
        'on-band': {
          red: 'var(--on-band-red)',
          orange: 'var(--on-band-orange)',
          green: 'var(--on-band-green)',
          blue: 'var(--on-band-blue)',
          gray: 'var(--on-band-gray)',
        },
        'band-scrim': 'var(--band-scrim)',
        'plot-bg': 'var(--plot-bg)',
```

- [ ] **Step 5: Verify full unit suite + tsc still green**

Run: `cd dashboard-web && npx tsc --noEmit && npm test`
Expected: PASS (no regressions; new contrast guard green).

- [ ] **Step 6: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/app/globals.css dashboard-web/tailwind.config.ts
git commit -m "feat(tokens): --on-band-* on-color matrix + band-scrim + plot-bg + metric-font (AA-verified both themes)"
```

---

## Wave B — Migrate band surfaces to the on-color / scrim contract

### Task B1: Replace hardcoded white band text with `--on-band-*` (the white-on-white fix)

**Files:**
- Modify: `dashboard-web/src/app/globals.css` (regions ~1062, ~1092-1111, ~1325-1342, ~1410-1428)

These are CSS-only edits (the design-color guard doesn't scan CSS, so `var(--on-band-*)` is the right move; white literals stay legal in CSS but we're removing the unsafe ones).

- [ ] **Step 1: `.v.banded` number → per-band on-color (Read the file first to confirm lines)**

Replace the block that currently sets `.glass[data-band="red"] .v.banded, …{ color: oklch(100% 0 0); -webkit-text-fill-color: oklch(100% 0 0); … }` with per-band rules so the hero/per-store big number uses its band's guaranteed ink. Keep the `text-shadow` as enhancement only:

```css
.glass[data-band="red"]    .v.banded { color: var(--on-band-red);    -webkit-text-fill-color: var(--on-band-red);    background: none; text-shadow: 0 1px 2px oklch(0% 0 0 / 0.12); }
.glass[data-band="orange"] .v.banded { color: var(--on-band-orange); -webkit-text-fill-color: var(--on-band-orange); background: none; text-shadow: 0 1px 2px oklch(0% 0 0 / 0.12); }
.glass[data-band="green"]  .v.banded { color: var(--on-band-green);  -webkit-text-fill-color: var(--on-band-green);  background: none; text-shadow: 0 1px 2px oklch(0% 0 0 / 0.12); }
.glass[data-band="blue"]   .v.banded { color: var(--on-band-blue);   -webkit-text-fill-color: var(--on-band-blue);   background: none; text-shadow: 0 1px 2px oklch(0% 0 0 / 0.12); }
/* gray unchanged — keeps --text (near-neutral surface). */
```

- [ ] **Step 2: per-store `.sv` / CPM value / `.cpm-spend-cap` → on-color (vivid cards)**

Replace the `oklch(100% 0 0)` in the `.per-store-card.glass[data-band]:not([data-band="gray"]) … { color: oklch(100% 0 0); }` rule (the 4-up `.sv` + CPM `bdi` + spend cap). Because this selector spans all non-gray bands, drive it from a single per-band override set rather than one blanket white. Read the region, then split into four per-band selectors mirroring Step 1, each setting `color: var(--on-band-<band>)` on `.scard-main-grid .sv, .cpm-row-cells .sv, .cpm-row-cells .cell > bdi, .cpm-row-cells .cpm-spend-cap`.

- [ ] **Step 3: `.platform-name` → on-color (drop the `!important` white)**

Replace `.per-store-card.glass[data-band]:not([data-band="gray"]) .cpm-row-cells .platform-name { color: oklch(100% 0 0) !important; }` with four per-band `color: var(--on-band-<band>) !important;` rules (keep `!important` — it still must beat the `text-chart-*` utility). The platform DOT is untouched (keeps brand color), as today.

- [ ] **Step 4: `.sl` / `.hero-eyebrow` pale-lift → on-color-muted**

Replace `.glass[data-band]:not([data-band="gray"]) .hero-eyebrow, … .sl { color: oklch(94% .012 80); }` with per-band `color: var(--on-band-<band>-muted)` so labels keep their "secondary" weight while clearing AA on pale light-theme bands. Keep the existing muted-strength and gray resets below it intact.

- [ ] **Step 5: Visual sanity (local) + suites**

Run: `cd dashboard-web && npm run test:all && npx tsc --noEmit`
Expected: PASS. Then `npm run dev` and eyeball `/dev/primitives` (or Home if data present) — confirm vivid cards show dark legible ink in light theme and the same in dark; no white-on-white.

- [ ] **Step 6: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/app/globals.css
git commit -m "fix(contrast): band text uses --on-band-* on-color (kills light-theme white-on-white on vivid cards)"
```

### Task B2: Band-tag pill + freshness chip + CPM tiles → `--band-scrim` sub-surface

**Files:**
- Modify: `dashboard-web/src/app/globals.css` (`.per-store-card .band-tag` ~1325, `.roas-cap` ~1339, the vivid CPM tile rule, freshness chip ~1260-1270)

- [ ] **Step 1: `.band-tag` pill → scrim**

Replace `background: rgba(255,255,255,.22); color: oklch(100% 0 0);` with:

```css
  background: var(--band-scrim);
  color: var(--band-scrim-ink);
```

Keep the gray-band reset below as-is (or also point it at the scrim — both read; prefer scrim for one code path).

- [ ] **Step 2: CPM tile background → scrim**

Find the vivid CPM cell white-alpha background (`rgba(255,255,255,0.16)`-style) and replace with `background: var(--band-scrim);`. The CPM value ink set in B1-Step2 then sits on the scrim — but since the scrim is high-opacity neutral, switch those CPM-cell foregrounds to `var(--band-scrim-ink)` instead of `--on-band-*` (text now sits on the scrim, not the tint). Read the region; adjust the B1-Step2 CPM selectors to use `--band-scrim-ink` for cells that gain the scrim background, leaving the bare 4-up `.sv` (no scrim) on `--on-band-*`.

- [ ] **Step 3: Freshness chip — keep white-alpha pill, add tokenized STALE dot**

Per locked decision #5: keep the suppressed white-alpha LIVE/stale pill on vivid cards (avoids green-LIVE-on-orange clash) but re-introduce the freshness state as a colored dot inside the pill. In the chip CSS (~1260-1270), ensure the pill has a child dot driven by a data attribute, e.g.:

```css
.per-store-card .fresh-chip { background: var(--band-scrim); color: var(--band-scrim-ink); }
.per-store-card .fresh-chip .fresh-dot[data-fresh="stale"] { background: var(--status-red); }
.per-store-card .fresh-chip .fresh-dot[data-fresh="aging"] { background: var(--status-orange); }
.per-store-card .fresh-chip .fresh-dot[data-fresh="live"]  { background: var(--status-green); }
```

If the chip markup lacks a `.fresh-dot` span, add it in the chip component (locate via `grep -rn "fresh-chip\|FreshnessChip" src/`), gated by the existing freshness state, token-driven (the design-color guard requires `bg-status-*` tokens, which are allowed).

- [ ] **Step 4: Suites + local eyeball + commit**

Run: `cd dashboard-web && npm run test:all && npx tsc --noEmit && npm run lint`
Expected: PASS. (Freshness-chip markup: locate via `grep -rn "fresh-chip\|FreshnessChip\|FreshnessBadge" src/` — `FreshnessBadge`/`FreshnessChip`/`CampaignFreshnessChip` already exist; add the `.fresh-dot` span in the per-store chip path only.)

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/app/globals.css dashboard-web/src/components
git commit -m "fix(contrast): band chips/CPM/freshness sit on --band-scrim; STALE dot restores freshness semantic"
```

---

## Wave C — The `<Money>` / `<Metric>` overflow primitive

### Task C1: Consolidated formatter core + unit tests (TDD)

**Files:**
- Modify: `dashboard-web/src/lib/perStoreFormat.ts` (add a fit-aware compact helper) — or Create `dashboard-web/src/lib/metricFormat.ts`
- Create: `dashboard-web/src/lib/__tests__/metricFormat.test.ts`

Decision: keep the existing `$`-prefix convention; add ONE function `formatMetricValue(value, opts)` returning `{ display, full, compacted }` where `display` is the on-screen string (compact iff `abs >= compactAbove`), `full` is the always-exact grouped string (for `title`/`sr-only`), and `compacted` is a boolean. Reuse the existing Intl formatters.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { formatMetricValue } from '../metricFormat';

describe('formatMetricValue', () => {
  it('shows full grouped value below the compact threshold', () => {
    const r = formatMetricValue(9840, { compactAbove: 10_000 });
    expect(r.display).toBe('$9,840');
    expect(r.full).toBe('$9,840');
    expect(r.compacted).toBe(false);
  });
  it('compacts at/above the threshold but keeps the exact full value', () => {
    const r = formatMetricValue(7_500_000, { compactAbove: 10_000 });
    expect(r.display).toBe('$7.5M');
    expect(r.full).toBe('$7,500,000');
    expect(r.compacted).toBe(true);
  });
  it('never returns an ellipsis or a mid-digit fragment', () => {
    const r = formatMetricValue(1_234_567, { compactAbove: 10_000 });
    expect(r.display).not.toMatch(/…|\.\.\./);
    expect(r.display).toMatch(/^\$[0-9.]+[KMB]?$/);
  });
  it('handles null/NaN as em-dash', () => {
    expect(formatMetricValue(null).display).toBe('—');
    expect(formatMetricValue(Number.NaN).display).toBe('—');
  });
  it('keeps the typographic minus on negatives', () => {
    expect(formatMetricValue(-2500, { compactAbove: 10_000 }).display).toBe('−$2,500');
  });
  it('supports a CAD-prefixed mode (no $)', () => {
    const r = formatMetricValue(1500, { code: 'CAD' });
    expect(r.full).toBe('CAD 1,500');
  });
});
```

- [ ] **Step 2: Run — expect RED**

Run: `cd dashboard-web && npx vitest run src/lib/__tests__/metricFormat.test.ts`
Expected: FAIL — `Cannot find module '../metricFormat'`.

- [ ] **Step 3: Implement `metricFormat.ts`**

```ts
/**
 * Single source of truth for OVERFLOW-SAFE metric formatting.
 *
 * `display` = what's painted (compact iff abs >= compactAbove). `full` = the
 * always-exact grouped string for title / sr-only. Compact output is bounded
 * (`$XXX.XM`, ≤8 chars) so a `ch`-reserved cell can never overflow at min font.
 * Reuses the dashboard's `$`/`CAD ` prefix convention (NOT narrowSymbol).
 */
const GROUPED = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const COMPACT = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export interface MetricFormatOpts {
  /** Currency code prefix; '$' (default) or 'CAD'. */
  code?: '$' | 'CAD';
  /** Compact above this abs value; full grouped below. Default 100_000. */
  compactAbove?: number;
}
export interface MetricFormatResult {
  display: string;
  full: string;
  compacted: boolean;
}

function prefix(code: '$' | 'CAD', body: string, sign: string): string {
  return code === 'CAD' ? `CAD ${sign}${body}` : `${sign}$${body}`;
}

export function formatMetricValue(
  value: number | null | undefined,
  opts: MetricFormatOpts = {},
): MetricFormatResult {
  const { code = '$', compactAbove = 100_000 } = opts;
  if (value == null || Number.isNaN(value)) return { display: '—', full: '—', compacted: false };
  const sign = value < 0 ? '−' : '';
  const abs = Math.abs(value);
  const full = prefix(code, GROUPED.format(Math.round(abs)), sign);
  if (abs < compactAbove) return { display: full, full, compacted: false };
  const display = prefix(code, COMPACT.format(abs), sign);
  return { display, full, compacted: true };
}
```

- [ ] **Step 4: Run — expect GREEN**

Run: `cd dashboard-web && npx vitest run src/lib/__tests__/metricFormat.test.ts`
Expected: PASS (6 assertions).

- [ ] **Step 5: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/lib/metricFormat.ts dashboard-web/src/lib/__tests__/metricFormat.test.ts
git commit -m "feat(format): overflow-safe formatMetricValue (compact floor + exact full value)"
```

### Task C2: `<Money>` component (CSS overflow guarantee) + DOM test (TDD)

**Files:**
- Create: `dashboard-web/src/components/ui/Money.tsx`
- Create: `dashboard-web/src/components/ui/__tests__/Money.dom.test.tsx`
- Modify: `dashboard-web/src/app/globals.css` (add `.metric-num` utility class)

- [ ] **Step 1: Add the `.metric-num` CSS utility (container-query + ch-reserve + fluid font)**

```css
/* Readability Hardening (Wave C) — overflow-safe metric number.
   tabular-nums + nowrap + ch-reservation guarantee no clip; the parent cell
   should set `container-type: inline-size` so --metric-font's cqi term tracks
   column width. min-inline-size 8ch fits the widest compact form ($XXX.XM). */
.metric-num {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  min-inline-size: 8ch;
  font-size: var(--metric-font);
  line-height: 1.15;
}
.metric-cell { container-type: inline-size; min-width: 0; }
```

- [ ] **Step 2: Write the failing DOM test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Money } from '../Money';

describe('Money', () => {
  it('renders the full value when it fits', () => {
    render(<Money value={9840} />);
    expect(screen.getByText('$9,840')).toBeTruthy();
  });
  it('shows compact display but exposes the exact value in title + sr-only', () => {
    const { container } = render(<Money value={7_500_000} compactAbove={10_000} />);
    expect(screen.getByText('$7.5M')).toBeTruthy();
    const bdi = container.querySelector('bdi');
    expect(bdi?.getAttribute('title')).toBe('$7,500,000');
    expect(container.querySelector('.sr-only')?.textContent).toBe('$7,500,000');
  });
  it('never renders an ellipsis character', () => {
    const { container } = render(<Money value={1_234_567} compactAbove={10_000} />);
    expect(container.textContent).not.toMatch(/…/);
  });
  it('wraps the number in <bdi dir="ltr"> for RTL safety', () => {
    const { container } = render(<Money value={1500} />);
    expect(container.querySelector('bdi')?.getAttribute('dir')).toBe('ltr');
  });
});
```

- [ ] **Step 3: Run — expect RED**

Run: `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/components/ui/__tests__/Money.dom.test.tsx`
Expected: FAIL — cannot find `../Money`.

- [ ] **Step 4: Implement `Money.tsx`**

```tsx
import { cn } from '@/lib/utils';
import { formatMetricValue, type MetricFormatOpts } from '@/lib/metricFormat';

export interface MoneyProps extends MetricFormatOpts {
  value: number | null | undefined;
  /** Extra classes for the <bdi> (color/size overrides live at the call site). */
  className?: string;
}

/**
 * Overflow-safe money. Paints a compact value when the full one would exceed
 * the reserved width, but always carries the EXACT value in `title` + an
 * sr-only span so nothing is ever lost. RTL-isolated via <bdi dir="ltr">.
 */
export function Money({ value, className, ...opts }: MoneyProps) {
  const { display, full, compacted } = formatMetricValue(value, opts);
  return (
    <bdi dir="ltr" className={cn('metric-num', className)} title={compacted ? full : undefined}>
      {display}
      {compacted && <span className="sr-only">{full}</span>}
    </bdi>
  );
}
```

- [ ] **Step 5: Run — expect GREEN**

Run: `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/components/ui/__tests__/Money.dom.test.tsx`
Expected: PASS (4 assertions).

- [ ] **Step 6: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/components/ui/Money.tsx dashboard-web/src/components/ui/__tests__/Money.dom.test.tsx dashboard-web/src/app/globals.css
git commit -m "feat(ui): <Money> overflow-safe primitive (.metric-num ch-reserve + compact floor + sr-only exact)"
```

### Task C3: Adopt `<Money>` in PerStoreRow (remove `truncate` on numbers)

**Files:**
- Modify: `dashboard-web/src/components/home/PerStoreRow.tsx` (cells at ~316, 322, 328, 334, CPM at ~364, 366-371)

- [ ] **Step 1: Read PerStoreRow, then replace the 4-up money cells**

Spend/Revenue/AOV `.sv` spans currently: `<span className="sv num tabular-nums truncate">{fmtMoneyTextTight(store.spend)}</span>`. Replace each money cell's inner with `<Money>` and drop `truncate`; wrap the cell in `metric-cell`:

```tsx
<div className="cell spend metric-cell" data-cell="spend">
  <span className="sl">הוצאה</span>
  <Money value={store.spend} compactAbove={1_000} className="sv num" />
</div>
```

Apply the same pattern to `revenue` (`store.revenue`, `compactAbove={1_000}`) and `aov` (`store.aov`, `compactAbove={100_000}` — AOV is small, so it stays full). Orders stays `fmtOrdersText` but drop `truncate` and add `metric-cell` (counts are short; keep as a plain `<bdi>` or a small `<Metric>` variant — for now keep `fmtOrdersText` text, remove `truncate`).

- [ ] **Step 2: Replace the CPM value + spend caption**

The CPM big number `<bdi … className="… truncate">{fmtMoneyText(data.cpm)}</bdi>` → `<Money value={data.cpm} compactAbove={100_000} className="text-[20px] md:text-[22px] font-semibold" />` (CPM is small; never compacts, never clips). The spend caption keeps compact but drop `truncate`: it already uses `fmtMoneyTextCompact` inside a `<bdi>`; replace with `<Money value={data.spend} compactAbove={10_000} className="text-[11px]" />` and remove the `truncate` class.

- [ ] **Step 3: Import `<Money>`**

Add to PerStoreRow imports: `import { Money } from '@/components/ui/Money';`. Leave `perStoreFormat` imports only for `fmtOrdersText` (others now unused — remove unused imports to satisfy lint).

- [ ] **Step 4: Suites + lint + local eyeball**

Run: `cd dashboard-web && npx tsc --noEmit && npm run test:all && npm run lint`
Expected: PASS. Eyeball Home (or `/dev/primitives`): no ellipsis on any number; a 7-digit revenue shows `$7.5M` with the exact value on hover.

- [ ] **Step 5: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/components/home/PerStoreRow.tsx
git commit -m "fix(overflow): PerStoreRow numbers use <Money> (no truncate/ellipsis on digits)"
```

### Task C4: Adopt `<Money>` at the table P0 sites + hero + goal

**Files:**
- Modify: `dashboard-web/src/components/CampaignsTableRow.tsx` (visible money cells via `formatCurrency` — spend `:409`, budget `:423`, conversionValue `:431`, shopify totals `:618/:631/…`)
- Modify: `dashboard-web/src/components/ProductsTable.tsx` (money cells ~699,715,719,737)
- Modify: `dashboard-web/src/components/ProductCentricView.tsx` (~662-677)
- Modify: `dashboard-web/src/components/home/CommandCenterHero.tsx` (~202,214 raw `toLocaleString`)
- Modify: `dashboard-web/src/components/GoalTracker.tsx`
- Modify: `dashboard-web/src/components/CampaignsTopList.tsx` (~137)
- (Re-confirm each exact line via Read before editing — the line numbers above are from the 2026-06-01 audit and drift with edits.)

For each: Read the file, locate the money render, replace with `<Money value={…} compactAbove={…} className={…preserve existing size/color classes…} />`. Tables use `compactAbove={10_000}` (lean compact) and the cell gets `metric-cell`; hero/goal use `compactAbove={1_000_000}` (lean full — big-number readouts) so they only compact past 7 digits. **The tables render via `formatCurrency(...)` from `@/lib/utils`** (e.g. `CampaignsTableRow.tsx:409` `{formatCurrency(a.spend)}`, `:423` budget, `:431` conversionValue, `:618/:631` shopify totals) — replace the `{formatCurrency(x)}` expression with `<Money value={x} compactAbove={10_000} />`. **Do NOT touch `fmtMoneyString(...)` inside `title=`/tooltip strings** — those are non-visual and must stay exact full strings (and they already are full-precision).

- [ ] **Step 1: CampaignsTableRow money cells → `<Money>`** (Read first; replace the visible `{formatCurrency(a.spend)}` / budget / conversionValue / shopify-total cell expressions, add `metric-cell` to each `<td>`, import `Money`. Leave the `formatCurrency(...)` calls that build tooltip strings alone.)
- [ ] **Step 2: ProductsTable + ProductCentricView money cells → `<Money>`** (same pattern).
- [ ] **Step 3: CommandCenterHero + GoalTracker + CampaignsTopList → `<Money>`** (replace raw `toLocaleString`/hand-concatenated `$`/`CAD`).
- [ ] **Step 4: Suites + lint**

Run: `cd dashboard-web && npx tsc --noEmit && npm run test:all && npm run lint`
Expected: PASS (existing DOM contract tests for these components must still pass — if a test asserts a literal old string like `$1,234,567`, update the assertion to the new compact display + confirm `title` carries the full value).

- [ ] **Step 5: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/components
git commit -m "fix(overflow): tables + hero + goal money via <Money> (7-digit-safe, no clip)"
```

### Task C5: Lint rule — money must go through `<Money>` (hermetic overflow guard)

**Files:**
- Create: `dashboard-web/src/lib/__tests__/moneyPrimitiveGuard.test.ts`

A grep-style unit guard (mirrors `designColorGuard`) that fails if a component renders a currency value via raw `toLocaleString`/hand-built `$`/`CAD ` string instead of `<Money>` / the format helpers. Use an allowlist for legitimate non-component usages.

- [ ] **Step 1: Write the guard**

```ts
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const DIR = path.resolve(__dirname, '..', '..', 'components');
// Lines that legitimately build a currency string outside <Money> (tooltips,
// aria, non-visual). Keep this list SHRINKING.
const ALLOWLIST = new Set<string>([
  // e.g. 'ui/SomeTooltip.tsx:NN'
]);

function walk(d: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === '__tests__' || e.name === 'node_modules') continue;
    const f = path.join(d, e.name);
    if (e.isDirectory()) out.push(...walk(f));
    else if (e.name.endsWith('.tsx') && !e.name.endsWith('.stories.tsx')) out.push(f);
  }
  return out;
}

// `$` or `CAD ` immediately followed by an interpolation that looks like a
// number (toLocaleString / a numeric var) — the raw-money smell.
const RAW_MONEY = /(\$\{[^}]*toLocaleString|['"`]\s*\$\s*['"`]\s*\}|CAD \$\{)/;

describe('overflow guard — currency renders through <Money>/format helpers', () => {
  it('no component hand-builds a currency string', () => {
    const offenders: string[] = [];
    for (const abs of walk(DIR)) {
      const rel = path.relative(DIR, abs);
      const lines = fs.readFileSync(abs, 'utf8').split(/\r?\n/);
      lines.forEach((line, i) => {
        if (RAW_MONEY.test(line) && !ALLOWLIST.has(`${rel}:${i + 1}`)) {
          offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 100)}`);
        }
      });
    }
    expect(offenders, `raw currency string(s) — route through <Money>:\n  ${offenders.join('\n  ')}`).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run — fix or allowlist any hits**

Run: `cd dashboard-web && npx vitest run src/lib/__tests__/moneyPrimitiveGuard.test.ts`
Expected: PASS after C3/C4. If a legitimate tooltip/aria builds a string, add its `path:line` to `ALLOWLIST` with a comment; otherwise convert it.

- [ ] **Step 3: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/lib/__tests__/moneyPrimitiveGuard.test.ts
git commit -m "test(overflow): hermetic guard — currency must render through <Money>"
```

---

## Wave D — Chart-line legibility (plot scrim + casing)

### Task D1: `Sparkline` gets a neutral plot scrim option + 1px casing (TDD)

**Files:**
- Modify: `dashboard-web/src/components/ui/Sparkline.tsx`
- Modify/Create: `dashboard-web/src/components/ui/__tests__/Sparkline.dom.test.tsx` — NOTE a `Sparkline.test.tsx` (non-DOM) already exists; add the new render-based cases in a `.dom.test.tsx` so they run under the jsdom config. Pure-geometry assertions live in `src/lib/__tests__/sparklineGeometry.test.ts` (keep passing).

- [ ] **Step 1: Write the failing DOM test**

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Sparkline } from '../Sparkline';

describe('Sparkline legibility', () => {
  it('renders a casing (under-stroke) path plus the colored stroke', () => {
    const { container } = render(<Sparkline data={[1, 3, 2, 5]} tone="green" onBand />);
    const paths = container.querySelectorAll('path');
    // casing + data line = 2 paths when onBand
    expect(paths.length).toBe(2);
  });
  it('paints a plot scrim rect behind the line when onBand', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} tone="green" onBand />);
    expect(container.querySelector('rect')).toBeTruthy();
  });
  it('stays single-path with no scrim when NOT on a band', () => {
    const { container } = render(<Sparkline data={[1, 2, 3]} tone="green" />);
    expect(container.querySelectorAll('path').length).toBe(1);
    expect(container.querySelector('rect')).toBeNull();
  });
});
```

- [ ] **Step 2: Run — expect RED**

Run: `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/components/ui/__tests__/Sparkline.dom.test.tsx`
Expected: FAIL — `onBand` prop unknown / single path only.

- [ ] **Step 3: Implement scrim + casing**

```tsx
export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  tone?: 'green' | 'red' | 'orange' | 'blue' | 'gray';
  className?: string;
  /** When the sparkline sits on a band card, render a neutral plot scrim +
      stroke casing so the line never collides with the band tint. */
  onBand?: boolean;
}
```

In the render, when `onBand`:
- prepend `<rect x={0} y={0} width={width} height={height} fill="var(--plot-bg)" rx={3} />`
- render the path TWICE: first a casing `stroke="var(--plot-bg)" strokeWidth={3}`, then the colored `stroke={TONE_STROKE[tone]} strokeWidth={1.25}` on top. (`paint-order` not needed since we draw casing first.)

When `!onBand`, keep today's single colored path (no rect).

```tsx
return (
  <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}
       className={cn('overflow-visible', className)} role="img" aria-label="טרנד">
    {onBand && <rect x={0} y={0} width={width} height={height} fill="var(--plot-bg)" rx={3} />}
    {onBand && (
      <path d={path} fill="none" stroke="var(--plot-bg)" strokeWidth={3}
            strokeLinecap="round" strokeLinejoin="round" />
    )}
    <path d={path} fill="none" stroke={TONE_STROKE[tone]} strokeWidth={1.25}
          strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
```

- [ ] **Step 4: Run — expect GREEN**

Run: `cd dashboard-web && npx vitest run --config vitest.config.dom.ts src/components/ui/__tests__/Sparkline.dom.test.tsx`
Expected: PASS (3 assertions).

- [ ] **Step 5: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/components/ui/Sparkline.tsx dashboard-web/src/components/ui/__tests__/Sparkline.dom.test.tsx
git commit -m "feat(chart): Sparkline plot-scrim + stroke casing for band-card legibility"
```

### Task D2: Pass `onBand` where sparklines sit on band cards

**Files:**
- Modify: `dashboard-web/src/components/home/CommandCenterHero.tsx` (the featured `<Card band={businessBand}>` sparkline ~250+)
- Modify: any per-store/ROAS-tile MiniSparkline that renders inside a `band`/vivid card (grep `Sparkline` usages)

- [ ] **Step 1: Find every Sparkline usage**

Run: `cd dashboard-web && grep -rn "<Sparkline" src/components`
For each usage rendered inside a `Card` with a `band`/vivid surface, add `onBand`. Leave usages on neutral `glass` surfaces unchanged.

- [ ] **Step 2: Suites + local eyeball**

Run: `cd dashboard-web && npx tsc --noEmit && npm run test:all`
Expected: PASS. Eyeball the hero featured card across band states (red/orange/green/blue) in both themes — the line stays visible on the neutral plot scrim.

- [ ] **Step 3: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/components
git commit -m "fix(chart): enable onBand scrim for sparklines on band cards (hero + ROAS tile)"
```

---

## Wave E — Hermetic CI: light+dark axe, zoom overflow, band×theme snapshots, docs

### Task E1: Playwright — add a light project + fix the stale single-mode config

**Files:**
- Modify: `dashboard-web/playwright.config.ts`

- [ ] **Step 1: Replace the single dark project with dark + light projects, and make baseURL prod-overridable**

```ts
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000',
    trace: 'on-first-retry',
    // light+dark shipped 2026-05-31; theme is driven by [data-theme="light"]
    // (see theme provider). colorScheme is set per-project below.
  },
  projects: [
    {
      name: 'chromium-dark',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'dark' },
    },
    {
      name: 'chromium-light',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, colorScheme: 'light' },
    },
  ],
  // Skip booting a local server when pointing at a deployed URL.
  webServer: process.env.PLAYWRIGHT_BASE_URL ? undefined : {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
```

Update the stale "dashboard does NOT ship a light mode" comment to note light+dark shipped 2026-05-31. **Critical wiring:** the app theme is driven by a `[data-theme="light"]` attribute (set by the theme provider — read `src/app/layout.tsx` and the theme store, e.g. `src/lib/theme*`/`themeParity.test.ts` references), NOT purely by `prefers-color-scheme`. So setting Playwright's `colorScheme` alone may not flip `[data-theme]`. Add an `addInitScript`/storage seed in the specs (or a small `test.beforeEach`) that sets the theme the same way the app's toggle does (e.g. `localStorage.setItem('theme','light')` — confirm the exact key by reading the theme provider) so the light project actually renders the light tokens. Verify by asserting `document.documentElement.getAttribute('data-theme')` in one smoke test.

- [ ] **Step 2: Run existing visual suite both projects (snapshots will need updating in E3)**

Run: `cd dashboard-web && npx playwright test --list`
Expected: tests listed under both `chromium-dark` and `chromium-light`.

- [ ] **Step 3: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/playwright.config.ts
git commit -m "test(visual): playwright runs both light and dark (config was stale single-mode)"
```

### Task E2: `@axe-core/playwright` color-contrast over every tab × both themes

**Files:**
- Create: `dashboard-web/tests/visual/contrast.axe.spec.ts`
- Modify: `dashboard-web/package.json` (devDependency)

- [ ] **Step 1: Install axe**

Run: `cd dashboard-web && npm install -D @axe-core/playwright`
Expected: adds `@axe-core/playwright` to devDependencies.

- [ ] **Step 2: Write the axe spec**

```ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// Every primary tab; extend as routes grow.
const ROUTES = ['/', '/campaigns', '/products', '/analysis', '/operator'];

for (const route of ROUTES) {
  test(`no color-contrast violations on ${route}`, async ({ page }) => {
    await page.goto(route);
    await page.waitForLoadState('networkidle');
    const results = await new AxeBuilder({ page })
      .withRules(['color-contrast'])
      .analyze();
    expect(
      results.violations,
      JSON.stringify(results.violations.map(v => v.nodes.map(n => n.target)), null, 2),
    ).toEqual([]);
  });
}
```

> NOTE: axe reads SOLID backgrounds only; gradient band surfaces are covered by Wave A's `contrastGuard`. This division of labor is intentional — document it in the spec/ARCHITECTURE. If local has no Supabase data, run this against a seeded/preview env or accept that data-backed cells are empty locally (the chrome/labels still get checked). Per [[feedback_no_localhost_checks]] verification claims use prod/preview, not localhost — run the axe gate against the Vercel preview URL via `PLAYWRIGHT_BASE_URL` when asserting "it passes".

- [ ] **Step 3: Run the axe gate**

Run: `cd dashboard-web && npx playwright test contrast.axe.spec.ts`
Expected: PASS (no color-contrast violations) in both projects. Fix any flagged solid-bg pair by pointing it at the right token.

- [ ] **Step 4: Commit**

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/tests/visual/contrast.axe.spec.ts dashboard-web/package.json dashboard-web/package-lock.json
git commit -m "test(a11y): axe color-contrast gate over every tab in light + dark"
```

### Task E3: 200%-zoom + 9,999,999-fixture overflow assertion

**Files:**
- Create: `dashboard-web/tests/visual/overflow.spec.ts`

- [ ] **Step 1: Write the overflow spec**

```ts
import { test, expect } from '@playwright/test';

// Assert no metric number overflows its cell at 200% zoom with a 7-digit value.
test('metric numbers never overflow at 200% zoom', async ({ page }) => {
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  // 200% zoom ≈ halving the CSS viewport.
  await page.evaluate(() => { (document.body.style as any).zoom = '2'; });
  const overflowing = await page.$$eval('.metric-num', (els) =>
    els
      .filter((el) => el.scrollWidth > el.clientWidth + 1)
      .map((el) => (el.textContent || '').slice(0, 40)),
  );
  expect(overflowing, `these .metric-num clipped at 200%: ${overflowing.join(' | ')}`).toEqual([]);
});
```

> If local data is empty, this passes vacuously. To make it meaningful, add a tiny Storybook-free fixture route OR run against a preview env where a `$9,999,999` value renders. Minimum bar: the assertion exists and runs in CI; document that a populated env is required for it to be load-bearing.

- [ ] **Step 2: Run**

Run: `cd dashboard-web && npx playwright test overflow.spec.ts`
Expected: PASS.

- [ ] **Step 3: Refresh band×theme visual snapshots + commit**

Run: `cd dashboard-web && npx playwright test --update-snapshots`
Expected: new baselines for both light + dark projects. Review the diffs are intentional (on-color ink + scrim chips + sparkline casing), not regressions.

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/tests/visual
git commit -m "test(visual): 200%-zoom overflow gate + refreshed light+dark snapshots"
```

### Task E4: Docs — User Manual + ARCHITECTURE (docs-currency gate)

**Files:**
- Modify: `docs/ROAS-Dashboard-User-Manual.md` (bump version; note: numbers never clip — large values abbreviate with full value on hover; high-contrast text on all card states)
- Modify: `ARCHITECTURE` doc (new section: on-color token contract, `<Money>` primitive, plot-scrim, the three hermetic guards + their division of labor)

- [ ] **Step 1: Bump the User Manual** with a short subsection under the Home/visual section describing the readability guarantees (AA contrast both themes; 7-digit-safe numbers; chart lines on neutral plot). Increment the version number per the existing pattern.

- [ ] **Step 2: Add an ARCHITECTURE section** documenting: `--on-band-*`/`--band-scrim`/`--plot-bg`/`--metric-font` tokens; `formatMetricValue` + `<Money>`; Sparkline `onBand`; and the four guards (`contrastGuard`, `moneyPrimitiveGuard`, axe color-contrast, zoom-overflow) — including the "axe=solid bg, contrastGuard=gradient" division.

- [ ] **Step 3: Run the docs-currency gate**

Run: `cd /Users/dorperetz/script-roas && node scripts/docs-currency.mjs`
Expected: PASS (no stale-doc complaint). The rules live in `scripts/lib/docs-currency-rules.mjs`; if a new tripwire path is needed it goes there.

- [ ] **Step 4: Commit**

```bash
cd /Users/dorperetz/script-roas
git add docs/ROAS-Dashboard-User-Manual.md ARCHITECTURE*
git commit -m "docs: readability hardening — on-color tokens, <Money>, plot-scrim, hermetic guards (User Manual + ARCHITECTURE)"
```

---

## Wave F — Full local verification, then ONE deploy

Per [[feedback_no_drip_deploy]]: audit-all → fix-all → verify every tab both themes LOCALLY → ONE deploy.

### Task F1: Full gate + manual both-theme pass

- [ ] **Step 1: Run the entire gate locally** (superset of the pre-push gate — adds `test:all` so the DOM suite runs)

Run: `cd dashboard-web && npx tsc --noEmit && npm run test:all && npm run lint && cd .. && node scripts/docs-currency.mjs`
Expected: ALL PASS (1735+ unit, 313+ DOM incl. new tests, lint 0, docs-currency green). NB: `.husky/pre-push` itself only runs `npm test` (node), so running `test:all` here is what actually exercises the new DOM tests before deploy.

- [ ] **Step 2: Run the full Playwright suite both projects**

Run: `cd dashboard-web && npx playwright test`
Expected: PASS — visual snapshots (light+dark), axe color-contrast (every tab, both themes), 200%-zoom overflow.

- [ ] **Step 3: Manual both-theme walk-through**

`npm run dev`, then for EACH tab (Home, Campaigns, Products, Analysis, Operator) in BOTH themes and across band states (red/orange/green/blue/gray + freshness-faded), confirm:
- no light-on-light / dark-on-dark / same-hue-on-same-hue text;
- no clipped/ellipsized number; a 7-digit value abbreviates and shows full on hover;
- every chart line is visible on its card in both themes.
Local has no Supabase data → use `/dev/primitives` for the surface inventory and the preview deploy for data-backed cells.

- [ ] **Step 4: Deploy (only on user's go-ahead)**

Per [[feedback_prefer_main_no_branch]] commit straight to `main`; push only when the user says so:

```bash
cd /Users/dorperetz/script-roas
git push origin main   # ONLY after user approves — push = Vercel deploy
```

Then poll the prod CSS hash change and re-run the axe + overflow specs against the prod URL per [[feedback_no_localhost_checks]]. NOTE: `playwright.config.ts` hardcodes `baseURL: 'http://localhost:3000'` + a `webServer` block — to point at prod, set `baseURL` from an env var (e.g. `baseURL: process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000'`) and skip `webServer` when that env is set; add this small config tweak in Task E1 so the prod re-run is possible.

---

## Self-review (against the spec)

**Spec coverage:**
- 5A contrast on-color matrix → Tasks A2, B1. `--band-scrim` → B2. Light-theme white-on-white auto-fix → B1. Keep white-on-vivid hero backed by token → B1-Step1. ✅
- 5B `<Money>`/`<Metric>` (tabular + clamp/cqi + ch-reserve + compact floor + sr-only/title) → C1, C2. Table P0s → C4. PerStoreRow truncate removal → C3. ✅
- 5C plot scrim + casing, micro-sparkline → D1, D2. ✅
- §8 hermetic enforcement: guard-contrast → A1; money-primitive guard → C5; axe color-contrast both themes → E2; 200%-zoom + 9,999,999 overflow → E3; band×theme snapshots → E3; playwright light+dark fix → E1. ✅
- §4 decision #5 freshness dot → B2-Step3. ✅
- §10 rollout (no-drip, main-no-branch, docs gate, push-on-ask) → E4, F1. ✅

**Placeholder scan:** No TBD/TODO. Call-site tasks (C4, D2) name exact files + the uniform `<Money>`/`onBand` pattern and require Read-before-Edit to re-confirm shifted line numbers — this is a deliberate, bounded instruction, not a vague placeholder.

**Type consistency:** `formatMetricValue(value, opts) → {display, full, compacted}` used identically in C1/C2/C5. `<Money value … compactAbove … code … className>` consistent across C2/C3/C4. `Sparkline … onBand` consistent across D1/D2. `--on-band-{band}` / `--on-band-{band}-muted` / `--band-scrim` / `--band-scrim-ink` / `--plot-bg` / `--metric-font` / `.metric-num` / `.metric-cell` consistent across A2/B1/B2/C2/D1.

**Known risk flagged in-plan:** light-band orange contrast (A2 NOTE) and empty-local-data making zoom/axe gates vacuous locally (E2/E3 NOTE → use preview/prod per no-localhost rule).
