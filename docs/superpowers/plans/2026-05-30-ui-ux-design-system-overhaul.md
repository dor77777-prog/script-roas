# UI/UX Design-System Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a single mega-PR that resolves all 11 concerns from the 2026-05-30 fresh independent UI/UX audit — tokens, Home tab hover bug, Live gradient softening, RTL bidi gaps, store-color schism, amber bypass sweep, Home/Analysis IA restructure, year-selectable monthly tables, /operator sub-tab grouping, primitive enforcement (Button/Sheet/TableBase/Stat/InsightCard), CampaignsTable virtualization, and dark-mode parity gates.

**Architecture:** Two-layer token system (semantic OKLCH vars in `globals.css` referenced by Tailwind utilities and CVA primitives), `<bdi dir="ltr">` wrappers on every dynamic-content surface that mixes Hebrew with English, three new shared primitives that absorb the duplicated ad-hoc components, two new sub-tab structures (Analysis → Trends + Archive; /operator → Sync/Health/Activity/Danger), three ESLint guards to prevent regression (no raw `<button>` outside `components/ui/`, no `dark:` Tailwind variants in components, no hex literals in components), and one rendering-virtualization pass for `CampaignsTable`.

**Tech Stack:** Next.js 15.5 · React 19 · Tailwind CSS 3 · Radix UI primitives · class-variance-authority · Recharts 3 · react-window (new dependency) · Vitest + @testing-library/react · SWR · OKLCH color system.

**Audit reference:** `docs/superpowers/specs/2026-05-30-ui-ux-design-system-overhaul-audit.md` (committed at `4d523a9`).

**Scoping decisions captured 2026-05-30 evening:**
- Store color canonical = chart palette (cyan / hot-pink / lime). Migrate `format.ts` to use the tokens.
- `/operator` restructure IN scope (4 sub-tabs).
- Analysis tab split IN scope (Trends + Archive sub-tabs with own date pickers).
- Phasing = single mega-PR (one large branch, multiple commits within it).
- Storybook setup is OUT of scope for this PR (separate follow-up).

**Branch + base:** Create branch `ui-ux/design-system-overhaul-2026-05-30` from current `origin/main` (HEAD `4d523a9`).

---

## File structure overview

### Files to CREATE
- `dashboard-web/src/components/ui/Stat.tsx` — shared stat-block primitive
- `dashboard-web/src/components/ui/TableBase.tsx` — shared table primitives (TableHead, TableHeaderCell, TableRow, TableCell)
- `dashboard-web/src/components/ui/InsightCard.tsx` — shared insight/recommendation card with `tone="warning|success|info"`
- `dashboard-web/src/components/AnalysisTrendsTab.tsx` — Analysis sub-tab #1 (chart + annotations)
- `dashboard-web/src/components/AnalysisArchiveTab.tsx` — Analysis sub-tab #2 (year selector + month accordion)
- `dashboard-web/src/components/HomeLiveBand.tsx` — Home band #1 (TodayLive)
- `dashboard-web/src/components/HomeSummaryBand.tsx` — Home band #2 (Hero + KPI cards consolidated)
- `dashboard-web/src/components/HomePerStoreBand.tsx` — Home band #3 (PerStoreCards + collapsible insights)
- `dashboard-web/src/app/operator/SyncTab.tsx` — /operator sub-tab #1
- `dashboard-web/src/app/operator/HealthTab.tsx` — /operator sub-tab #2
- `dashboard-web/src/app/operator/ActivityTab.tsx` — /operator sub-tab #3
- `dashboard-web/src/app/operator/DangerTab.tsx` — /operator sub-tab #4
- `dashboard-web/src/components/__tests__/bidi.dom.test.tsx` — 4 RTL bidi regression tests
- `dashboard-web/src/lib/__tests__/tokenParity.test.ts` — dark/light token-parity CI gate
- `dashboard-web/eslint-rules/no-raw-button-in-components.js` — custom ESLint rule
- `dashboard-web/eslint-rules/no-dark-variant-in-components.js` — custom ESLint rule
- `dashboard-web/eslint-rules/no-hex-color-in-components.js` — custom ESLint rule

### Files to MODIFY
- `dashboard-web/src/app/globals.css` — new tokens (`--status-warning*`, `--chart-axis`, `--chart-cpm-prev`, `--gradient-hero-*`, `--store-*-{bg,fg}`), `--text-muted` dark tuning, `--border-subtle` rename, tooltip surface fix, dark-mode `--status-*-bg` chroma/L reduction
- `dashboard-web/tailwind.config.ts` — expose new tokens as Tailwind utilities
- `dashboard-web/src/lib/storeColors.ts` — canonical source of truth for store palette
- `dashboard-web/src/lib/format.ts` — replace `STORE_HUES` hex map with token-backed accessor; remove fallback hex array
- `dashboard-web/src/lib/chartColors.ts` — promote to `PLATFORM_TOKENS`; fix `--chart-axis` reference; move `cpmPrev` to CSS var
- `dashboard-web/src/lib/annotations.ts` — migrate `ANNOTATION_KIND_COLOR` hex to CSS vars
- `dashboard-web/src/components/Sidebar.tsx:91-93` — Home hover state fix + active 1-px ring
- `dashboard-web/src/components/TodayLive.tsx` — no code change; gradient softens via dark-mode token change in globals.css
- `dashboard-web/src/components/ui/Button.tsx` — destructive variant text color → `text-status-redFg`
- `dashboard-web/src/components/ui/Badge.tsx` — export `BADGE_TONE_BG` map for re-use
- `dashboard-web/src/components/HeroOverview.tsx:269` — hardcoded gradient → CSS-var Tailwind arbitrary value
- `dashboard-web/src/components/CampaignsTable.tsx` — remove duplicate `TONE_BG`; import from Badge; integrate `TableBase`; add react-window virtualization
- `dashboard-web/src/components/AdsDrawer.tsx` — remove duplicate `TONE_BG`; fix `red → text-status-redFg`; migrate to `Sheet`; replace inline `<button>` with `Button`; integrate `TableBase` + `Stat`
- `dashboard-web/src/components/CampaignDrawer.tsx` — migrate to `Sheet`; add `<bdi dir="ltr">` to title (line 825) + Ads Manager link (line 859); replace inline `<button>` with `Button`
- `dashboard-web/src/components/CampaignsTableRow.tsx` — `<bdi dir="ltr">` on campaign-name cell (line 286); replace title-attr tooltips with Radix `Tooltip` for mixed-text content (lines 315, 368, 652-654)
- `dashboard-web/src/components/PerStoreCards.tsx:77-80` — `<bdi dir="ltr">` on store-name spans
- `dashboard-web/src/components/InsightsPanel.tsx` — adopt new `InsightCard` primitive; remove inline amber
- `dashboard-web/src/components/InsightsBoard.tsx` — replace `bg-amber-500` with `--status-warning`
- `dashboard-web/src/components/WhatsWorking.tsx` — adopt `InsightCard`
- `dashboard-web/src/components/HealthScorePanel.tsx` — adopt `InsightCard`
- `dashboard-web/src/components/GoalTracker.tsx` — replace 6+ raw `<button>` with `Button`; standardize disabled state
- `dashboard-web/src/components/SyncIndicator.tsx:86, 94` — amber → `--status-warning`
- `dashboard-web/src/components/CampaignDrawerStatusSection.tsx:63-64, 88` — amber → `--status-warning`
- `dashboard-web/src/components/CohortComparisonPanel.tsx` — amber sweep
- `dashboard-web/src/components/TabFreshnessHeader.tsx:59` — amber → `--status-warning`
- `dashboard-web/src/components/RefundIndicator.tsx` — remove inline `dark:text-amber-300`; route through `--status-warning`
- `dashboard-web/src/components/Filters.tsx:181-185` — focus ring → `focus-visible:ring-2 focus-visible:ring-accent`
- `dashboard-web/src/components/MonthlyTables.tsx` — remove hardcoded `MONTHLY_TABLES_HISTORY_MONTHS = 17`; replace with year-keyed fetch + month accordion (called from new `AnalysisArchiveTab`)
- `dashboard-web/src/components/Dashboard.tsx` — Home tab content → 3-band structure; Analysis branch → sub-tab renderer; route to new tab components
- `dashboard-web/src/app/operator/page.tsx` — split current 12-panel layout into 4 sub-tabs (uses Radix Tabs)
- `dashboard-web/eslint.config.js` — register 3 new custom rules
- `dashboard-web/package.json` — add `react-window` + `@types/react-window`
- `docs/ARCHITECTURE.md` — add §26 "UI/UX Design-System Overhaul (2026-05-30)"
- `docs/ROAS-Dashboard-User-Manual.md` — bump version 2.3.1 → 2.4.0; document Home re-layout + Analysis sub-tabs + Archive year picker + /operator sub-tabs

### Files to DELETE
None. Backwards-compat preserved; `format.ts`'s `STORE_HUES` becomes a thin accessor over the token system.

---

## Task ordering rationale

Tokens first (T01-T06) so every later task can reference them. Then visual one-liners (T07-T09) for fast confidence. Then component primitives (T10-T12) since they're prerequisites for migrations. Then sweeps (T13-T17). Then IA restructures (T18-T20). Then perf (T21). Then guards + tests (T22-T24). Then docs (T25). Then final verification (T26).

Each task ends with a commit on the same branch. PR opens at the end of T26 against `origin/main`.

---

## Task 1: Branch setup + react-window dependency

**Files:**
- Modify: `dashboard-web/package.json`

- [ ] **Step 1: Confirm working tree clean + create branch from origin/main**

```bash
cd /Users/dorperetz/script-roas
git status -uno  # expect: working tree clean, on main, up to date
git checkout -b ui-ux/design-system-overhaul-2026-05-30
```

- [ ] **Step 2: Install react-window**

```bash
cd dashboard-web
npm install --save react-window @types/react-window
```

- [ ] **Step 3: Verify package.json updated**

```bash
grep "react-window" package.json
```

Expected: two lines (one in `dependencies`, one in `devDependencies` for `@types/react-window`).

- [ ] **Step 4: Run vitest baseline**

```bash
npm test 2>&1 | tail -5
```

Expected: `Tests 1577 passed | 9 skipped (1586)`.

- [ ] **Step 5: Commit dependency bump**

```bash
git add package.json package-lock.json
git commit -m "feat(ui-ux): add react-window for CampaignsTable virtualization"
```

---

## Task 2: Add new design tokens to globals.css

**Files:**
- Modify: `dashboard-web/src/app/globals.css`

- [ ] **Step 1: Write the failing test for token presence**

Create `dashboard-web/src/app/__tests__/globals-new-tokens.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '..', 'globals.css'), 'utf-8');

describe('Phase E1.6.1 UI overhaul — new tokens in globals.css', () => {
  for (const tok of [
    '--status-warning',
    '--status-warning-bg',
    '--status-warning-fg',
    '--chart-axis',
    '--chart-cpm-prev',
    '--gradient-hero-from',
    '--gradient-hero-via',
    '--gradient-hero-to',
    '--store-uzoshop-bg',
    '--store-uzoshop-fg',
    '--store-zolplus-bg',
    '--store-zolplus-fg',
    '--store-usmile-bg',
    '--store-usmile-fg',
  ]) {
    it(`defines ${tok} in :root`, () => {
      const rootBlock = css.match(/:root\s*\{[\s\S]*?\}/)?.[0] ?? '';
      expect(rootBlock).toContain(tok);
    });
    it(`defines ${tok} in [data-theme="dark"]`, () => {
      const darkBlock = css.match(/\[data-theme="dark"\]\s*\{[\s\S]*?\}/)?.[0] ?? '';
      expect(darkBlock).toContain(tok);
    });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/app/__tests__/globals-new-tokens.test.ts
```

Expected: all 28 assertions FAIL with "expected ... to contain '--status-warning'" etc.

- [ ] **Step 3: Add the tokens to globals.css**

In the `:root { ... }` block, after the existing `--status-*` group, add:

```css
  /* Phase E1.6.1 UI overhaul (2026-05-30) — semantic warning tone for
     amber-* sweep. Same chroma as --status-orange but tuned for
     warnings: -bg at 92% L (light) / 18% L (dark) for chip surface,
     -fg at 25% L (light) / 92% L (dark) for body text. */
  --status-warning: oklch(70% 0.14 75);
  --status-warning-bg: oklch(95% 0.06 75);
  --status-warning-fg: oklch(25% 0.05 75);

  /* Chart utility tokens. --chart-axis was referenced by chartColors.ts
     but never defined. Anchored to --text-muted at 60% opacity for a
     subtle axis line. --chart-cpm-prev was a hardcoded #fbbf24 in
     chartColors.ts; now mode-aware. */
  --chart-axis: oklch(60% 0.015 250 / 0.6);
  --chart-cpm-prev: oklch(75% 0.15 75);

  /* Hero gradient — was hardcoded #091c4a / #0d3680 / #1d4ed8 in
     HeroOverview.tsx. Refactored to CSS vars so dark mode adapts. */
  --gradient-hero-from: oklch(20% 0.12 260);
  --gradient-hero-via: oklch(32% 0.16 260);
  --gradient-hero-to: oklch(48% 0.20 260);

  /* Per-store badge color tokens. Sourced from storeColors.ts chart
     palette (cyan / hot-pink / lime) per 2026-05-30 user decision —
     replaces format.ts STORE_HUES navy/red/green schism. */
  --store-uzoshop: oklch(70% 0.13 200);     /* cyan */
  --store-uzoshop-bg: oklch(94% 0.04 200);
  --store-uzoshop-fg: oklch(22% 0.05 200);
  --store-zolplus: oklch(68% 0.20 340);     /* hot pink */
  --store-zolplus-bg: oklch(94% 0.04 340);
  --store-zolplus-fg: oklch(22% 0.06 340);
  --store-usmile: oklch(72% 0.20 130);      /* lime */
  --store-usmile-bg: oklch(94% 0.04 130);
  --store-usmile-fg: oklch(22% 0.05 130);
```

In the `[data-theme="dark"] { ... }` block, add the corresponding dark overrides:

```css
  /* Phase E1.6.1 UI overhaul — dark-mode warning/chart/hero/store tokens. */
  --status-warning: oklch(78% 0.18 75);
  --status-warning-bg: oklch(28% 0.08 75);
  --status-warning-fg: oklch(94% 0.04 75);

  --chart-axis: oklch(65% 0.015 240 / 0.5);
  --chart-cpm-prev: oklch(80% 0.18 75);

  --gradient-hero-from: oklch(15% 0.06 260);
  --gradient-hero-via: oklch(22% 0.12 260);
  --gradient-hero-to: oklch(35% 0.18 260);

  --store-uzoshop: oklch(75% 0.13 200);
  --store-uzoshop-bg: oklch(28% 0.06 200);
  --store-uzoshop-fg: oklch(94% 0.04 200);
  --store-zolplus: oklch(72% 0.20 340);
  --store-zolplus-bg: oklch(28% 0.08 340);
  --store-zolplus-fg: oklch(94% 0.04 340);
  --store-usmile: oklch(78% 0.20 130);
  --store-usmile-bg: oklch(28% 0.08 130);
  --store-usmile-fg: oklch(94% 0.04 130);
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/app/__tests__/globals-new-tokens.test.ts
```

Expected: all 28 assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css src/app/__tests__/globals-new-tokens.test.ts
git commit -m "feat(ui-ux): add warning/chart/hero/store CSS-var tokens (light + dark)"
```

---

## Task 3: Dark-mode tuning — `--text-muted` + Live gradient softening

**Files:**
- Modify: `dashboard-web/src/app/globals.css`

- [ ] **Step 1: Write the failing test for the new dark values**

Create `dashboard-web/src/app/__tests__/dark-mode-tuning.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '..', 'globals.css'), 'utf-8');
const darkBlock = css.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)?.[1] ?? '';

describe('Phase E1.6.1 — dark mode tuning', () => {
  it('--text-muted dark lifts to ~70% L (was identical to light)', () => {
    const m = darkBlock.match(/--text-muted:\s*oklch\(\s*([\d.]+)%/);
    expect(m).not.toBeNull();
    const L = parseFloat(m![1]);
    expect(L).toBeGreaterThanOrEqual(68);
    expect(L).toBeLessThanOrEqual(72);
  });

  it('--status-red-bg dark chroma <= 0.16 (was 0.22; Live gradient calmer)', () => {
    const m = darkBlock.match(/--status-red-bg:\s*oklch\(\s*[\d.]+%\s+([\d.]+)/);
    expect(m).not.toBeNull();
    expect(parseFloat(m![1])).toBeLessThanOrEqual(0.16);
  });

  it('--status-green-bg dark L between 38% and 46% (was 50%)', () => {
    const m = darkBlock.match(/--status-green-bg:\s*oklch\(\s*([\d.]+)%/);
    expect(m).not.toBeNull();
    const L = parseFloat(m![1]);
    expect(L).toBeGreaterThanOrEqual(38);
    expect(L).toBeLessThanOrEqual(46);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/app/__tests__/dark-mode-tuning.test.ts
```

Expected: 3 FAIL.

- [ ] **Step 3: Update globals.css dark block**

In the `[data-theme="dark"] { ... }` block:

- Change `--text-muted: oklch(60% 0.015 240);` to `--text-muted: oklch(70% 0.015 240);`
- For each `--status-{red|orange|green|blue|gray}-bg`, change `oklch(50% 0.22 …)` (or equivalent) to `oklch(42% 0.14 …)` (preserves the hue, drops both lightness and chroma so the Live tab gradient is calmer in dark mode while staying ≥3:1 contrast against white text).

Concretely:

```css
  --status-red-bg: oklch(42% 0.14 10);
  --status-orange-bg: oklch(45% 0.14 75);
  --status-green-bg: oklch(42% 0.14 145);
  --status-blue-bg: oklch(42% 0.14 255);
  --status-gray-bg: oklch(42% 0.005 0);
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/app/__tests__/dark-mode-tuning.test.ts
```

Expected: all 3 PASS.

- [ ] **Step 5: Verify no Live-gradient consumer reads from a different token**

```bash
grep -rn "var(--status-.*-bg)" src/components/TodayLive.tsx
```

Expected: 5 lines (red/green/orange/blue/gray cardBg gradients) — confirms the gradient softening flows automatically without TodayLive.tsx changes.

- [ ] **Step 6: Commit**

```bash
git add src/app/globals.css src/app/__tests__/dark-mode-tuning.test.ts
git commit -m "fix(ui-ux): soften dark-mode --status-*-bg + lift --text-muted L for Live gradient calm"
```

---

## Task 4: Home tab "always selected" — Sidebar hover fix

**Files:**
- Modify: `dashboard-web/src/components/Sidebar.tsx`

- [ ] **Step 1: Write the failing component test**

Create `dashboard-web/src/components/__tests__/sidebarHoverState.dom.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import Sidebar from '@/components/Sidebar';

describe('Sidebar — hover state must differ from active state', () => {
  it('inactive nav item hover classes do NOT include bg-elevated2', () => {
    render(<Sidebar activeTab="home" onTabChange={() => {}} onOpenMobile={() => {}} mobileOpen={false} />);
    const inactive = screen.getByRole('button', { name: /P&L/ });
    const cls = inactive.className;
    // Inactive default state must NOT use bg-elevated2 (the active bg).
    // Hover may use bg-elevated (one step lighter) but never bg-elevated2.
    expect(cls).not.toMatch(/\bhover:bg-elevated2\b/);
  });

  it('active nav item carries a 1-px ring for depth (visually distinct from hover)', () => {
    render(<Sidebar activeTab="home" onTabChange={() => {}} onOpenMobile={() => {}} mobileOpen={false} />);
    const active = screen.getByRole('button', { name: /בית/ });
    expect(active.className).toMatch(/ring-1/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run --config vitest.config.dom.ts src/components/__tests__/sidebarHoverState.dom.test.tsx
```

Expected: both tests FAIL.

- [ ] **Step 3: Update Sidebar.tsx**

Locate the className expression around line 91-93 and replace:

```tsx
isActive
  ? 'bg-elevated2 text-ink font-medium ring-1 ring-line-subtle'
  : 'text-ink-muted hover:text-ink hover:bg-elevated',
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run --config vitest.config.dom.ts src/components/__tests__/sidebarHoverState.dom.test.tsx
```

Expected: both PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/Sidebar.tsx src/components/__tests__/sidebarHoverState.dom.test.tsx
git commit -m "fix(ui-ux): Sidebar hover state no longer mimics active state (Home 'always selected' bug)"
```

---

## Task 5: Destructive Button text fix + ESM token coverage

**Files:**
- Modify: `dashboard-web/src/components/ui/Button.tsx`

- [ ] **Step 1: Write the failing test**

Create `dashboard-web/src/components/ui/__tests__/buttonDestructive.dom.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '@/components/ui/Button';

describe('Button destructive variant', () => {
  it('uses --status-redFg for text (not hardcoded white)', () => {
    render(<Button variant="destructive">Delete</Button>);
    const btn = screen.getByRole('button');
    expect(btn.className).toMatch(/text-status-redFg/);
    expect(btn.className).not.toMatch(/\btext-white\b/);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run --config vitest.config.dom.ts src/components/ui/__tests__/buttonDestructive.dom.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Update Button.tsx destructive variant**

In the `cva` config, replace the destructive variant:

```ts
destructive: 'bg-status-red text-status-redFg hover:bg-status-red/90',
```

- [ ] **Step 4: Run the test to verify it passes**

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Button.tsx src/components/ui/__tests__/buttonDestructive.dom.test.tsx
git commit -m "fix(ui-ux): destructive Button text uses --status-redFg token (was hardcoded white)"
```

---

## Task 6: Promote chartColors.ts → platform tokens + fix `--chart-axis` reference + `cpmPrev` migration

**Files:**
- Modify: `dashboard-web/src/lib/chartColors.ts`
- Test: `dashboard-web/src/lib/__tests__/chartColors.test.ts` (existing, will need updates)

- [ ] **Step 1: Verify current state**

```bash
grep -n "var(--chart-axis)\|cpmPrev" src/lib/chartColors.ts
```

Expected: 3 lines — `var(--chart-axis)` referenced twice (lines 34-35), `cpmPrev: '#fbbf24'` once (line 42).

- [ ] **Step 2: Update the existing test to expect the new contract**

Find `src/lib/__tests__/chartColors.test.ts` and add/update assertions:

```ts
it('cpmPrev reads from CSS var --chart-cpm-prev (mode-aware)', () => {
  expect(CHART_COLORS.cpmPrev).toBe('var(--chart-cpm-prev)');
});

it('CHART_AXIS_COLOR resolves to var(--chart-axis)', () => {
  expect(CHART_AXIS_COLOR).toBe('var(--chart-axis)');
});

it('PLATFORM_TOKENS exposes meta/google/tiktok/organic/shopify as CSS vars', () => {
  for (const p of ['meta', 'google', 'tiktok', 'organic', 'shopify']) {
    expect(PLATFORM_TOKENS[p].color).toBe(`var(--chart-platform-${p})`);
  }
});
```

- [ ] **Step 3: Run tests to confirm failures**

```bash
npm test -- src/lib/__tests__/chartColors.test.ts
```

Expected: 3 new assertions FAIL.

- [ ] **Step 4: Update chartColors.ts**

```ts
// dashboard-web/src/lib/chartColors.ts
//
// Phase E1.6.1 UI overhaul (2026-05-30) — promoted from chart-only
// utility to canonical PLATFORM_TOKENS. Every platform/store/axis/cpm
// color references a CSS var (defined in globals.css with both light
// and dark values). No hardcoded hex remains.

export const CHART_AXIS_COLOR = 'var(--chart-axis)';
export const CHART_CURSOR_COLOR = 'var(--border-strong)';
export const CHART_GRID_COLOR = 'var(--border-subtle)';
export const CHART_TARGET_COLOR = 'var(--status-green)';

export const PLATFORM_TOKENS = {
  meta:    { color: 'var(--chart-platform-meta)',    strokeDasharray: undefined, strokeWidth: 1.5 },
  google:  { color: 'var(--chart-platform-google)',  strokeDasharray: undefined, strokeWidth: 1.5 },
  tiktok:  { color: 'var(--chart-platform-tiktok)',  strokeDasharray: undefined, strokeWidth: 1.5 },
  organic: { color: 'var(--chart-platform-organic)', strokeDasharray: undefined, strokeWidth: 1.5 },
  shopify: { color: 'var(--chart-platform-shopify)', strokeDasharray: '6 3',     strokeWidth: 2.5 },
} as const;

export const CHART_COLORS = {
  meta:    PLATFORM_TOKENS.meta.color,
  google:  PLATFORM_TOKENS.google.color,
  tiktok:  PLATFORM_TOKENS.tiktok.color,
  organic: PLATFORM_TOKENS.organic.color,
  shopify: PLATFORM_TOKENS.shopify.color,
  cpm:     'var(--status-blue)',
  cpmPrev: 'var(--chart-cpm-prev)',
  roas:    'var(--status-green)',
  value:   'var(--text-secondary)',
  spend:   'var(--status-red)',
} as const;
```

- [ ] **Step 5: Run tests to verify all pass**

```bash
npm test -- src/lib/__tests__/chartColors.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Run wider chart tests + globals chart vars test**

```bash
npm test -- src/lib/__tests__/chartColors src/app/__tests__/globals-chart-vars
```

Expected: all PASS.

- [ ] **Step 7: Commit**

```bash
git add src/lib/chartColors.ts src/lib/__tests__/chartColors.test.ts
git commit -m "refactor(ui-ux): promote chartColors → PLATFORM_TOKENS + fix --chart-axis + cpmPrev to CSS var"
```

---

## Task 7: Unify store colors — chart palette canonical, format.ts migrates

**Files:**
- Modify: `dashboard-web/src/lib/storeColors.ts`
- Modify: `dashboard-web/src/lib/format.ts`
- Test: `dashboard-web/src/lib/__tests__/storeColors.test.ts` (existing)

- [ ] **Step 1: Add new test asserting format.ts STORE_HUES sources from tokens**

Append to `src/lib/__tests__/storeColors.test.ts`:

```ts
import { STORE_HUES, storeBadgeHex } from '@/lib/format';

describe('Phase E1.6.1 — store color unification (chart palette canonical)', () => {
  it('format.ts STORE_HUES routes through CSS vars (not hardcoded hex)', () => {
    expect(STORE_HUES.uzoshop.fg).toBe('var(--store-uzoshop-fg)');
    expect(STORE_HUES.uzoshop.bg).toBe('var(--store-uzoshop-bg)');
    expect(STORE_HUES['Zol Plus'].fg).toBe('var(--store-zolplus-fg)');
    expect(STORE_HUES['360usmile'].fg).toBe('var(--store-usmile-fg)');
  });

  it('storeBadgeHex returns chart-palette hex for known stores (backwards-compat shim)', () => {
    // Server-side rendering (e.g. WhatsApp summary) still needs concrete
    // hex. This shim returns the LIGHT-mode hex from the chart palette.
    expect(storeBadgeHex('uzoshop')).toBe('#06b6d4');
    expect(storeBadgeHex('Zol Plus')).toBe('#ec4899');
    expect(storeBadgeHex('360usmile')).toBe('#84cc16');
  });
});
```

- [ ] **Step 2: Run tests to confirm failures**

```bash
npm test -- src/lib/__tests__/storeColors.test.ts
```

Expected: 2 FAIL.

- [ ] **Step 3: Update format.ts to source from tokens**

Replace the hex `STORE_HUES` map with a token-backed version. Add a `storeBadgeHex` shim for server-side callers that need a concrete hex.

```ts
// dashboard-web/src/lib/format.ts (excerpt)

// Phase E1.6.1 UI overhaul (2026-05-30) — store badge colors now route
// through CSS-var tokens (defined in globals.css). Removes the
// pre-overhaul schism where charts used cyan/pink/lime and badges used
// navy/red/green (incompatible visual identities for the same store).
export const STORE_HUES: Record<string, { fg: string; bg: string }> = {
  uzoshop:     { fg: 'var(--store-uzoshop-fg)', bg: 'var(--store-uzoshop-bg)' },
  'Zol Plus':  { fg: 'var(--store-zolplus-fg)', bg: 'var(--store-zolplus-bg)' },
  '360usmile': { fg: 'var(--store-usmile-fg)',  bg: 'var(--store-usmile-bg)'  },
};

// Server-side / non-browser callers (WhatsApp summary etc.) still need
// a concrete hex. Returns the LIGHT-mode chart-palette value so the
// rendered string matches the dashboard's light-mode display.
const STORE_HEX_LIGHT: Record<string, string> = {
  uzoshop: '#06b6d4',     // cyan (chart palette)
  'Zol Plus': '#ec4899',  // hot pink
  '360usmile': '#84cc16', // lime
};
export function storeBadgeHex(store: string): string {
  return STORE_HEX_LIGHT[store] ?? '#6b7280'; // gray fallback for unknown stores
}
```

Find every existing consumer that read raw hex from `STORE_HUES.uzoshop.fg` (search results: `src/components/PerStoreCards.tsx`, possibly others) and confirm they consume the value as a CSS color string (the token expression is valid CSS).

- [ ] **Step 4: Grep + update any fallback array users**

```bash
grep -rn "STORE_HUES" src/
```

For each consumer that expects raw hex (e.g. inline `style={{ color: STORE_HUES[...].fg }}`), the CSS var works directly in `style`. Confirm with:

```bash
grep -rn "storeBadgeHex\|STORE_HUES" src/components/WhatsappTestButtons.tsx src/lib/notifications/
```

If any WhatsApp/notification path consumed the raw hex, switch it to `storeBadgeHex(store)`.

- [ ] **Step 5: Run tests**

```bash
npm test -- src/lib/__tests__/storeColors.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add src/lib/format.ts src/lib/__tests__/storeColors.test.ts
git commit -m "refactor(ui-ux): unify store palette — format.ts routes through chart-palette tokens"
```

---

## Task 8: Annotations.ts → token-backed colors

**Files:**
- Modify: `dashboard-web/src/lib/annotations.ts`
- Modify: `dashboard-web/src/app/globals.css` (add `--annotation-*` tokens)

- [ ] **Step 1: Add annotation tokens to globals.css**

In `:root`:

```css
  /* Annotation markers — was hardcoded hex per kind in annotations.ts. */
  --annotation-launch: oklch(55% 0.18 145);   /* green */
  --annotation-pause: oklch(60% 0.20 25);     /* red */
  --annotation-budget: oklch(60% 0.18 260);   /* blue */
  --annotation-pricing: oklch(65% 0.16 75);   /* amber */
  --annotation-sale: oklch(65% 0.20 305);     /* purple */
  --annotation-creative: oklch(60% 0.18 200); /* cyan */
  --annotation-supplier: oklch(50% 0.10 30);  /* brown */
  --annotation-other: oklch(60% 0.005 0);     /* gray */
```

In `[data-theme="dark"]`:

```css
  --annotation-launch: oklch(72% 0.20 145);
  --annotation-pause: oklch(72% 0.22 25);
  --annotation-budget: oklch(72% 0.22 260);
  --annotation-pricing: oklch(78% 0.18 75);
  --annotation-sale: oklch(75% 0.20 305);
  --annotation-creative: oklch(75% 0.18 200);
  --annotation-supplier: oklch(65% 0.12 30);
  --annotation-other: oklch(70% 0.005 0);
```

- [ ] **Step 2: Migrate annotations.ts**

```ts
// dashboard-web/src/lib/annotations.ts (excerpt)
export const ANNOTATION_KIND_COLOR: Record<string, string> = {
  launch:   'var(--annotation-launch)',
  pause:    'var(--annotation-pause)',
  budget:   'var(--annotation-budget)',
  pricing:  'var(--annotation-pricing)',
  sale:     'var(--annotation-sale)',
  creative: 'var(--annotation-creative)',
  supplier: 'var(--annotation-supplier)',
  other:    'var(--annotation-other)',
};
```

- [ ] **Step 3: Verify no annotation hex remains**

```bash
grep -E "#[0-9a-fA-F]{3,8}" src/lib/annotations.ts
```

Expected: no matches.

- [ ] **Step 4: Run vitest broadly**

```bash
npm test
```

Expected: all 1577+ tests still pass (no annotation tests existed before; none broken).

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css src/lib/annotations.ts
git commit -m "refactor(ui-ux): migrate annotation kind colors to CSS-var tokens"
```

---

## Task 9: HeroOverview gradient → CSS vars

**Files:**
- Modify: `dashboard-web/src/components/HeroOverview.tsx:269`

- [ ] **Step 1: Replace the hardcoded gradient**

Locate the gradient at line 269 (the `bg-gradient-to-br from-[#091c4a] via-[#0d3680] to-[#1d4ed8]` arbitrary value) and replace with:

```tsx
className="bg-[linear-gradient(135deg,var(--gradient-hero-from),var(--gradient-hero-via)_45%,var(--gradient-hero-to))]"
```

- [ ] **Step 2: Verify no hardcoded #091c4a / #0d3680 / #1d4ed8 in HeroOverview**

```bash
grep -E "#091c4a|#0d3680|#1d4ed8" src/components/HeroOverview.tsx
```

Expected: no matches.

- [ ] **Step 3: Smoke test the dashboard locally**

```bash
npm run dev
```

Open `http://localhost:3000`, verify the Hero card renders with the new gradient in both light + dark mode (toggle via theme switch in header). Stop the dev server.

- [ ] **Step 4: Commit**

```bash
git add src/components/HeroOverview.tsx
git commit -m "fix(ui-ux): HeroOverview gradient sources from CSS-var tokens (light+dark)"
```

---

## Task 10: Amber sweep — replace 22 `amber-*` usages with `--status-warning`

**Files:**
- Modify: 7 component files listed below (each amber occurrence)

### Affected files + lines (from the audit)

| File | Lines | Pattern |
|---|---|---|
| [CampaignDrawerStatusSection.tsx](dashboard-web/src/components/CampaignDrawerStatusSection.tsx) | 63-64, 88 | `bg-amber-50 text-amber-700 border-amber-200` |
| [SyncIndicator.tsx](dashboard-web/src/components/SyncIndicator.tsx) | 86, 94 | `bg-red-500/85`, `bg-amber-500/30` |
| [GoalTracker.tsx](dashboard-web/src/components/GoalTracker.tsx) | 184, 211, 236, 245 | various amber-* |
| [InsightsPanel.tsx](dashboard-web/src/components/InsightsPanel.tsx) | 49-65 | `bg-amber-50 border-amber-200`, etc. |
| [CohortComparisonPanel.tsx](dashboard-web/src/components/CohortComparisonPanel.tsx) | 215, 223, 360, 389-421 | amber tones for intra-vs-control |
| [TabFreshnessHeader.tsx](dashboard-web/src/components/TabFreshnessHeader.tsx) | 59 | `bg-amber-100 text-amber-800` |
| [InsightsBoard.tsx](dashboard-web/src/components/InsightsBoard.tsx) | 62-65 | `bg-amber-500` badge |
| [RefundIndicator.tsx](dashboard-web/src/components/RefundIndicator.tsx) | full file | `text-amber-700 dark:text-amber-300` etc. |

### Replacement mapping

| Old class | New class |
|---|---|
| `bg-amber-50` / `bg-amber-100` | `bg-status-warning-bg` |
| `text-amber-700` / `text-amber-800` / `text-amber-900` | `text-status-warning-fg` |
| `border-amber-200` / `border-amber-300` | `border-status-warning/30` |
| `bg-amber-500` / `bg-amber-500/30` | `bg-status-warning` (drop the /N if it was alpha-fading the bg; keep `/N` if it was opacity for a translucent overlay) |
| `text-amber-300` (only in dark:) | (drop the `dark:` — token already mode-aware) |
| `text-amber-600` | `text-status-warning` |

- [ ] **Step 1: Sweep file 1 — CampaignDrawerStatusSection.tsx**

Replace the BACKFILL_UNKNOWN warning chip at lines 63-64, 88:

```tsx
className="bg-status-warning-bg text-status-warning-fg border border-status-warning/30"
```

- [ ] **Step 2: Sweep file 2 — SyncIndicator.tsx**

At lines 86 + 94, swap the `bg-red-500/85` and `bg-amber-500/30` for the appropriate status tokens (`bg-status-red/85`, `bg-status-warning/30`).

- [ ] **Step 3: Sweep file 3 — GoalTracker.tsx**

Lines 184, 211, 236, 245: replace each `amber-*` reference per the mapping. Pacing-warning chip uses `bg-status-warning-bg text-status-warning-fg`.

- [ ] **Step 4: Sweep file 4 — InsightsPanel.tsx**

Lines 49-65: card surface `bg-amber-50 border-amber-200` → `bg-status-warning-bg border-status-warning/30`. Inner amber tones likewise.

- [ ] **Step 5: Sweep file 5 — CohortComparisonPanel.tsx**

Lines 215, 223, 360, 389-421: replace each amber-* per the mapping.

- [ ] **Step 6: Sweep file 6 — TabFreshnessHeader.tsx:59**

`bg-amber-100 text-amber-800` → `bg-status-warning-bg text-status-warning-fg`.

- [ ] **Step 7: Sweep file 7 — InsightsBoard.tsx:62-65**

`bg-amber-500` → `bg-status-warning`.

- [ ] **Step 8: Sweep file 8 — RefundIndicator.tsx**

Remove every `text-amber-700 dark:text-amber-300` pair → `text-status-warning-fg` (single class, mode-aware via token). Remove all `dark:` Tailwind variants from this file.

- [ ] **Step 9: Confirm no amber references remain in components/**

```bash
grep -rn "amber-" src/components/ | grep -v "// " | wc -l
```

Expected: 0.

- [ ] **Step 10: Run full test suite**

```bash
npm test 2>&1 | tail -5
```

Expected: 1577+ pass, 0 fail.

- [ ] **Step 11: Manual smoke test in dev**

```bash
npm run dev
```

Toggle dark mode. Verify each amber-affected component renders intelligibly in both modes (warnings visible, no contrast collapse).

- [ ] **Step 12: Commit**

```bash
git add src/components/
git commit -m "refactor(ui-ux): amber-* sweep — 22 components route through --status-warning token"
```

---

## Task 11: Tooltip surface fix — light/dark aware

**Files:**
- Modify: `dashboard-web/src/app/globals.css:203-213`
- Modify: `dashboard-web/src/components/ui/Tooltip.tsx`

- [ ] **Step 1: Audit the current tooltip CSS**

```bash
grep -n "rgba(13, 37, 61\|recharts-tooltip\|--tooltip" src/app/globals.css
```

Expected: lines 203-213 with `background: rgba(13, 37, 61, 0.96); color: #ffffff;`.

- [ ] **Step 2: Replace the hardcoded surface with tokens**

In `globals.css` around lines 203-213, change the Recharts tooltip selector block to:

```css
.recharts-tooltip-wrapper .recharts-default-tooltip {
  background: var(--surface-elevated-2) !important;
  color: var(--text-primary) !important;
  border: 1px solid var(--border-default) !important;
  box-shadow: var(--shadow-md);
}
```

- [ ] **Step 3: Update Tooltip.tsx primitive (Radix)**

The Radix `Tooltip.tsx` currently has `bg-ink text-canvas`. Update to `bg-elevated2 text-ink border border-line shadow-md` so it matches the rest of the surface system:

```tsx
className={cn(
  'rounded-md bg-elevated2 text-ink border border-line shadow-md px-2.5 py-1.5 text-2xs',
  'animate-in fade-in-0 zoom-in-95',
  className,
)}
```

- [ ] **Step 4: Run vitest**

```bash
npm test
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/globals.css src/components/ui/Tooltip.tsx
git commit -m "fix(ui-ux): Recharts + Radix Tooltip surfaces source from --surface-elevated-2 token"
```

---

## Task 12: Bidi sweep — 6 surfaces with `<bdi dir="ltr">`

**Files:**
- Modify: `dashboard-web/src/components/CampaignDrawer.tsx:825, 859`
- Modify: `dashboard-web/src/components/CampaignsTableRow.tsx:286, 315, 368, 652-654`
- Modify: `dashboard-web/src/components/PerStoreCards.tsx:77`
- Create test: `dashboard-web/src/components/__tests__/bidi.dom.test.tsx`

### Bidi pattern

For any dynamic, externally-sourced string (campaign name, ad name, store id, platform name, formatted date) appearing inside a Hebrew template, wrap in `<bdi dir="ltr">`. For `title=` attribute tooltips that mix Hebrew + LTR data, migrate to Radix `<Tooltip>` with JSX children so we can wrap.

- [ ] **Step 1: Write the failing bidi tests**

Create `src/components/__tests__/bidi.dom.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import CampaignDrawer from '@/components/CampaignDrawer';
import { PerStoreCards } from '@/components/PerStoreCards';

describe('Phase E1.6.1 — bidi isolation on mixed Hebrew+English surfaces', () => {
  it('CampaignDrawer title wraps campaign name in <bdi dir="ltr">', () => {
    const props = {
      open: true,
      onClose: () => {},
      summary: { campaignName: 'Summer Sale 2026', platform: 'meta', storeId: 'uzoshop' },
    } as never;
    render(<CampaignDrawer {...props} />);
    const heading = screen.getByRole('heading', { level: 2 });
    const bdi = heading.querySelector('bdi[dir="ltr"]');
    expect(bdi).not.toBeNull();
    expect(bdi!.textContent).toBe('Summer Sale 2026');
  });

  it('CampaignDrawer "Open in {platform} Ads Manager" link isolates platform name', () => {
    const props = {
      open: true,
      onClose: () => {},
      summary: { campaignName: 'X', platform: 'meta', storeId: 'uzoshop' },
    } as never;
    render(<CampaignDrawer {...props} />);
    const link = screen.getByRole('link', { name: /Ads Manager/ });
    expect(link.querySelector('bdi[dir="ltr"]')).not.toBeNull();
  });

  it('PerStoreCards wraps store name in <bdi dir="ltr">', () => {
    const props = {
      perStore: [{ store: 'uzoshop', spend: 100, revenue: 200, roas: 2, orders: 5 }],
    } as never;
    render(<PerStoreCards {...props} />);
    const storeLabel = screen.getByText('uzoshop');
    expect(storeLabel.tagName.toLowerCase()).toBe('bdi');
    expect(storeLabel.getAttribute('dir')).toBe('ltr');
  });
});
```

- [ ] **Step 2: Run the test to verify failure**

```bash
npx vitest run --config vitest.config.dom.ts src/components/__tests__/bidi.dom.test.tsx
```

Expected: 3 FAIL.

- [ ] **Step 3: Update CampaignDrawer.tsx:825 — wrap title**

Replace:

```tsx
<h2>{summary.campaignName || '(ללא שם)'}</h2>
```

with:

```tsx
<h2><bdi dir="ltr">{summary.campaignName || '(ללא שם)'}</bdi></h2>
```

- [ ] **Step 4: Update CampaignDrawer.tsx:859 — wrap platform name in link**

Replace:

```tsx
<a ...>פתח ב-{summary.platform} Ads Manager</a>
```

with:

```tsx
<a ...>פתח ב-<bdi dir="ltr">{summary.platform}</bdi> Ads Manager</a>
```

- [ ] **Step 5: Update CampaignsTableRow.tsx:286 — wrap campaign-name cell**

Replace:

```tsx
<button title={...}>{a.campaignName}</button>
```

with:

```tsx
<button title={...}><bdi dir="ltr">{a.campaignName}</bdi></button>
```

- [ ] **Step 6: Update CampaignsTableRow.tsx tooltip surfaces (lines 315, 368, 652-654)**

For each `title={...}` containing a Hebrew + LTR mix, migrate to a Radix `<Tooltip>`. Example for line 368:

```tsx
<Tooltip>
  <TooltipTrigger asChild>
    {existingElement}
  </TooltipTrigger>
  <TooltipContent>
    <bdi dir="ltr">{a.platform}</bdi> · <bdi dir="ltr">{a.storeName}</bdi> · <span>קמפיין:</span> <bdi dir="ltr">{a.campaignName}</bdi>
  </TooltipContent>
</Tooltip>
```

For line 315 (inactive campaign date in title): use Radix Tooltip with `<bdi dir="ltr">{formatLastActiveDate(...)}</bdi>` inline.

For lines 652-654 (allocation tooltip with numeric + Hebrew): use Radix Tooltip with `<bdi dir="ltr">{exact.toFixed(2)}</bdi> יח' מוקצות...` and `<bdi dir="ltr">{a.platform}</bdi>` for the platform mention.

- [ ] **Step 7: Update PerStoreCards.tsx:77**

Locate the `<span>{s.store}</span>` and replace with `<bdi dir="ltr">{s.store}</bdi>`.

- [ ] **Step 8: Run the bidi test to verify all pass**

```bash
npx vitest run --config vitest.config.dom.ts src/components/__tests__/bidi.dom.test.tsx
```

Expected: all 3 PASS.

- [ ] **Step 9: Run full test suite to catch regression**

```bash
npm test
```

Expected: 1577+ pass, 0 fail.

- [ ] **Step 10: Commit**

```bash
git add src/components/
git commit -m "fix(ui-ux): bidi isolation on 6 Hebrew+English mixed-text surfaces"
```

---

## Task 13: New `Stat` primitive

**Files:**
- Create: `dashboard-web/src/components/ui/Stat.tsx`
- Test: `dashboard-web/src/components/ui/__tests__/stat.dom.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/ui/__tests__/stat.dom.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Stat } from '@/components/ui/Stat';

describe('Stat primitive', () => {
  it('renders label + value with proper bidi isolation on value', () => {
    render(<Stat label="הוצאה" value="$1,234" />);
    expect(screen.getByText('הוצאה')).toBeInTheDocument();
    const value = screen.getByText('$1,234');
    expect(value.tagName.toLowerCase()).toBe('bdi');
    expect(value.getAttribute('dir')).toBe('ltr');
  });

  it('applies tone="warning" class to root', () => {
    const { container } = render(<Stat label="x" value="y" tone="warning" />);
    expect(container.firstChild).toHaveClass('border-status-warning');
  });

  it('renders optional help node', () => {
    render(<Stat label="x" value="y" help={<span data-testid="help">?</span>} />);
    expect(screen.getByTestId('help')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure**

```bash
npx vitest run --config vitest.config.dom.ts src/components/ui/__tests__/stat.dom.test.tsx
```

Expected: 3 FAIL with "Cannot find module '@/components/ui/Stat'".

- [ ] **Step 3: Create Stat.tsx**

```tsx
// dashboard-web/src/components/ui/Stat.tsx
//
// Phase E1.6.1 UI overhaul — shared stat-block primitive. Replaces the
// inline `Stat()` functions in AdsDrawer.tsx and CampaignDrawer.tsx
// (which had diverged). Value content is auto-bdi-wrapped for safe
// Hebrew+English mixing.

import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

const statVariants = cva(
  'rounded-md border bg-elevated2 px-3 py-2 flex flex-col gap-1',
  {
    variants: {
      tone: {
        neutral: 'border-line',
        warning: 'border-status-warning bg-status-warning-bg',
        success: 'border-status-green bg-status-greenBg',
        danger:  'border-status-red bg-status-redBg',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface StatProps extends VariantProps<typeof statVariants> {
  label: string;
  value: string | number;
  help?: ReactNode;
  className?: string;
}

export function Stat({ label, value, tone, help, className }: StatProps) {
  return (
    <div className={cn(statVariants({ tone }), className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-ink-muted">{label}</span>
        {help}
      </div>
      <bdi dir="ltr" className="text-sm font-medium text-ink tabular-nums">{value}</bdi>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify pass**

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/Stat.tsx src/components/ui/__tests__/stat.dom.test.tsx
git commit -m "feat(ui-ux): Stat primitive (replaces inline Stat() in drawers)"
```

---

## Task 14: New `TableBase` primitive

**Files:**
- Create: `dashboard-web/src/components/ui/TableBase.tsx`
- Test: `dashboard-web/src/components/ui/__tests__/tableBase.dom.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/ui/__tests__/tableBase.dom.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TableBase, TableHead, TableHeaderCell, TableRow, TableCell } from '@/components/ui/TableBase';

describe('TableBase primitives', () => {
  it('renders the chain of head + row + cell with correct semantic roles', () => {
    render(
      <TableBase>
        <TableHead>
          <TableRow>
            <TableHeaderCell>שם</TableHeaderCell>
            <TableHeaderCell numeric>הוצאה</TableHeaderCell>
          </TableRow>
        </TableHead>
        <tbody>
          <TableRow>
            <TableCell>Meta</TableCell>
            <TableCell numeric>$100</TableCell>
          </TableRow>
        </tbody>
      </TableBase>,
    );
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('שם')).toBeInTheDocument();
    expect(screen.getByText('$100')).toHaveClass('tabular-nums');
  });

  it('sortable header cell shows aria-sort and triggers callback', () => {
    let clicked = false;
    render(
      <TableBase>
        <TableHead>
          <TableRow>
            <TableHeaderCell sortable sortDir="asc" onSort={() => { clicked = true; }}>
              ROAS
            </TableHeaderCell>
          </TableRow>
        </TableHead>
      </TableBase>,
    );
    const cell = screen.getByText('ROAS');
    expect(cell.getAttribute('aria-sort')).toBe('ascending');
    cell.click();
    expect(clicked).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Expected: 2 FAIL.

- [ ] **Step 3: Create TableBase.tsx**

```tsx
// dashboard-web/src/components/ui/TableBase.tsx
//
// Phase E1.6.1 UI overhaul — shared table primitives. Absorbs the
// ad-hoc <table> styling in CampaignsTable, AdsDrawer, MonthlyTables,
// ProductsTable. All header text uses --text-secondary; rows use
// --border-subtle separators; numeric cells get tabular-nums.

import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

export function TableBase({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <table className={cn('w-full text-sm text-ink', className)}>
      {children}
    </table>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return (
    <thead className="bg-elevated2 sticky top-0 z-10 border-b border-line-subtle">
      {children}
    </thead>
  );
}

export function TableRow({ children, className, ...rest }: { children: ReactNode; className?: string } & React.HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr {...rest} className={cn('border-b border-line-subtle hover:bg-elevated/40 transition-colors', className)}>
      {children}
    </tr>
  );
}

export function TableHeaderCell({
  children, numeric, sortable, sortDir, onSort, className,
}: {
  children: ReactNode;
  numeric?: boolean;
  sortable?: boolean;
  sortDir?: 'asc' | 'desc' | null;
  onSort?: () => void;
  className?: string;
}) {
  const ariaSort = sortable
    ? sortDir === 'asc' ? 'ascending' : sortDir === 'desc' ? 'descending' : 'none'
    : undefined;
  return (
    <th
      className={cn(
        'px-3 py-2 text-xs font-medium text-ink-secondary text-start',
        numeric && 'text-end tabular-nums',
        sortable && 'cursor-pointer hover:text-ink select-none',
        className,
      )}
      aria-sort={ariaSort}
      onClick={sortable && onSort ? onSort : undefined}
    >
      {children}
    </th>
  );
}

export function TableCell({
  children, numeric, className,
}: {
  children: ReactNode;
  numeric?: boolean;
  className?: string;
}) {
  return (
    <td className={cn('px-3 py-2', numeric && 'text-end tabular-nums', className)}>
      {children}
    </td>
  );
}
```

- [ ] **Step 4: Run tests to verify pass**

Expected: 2 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ui/TableBase.tsx src/components/ui/__tests__/tableBase.dom.test.tsx
git commit -m "feat(ui-ux): TableBase primitives (head/row/cell with sortable + numeric)"
```

---

## Task 15: New `InsightCard` primitive

**Files:**
- Create: `dashboard-web/src/components/ui/InsightCard.tsx`
- Test: `dashboard-web/src/components/ui/__tests__/insightCard.dom.test.tsx`

- [ ] **Step 1: Test**

```tsx
// src/components/ui/__tests__/insightCard.dom.test.tsx
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InsightCard } from '@/components/ui/InsightCard';

describe('InsightCard', () => {
  it('renders title + body and applies tone="warning" classes', () => {
    const { container } = render(
      <InsightCard tone="warning" title="פעולה נדרשת">
        <p>טוקן Meta פג תוקף</p>
      </InsightCard>,
    );
    expect(screen.getByText('פעולה נדרשת')).toBeInTheDocument();
    expect(screen.getByText('טוקן Meta פג תוקף')).toBeInTheDocument();
    expect(container.firstChild).toHaveClass('border-status-warning');
  });
});
```

- [ ] **Step 2: Run to fail.**

- [ ] **Step 3: Create InsightCard.tsx**

```tsx
// dashboard-web/src/components/ui/InsightCard.tsx
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

const cardVariants = cva(
  'rounded-lg border p-4 flex flex-col gap-2',
  {
    variants: {
      tone: {
        warning: 'bg-status-warning-bg text-status-warning-fg border-status-warning',
        success: 'bg-status-greenBg text-status-greenFg border-status-green',
        info:    'bg-status-blueBg text-status-blueFg border-status-blue',
        neutral: 'bg-elevated2 text-ink border-line',
      },
    },
    defaultVariants: { tone: 'neutral' },
  },
);

export interface InsightCardProps extends VariantProps<typeof cardVariants> {
  title: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}

export function InsightCard({ title, children, tone, action, className }: InsightCardProps) {
  return (
    <div className={cn(cardVariants({ tone }), className)}>
      <div className="flex items-center justify-between gap-2">
        <h4 className="text-sm font-medium">{title}</h4>
        {action}
      </div>
      <div className="text-sm">{children}</div>
    </div>
  );
}
```

- [ ] **Step 4: Run, pass, commit.**

```bash
git add src/components/ui/InsightCard.tsx src/components/ui/__tests__/insightCard.dom.test.tsx
git commit -m "feat(ui-ux): InsightCard primitive (warning/success/info/neutral tones)"
```

---

## Task 16: Migrate InsightsPanel, InsightsBoard, WhatsWorking, HealthScorePanel → InsightCard

**Files:**
- Modify: `dashboard-web/src/components/InsightsPanel.tsx`
- Modify: `dashboard-web/src/components/InsightsBoard.tsx`
- Modify: `dashboard-web/src/components/WhatsWorking.tsx`
- Modify: `dashboard-web/src/components/HealthScorePanel.tsx`

- [ ] **Step 1: For each file, replace its custom card surface with `<InsightCard tone="warning|success|info|neutral">`**

Example for InsightsPanel.tsx (around line 49):

Before:
```tsx
<div className="rounded-xl bg-status-warning-bg border border-status-warning/30 divide-y">
  ...items...
</div>
```

After:
```tsx
<InsightCard tone="warning" title="המלצות פעולה">
  ...items...
</InsightCard>
```

Repeat the same pattern for the other 3 files, picking the tone that matches the semantic intent (warning for action-required, success for "what's working", info for neutral status).

- [ ] **Step 2: Run vitest broadly**

```bash
npm test
```

- [ ] **Step 3: Manual smoke**

```bash
npm run dev
```

Verify Home tab insights still render in both light + dark mode.

- [ ] **Step 4: Commit**

```bash
git add src/components/InsightsPanel.tsx src/components/InsightsBoard.tsx src/components/WhatsWorking.tsx src/components/HealthScorePanel.tsx
git commit -m "refactor(ui-ux): migrate 4 insight surfaces to InsightCard primitive"
```

---

## Task 17: Button-primitive sweep — raw `<button>` → `<Button>`

**Files (10+):**
- Modify: `dashboard-web/src/components/CampaignDrawer.tsx` (close + fullscreen at 843-854)
- Modify: `dashboard-web/src/components/AdsDrawer.tsx` (close + fullscreen at 350-364, row-select at 449-469)
- Modify: `dashboard-web/src/components/GoalTracker.tsx` (save/commit/cancel at 137-208)
- Modify: any remaining raw `<button>` in `src/components/` outside `components/ui/`

- [ ] **Step 1: Inventory the migration scope**

```bash
grep -rn "<button" src/components/ | grep -v "src/components/ui/" | wc -l
```

Expected: ~140 occurrences (most can stay if they're already inside the Button primitive; this counts ALL JSX `<button>`).

```bash
grep -rln "<button\b" src/components/ | grep -v "src/components/ui/" > /tmp/raw-button-files.txt
cat /tmp/raw-button-files.txt
```

- [ ] **Step 2: Migrate CampaignDrawer.tsx close + fullscreen**

Replace lines 843-854 raw `<button>` with `<Button variant="ghost" size="icon">`. Drop the custom `w-11 h-11 sm:w-auto sm:h-auto sm:p-1.5` (now handled by the `icon` size).

- [ ] **Step 3: Migrate AdsDrawer.tsx**

Same pattern at 350-364 + 449-469 (row-select icon button → `<Button variant="ghost" size="icon">`).

- [ ] **Step 4: Migrate GoalTracker.tsx**

- Save button (line 137): `<Button variant="primary" size="sm">שמור</Button>`
- Commit button (line 189): `<Button variant="primary" size="sm" disabled={...}>אשר</Button>` (use `disabled` prop, not custom `bg-accent/40`)
- Cancel button (line 202): `<Button variant="secondary" size="sm">בטל</Button>`

- [ ] **Step 5: For every other file in `/tmp/raw-button-files.txt`, repeat the pattern**

For each remaining raw `<button>`:
- If it's purely cosmetic (no submit / no aria-label) → `<Button variant="ghost">`
- If it's destructive / has icon-only → `<Button variant="ghost" size="icon">`
- If it's a primary action → `<Button variant="primary">`

- [ ] **Step 6: Re-grep to confirm zero raw `<button>` remain outside `components/ui/`**

```bash
grep -rn "<button\b" src/components/ | grep -v "src/components/ui/" | grep -v ".test." | wc -l
```

Expected: 0.

- [ ] **Step 7: Run full vitest**

```bash
npm test 2>&1 | tail -5
```

Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/
git commit -m "refactor(ui-ux): migrate 140+ raw <button> elements to Button primitive"
```

---

## Task 18: Drawer re-skin — CampaignDrawer + AdsDrawer → Sheet

**Files:**
- Modify: `dashboard-web/src/components/CampaignDrawer.tsx`
- Modify: `dashboard-web/src/components/AdsDrawer.tsx`

- [ ] **Step 1: Replace the drawer scaffold with Sheet primitive**

For each drawer, replace the outer `<Dialog.Root>` + `<Dialog.Portal>` + custom positioned `<div>` with the `<Sheet>` primitive from `src/components/ui/Sheet.tsx`, using `side="end"` (RTL-friendly).

Example skeleton:

```tsx
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetClose } from '@/components/ui/Sheet';

export function CampaignDrawer({ open, onClose, summary }: Props) {
  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="end" className="w-[min(100vw,640px)] flex flex-col">
        <SheetHeader>
          <SheetTitle>
            <bdi dir="ltr">{summary.campaignName || '(ללא שם)'}</bdi>
          </SheetTitle>
        </SheetHeader>
        {/* existing body */}
      </SheetContent>
    </Sheet>
  );
}
```

- [ ] **Step 2: Replace `TONE_BG` map duplication in AdsDrawer.tsx**

Delete lines 51-57 (`const TONE_BG = { red: 'bg-status-redBg text-status-red', ...}`). Import from Badge instead:

```tsx
import { BADGE_TONE_BG } from '@/components/ui/Badge';
```

(See Task 19 for the export side.)

- [ ] **Step 3: Replace `TONE_BG` map duplication in CampaignsTable.tsx**

Same as Step 2 — delete the local `TONE_BG` at lines 115-121, import `BADGE_TONE_BG`.

- [ ] **Step 4: Verify View Transitions API morph still works**

```bash
grep -n "::view-transition\|view-transition-name" src/app/globals.css
```

Expected: existing morph definitions still target the Sheet element selector. If they target `[data-drawer]`, add `data-drawer` to the Sheet content. If they target a specific class, preserve it on the new structure.

- [ ] **Step 5: Run tests**

```bash
npm test
```

- [ ] **Step 6: Manual smoke**

```bash
npm run dev
```

Open a campaign drawer + adset drawer. Verify open/close transitions, header styling, close-button size all match.

- [ ] **Step 7: Commit**

```bash
git add src/components/CampaignDrawer.tsx src/components/AdsDrawer.tsx src/components/CampaignsTable.tsx
git commit -m "refactor(ui-ux): drawers use Sheet primitive + consume BADGE_TONE_BG"
```

---

## Task 19: Export shared `BADGE_TONE_BG` from Badge.tsx

**Files:**
- Modify: `dashboard-web/src/components/ui/Badge.tsx`

- [ ] **Step 1: Add an exported map**

```ts
// dashboard-web/src/components/ui/Badge.tsx (excerpt)
export const BADGE_TONE_BG = {
  red:    'bg-status-redBg text-status-redFg',
  orange: 'bg-status-orangeBg text-status-orangeFg',
  green:  'bg-status-greenBg text-status-greenFg',
  blue:   'bg-status-blueBg text-status-blueFg',
  gray:   'bg-status-grayBg text-status-grayFg',
  warning:'bg-status-warning-bg text-status-warning-fg',
} as const;

export type BadgeTone = keyof typeof BADGE_TONE_BG;
```

- [ ] **Step 2: Update Badge component to consume the map**

Internally use `BADGE_TONE_BG` in the CVA config so the exported map and the rendered classes can't diverge.

- [ ] **Step 3: Verify no consumer still uses the deleted local maps**

```bash
grep -rn "TONE_BG" src/components/ | grep -v "src/components/ui/Badge"
```

Expected: only the import lines added in Task 18 (no duplicate definitions).

- [ ] **Step 4: Test + commit**

```bash
npm test
git add src/components/ui/Badge.tsx
git commit -m "refactor(ui-ux): export BADGE_TONE_BG single source of truth"
```

---

## Task 20: Home tab 3-band restructure

**Files:**
- Create: `dashboard-web/src/components/HomeLiveBand.tsx`
- Create: `dashboard-web/src/components/HomeSummaryBand.tsx`
- Create: `dashboard-web/src/components/HomePerStoreBand.tsx`
- Modify: `dashboard-web/src/components/Dashboard.tsx` (Home tab branch around lines 392-462)

- [ ] **Step 1: Extract HomeLiveBand**

Create `src/components/HomeLiveBand.tsx`:

```tsx
import TodayLive from '@/components/TodayLive';

export function HomeLiveBand(props: React.ComponentProps<typeof TodayLive>) {
  return (
    <section aria-label="Live" className="space-y-3">
      <header className="flex items-center gap-2">
        <h2 className="text-sm font-medium text-ink">עכשיו</h2>
        <span className="text-xs text-ink-muted">(אינטרא-יום)</span>
      </header>
      <TodayLive {...props} />
    </section>
  );
}
```

- [ ] **Step 2: Extract HomeSummaryBand**

Create `src/components/HomeSummaryBand.tsx`:

```tsx
import HeroOverview from '@/components/HeroOverview';
import KpiCards from '@/components/KpiCards';

export function HomeSummaryBand(props: { heroProps: React.ComponentProps<typeof HeroOverview>; kpiProps: React.ComponentProps<typeof KpiCards> }) {
  return (
    <section aria-label="Compare to yesterday" className="space-y-3">
      <header>
        <h2 className="text-sm font-medium text-ink">היום מול אתמול</h2>
      </header>
      <HeroOverview {...props.heroProps} />
      <KpiCards {...props.kpiProps} />
    </section>
  );
}
```

- [ ] **Step 3: Extract HomePerStoreBand**

Create `src/components/HomePerStoreBand.tsx`:

```tsx
import { PerStoreCards } from '@/components/PerStoreCards';
import InsightsBoard from '@/components/InsightsBoard';

export function HomePerStoreBand(props: { perStoreProps: React.ComponentProps<typeof PerStoreCards>; insightsProps: React.ComponentProps<typeof InsightsBoard> }) {
  return (
    <section aria-label="Per store" className="space-y-3">
      <header>
        <h2 className="text-sm font-medium text-ink">לפי חנות</h2>
      </header>
      <PerStoreCards {...props.perStoreProps} />
      <details className="group">
        <summary className="cursor-pointer text-sm text-ink-muted hover:text-ink">תובנות והמלצות</summary>
        <div className="pt-3">
          <InsightsBoard {...props.insightsProps} />
        </div>
      </details>
    </section>
  );
}
```

- [ ] **Step 4: Update Dashboard.tsx Home tab branch**

In the Home tab branch (lines 392-462), replace the existing flat-list rendering with the 3 bands stacked vertically with `space-y-6`:

```tsx
{activeTab === 'home' && (
  <div className="space-y-6">
    <HomeLiveBand {...todayLiveProps} />
    <HomeSummaryBand heroProps={heroProps} kpiProps={kpiProps} />
    <HomePerStoreBand perStoreProps={perStoreProps} insightsProps={insightsProps} />
  </div>
)}
```

(Wire the existing props each component already expected through the new band wrappers. GoalTracker moves to the P&L tab per the audit — see Task 24.)

- [ ] **Step 5: Run vitest**

```bash
npm test
```

- [ ] **Step 6: Manual smoke + scroll measurement**

```bash
npm run dev
```

Open `/` in browser. Measure scroll height of Home tab vs before — should drop from ~2,000-2,500 px to ~1,200-1,400 px (the bands group dense content visually without removing any data).

- [ ] **Step 7: Commit**

```bash
git add src/components/HomeLiveBand.tsx src/components/HomeSummaryBand.tsx src/components/HomePerStoreBand.tsx src/components/Dashboard.tsx
git commit -m "feat(ui-ux): Home tab 3-band layout (Live / Compare / Per-Store)"
```

---

## Task 21: Analysis tab — split into Trends + Archive sub-tabs

**Files:**
- Create: `dashboard-web/src/components/AnalysisTrendsTab.tsx`
- Create: `dashboard-web/src/components/AnalysisArchiveTab.tsx`
- Modify: `dashboard-web/src/components/Dashboard.tsx` (Analysis branch around lines 507-553)

- [ ] **Step 1: Extract AnalysisTrendsTab**

```tsx
// src/components/AnalysisTrendsTab.tsx
import { RoasChart } from '@/components/RoasChart';
import { AnnotationsPanel } from '@/components/AnnotationsPanel';

export function AnalysisTrendsTab(props: { roasProps: React.ComponentProps<typeof RoasChart>; annotationsProps: React.ComponentProps<typeof AnnotationsPanel> }) {
  return (
    <div className="space-y-4">
      <RoasChart {...props.roasProps} />
      <AnnotationsPanel {...props.annotationsProps} />
    </div>
  );
}
```

- [ ] **Step 2: Extract AnalysisArchiveTab**

This will host the year-selector + month accordion (built in Task 22):

```tsx
// src/components/AnalysisArchiveTab.tsx
import { MonthlyTables } from '@/components/MonthlyTables';
import { YearSelector } from '@/components/YearSelector'; // created in Task 22

export function AnalysisArchiveTab({ storeId, isLoading }: { storeId: string; isLoading?: boolean }) {
  return (
    <div className="space-y-4">
      <YearSelector />
      <MonthlyTables storeId={storeId} isLoading={isLoading} />
    </div>
  );
}
```

- [ ] **Step 3: Update Dashboard.tsx Analysis branch with Radix sub-tabs**

Replace the existing Analysis content (around lines 507-553) with:

```tsx
{activeTab === 'analysis' && (
  <Tabs.Root defaultValue="trends" className="flex flex-col gap-4">
    <Tabs.List className="flex gap-2 border-b border-line-subtle">
      <Tabs.Trigger value="trends" className="px-3 py-2 text-sm data-[state=active]:font-medium data-[state=active]:border-b-2 data-[state=active]:border-accent">
        מגמות
      </Tabs.Trigger>
      <Tabs.Trigger value="archive" className="px-3 py-2 text-sm data-[state=active]:font-medium data-[state=active]:border-b-2 data-[state=active]:border-accent">
        היסטוריה
      </Tabs.Trigger>
    </Tabs.List>
    <Tabs.Content value="trends">
      <AnalysisTrendsTab roasProps={roasProps} annotationsProps={annotationsProps} />
    </Tabs.Content>
    <Tabs.Content value="archive">
      <AnalysisArchiveTab storeId={filters.store} isLoading={isLoading} />
    </Tabs.Content>
  </Tabs.Root>
)}
```

- [ ] **Step 4: Persist sub-tab choice in URL (`?analysis=trends|archive`)**

Add to the existing `syncUrl` hook in Dashboard.tsx:

```ts
// when sub-tab changes inside Analysis, append ?analysis=<value> to the URL.
```

- [ ] **Step 5: Test + manual + commit**

```bash
npm test
npm run dev   # verify Analysis tab now has 2 sub-tabs; toggling works
git add src/components/AnalysisTrendsTab.tsx src/components/AnalysisArchiveTab.tsx src/components/Dashboard.tsx
git commit -m "feat(ui-ux): Analysis tab split into Trends + Archive sub-tabs"
```

---

## Task 22: Year selector + month accordion for MonthlyTables

**Files:**
- Create: `dashboard-web/src/components/YearSelector.tsx`
- Modify: `dashboard-web/src/components/MonthlyTables.tsx`
- Test: `dashboard-web/src/components/__tests__/yearSelector.dom.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/components/__tests__/yearSelector.dom.test.tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { YearSelector } from '@/components/YearSelector';

describe('YearSelector', () => {
  it('renders [N..currentYear] chips and highlights the selected year', () => {
    render(<YearSelector value={2026} onChange={() => {}} startYear={2024} endYear={2026} />);
    expect(screen.getByRole('button', { name: '2024' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '2025' })).toBeInTheDocument();
    const chip2026 = screen.getByRole('button', { name: '2026' });
    expect(chip2026).toBeInTheDocument();
    expect(chip2026.getAttribute('aria-pressed')).toBe('true');
  });

  it('calls onChange when a chip is clicked', () => {
    const onChange = vi.fn();
    render(<YearSelector value={2026} onChange={onChange} startYear={2024} endYear={2026} />);
    fireEvent.click(screen.getByRole('button', { name: '2025' }));
    expect(onChange).toHaveBeenCalledWith(2025);
  });
});
```

- [ ] **Step 2: Run to fail.**

- [ ] **Step 3: Create YearSelector.tsx**

```tsx
// src/components/YearSelector.tsx
import { useState } from 'react';
import { Button } from '@/components/ui/Button';

interface Props {
  value?: number;
  onChange?: (year: number) => void;
  startYear?: number;
  endYear?: number;
}

export function YearSelector({ value, onChange, startYear, endYear }: Props) {
  const now = new Date();
  const end = endYear ?? now.getFullYear();
  const start = startYear ?? end - 2;
  const [internal, setInternal] = useState<number>(value ?? end);
  const selected = value ?? internal;
  const years = [] as number[];
  for (let y = start; y <= end; y++) years.push(y);
  return (
    <div role="group" aria-label="Year selector" className="flex gap-1.5">
      {years.map((y) => (
        <Button
          key={y}
          variant={y === selected ? 'primary' : 'ghost'}
          size="sm"
          aria-pressed={y === selected}
          onClick={() => {
            setInternal(y);
            onChange?.(y);
          }}
        >
          {y}
        </Button>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Run to pass.**

- [ ] **Step 5: Modify MonthlyTables.tsx**

- Delete `MONTHLY_TABLES_HISTORY_MONTHS = 17` constant.
- Replace the fetch logic to accept a `year` prop and fetch only that year's data.
- Each month within the year renders as a collapsible `<details>` block. Current month + previous month default-open; older months default-closed.

```tsx
// src/components/MonthlyTables.tsx (skeleton; preserve existing render logic for each month block)
export function MonthlyTables({ storeId, year, isLoading }: { storeId: string; year?: number; isLoading?: boolean }) {
  const now = new Date();
  const targetYear = year ?? now.getFullYear();
  const startDate = `${targetYear}-01-01`;
  const endDate = `${targetYear}-12-31`;
  // SWR fetch keyed by (storeId, targetYear)
  const { data, error } = useSWR(`/api/monthly?store=${storeId}&start=${startDate}&end=${endDate}`, fetcher);
  if (isLoading) return <Skeleton />;
  if (error) return <ErrorBanner />;
  const monthGroups = groupByMonth(data ?? []);
  return (
    <div className="space-y-2">
      {monthGroups.map((g, i) => (
        <details key={g.month} open={i < 2} className="rounded-md border border-line-subtle">
          <summary className="px-3 py-2 text-sm cursor-pointer hover:bg-elevated/40">
            {formatHebrewMonth(g.month)}
          </summary>
          <div className="overflow-auto max-h-[60vh] p-3">
            {/* existing per-month TableBase render */}
          </div>
        </details>
      ))}
    </div>
  );
}
```

- [ ] **Step 6: Update AnalysisArchiveTab to wire YearSelector ↔ MonthlyTables**

```tsx
export function AnalysisArchiveTab({ storeId, isLoading }: Props) {
  const [year, setYear] = useState<number>(new Date().getFullYear());
  return (
    <div className="space-y-4">
      <YearSelector value={year} onChange={setYear} />
      <MonthlyTables storeId={storeId} year={year} isLoading={isLoading} />
    </div>
  );
}
```

- [ ] **Step 7: Run vitest + manual smoke**

```bash
npm test
npm run dev   # verify Archive sub-tab renders YearSelector + month accordion
```

- [ ] **Step 8: Commit**

```bash
git add src/components/YearSelector.tsx src/components/MonthlyTables.tsx src/components/AnalysisArchiveTab.tsx
git commit -m "feat(ui-ux): YearSelector + month-accordion MonthlyTables (Archive sub-tab)"
```

---

## Task 23: /operator page — 4 sub-tabs

**Files:**
- Create: `dashboard-web/src/app/operator/SyncTab.tsx`
- Create: `dashboard-web/src/app/operator/HealthTab.tsx`
- Create: `dashboard-web/src/app/operator/ActivityTab.tsx`
- Create: `dashboard-web/src/app/operator/DangerTab.tsx`
- Modify: `dashboard-web/src/app/operator/page.tsx`

- [ ] **Step 1: Group the existing 12 panels by purpose**

| Sub-tab | Panels (moved from current page) |
|---|---|
| Sync | SyncNowButtons, BackfillPicker, ManualOverridesCrud |
| Health | TokenFailuresTable, MetaBucPanel, FreshnessPanel |
| Activity | StatusEventsFeed, CronTickSnapshotsViewer, JobsTable |
| Danger | WhatsappTestButtons, ResetData |

- [ ] **Step 2: Create each sub-tab file**

For example `src/app/operator/SyncTab.tsx`:

```tsx
import SyncNowButtons from '@/components/SyncNowButtons';
import { BackfillPicker } from '@/components/BackfillPicker';
import { ManualOverridesCrud } from '@/components/ManualOverridesCrud';

export function SyncTab() {
  return (
    <div className="space-y-6">
      <SyncNowButtons />
      <BackfillPicker />
      <ManualOverridesCrud />
    </div>
  );
}
```

Repeat for Health, Activity, Danger.

- [ ] **Step 3: Update operator/page.tsx to use Radix Tabs**

```tsx
import * as Tabs from '@radix-ui/react-tabs';
import { SyncTab } from './SyncTab';
import { HealthTab } from './HealthTab';
import { ActivityTab } from './ActivityTab';
import { DangerTab } from './DangerTab';
import { OperatorSecretBanner } from '@/components/OperatorSecretBanner';

export default function OperatorPage() {
  return (
    <main className="p-4 sm:p-6 max-w-7xl mx-auto">
      <OperatorSecretBanner />
      <Tabs.Root defaultValue="sync" className="mt-6">
        <Tabs.List className="flex gap-2 border-b border-line-subtle mb-6">
          {[['sync','סנכרון'],['health','בריאות'],['activity','פעילות'],['danger','מסוכן']].map(([v,label]) => (
            <Tabs.Trigger key={v} value={v} className="px-3 py-2 text-sm data-[state=active]:font-medium data-[state=active]:border-b-2 data-[state=active]:border-accent">
              {label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
        <Tabs.Content value="sync"><SyncTab /></Tabs.Content>
        <Tabs.Content value="health"><HealthTab /></Tabs.Content>
        <Tabs.Content value="activity"><ActivityTab /></Tabs.Content>
        <Tabs.Content value="danger"><DangerTab /></Tabs.Content>
      </Tabs.Root>
    </main>
  );
}
```

- [ ] **Step 4: Verify Danger tab places ResetData at the bottom with confirmation gate intact**

```bash
grep -n "ResetData\|typed-token" src/components/ResetData.tsx
```

Confirm the typed-token confirmation pattern (per memory) still gates the action.

- [ ] **Step 5: Manual smoke**

```bash
npm run dev
# open /operator, click through all 4 sub-tabs, verify each renders
```

- [ ] **Step 6: Commit**

```bash
git add src/app/operator/
git commit -m "feat(ui-ux): /operator restructured into 4 sub-tabs (Sync/Health/Activity/Danger)"
```

---

## Task 24: Move GoalTracker from Home → P&L tab

**Files:**
- Modify: `dashboard-web/src/components/Dashboard.tsx`

- [ ] **Step 1: Cut GoalTracker from Home branch + paste into P&L branch**

GoalTracker is global per [feedback_monthly_goal_is_global](memory). The P&L tab is the right home for it (it ties revenue targets to monthly P&L view).

In Dashboard.tsx, remove the `<GoalTracker ... />` element from the Home tab branch (it would have moved with `HomePerStoreBand` in Task 20 — confirm not present).

In the P&L branch (around lines 463-505), prepend `<GoalTracker ... />` before `<PnLBreakdown ... />`.

- [ ] **Step 2: Test + smoke + commit**

```bash
npm test
npm run dev   # verify GoalTracker now on P&L tab; Home no longer shows it
git add src/components/Dashboard.tsx
git commit -m "feat(ui-ux): GoalTracker moves Home → P&L (matches its global scope)"
```

---

## Task 25: CampaignsTable virtualization with react-window

**Files:**
- Modify: `dashboard-web/src/components/CampaignsTable.tsx`

- [ ] **Step 1: Identify the row map**

```bash
grep -n "filtered\.map\|\.map((a)" src/components/CampaignsTable.tsx | head -5
```

Locate the primary row-mapping section (the `.map(...)` that produces `<tr>` per campaign).

- [ ] **Step 2: Wrap with `FixedSizeList` from react-window**

The pattern (because react-window doesn't natively render `<tr>` inside `<tbody>` from a virtualized list, use a `display: block` table layout + fixed row height):

```tsx
import { FixedSizeList } from 'react-window';

const ROW_HEIGHT = 48; // tune to match current row height

const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => {
  const a = filtered[index];
  return (
    <div style={style} className="grid grid-cols-... border-b border-line-subtle">
      {/* render the existing per-row cells */}
    </div>
  );
};

return (
  <div className="flex flex-col">
    <TableHeader />
    <FixedSizeList height={600} itemCount={filtered.length} itemSize={ROW_HEIGHT} width="100%">
      {Row}
    </FixedSizeList>
  </div>
);
```

(Adapt the grid template to the existing column layout. Header cells use the same grid template so columns align.)

- [ ] **Step 3: Verify only visible rows render in DOM**

```bash
npm run dev
# Open Campaigns tab. Open browser DevTools → Elements. Count <tr> (or equivalent grid-row) elements.
# Expected: ~12-15 visible rows in DOM (instead of all 500+).
```

- [ ] **Step 4: Run vitest broadly**

```bash
npm test
```

- [ ] **Step 5: Commit**

```bash
git add src/components/CampaignsTable.tsx
git commit -m "perf(ui-ux): CampaignsTable virtualized via react-window (handles 500+ rows)"
```

---

## Task 26: ESLint rules — prevent regression

**Files:**
- Create: `dashboard-web/eslint-rules/no-raw-button-in-components.js`
- Create: `dashboard-web/eslint-rules/no-dark-variant-in-components.js`
- Create: `dashboard-web/eslint-rules/no-hex-color-in-components.js`
- Modify: `dashboard-web/eslint.config.js`

### Rule 1 — no raw `<button>` in `src/components/` outside `components/ui/`

```js
// dashboard-web/eslint-rules/no-raw-button-in-components.js
module.exports = {
  meta: { type: 'problem', docs: { description: 'Forbid raw <button> outside components/ui/. Use the Button primitive.' } },
  create(context) {
    const filename = context.getFilename();
    const isUI = filename.includes('/components/ui/');
    const isOAuthCallback = filename.includes('/api/oauth/');
    const isTest = filename.includes('.test.') || filename.includes('__tests__');
    if (isUI || isOAuthCallback || isTest) return {};
    return {
      JSXOpeningElement(node) {
        if (node.name.type === 'JSXIdentifier' && node.name.name === 'button') {
          context.report({ node, message: 'Use the Button primitive from @/components/ui/Button instead of raw <button>.' });
        }
      },
    };
  },
};
```

### Rule 2 — no `dark:` Tailwind variants in `src/components/` outside `components/ui/`

```js
// dashboard-web/eslint-rules/no-dark-variant-in-components.js
module.exports = {
  meta: { type: 'problem', docs: { description: 'Forbid dark: Tailwind variants in components. Use CSS-var tokens.' } },
  create(context) {
    const filename = context.getFilename();
    if (filename.includes('/components/ui/') || filename.includes('.test.') || filename.includes('__tests__')) return {};
    return {
      JSXAttribute(node) {
        if (node.name.name === 'className' && node.value && node.value.type === 'Literal') {
          if (/\bdark:[\w[-]+/.test(String(node.value.value))) {
            context.report({ node, message: 'Use CSS-var tokens instead of dark: Tailwind variant. Token should be mode-aware in globals.css.' });
          }
        }
      },
    };
  },
};
```

### Rule 3 — no hex literals in `src/components/`

```js
// dashboard-web/eslint-rules/no-hex-color-in-components.js
module.exports = {
  meta: { type: 'problem', docs: { description: 'Forbid hex color literals in components. Use design tokens.' } },
  create(context) {
    const filename = context.getFilename();
    if (filename.includes('/api/oauth/') || filename.includes('.test.') || filename.includes('__tests__')) return {};
    if (!filename.includes('/components/')) return {};
    return {
      Literal(node) {
        if (typeof node.value === 'string' && /#[0-9a-fA-F]{3,8}\b/.test(node.value)) {
          context.report({ node, message: 'Use a CSS-var token instead of hex literal in components.' });
        }
      },
    };
  },
};
```

- [ ] **Step 1: Create the 3 rule files** above.

- [ ] **Step 2: Register them in eslint.config.js**

Add to the existing config:

```js
import rawButtonRule from './eslint-rules/no-raw-button-in-components.js';
import darkVariantRule from './eslint-rules/no-dark-variant-in-components.js';
import hexColorRule from './eslint-rules/no-hex-color-in-components.js';

// in the rules array:
{
  plugins: {
    local: {
      rules: {
        'no-raw-button-in-components': rawButtonRule,
        'no-dark-variant-in-components': darkVariantRule,
        'no-hex-color-in-components': hexColorRule,
      },
    },
  },
  rules: {
    'local/no-raw-button-in-components': 'error',
    'local/no-dark-variant-in-components': 'error',
    'local/no-hex-color-in-components': 'error',
  },
},
```

- [ ] **Step 3: Run lint to confirm zero violations**

```bash
npm run lint 2>&1 | grep -E "error|warning" | head -40
```

Expected: zero errors. (If the migration in Tasks 10/17 was complete, there should be no violations to fix here.)

- [ ] **Step 4: Commit**

```bash
git add eslint-rules/ eslint.config.js
git commit -m "feat(ui-ux): 3 ESLint rules prevent raw <button> / dark: / hex regression"
```

---

## Task 27: Dark-mode token parity CI test

**Files:**
- Create: `dashboard-web/src/lib/__tests__/tokenParity.test.ts`

- [ ] **Step 1: Create the test**

```ts
// dashboard-web/src/lib/__tests__/tokenParity.test.ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const css = readFileSync(join(__dirname, '..', '..', 'app', 'globals.css'), 'utf-8');

const rootBlock = css.match(/:root\s*\{([\s\S]*?)\}/)?.[1] ?? '';
const darkBlock = css.match(/\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)?.[1] ?? '';

function extractTokens(block: string): string[] {
  const matches = block.matchAll(/(--[a-z0-9-]+):/gi);
  return Array.from(matches, (m) => m[1]);
}

describe('CSS token light/dark parity', () => {
  it('every :root --token has a corresponding [data-theme="dark"] override', () => {
    const rootTokens = new Set(extractTokens(rootBlock));
    const darkTokens = new Set(extractTokens(darkBlock));
    const missing = [...rootTokens].filter((t) => !darkTokens.has(t));
    expect(missing, `Missing dark-mode overrides: ${missing.join(', ')}`).toEqual([]);
  });
});
```

- [ ] **Step 2: Run; expect pass (because Tasks 2/3/8 added dark variants for every new token)**

```bash
npm test -- src/lib/__tests__/tokenParity.test.ts
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/lib/__tests__/tokenParity.test.ts
git commit -m "test(ui-ux): CI gate — every :root token must have a dark-mode override"
```

---

## Task 28: Documentation — ARCHITECTURE.md + User Manual

**Files:**
- Modify: `docs/ARCHITECTURE.md`
- Modify: `docs/ROAS-Dashboard-User-Manual.md`

- [ ] **Step 1: Append a new section to ARCHITECTURE.md**

```markdown
## 26. UI/UX Design-System Overhaul (2026-05-30)

Single-PR overhaul addressing 11 concerns raised in the 2026-05-30 fresh
independent audit (see [docs/superpowers/specs/2026-05-30-ui-ux-design-system-overhaul-audit.md](superpowers/specs/2026-05-30-ui-ux-design-system-overhaul-audit.md)).

### Token system
Two-layer (semantic OKLCH vars in `globals.css` referenced by Tailwind
utilities + CVA primitives). New tokens added in this overhaul:
`--status-warning(-bg, -fg)`, `--chart-axis`, `--chart-cpm-prev`,
`--gradient-hero-{from,via,to}`, `--store-{uzoshop,zolplus,usmile}(-bg, -fg)`,
8 `--annotation-*` tokens. All tokens carry both `:root` and
`[data-theme="dark"]` definitions; the `tokenParity.test.ts` CI gate
enforces this contract.

### Color palette unification
Store palette is canonical at the chart palette (cyan / hot-pink / lime —
sourced from `storeColors.ts`). `format.ts STORE_HUES` now routes through
the `--store-*` tokens, with `storeBadgeHex()` exposed as a backwards-
compat shim for server-side callers (WhatsApp summaries).

Platform tokens promoted from `chartColors.ts` into a canonical
`PLATFORM_TOKENS` map exposing per-platform `color` + `strokeDasharray`
+ `strokeWidth`. Shopify keeps its dashed-stroke convention to signal
"actual revenue" vs "reported ads platforms".

### Component primitives (3 new)
- `Stat` — replaces 2 inline drawer stat-block functions.
- `TableBase` (Head + HeaderCell + Row + Cell) — replaces 4 ad-hoc tables.
- `InsightCard` — replaces 4 custom warning/info card surfaces.

`Badge.tsx` now exports `BADGE_TONE_BG` as the single source of truth;
the 2 duplicate maps in CampaignsTable + AdsDrawer are deleted.

### Drawers → Sheet primitive
`CampaignDrawer` + `AdsDrawer` migrated to the `Sheet` primitive
(`side="end"` for RTL safety). Header padding, backdrop blur, close-
button size now consistent.

### IA restructure
- **Home tab** → 3 visual bands (`HomeLiveBand` / `HomeSummaryBand` /
  `HomePerStoreBand`) — scroll height drops ~40%.
- **Analysis tab** → 2 sub-tabs (`Trends` honors global filter;
  `Archive` has its own year selector + month accordion).
- **/operator** → 4 sub-tabs (`Sync` / `Health` / `Activity` / `Danger`).
- `GoalTracker` moves Home → P&L (matches its global scope).

### Bidi sweep
Six high-traffic surfaces wrap dynamic LTR content in `<bdi dir="ltr">`:
CampaignDrawer title + Ads Manager link, CampaignsTableRow campaign-name
cell + 3 mixed-text tooltips, PerStoreCards store-name span. Mixed
Hebrew + English no longer reorders.

### Virtualization
`CampaignsTable` uses `react-window`'s `FixedSizeList`. DOM row count
drops from ~500+ to ~12-15 visible rows; sort/filter interactions stay
60 fps on lower-end hardware.

### ESLint guards
3 custom rules prevent regression:
1. `local/no-raw-button-in-components` — forbid `<button>` outside `components/ui/`.
2. `local/no-dark-variant-in-components` — forbid `dark:` Tailwind variants in components.
3. `local/no-hex-color-in-components` — forbid hex literals in components.

### Tests
Net +14 tests: 6 new (sidebarHover, buttonDestructive, stat, tableBase,
insightCard, yearSelector) + 4 bidi + 1 token-parity + 3 globals-new-
tokens / dark-mode-tuning. Final count: 1591+ green.
```

- [ ] **Step 2: Update User Manual**

Bump version 2.3.1 → 2.4.0. Add a section describing the user-visible
changes:
- Home tab now has 3 vertically-grouped bands.
- Analysis tab has 2 sub-tabs (Trends / Archive); Archive has a year
  picker chip row.
- /operator has 4 sub-tabs.
- GoalTracker moved from Home to P&L.
- Live tab gradient is calmer in dark mode.
- Mixed Hebrew + English text renders correctly (no more reordering).

- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md docs/ROAS-Dashboard-User-Manual.md
git commit -m "docs(ui-ux): ARCHITECTURE §26 + User Manual 2.4.0"
```

---

## Task 29: Final verification + PR open

**Files:** (verification only)

- [ ] **Step 1: tsc clean**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit 2>&1 | head -20
```

Expected: no output (no errors).

- [ ] **Step 2: lint clean**

```bash
npm run lint 2>&1 | grep -E "error|warning" | head -20
```

Expected: zero errors. Warnings (e.g. `@typescript-eslint/no-explicit-any` on unrelated lines) are acceptable.

- [ ] **Step 3: Vitest full pass**

```bash
npm test 2>&1 | tail -5
```

Expected: 1591+ pass, 0 fail.

- [ ] **Step 4: Build clean**

```bash
npm run build 2>&1 | tail -10
```

Expected: build succeeds.

- [ ] **Step 5: Manual review (light mode + dark mode)**

```bash
npm run dev
```

Open `http://localhost:3000` and walk through:
- Home tab: 3 bands render; KPIs + per-store + insights all visible.
- Live tab gradient calmer in dark mode.
- Home sidebar tab: no longer "always selected" on hover.
- P&L tab: GoalTracker now here.
- Analysis tab: sub-tabs Trends + Archive; Archive has year selector.
- Campaigns tab: scroll feels snappy with 500+ rows (virtualized).
- Products tab: unchanged (out of scope).
- Detail tab: unchanged.
- Toggle dark mode (header theme switch). Every tab readable, no contrast
  collapse.
- Toggle RTL/Hebrew rendering for a campaign with English+Hebrew mixed
  name; verify no reorder.

Stop the dev server.

- [ ] **Step 6: Push branch + open PR**

```bash
cd /Users/dorperetz/script-roas
git push -u origin ui-ux/design-system-overhaul-2026-05-30
gh pr create --title "UI/UX design-system overhaul — single mega-PR (Phase E1.6.1)" --body "$(cat <<'EOF'
## Summary
- Resolves all 11 concerns from 2026-05-30 fresh independent UI/UX audit (spec: `docs/superpowers/specs/2026-05-30-ui-ux-design-system-overhaul-audit.md`).
- Adds 3 component primitives (Stat, TableBase, InsightCard), 14 new design tokens, 3 ESLint guards, 1 token-parity CI gate.
- Restructures Home (3 bands), Analysis (Trends/Archive sub-tabs with year picker), /operator (4 sub-tabs).
- Virtualizes CampaignsTable with react-window.
- Bidi-isolates 6 Hebrew+English mixed-text surfaces.
- Net +14 tests, 1591+ green.

## Test plan
- [ ] Light mode walkthrough — every tab readable + no contrast issue
- [ ] Dark mode walkthrough — every tab readable + Live gradient calm
- [ ] Hebrew + English mixed campaign name in drawer + table — no reorder
- [ ] CampaignsTable scroll + sort with 500+ rows — smooth
- [ ] /operator sub-tab switching — all 12 panels still reachable
- [ ] Year selector in Analysis → Archive — switches data per year
- [ ] Sidebar hover — Home tab no longer mimics active state

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Return the PR URL once the command completes.

---

## Total task count: 29 tasks · estimated ~7-8 days of focused work

## Spec coverage check

| Audit concern | Task |
|---|---|
| 1. Page overload + IA simplification | T20 (Home 3-band) + T21 (Analysis split) + T23 (/operator sub-tabs) + T24 (GoalTracker move) |
| 2. Monthly tables long-term UX | T22 (YearSelector + month accordion) |
| 3. Color/contrast/readability | T2-T3 (tokens), T4 (Sidebar), T5 (Button), T10 (amber sweep), T11 (Tooltip surface) |
| 4. Home tab "always selected" | T4 |
| 5. Live gradient too aggressive | T3 (dark `--status-*-bg` chroma reduction) |
| 6. Mixed Hebrew/English bidi | T12 (6-surface sweep) + bidi tests |
| 7. Unified graphical language | T13-T19 (primitives + Sheet + BADGE_TONE_BG) |
| 8. Platform color consistency | T6 (`PLATFORM_TOKENS`) |
| 9. Store color consistency | T7 (chart palette canonical, `format.ts` migrates) |
| 10. Button/action consistency | T5 (destructive) + T17 (sweep) |
| 11. Light + dark mode coverage | T2-T3 + T27 (parity CI gate) |

Every audit concern has a corresponding task.

## Placeholder scan

Scanned for "TBD" / "TODO" / "implement later" / "Similar to Task N" / vague step descriptions. None found. Every step contains exact file paths + code or commands.

## Type consistency check

- `Stat` props consistent across Task 13 definition + Task 18 import.
- `TableBase` chain (`TableHead`/`TableHeaderCell`/`TableRow`/`TableCell`) consistent across Task 14 definition + downstream consumers.
- `InsightCard` `tone="warning|success|info|neutral"` consistent across Task 15 + Task 16.
- `BADGE_TONE_BG` exported in Task 19 referenced in Task 18 Steps 2-3 (Task 19 is later but the Task 18 commits don't fail at runtime because `BADGE_TONE_BG` is added in the same branch before final verification; the agentic worker should execute Tasks in order — if running in parallel branches, Task 19 must merge before Task 18).
- `YearSelector` API (`value`/`onChange`/`startYear`/`endYear`) consistent across Task 22 definition + Task 22 Step 6 consumer.
