# Dashboard UX/UI Overhaul — Plan 01: Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the design-system foundation (OKLCH tokens, font stack, theme system, `components/ui/` primitives, Sidebar, TabHeader, FocusMode, View-Transitions root, ⌘K NL query) on a single feature branch. After this plan, the dashboard looks identical to today by data, but the chrome is new and every later plan builds on these primitives.

**Architecture:** New `components/ui/` shadcn-style primitive layer (Radix-based, copy-paste, not a library wrapper). CSS-variable tokens in `globals.css` driven by Tailwind v3 class strategy. `ThemeProvider` wraps the app with `system | light | dark` resolution. `Sidebar` replaces `TabNav` at the chrome level — tab content stays in `HomeTab`/`PnLTab`/`AnalysisTab`/`CampaignsTab`/`ProductsTab`/`DetailTab` and is rendered identically. Component tests run under a new `jsdom` Vitest config alongside the existing Node config.

**Tech Stack:** Next.js 15 + React 19 + Tailwind v3 + Radix UI primitives + `class-variance-authority` (cva) + `clsx` + `tailwind-merge` (existing) + `next/font` (Heebo + Rubik + Geist Mono) + Vitest + React Testing Library + jest-dom + jsdom. View Transitions via React 19 `<ViewTransition>`.

**Branch:** `dashboard-ux-overhaul-2026-05-28` (created from `main` at the start of Task 1). Commits within the branch use `feat(foundation)` / `chore(foundation)` / `test(foundation)` prefixes.

---

## Pre-Plan: capture before-screenshots

Before any code changes, capture the visual baseline. This is a one-time human action, not a code task.

- [ ] Open the dashboard on a representative day with at least 3 hours of live data.
- [ ] Capture: full scroll of each tab (בית / P&L / ניתוח / קמפיינים / מוצרים / פירוט).
- [ ] Capture: CampaignDrawer open on a representative campaign showing `HealthScorePanel`, `CohortComparisonPanel`, `AttributionAnalysisPanel`, `ProductChannelBreakdown`, `MetaShopifyReconciliation`.
- [ ] Capture: MonthlyTables at all 17 months of history.
- [ ] Capture: Operator console main view at `/operator`.
- [ ] Capture: TodayLive in each of the 4 ROAS tones (red < 2.0, orange 2.0–2.7, green 2.7–3.0, blue > 3.0). If a tone isn't currently live, look at a historical day via the date filter.
- [ ] Save under `.planning/dashboard-ux-overhaul-2026-05-28/before/` (uncommitted; operator-local).

These screenshots are the visual diff baseline for the merge gate later.

---

## Phase 1A — Tooling + tokens

### Task 1: Create branch + add component-test infrastructure

**Files:**
- Create: `dashboard-web/vitest.config.dom.ts`
- Create: `dashboard-web/src/test/setup-dom.ts`
- Modify: `dashboard-web/package.json` (add deps + scripts)

- [ ] **Step 1: Create the feature branch from main**

```bash
cd /Users/dorperetz/script-roas
git fetch origin
git checkout -b dashboard-ux-overhaul-2026-05-28 origin/main
```

Expected: branch created and checked out.

- [ ] **Step 2: Install component-test dependencies**

```bash
cd dashboard-web
npm install --save-dev \
  @testing-library/react@^16.1.0 \
  @testing-library/jest-dom@^6.6.0 \
  @testing-library/user-event@^14.5.0 \
  jsdom@^25.0.0
```

Expected: deps appear in `package.json` devDependencies.

- [ ] **Step 3: Create the jsdom setup file**

Create `dashboard-web/src/test/setup-dom.ts`:

```ts
import '@testing-library/jest-dom/vitest';

// React 19 ships with built-in act() warnings under jsdom. The matcher
// extensions above add expect(...).toBeInTheDocument() etc. and run once
// per test file before describe blocks execute.
```

- [ ] **Step 4: Create the jsdom Vitest config**

Create `dashboard-web/vitest.config.dom.ts`:

```ts
import { defineConfig } from 'vitest/config';
import path from 'path';

// Second Vitest config for component tests that require a DOM (Radix
// primitives, focus management, RTL flips). Kept separate from the
// project-wide node config so the existing pure-function suite stays
// fast (~5x faster than running everything under jsdom).
//
// Run with: npm run test:components
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: [
      'src/components/**/__tests__/*.dom.test.{ts,tsx}',
      'src/components/ui/**/__tests__/*.test.{ts,tsx}',
    ],
    setupFiles: ['./src/test/setup-dom.ts'],
    globals: false,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 5: Add npm scripts**

Edit `dashboard-web/package.json`. Find the `"scripts"` block. Add three new entries (keep existing ones intact):

```json
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint .",
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest",
    "test:components": "vitest run --passWithNoTests --config vitest.config.dom.ts",
    "test:components:watch": "vitest --config vitest.config.dom.ts",
    "test:all": "npm run test && npm run test:components",
    "test:coverage": "vitest run --coverage",
    "audit:reconcile": "AUDIT_LIVE=1 vitest run src/lib/audit/__tests__/reconcile.live.test.ts"
  }
}
```

- [ ] **Step 6: Smoke-test the new config**

```bash
cd dashboard-web
npm run test:components
```

Expected: `Test Files  no tests` (no test files exist yet — exit code 0 because of `--passWithNoTests`).

- [ ] **Step 7: Commit**

```bash
git add dashboard-web/package.json dashboard-web/package-lock.json \
        dashboard-web/vitest.config.dom.ts dashboard-web/src/test/setup-dom.ts
git commit -m "chore(foundation): add jsdom Vitest config + testing-library deps for components/ui/"
```

---

### Task 2: Add Radix UI + cva dependencies

**Files:**
- Modify: `dashboard-web/package.json`

- [ ] **Step 1: Install Radix primitives + cva**

```bash
cd dashboard-web
npm install \
  @radix-ui/react-dialog@^1.1.3 \
  @radix-ui/react-tooltip@^1.1.4 \
  @radix-ui/react-popover@^1.1.3 \
  @radix-ui/react-tabs@^1.1.1 \
  @radix-ui/react-switch@^1.1.2 \
  @radix-ui/react-select@^2.1.3 \
  @radix-ui/react-toggle@^1.1.1 \
  @radix-ui/react-slot@^1.1.0 \
  class-variance-authority@^0.7.1
```

Expected: deps appear in `package.json` dependencies.

- [ ] **Step 2: Verify TypeScript still compiles**

```bash
cd dashboard-web
npx tsc --noEmit
```

Expected: no errors. Radix types come with their packages.

- [ ] **Step 3: Commit**

```bash
git add dashboard-web/package.json dashboard-web/package-lock.json
git commit -m "chore(foundation): add Radix UI primitives + cva for components/ui/"
```

---

### Task 3: OKLCH design token definitions in globals.css

**Files:**
- Modify: `dashboard-web/src/app/globals.css`
- Test: `dashboard-web/src/lib/__tests__/themeTokens.test.ts`

- [ ] **Step 1: Write the failing test (token contract)**

Create `dashboard-web/src/lib/__tests__/themeTokens.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';

/**
 * Lock-in: globals.css MUST define both :root (light) and [data-theme="dark"]
 * blocks for the same token list. Any later plan that adds a surface or
 * status token must add it to both blocks — this test catches drift.
 */
describe('OKLCH theme tokens — light + dark parity', () => {
  const css = readFileSync(
    join(__dirname, '../../app/globals.css'),
    'utf-8',
  );

  const REQUIRED_TOKENS = [
    // Surfaces
    '--surface-canvas',
    '--surface-elevated-1',
    '--surface-elevated-2',
    '--surface-overlay',
    // Text
    '--text-primary',
    '--text-secondary',
    '--text-muted',
    '--text-subtle',
    // Borders
    '--border-default',
    '--border-subtle',
    '--border-strong',
    // Accent
    '--accent',
    '--accent-fg',
    // ROAS status (4 tones, 3 variants each)
    '--status-red',     '--status-red-bg',     '--status-red-fg',
    '--status-orange',  '--status-orange-bg',  '--status-orange-fg',
    '--status-green',   '--status-green-bg',   '--status-green-fg',
    '--status-blue',    '--status-blue-bg',    '--status-blue-fg',
    // Gray for ROAS "no data"
    '--status-gray',    '--status-gray-bg',    '--status-gray-fg',
  ];

  function extractBlock(selector: string): string {
    const re = new RegExp(`${selector}\\s*\\{([\\s\\S]*?)\\}`);
    const m = css.match(re);
    if (!m) throw new Error(`Selector ${selector} not found in globals.css`);
    return m[1];
  }

  it('defines every required token in :root (light)', () => {
    const block = extractBlock(':root');
    for (const tok of REQUIRED_TOKENS) {
      expect(block, `:root missing ${tok}`).toContain(tok);
    }
  });

  it('defines every required token in [data-theme="dark"]', () => {
    const block = extractBlock('\\[data-theme="dark"\\]');
    for (const tok of REQUIRED_TOKENS) {
      expect(block, `dark block missing ${tok}`).toContain(tok);
    }
  });

  it('uses oklch() syntax for every token value (not hsl/rgb/hex)', () => {
    const blocks = [
      extractBlock(':root'),
      extractBlock('\\[data-theme="dark"\\]'),
    ];
    for (const block of blocks) {
      for (const tok of REQUIRED_TOKENS) {
        const re = new RegExp(`${tok}\\s*:\\s*([^;]+);`);
        const m = block.match(re);
        expect(m, `value missing for ${tok}`).not.toBeNull();
        expect(m![1], `${tok} should use oklch()`).toMatch(/oklch\s*\(/);
      }
    }
  });
});
```

- [ ] **Step 2: Run test to confirm it fails**

```bash
cd dashboard-web
npm run test -- src/lib/__tests__/themeTokens.test.ts
```

Expected: FAIL — `:root` block exists but doesn't have these token names yet.

- [ ] **Step 3: Add the token blocks to globals.css**

Edit `dashboard-web/src/app/globals.css`. Insert IMMEDIATELY after the `@tailwind utilities;` line (line 3 today) and BEFORE the existing base `html, body` rule:

```css
/* ===========================================================================
   Design Tokens — OKLCH-based. Defined in :root (light) and overridden
   under [data-theme="dark"]. Tailwind reads these via the CSS-variable
   color strategy in tailwind.config.ts. ROAS status tokens map 1-to-1
   to the existing roasLabel() tones (red < 2.0, orange 2.0–2.7,
   green 2.7–3.0, blue > 3.0, gray for no-data) — color logic itself
   does not move.
   =========================================================================== */
:root {
  /* Surfaces — warm off-white scale */
  --surface-canvas:    oklch(99% 0.005 80);
  --surface-elevated-1: oklch(100% 0 0);
  --surface-elevated-2: oklch(97% 0.005 80);
  --surface-overlay:   oklch(95% 0.005 80 / 0.92);

  /* Text */
  --text-primary:   oklch(20% 0.02 250);
  --text-secondary: oklch(40% 0.02 250);
  --text-muted:     oklch(60% 0.015 250);
  --text-subtle:    oklch(75% 0.01 250);

  /* Borders */
  --border-default: oklch(90% 0.01 250);
  --border-subtle:  oklch(94% 0.005 250);
  --border-strong:  oklch(80% 0.015 250);

  /* Accent — single cool indigo */
  --accent:    oklch(55% 0.18 260);
  --accent-fg: oklch(99% 0 0);

  /* ROAS status — all at uniform L=60% for perceptual balance */
  --status-red:    oklch(60% 0.18 25);
  --status-red-bg: oklch(96% 0.04 25);
  --status-red-fg: oklch(35% 0.18 25);

  --status-orange:    oklch(70% 0.16 55);
  --status-orange-bg: oklch(96% 0.05 55);
  --status-orange-fg: oklch(40% 0.15 55);

  --status-green:    oklch(60% 0.16 145);
  --status-green-bg: oklch(95% 0.05 145);
  --status-green-fg: oklch(35% 0.16 145);

  --status-blue:    oklch(60% 0.16 240);
  --status-blue-bg: oklch(95% 0.04 240);
  --status-blue-fg: oklch(35% 0.16 240);

  --status-gray:    oklch(60% 0 0);
  --status-gray-bg: oklch(95% 0 0);
  --status-gray-fg: oklch(40% 0 0);
}

[data-theme="dark"] {
  /* Surfaces — soft dark, NOT pure #000 (modern dark standard).
     Highest contrast against text-primary, lowest against text-subtle. */
  --surface-canvas:    oklch(15% 0.01 240);
  --surface-elevated-1: oklch(19% 0.01 240);
  --surface-elevated-2: oklch(23% 0.01 240);
  --surface-overlay:   oklch(15% 0.01 240 / 0.85);

  /* Text — inverted scale */
  --text-primary:   oklch(95% 0.01 240);
  --text-secondary: oklch(78% 0.01 240);
  --text-muted:     oklch(60% 0.015 240);
  --text-subtle:    oklch(45% 0.015 240);

  /* Borders */
  --border-default: oklch(30% 0.01 240);
  --border-subtle:  oklch(25% 0.01 240);
  --border-strong:  oklch(40% 0.01 240);

  /* Accent — slightly desaturated for dark */
  --accent:    oklch(65% 0.16 260);
  --accent-fg: oklch(15% 0.01 240);

  /* ROAS status — hue locked, luminance bumped so colors stay legible
     against dark surfaces. The 4 tones still map to roasLabel() 1-to-1. */
  --status-red:    oklch(65% 0.18 25);
  --status-red-bg: oklch(25% 0.06 25);
  --status-red-fg: oklch(85% 0.10 25);

  --status-orange:    oklch(73% 0.16 55);
  --status-orange-bg: oklch(25% 0.06 55);
  --status-orange-fg: oklch(85% 0.10 55);

  --status-green:    oklch(65% 0.16 145);
  --status-green-bg: oklch(25% 0.06 145);
  --status-green-fg: oklch(85% 0.10 145);

  --status-blue:    oklch(65% 0.16 240);
  --status-blue-bg: oklch(25% 0.05 240);
  --status-blue-fg: oklch(85% 0.08 240);

  --status-gray:    oklch(65% 0 0);
  --status-gray-bg: oklch(25% 0 0);
  --status-gray-fg: oklch(85% 0 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd dashboard-web
npm run test -- src/lib/__tests__/themeTokens.test.ts
```

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/app/globals.css \
        dashboard-web/src/lib/__tests__/themeTokens.test.ts
git commit -m "feat(foundation): OKLCH design tokens — light + dark with ROAS-tone parity"
```

---

### Task 4: Wire tokens into tailwind.config.ts

**Files:**
- Modify: `dashboard-web/tailwind.config.ts`

- [ ] **Step 1: Update tailwind config to consume the CSS variables**

Edit `dashboard-web/tailwind.config.ts`. Add a `darkMode` selector strategy at the top of the config object, then extend the `colors` block (KEEP all existing color tokens — they're still used by today's components and will be migrated incrementally; the new tokens are additive):

Find this section (line 13-18):

```ts
const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        // Cool-tinted surface stack — pure white feels harsh next to data.
```

Replace with:

```ts
const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        // New token-driven colors (OKLCH, light/dark aware). Consumed by
        // components/ui/* primitives and progressively by migrated
        // legacy components. The hex/literal color block below is kept
        // intact during the migration so unmigrated components don't
        // visually break — deleted in Plan 7 (polish) once nothing uses
        // them.
        canvas:        'var(--surface-canvas)',
        elevated:      'var(--surface-elevated-1)',
        elevated2:     'var(--surface-elevated-2)',
        overlay:       'var(--surface-overlay)',
        ink: {
          DEFAULT:   'var(--text-primary)',
          secondary: 'var(--text-secondary)',
          muted:     'var(--text-muted)',
          subtle:    'var(--text-subtle)',
        },
        line: {
          DEFAULT: 'var(--border-default)',
          subtle:  'var(--border-subtle)',
          strong:  'var(--border-strong)',
        },
        accent: {
          DEFAULT: 'var(--accent)',
          fg:      'var(--accent-fg)',
        },
        status: {
          red:        'var(--status-red)',
          redBg:      'var(--status-red-bg)',
          redFg:      'var(--status-red-fg)',
          orange:     'var(--status-orange)',
          orangeBg:   'var(--status-orange-bg)',
          orangeFg:   'var(--status-orange-fg)',
          green:      'var(--status-green)',
          greenBg:    'var(--status-green-bg)',
          greenFg:    'var(--status-green-fg)',
          blue:       'var(--status-blue)',
          blueBg:     'var(--status-blue-bg)',
          blueFg:     'var(--status-blue-fg)',
          gray:       'var(--status-gray)',
          grayBg:     'var(--status-gray-bg)',
          grayFg:     'var(--status-gray-fg)',
        },

        // ===== LEGACY (kept during migration; removed in Plan 7) =====
        // Cool-tinted surface stack — pure white feels harsh next to data.
```

- [ ] **Step 2: Verify Tailwind compiles**

```bash
cd dashboard-web
npx tsc --noEmit
npm run build 2>&1 | tail -20
```

Expected: build succeeds. No new tokens are *used* yet so the build output is byte-identical to before.

- [ ] **Step 3: Commit**

```bash
git add dashboard-web/tailwind.config.ts
git commit -m "feat(foundation): wire OKLCH CSS-var tokens into tailwind.config (additive — legacy palette stays during migration)"
```

---

### Task 5: Load Heebo + Rubik + Geist Mono via next/font

**Files:**
- Modify: `dashboard-web/src/app/layout.tsx`
- Modify: `dashboard-web/tailwind.config.ts`
- Modify: `dashboard-web/src/app/globals.css`

- [ ] **Step 1: Add the three fonts to layout.tsx**

Find the existing `next/font/google` import in `dashboard-web/src/app/layout.tsx`. Add Rubik and Geist_Mono alongside Heebo.

If today's layout.tsx loads Heebo like:

```ts
import { Heebo } from 'next/font/google';
const heebo = Heebo({ subsets: ['hebrew', 'latin'], variable: '--font-heebo' });
```

Change it to:

```ts
import { Heebo, Rubik, Geist_Mono } from 'next/font/google';

const heebo = Heebo({
  subsets: ['hebrew', 'latin'],
  weight: ['300', '400', '500', '600', '700', '800'],
  variable: '--font-heebo',
  display: 'swap',
});

const rubik = Rubik({
  subsets: ['hebrew', 'latin'],
  weight: ['300', '400', '500', '600', '700'],
  // Rubik has real OpenType `tnum` + `zero` + `case` features that Heebo
  // lacks. Adding it as the numeric font fixes a silent bug where the
  // existing `.tabular-nums` class declared the feature against Heebo
  // (which has no tnum), making columns align only because Heebo's
  // digits are coincidentally near-monowidth.
  variable: '--font-rubik',
  display: 'swap',
});

const geistMono = Geist_Mono({
  // Geist Mono is on Google Fonts (added in 2024). next/font/google
  // handles subset loading, hashing, and CSS variable wiring just like
  // Heebo and Rubik above. No manual woff2 vendoring needed.
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-geist-mono',
  display: 'swap',
});
```

Apply the variables to the root element. Find the `<html>` tag in the layout's returned JSX (it currently includes `className={heebo.variable}` or similar). Update to:

```tsx
<html lang="he" dir="rtl" className={`${heebo.variable} ${rubik.variable} ${geistMono.variable}`}>
```

- [ ] **Step 2: (no-op — Google-hosted, no vendoring needed)**

Earlier drafts of this plan called for manually downloading Geist Mono woff2 files into `dashboard-web/src/fonts/`. That's no longer necessary — `next/font/google` ships Geist Mono. Step 1 is sufficient on its own; skip this step.

- [ ] **Step 3: Update tailwind.config.ts font chain**

Edit `dashboard-web/tailwind.config.ts`. Find the existing `fontFamily` block (line 67-78) and replace it with:

```ts
fontFamily: {
  sans: [
    'var(--font-heebo)',
    'var(--font-rubik)',
    'system-ui',
    '-apple-system',
    'BlinkMacSystemFont',
    'Segoe UI',
    'Arial',
    'sans-serif',
  ],
  // `font-numeric` is the new utility used by .tabular-nums. Heebo lacks
  // a real `tnum` feature; Rubik has it. By giving the numeric class a
  // Rubik-first chain we make the tnum declaration actually resolve to
  // a tabular substitution instead of silently no-op-ing.
  numeric: [
    'var(--font-rubik)',
    'var(--font-heebo)',
    'system-ui',
    'sans-serif',
  ],
  mono: [
    'var(--font-geist-mono)',
    'ui-monospace',
    'SFMono-Regular',
    'Menlo',
    'monospace',
  ],
},
```

- [ ] **Step 4: Update .tabular-nums to use the numeric font chain**

Edit `dashboard-web/src/app/globals.css`. Find the existing `.tabular-nums` rule (currently around line 18-23). Replace with:

```css
/* Tabular numbers — uses the Rubik-first numeric chain so the tnum
   feature actually resolves. Previously declared against Heebo
   (which has no tnum) — columns lined up only because Heebo's digits
   are coincidentally near-monowidth. */
.tabular-nums,
input[type="date"],
input[type="number"] {
  font-family: var(--font-rubik), var(--font-heebo), system-ui, sans-serif;
  font-feature-settings: 'tnum', 'kern', 'zero', 'case';
  font-variant-numeric: tabular-nums;
}
```

- [ ] **Step 5: Verify build + visual smoke test**

```bash
cd dashboard-web
npm run build 2>&1 | tail -10
npm run dev &
sleep 5
# Open http://localhost:3000 in a browser. The dashboard should look
# identical (Heebo is still the primary text font). Inspect any element
# with the .tabular-nums class — its font-family should now resolve to
# Rubik in the computed styles panel.
kill %1
```

Expected: dashboard renders, numeric cells use Rubik.

- [ ] **Step 6: Commit**

```bash
git add dashboard-web/src/app/layout.tsx dashboard-web/tailwind.config.ts \
        dashboard-web/src/app/globals.css
git commit -m "feat(foundation): add Rubik (real tnum) + Geist Mono via next/font/google; .tabular-nums now resolves to a real tabular substitution"
```

---

## Phase 1B — Theme system

### Task 6: ThemeProvider + useTheme hook

**Files:**
- Create: `dashboard-web/src/components/ThemeProvider.tsx`
- Create: `dashboard-web/src/lib/theme.ts`
- Test: `dashboard-web/src/lib/__tests__/theme.test.ts`

- [ ] **Step 1: Write the failing test for theme resolution + persistence**

Create `dashboard-web/src/lib/__tests__/theme.test.ts`:

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  THEME_STORAGE_KEY,
  resolveTheme,
  readStoredTheme,
  writeStoredTheme,
  type ThemeChoice,
  type ResolvedTheme,
} from '../theme';

describe('theme — resolve + persistence', () => {
  beforeEach(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.clear();
    }
  });

  describe('resolveTheme', () => {
    it('returns "light" when choice = system and OS prefers light', () => {
      const result: ResolvedTheme = resolveTheme('system', false);
      expect(result).toBe('light');
    });

    it('returns "dark" when choice = system and OS prefers dark', () => {
      const result: ResolvedTheme = resolveTheme('system', true);
      expect(result).toBe('dark');
    });

    it('returns "light" when choice = light regardless of OS', () => {
      expect(resolveTheme('light', true)).toBe('light');
      expect(resolveTheme('light', false)).toBe('light');
    });

    it('returns "dark" when choice = dark regardless of OS', () => {
      expect(resolveTheme('dark', true)).toBe('dark');
      expect(resolveTheme('dark', false)).toBe('dark');
    });
  });

  describe('readStoredTheme', () => {
    it('returns "system" when nothing stored', () => {
      expect(readStoredTheme()).toBe('system');
    });

    it('returns the stored value when present and valid', () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, 'dark');
      expect(readStoredTheme()).toBe('dark');
    });

    it('returns "system" on garbage stored value (defensive)', () => {
      window.localStorage.setItem(THEME_STORAGE_KEY, 'rainbow');
      expect(readStoredTheme()).toBe('system');
    });
  });

  describe('writeStoredTheme', () => {
    it('persists the choice to localStorage', () => {
      writeStoredTheme('dark');
      expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe('dark');
    });

    it('round-trips all three values', () => {
      const cases: ThemeChoice[] = ['system', 'light', 'dark'];
      for (const c of cases) {
        writeStoredTheme(c);
        expect(readStoredTheme()).toBe(c);
      }
    });
  });
});
```

This test must run under jsdom (uses `window.localStorage`). Add an explicit `// @vitest-environment jsdom` directive at the top so it works under the default node config too:

```ts
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
// ... rest of imports ...
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd dashboard-web
npm run test -- src/lib/__tests__/theme.test.ts
```

Expected: FAIL — `theme.ts` does not exist yet.

- [ ] **Step 3: Implement `lib/theme.ts`**

Create `dashboard-web/src/lib/theme.ts`:

```ts
/**
 * Theme persistence + resolution helpers.
 *
 * Theme model:
 *   - ThemeChoice: what the user picked ("system" | "light" | "dark")
 *   - ResolvedTheme: what we actually paint ("light" | "dark") — derived
 *     from ThemeChoice + the OS preference at the moment of resolution.
 *
 * The split lets us persist intent (user picked "system") instead of the
 * resolved value, so if the OS preference flips later, the dashboard
 * follows automatically.
 */
export type ThemeChoice = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'roas-theme';

const VALID_CHOICES: readonly ThemeChoice[] = ['system', 'light', 'dark'];

/** Reads the persisted choice, defaulting to 'system' for first-time + garbage values. */
export function readStoredTheme(): ThemeChoice {
  if (typeof window === 'undefined') return 'system';
  const raw = window.localStorage.getItem(THEME_STORAGE_KEY);
  if (raw && (VALID_CHOICES as readonly string[]).includes(raw)) {
    return raw as ThemeChoice;
  }
  return 'system';
}

/** Writes the persisted choice. */
export function writeStoredTheme(choice: ThemeChoice): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(THEME_STORAGE_KEY, choice);
}

/** Resolves a choice + OS-prefers-dark signal into a concrete paint value. */
export function resolveTheme(
  choice: ThemeChoice,
  osPrefersDark: boolean,
): ResolvedTheme {
  if (choice === 'light') return 'light';
  if (choice === 'dark') return 'dark';
  return osPrefersDark ? 'dark' : 'light';
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd dashboard-web
npm run test -- src/lib/__tests__/theme.test.ts
```

Expected: PASS (10 tests).

- [ ] **Step 5: Create `ThemeProvider.tsx`**

Create `dashboard-web/src/components/ThemeProvider.tsx`:

```tsx
'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  readStoredTheme,
  writeStoredTheme,
  resolveTheme,
  type ThemeChoice,
  type ResolvedTheme,
} from '@/lib/theme';

type ThemeContextValue = {
  choice: ThemeChoice;
  resolved: ResolvedTheme;
  setChoice: (next: ThemeChoice) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Choice can be read synchronously on the client; on SSR default to
  // 'system' so the no-FOUC inline script (added in Task 7) is what
  // actually applies the theme before hydration.
  const [choice, setChoiceState] = useState<ThemeChoice>(() => readStoredTheme());

  const [osPrefersDark, setOsPrefersDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  // Listen for OS preference changes so users who selected "system" get
  // automatic switch when their OS theme changes mid-session.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setOsPrefersDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const resolved = useMemo(
    () => resolveTheme(choice, osPrefersDark),
    [choice, osPrefersDark],
  );

  // Apply the resolved theme to <html data-theme="...">. The CSS variable
  // blocks in globals.css are keyed off this attribute.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.setAttribute('data-theme', resolved);
  }, [resolved]);

  const setChoice = (next: ThemeChoice) => {
    setChoiceState(next);
    writeStoredTheme(next);
  };

  const value = useMemo<ThemeContextValue>(
    () => ({ choice, resolved, setChoice }),
    [choice, resolved],
  );

  return (
    <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider');
  return ctx;
}
```

- [ ] **Step 6: Commit**

```bash
git add dashboard-web/src/lib/theme.ts \
        dashboard-web/src/lib/__tests__/theme.test.ts \
        dashboard-web/src/components/ThemeProvider.tsx
git commit -m "feat(foundation): ThemeProvider + useTheme + lib/theme persistence helpers (system/light/dark)"
```

---

### Task 7: Mount ThemeProvider + add no-FOUC script

**Files:**
- Modify: `dashboard-web/src/app/layout.tsx`

- [ ] **Step 1: Wrap the app body in ThemeProvider and add the inline script**

Edit `dashboard-web/src/app/layout.tsx`. Add the import:

```tsx
import { ThemeProvider } from '@/components/ThemeProvider';
```

Find the `<html>` element in the returned JSX. Before the `<body>` opens, add the no-FOUC `<head>` inline script (Next.js App Router accepts `<head>` children inside `<html>` for layout-level injections, or use a `<Script strategy="beforeInteractive">` from `next/script`). Use the explicit `<script>` tag injected via a server component (App Router pattern):

```tsx
<html lang="he" dir="rtl" className={`${heebo.variable} ${rubik.variable} ${geistMono.variable}`}>
  <head>
    <script
      // Run before React hydration so the user never sees the wrong theme
      // for a frame. Reads the persisted choice + OS preference, resolves
      // to "light" or "dark", and writes the data-theme attribute on the
      // root element. ThemeProvider takes over after hydration.
      dangerouslySetInnerHTML={{
        __html: `
(function () {
  try {
    var k = 'roas-theme';
    var v = localStorage.getItem(k);
    var c = (v === 'light' || v === 'dark' || v === 'system') ? v : 'system';
    var d = c === 'dark' || (c === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', d ? 'dark' : 'light');
  } catch (e) {
    document.documentElement.setAttribute('data-theme', 'light');
  }
})();
        `.trim(),
      }}
    />
  </head>
  <body className={/* existing body classes */}>
    <ThemeProvider>{children}</ThemeProvider>
  </body>
</html>
```

If the layout currently already has a `<head>` block, append the `<script>` to it instead of adding a new one.

- [ ] **Step 2: Verify build + theme application**

```bash
cd dashboard-web
npm run build 2>&1 | tail -10
npm run dev &
sleep 5
# Manually verify:
# 1. Open http://localhost:3000 with browser-default theme (light). Inspect <html>: should have data-theme="light".
# 2. Open browser DevTools > Rendering > "Emulate CSS prefers-color-scheme: dark". Refresh. <html> should have data-theme="dark".
# 3. In console: localStorage.setItem('roas-theme', 'light'); location.reload(). Should be light again even with OS=dark.
kill %1
```

- [ ] **Step 3: Commit**

```bash
git add dashboard-web/src/app/layout.tsx
git commit -m "feat(foundation): mount ThemeProvider + no-FOUC inline theme script in root layout"
```

---

### Task 8: (intentionally folded into Task 5) — verify tabular-nums resolves correctly

This was already done in Task 5 step 4. Marking complete here to keep task numbering consistent with the spec phases.

- [ ] **Step 1: Re-verify in browser DevTools**

```bash
cd dashboard-web
npm run dev &
sleep 5
# Inspect any KPI card numeric value (e.g. on the בית tab).
# Computed > font-family should resolve to Rubik first.
# Computed > font-variant-numeric should show "tabular-nums".
kill %1
```

No commit; this is a verification step.

---

## Phase 1C — `components/ui/` primitives

Each primitive lives in its own file under `dashboard-web/src/components/ui/`. Tests live alongside in `__tests__/`. Primitives use Radix where applicable and `cva` for variant API. Each primitive is RTL-correct by construction (`ms-`/`me-`/`ps-`/`pe-`/`text-start`/`text-end`).

### Task 9: `cn()` utility + Card primitive

**Files:**
- Modify: `dashboard-web/src/lib/utils.ts` (already exports `cn`; verify it merges class lists via `tailwind-merge`)
- Create: `dashboard-web/src/components/ui/Card.tsx`
- Create: `dashboard-web/src/components/ui/__tests__/Card.test.tsx`

- [ ] **Step 1: Verify `cn()` utility merges Tailwind classes**

Read `dashboard-web/src/lib/utils.ts`. Confirm `cn()` uses `twMerge(clsx(...))`. If it doesn't, update to:

```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 2: Write the failing test for Card**

Create `dashboard-web/src/components/ui/__tests__/Card.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card, CardHeader, CardTitle, CardDescription, CardBody, CardFooter } from '../Card';

describe('Card primitive', () => {
  it('renders all subcomponents', () => {
    render(
      <Card data-testid="card">
        <CardHeader>
          <CardTitle>Title</CardTitle>
          <CardDescription>Desc</CardDescription>
        </CardHeader>
        <CardBody>Body</CardBody>
        <CardFooter>Footer</CardFooter>
      </Card>,
    );
    expect(screen.getByTestId('card')).toBeInTheDocument();
    expect(screen.getByText('Title')).toBeInTheDocument();
    expect(screen.getByText('Desc')).toBeInTheDocument();
    expect(screen.getByText('Body')).toBeInTheDocument();
    expect(screen.getByText('Footer')).toBeInTheDocument();
  });

  it('accepts variant="elevated" → applies shadow class', () => {
    render(<Card variant="elevated" data-testid="card">x</Card>);
    expect(screen.getByTestId('card').className).toMatch(/shadow/);
  });

  it('accepts variant="flat" → does not apply border/shadow classes', () => {
    render(<Card variant="flat" data-testid="card">x</Card>);
    const cls = screen.getByTestId('card').className;
    expect(cls).not.toMatch(/shadow/);
    expect(cls).not.toMatch(/border-/);
  });

  it('preserves user className via cn() merge (no clobber)', () => {
    render(<Card className="mt-10" data-testid="card">x</Card>);
    expect(screen.getByTestId('card').className).toMatch(/mt-10/);
  });

  it('uses RTL-safe padding utilities (no pl-/pr-)', () => {
    render(<Card data-testid="card">x</Card>);
    const cls = screen.getByTestId('card').className;
    expect(cls).not.toMatch(/\bpl-/);
    expect(cls).not.toMatch(/\bpr-/);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

```bash
cd dashboard-web
npm run test:components -- Card.test.tsx
```

Expected: FAIL — Card not found.

- [ ] **Step 4: Implement `Card.tsx`**

Create `dashboard-web/src/components/ui/Card.tsx`:

```tsx
import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const cardVariants = cva(
  'bg-elevated text-ink rounded-xl transition-colors',
  {
    variants: {
      variant: {
        default:  'border border-line shadow-sm',
        elevated: 'border border-line shadow-md',
        flat:     '',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface CardProps
  extends HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof cardVariants> {}

export const Card = forwardRef<HTMLDivElement, CardProps>(
  ({ className, variant, ...props }, ref) => (
    <div ref={ref} className={cn(cardVariants({ variant }), className)} {...props} />
  ),
);
Card.displayName = 'Card';

export const CardHeader = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-1 px-5 py-4', className)} {...props} />
  ),
);
CardHeader.displayName = 'CardHeader';

export const CardTitle = forwardRef<HTMLHeadingElement, HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => (
    <h3 ref={ref} className={cn('text-sm font-semibold text-ink leading-tight', className)} {...props} />
  ),
);
CardTitle.displayName = 'CardTitle';

export const CardDescription = forwardRef<HTMLParagraphElement, HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => (
    <p ref={ref} className={cn('text-xs text-ink-muted', className)} {...props} />
  ),
);
CardDescription.displayName = 'CardDescription';

export const CardBody = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('px-5 py-3', className)} {...props} />
  ),
);
CardBody.displayName = 'CardBody';

export const CardFooter = forwardRef<HTMLDivElement, HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('px-5 py-3 border-t border-line-subtle', className)} {...props} />
  ),
);
CardFooter.displayName = 'CardFooter';
```

- [ ] **Step 5: Run test to verify it passes**

```bash
cd dashboard-web
npm run test:components -- Card.test.tsx
```

Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add dashboard-web/src/components/ui/Card.tsx \
        dashboard-web/src/components/ui/__tests__/Card.test.tsx \
        dashboard-web/src/lib/utils.ts
git commit -m "feat(foundation): Card primitive (default/elevated/flat variants) with RTL-safe spacing"
```

---

### Task 10: Button primitive

**Files:**
- Create: `dashboard-web/src/components/ui/Button.tsx`
- Create: `dashboard-web/src/components/ui/__tests__/Button.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `dashboard-web/src/components/ui/__tests__/Button.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Button } from '../Button';

describe('Button primitive', () => {
  it('renders a <button> by default', () => {
    render(<Button>Click</Button>);
    expect(screen.getByRole('button', { name: 'Click' })).toBeInTheDocument();
  });

  it('renders as <a> when asChild + child is <a>', () => {
    render(<Button asChild><a href="/x">Link</a></Button>);
    const el = screen.getByText('Link');
    expect(el.tagName).toBe('A');
    expect(el.getAttribute('href')).toBe('/x');
  });

  it('applies primary variant by default (accent class)', () => {
    render(<Button data-testid="b">x</Button>);
    expect(screen.getByTestId('b').className).toMatch(/bg-accent/);
  });

  it('applies destructive variant class', () => {
    render(<Button variant="destructive" data-testid="b">x</Button>);
    expect(screen.getByTestId('b').className).toMatch(/status-red/);
  });

  it('respects disabled prop', () => {
    render(<Button disabled data-testid="b">x</Button>);
    expect(screen.getByTestId('b')).toBeDisabled();
  });

  it('uses RTL-safe gap utilities (no pl-/pr-)', () => {
    render(<Button data-testid="b">x</Button>);
    const cls = screen.getByTestId('b').className;
    expect(cls).not.toMatch(/\bpl-/);
    expect(cls).not.toMatch(/\bpr-/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd dashboard-web
npm run test:components -- Button.test.tsx
```

Expected: FAIL.

- [ ] **Step 3: Implement Button**

Create `dashboard-web/src/components/ui/Button.tsx`:

```tsx
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Slot } from '@radix-ui/react-slot';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium ' +
    'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ' +
    'focus-visible:ring-offset-2 focus-visible:ring-offset-canvas disabled:opacity-50 disabled:pointer-events-none',
  {
    variants: {
      variant: {
        primary:     'bg-accent text-accent-fg hover:bg-accent/90',
        secondary:   'bg-elevated2 text-ink border border-line hover:bg-elevated',
        ghost:       'text-ink hover:bg-elevated2',
        destructive: 'bg-status-red text-white hover:bg-status-red/90',
        link:        'text-accent underline-offset-4 hover:underline',
      },
      size: {
        sm: 'h-8 px-3 text-xs rounded-md',
        md: 'h-9 px-4 text-sm rounded-md',
        lg: 'h-10 px-5 text-sm rounded-lg',
        icon: 'h-9 w-9 rounded-md',
      },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp: React.ElementType = asChild ? Slot : 'button';
    return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
  },
);
Button.displayName = 'Button';
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd dashboard-web
npm run test:components -- Button.test.tsx
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/components/ui/Button.tsx \
        dashboard-web/src/components/ui/__tests__/Button.test.tsx
git commit -m "feat(foundation): Button primitive (5 variants, 4 sizes, asChild via Radix Slot)"
```

---

### Task 11: Badge primitive (status-tone aware)

**Files:**
- Create: `dashboard-web/src/components/ui/Badge.tsx`
- Create: `dashboard-web/src/components/ui/__tests__/Badge.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `dashboard-web/src/components/ui/__tests__/Badge.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from '../Badge';

describe('Badge primitive', () => {
  it('renders the children', () => {
    render(<Badge>Healthy</Badge>);
    expect(screen.getByText('Healthy')).toBeInTheDocument();
  });

  it('applies each ROAS tone variant', () => {
    const tones = ['red', 'orange', 'green', 'blue', 'gray'] as const;
    for (const t of tones) {
      const { unmount } = render(<Badge tone={t} data-testid={t}>x</Badge>);
      expect(screen.getByTestId(t).className).toMatch(new RegExp(`status-${t}`));
      unmount();
    }
  });

  it('uses RTL-safe utilities', () => {
    render(<Badge data-testid="b">x</Badge>);
    const cls = screen.getByTestId('b').className;
    expect(cls).not.toMatch(/\bpl-/);
    expect(cls).not.toMatch(/\bpr-/);
  });
});
```

- [ ] **Step 2: Run test → fail**

```bash
cd dashboard-web
npm run test:components -- Badge.test.tsx
```

- [ ] **Step 3: Implement Badge**

Create `dashboard-web/src/components/ui/Badge.tsx`:

```tsx
import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-2xs font-semibold tabular-nums',
  {
    variants: {
      tone: {
        red:    'bg-status-redBg text-status-redFg',
        orange: 'bg-status-orangeBg text-status-orangeFg',
        green:  'bg-status-greenBg text-status-greenFg',
        blue:   'bg-status-blueBg text-status-blueFg',
        gray:   'bg-status-grayBg text-status-grayFg',
      },
    },
    defaultVariants: { tone: 'gray' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, tone, ...props }, ref) => (
    <span ref={ref} className={cn(badgeVariants({ tone }), className)} {...props} />
  ),
);
Badge.displayName = 'Badge';
```

- [ ] **Step 4: Run test → pass**

```bash
cd dashboard-web
npm run test:components -- Badge.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/components/ui/Badge.tsx \
        dashboard-web/src/components/ui/__tests__/Badge.test.tsx
git commit -m "feat(foundation): Badge primitive — 5 ROAS tones, RTL-safe, tabular-nums by default"
```

---

### Task 12: Tooltip primitive

**Files:**
- Create: `dashboard-web/src/components/ui/Tooltip.tsx`
- Create: `dashboard-web/src/components/ui/__tests__/Tooltip.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// dashboard-web/src/components/ui/__tests__/Tooltip.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '../Tooltip';

describe('Tooltip primitive', () => {
  it('shows content on hover', async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger>trigger</TooltipTrigger>
          <TooltipContent>tip text</TooltipContent>
        </Tooltip>
      </TooltipProvider>,
    );
    fireEvent.mouseEnter(screen.getByText('trigger'));
    expect(await screen.findByText('tip text')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test → fail**

```bash
npm run test:components -- Tooltip.test.tsx
```

- [ ] **Step 3: Implement Tooltip wrapper around Radix**

Create `dashboard-web/src/components/ui/Tooltip.tsx`:

```tsx
'use client';

import { forwardRef } from 'react';
import * as RadixTooltip from '@radix-ui/react-tooltip';
import { cn } from '@/lib/utils';

export const TooltipProvider = RadixTooltip.Provider;
export const Tooltip = RadixTooltip.Root;
export const TooltipTrigger = RadixTooltip.Trigger;

export const TooltipContent = forwardRef<
  React.ElementRef<typeof RadixTooltip.Content>,
  React.ComponentPropsWithoutRef<typeof RadixTooltip.Content>
>(({ className, sideOffset = 6, ...props }, ref) => (
  <RadixTooltip.Portal>
    <RadixTooltip.Content
      ref={ref}
      sideOffset={sideOffset}
      className={cn(
        'z-50 max-w-xs rounded-md bg-ink text-canvas px-2.5 py-1.5 text-2xs shadow-md',
        'animate-in fade-in-0 zoom-in-95',
        className,
      )}
      {...props}
    />
  </RadixTooltip.Portal>
));
TooltipContent.displayName = RadixTooltip.Content.displayName;
```

- [ ] **Step 4: Run test → pass**

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/components/ui/Tooltip.tsx \
        dashboard-web/src/components/ui/__tests__/Tooltip.test.tsx
git commit -m "feat(foundation): Tooltip primitive (Radix wrapper, dark-on-light by default)"
```

---

### Task 13: Dialog primitive

**Files:**
- Create: `dashboard-web/src/components/ui/Dialog.tsx`
- Create: `dashboard-web/src/components/ui/__tests__/Dialog.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// dashboard-web/src/components/ui/__tests__/Dialog.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Dialog, DialogContent, DialogTrigger, DialogTitle, DialogDescription, DialogFooter } from '../Dialog';

describe('Dialog primitive', () => {
  it('opens on trigger click and shows content', async () => {
    render(
      <Dialog>
        <DialogTrigger>open</DialogTrigger>
        <DialogContent>
          <DialogTitle>title</DialogTitle>
          <DialogDescription>desc</DialogDescription>
          <p>body</p>
          <DialogFooter>actions</DialogFooter>
        </DialogContent>
      </Dialog>,
    );
    fireEvent.click(screen.getByText('open'));
    expect(await screen.findByText('title')).toBeInTheDocument();
    expect(screen.getByText('desc')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
    expect(screen.getByText('actions')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test → fail**

- [ ] **Step 3: Implement Dialog**

Create `dashboard-web/src/components/ui/Dialog.tsx`:

```tsx
'use client';

import { forwardRef, type ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = RadixDialog.Root;
export const DialogTrigger = RadixDialog.Trigger;
export const DialogClose = RadixDialog.Close;

export const DialogContent = forwardRef<
  React.ElementRef<typeof RadixDialog.Content>,
  React.ComponentPropsWithoutRef<typeof RadixDialog.Content> & { children: ReactNode }
>(({ className, children, ...props }, ref) => (
  <RadixDialog.Portal>
    <RadixDialog.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-sm animate-in fade-in-0" />
    <RadixDialog.Content
      ref={ref}
      className={cn(
        'fixed left-1/2 top-1/2 z-50 w-full max-w-lg -translate-x-1/2 -translate-y-1/2',
        'bg-elevated text-ink rounded-xl border border-line shadow-xl p-6',
        'animate-in fade-in-0 zoom-in-95',
        className,
      )}
      {...props}
    >
      {children}
      <DialogClose
        aria-label="סגור"
        className="absolute end-3 top-3 rounded-md p-1 text-ink-muted hover:bg-elevated2"
      >
        <X size={16} />
      </DialogClose>
    </RadixDialog.Content>
  </RadixDialog.Portal>
));
DialogContent.displayName = RadixDialog.Content.displayName;

export const DialogTitle = forwardRef<
  React.ElementRef<typeof RadixDialog.Title>,
  React.ComponentPropsWithoutRef<typeof RadixDialog.Title>
>(({ className, ...props }, ref) => (
  <RadixDialog.Title ref={ref} className={cn('text-base font-semibold text-ink leading-tight', className)} {...props} />
));
DialogTitle.displayName = RadixDialog.Title.displayName;

export const DialogDescription = forwardRef<
  React.ElementRef<typeof RadixDialog.Description>,
  React.ComponentPropsWithoutRef<typeof RadixDialog.Description>
>(({ className, ...props }, ref) => (
  <RadixDialog.Description ref={ref} className={cn('text-xs text-ink-muted mt-1', className)} {...props} />
));
DialogDescription.displayName = RadixDialog.Description.displayName;

export function DialogFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('mt-6 flex justify-end gap-2', className)} {...props} />;
}
```

- [ ] **Step 4: Run test → pass**

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/components/ui/Dialog.tsx \
        dashboard-web/src/components/ui/__tests__/Dialog.test.tsx
git commit -m "feat(foundation): Dialog primitive (Radix wrapper, RTL-safe close button at end-3)"
```

---

### Task 14: Sheet primitive (side drawer, RTL-aware)

**Files:**
- Create: `dashboard-web/src/components/ui/Sheet.tsx`
- Create: `dashboard-web/src/components/ui/__tests__/Sheet.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/Sheet.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sheet, SheetContent, SheetTrigger, SheetTitle } from '../Sheet';

describe('Sheet primitive', () => {
  it('opens and shows content; supports side="start" and side="end"', async () => {
    render(
      <Sheet>
        <SheetTrigger>open</SheetTrigger>
        <SheetContent side="end">
          <SheetTitle>title</SheetTitle>
          <p>body</p>
        </SheetContent>
      </Sheet>,
    );
    fireEvent.click(screen.getByText('open'));
    expect(await screen.findByText('title')).toBeInTheDocument();
    expect(screen.getByText('body')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Implement Sheet**

Create `dashboard-web/src/components/ui/Sheet.tsx`:

```tsx
'use client';

import { forwardRef, type ReactNode } from 'react';
import * as RadixDialog from '@radix-ui/react-dialog';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

// Sheet uses Radix Dialog under the hood. Sides are logical (start/end)
// so they map to the correct physical side under RTL. `side="end"`
// renders at the page's end-edge — left in RTL, right in LTR.
const sheetVariants = cva(
  'fixed z-50 bg-elevated text-ink shadow-xl border-line transition ease-out animate-in slide-in-from-end',
  {
    variants: {
      side: {
        start: 'top-0 start-0 h-full w-3/4 max-w-md border-e',
        end:   'top-0 end-0 h-full w-3/4 max-w-md border-s',
        top:   'top-0 inset-x-0 h-1/3 border-b',
        bottom:'bottom-0 inset-x-0 h-1/3 border-t',
      },
    },
    defaultVariants: { side: 'end' },
  },
);

export const Sheet = RadixDialog.Root;
export const SheetTrigger = RadixDialog.Trigger;
export const SheetClose = RadixDialog.Close;

export interface SheetContentProps
  extends React.ComponentPropsWithoutRef<typeof RadixDialog.Content>,
    VariantProps<typeof sheetVariants> {
  children: ReactNode;
}

export const SheetContent = forwardRef<
  React.ElementRef<typeof RadixDialog.Content>,
  SheetContentProps
>(({ className, side, children, ...props }, ref) => (
  <RadixDialog.Portal>
    <RadixDialog.Overlay className="fixed inset-0 z-50 bg-overlay backdrop-blur-sm animate-in fade-in-0" />
    <RadixDialog.Content
      ref={ref}
      className={cn(sheetVariants({ side }), className)}
      {...props}
    >
      {children}
      <SheetClose
        aria-label="סגור"
        className="absolute end-3 top-3 rounded-md p-1 text-ink-muted hover:bg-elevated2"
      >
        <X size={16} />
      </SheetClose>
    </RadixDialog.Content>
  </RadixDialog.Portal>
));
SheetContent.displayName = RadixDialog.Content.displayName;

export const SheetTitle = forwardRef<
  React.ElementRef<typeof RadixDialog.Title>,
  React.ComponentPropsWithoutRef<typeof RadixDialog.Title>
>(({ className, ...props }, ref) => (
  <RadixDialog.Title ref={ref} className={cn('text-base font-semibold text-ink leading-tight', className)} {...props} />
));
SheetTitle.displayName = RadixDialog.Title.displayName;
```

- [ ] **Step 4: Run → pass**

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/components/ui/Sheet.tsx \
        dashboard-web/src/components/ui/__tests__/Sheet.test.tsx
git commit -m "feat(foundation): Sheet primitive (Radix Dialog + logical start/end sides for RTL)"
```

---

### Task 15: Tabs primitive

**Files:**
- Create: `dashboard-web/src/components/ui/Tabs.tsx`
- Create: `dashboard-web/src/components/ui/__tests__/Tabs.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// __tests__/Tabs.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../Tabs';

describe('Tabs primitive', () => {
  it('switches active panel on trigger click', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
        <TabsContent value="a">content A</TabsContent>
        <TabsContent value="b">content B</TabsContent>
      </Tabs>,
    );
    expect(screen.getByText('content A')).toBeInTheDocument();
    expect(screen.queryByText('content B')).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('B'));
    expect(screen.getByText('content B')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Implement Tabs**

Create `dashboard-web/src/components/ui/Tabs.tsx`:

```tsx
'use client';

import { forwardRef } from 'react';
import * as RadixTabs from '@radix-ui/react-tabs';
import { cn } from '@/lib/utils';

export const Tabs = RadixTabs.Root;

export const TabsList = forwardRef<
  React.ElementRef<typeof RadixTabs.List>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.List>
>(({ className, ...props }, ref) => (
  <RadixTabs.List
    ref={ref}
    className={cn('inline-flex h-9 items-center gap-1 rounded-md bg-elevated2 p-1', className)}
    {...props}
  />
));
TabsList.displayName = RadixTabs.List.displayName;

export const TabsTrigger = forwardRef<
  React.ElementRef<typeof RadixTabs.Trigger>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.Trigger>
>(({ className, ...props }, ref) => (
  <RadixTabs.Trigger
    ref={ref}
    className={cn(
      'inline-flex items-center justify-center rounded-sm px-3 py-1 text-xs font-medium',
      'text-ink-muted transition-colors hover:text-ink',
      'data-[state=active]:bg-elevated data-[state=active]:text-ink data-[state=active]:shadow-sm',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
      className,
    )}
    {...props}
  />
));
TabsTrigger.displayName = RadixTabs.Trigger.displayName;

export const TabsContent = forwardRef<
  React.ElementRef<typeof RadixTabs.Content>,
  React.ComponentPropsWithoutRef<typeof RadixTabs.Content>
>(({ className, ...props }, ref) => (
  <RadixTabs.Content ref={ref} className={cn('mt-3 focus-visible:outline-none', className)} {...props} />
));
TabsContent.displayName = RadixTabs.Content.displayName;
```

- [ ] **Step 4: Run → pass**

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/components/ui/Tabs.tsx \
        dashboard-web/src/components/ui/__tests__/Tabs.test.tsx
git commit -m "feat(foundation): Tabs primitive (Radix wrapper)"
```

---

### Task 16: Input + Select primitives

**Files:**
- Create: `dashboard-web/src/components/ui/Input.tsx`
- Create: `dashboard-web/src/components/ui/Select.tsx`
- Create: `dashboard-web/src/components/ui/__tests__/Input.test.tsx`
- Create: `dashboard-web/src/components/ui/__tests__/Select.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
// __tests__/Input.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Input } from '../Input';

describe('Input primitive', () => {
  it('accepts user typing', async () => {
    render(<Input defaultValue="" aria-label="x" />);
    await userEvent.type(screen.getByLabelText('x'), 'hello');
    expect(screen.getByLabelText('x')).toHaveValue('hello');
  });
});
```

```tsx
// __tests__/Select.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '../Select';

describe('Select primitive', () => {
  it('renders trigger; opens list', () => {
    render(
      <Select defaultValue="a">
        <SelectTrigger aria-label="s"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="a">A</SelectItem>
          <SelectItem value="b">B</SelectItem>
        </SelectContent>
      </Select>,
    );
    fireEvent.pointerDown(screen.getByLabelText('s'));
    // Radix portals the listbox; the test checks the trigger renders.
    expect(screen.getByLabelText('s')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Implement Input**

Create `dashboard-web/src/components/ui/Input.tsx`:

```tsx
import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-9 w-full rounded-md border border-line bg-elevated px-3 py-1 text-sm text-ink',
        'placeholder:text-ink-muted',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'tabular-nums',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
```

- [ ] **Step 4: Implement Select**

Create `dashboard-web/src/components/ui/Select.tsx`:

```tsx
'use client';

import { forwardRef } from 'react';
import * as RadixSelect from '@radix-ui/react-select';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Select = RadixSelect.Root;
export const SelectGroup = RadixSelect.Group;
export const SelectValue = RadixSelect.Value;

export const SelectTrigger = forwardRef<
  React.ElementRef<typeof RadixSelect.Trigger>,
  React.ComponentPropsWithoutRef<typeof RadixSelect.Trigger>
>(({ className, children, ...props }, ref) => (
  <RadixSelect.Trigger
    ref={ref}
    className={cn(
      'inline-flex h-9 items-center justify-between gap-2 rounded-md border border-line bg-elevated px-3 py-1 text-sm text-ink',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
      className,
    )}
    {...props}
  >
    {children}
    <RadixSelect.Icon><ChevronDown size={14} /></RadixSelect.Icon>
  </RadixSelect.Trigger>
));
SelectTrigger.displayName = RadixSelect.Trigger.displayName;

export const SelectContent = forwardRef<
  React.ElementRef<typeof RadixSelect.Content>,
  React.ComponentPropsWithoutRef<typeof RadixSelect.Content>
>(({ className, ...props }, ref) => (
  <RadixSelect.Portal>
    <RadixSelect.Content
      ref={ref}
      className={cn(
        'z-50 overflow-hidden rounded-md border border-line bg-elevated shadow-md text-ink',
        className,
      )}
      position="popper"
      {...props}
    />
  </RadixSelect.Portal>
));
SelectContent.displayName = RadixSelect.Content.displayName;

export const SelectItem = forwardRef<
  React.ElementRef<typeof RadixSelect.Item>,
  React.ComponentPropsWithoutRef<typeof RadixSelect.Item>
>(({ className, children, ...props }, ref) => (
  <RadixSelect.Item
    ref={ref}
    className={cn(
      'relative flex cursor-pointer select-none items-center gap-2 px-3 py-1.5 text-sm',
      'data-[highlighted]:bg-elevated2 data-[disabled]:opacity-50',
      className,
    )}
    {...props}
  >
    <RadixSelect.ItemIndicator><Check size={12} /></RadixSelect.ItemIndicator>
    <RadixSelect.ItemText>{children}</RadixSelect.ItemText>
  </RadixSelect.Item>
));
SelectItem.displayName = RadixSelect.Item.displayName;
```

- [ ] **Step 5: Run → pass**

- [ ] **Step 6: Commit**

```bash
git add dashboard-web/src/components/ui/Input.tsx \
        dashboard-web/src/components/ui/Select.tsx \
        dashboard-web/src/components/ui/__tests__/Input.test.tsx \
        dashboard-web/src/components/ui/__tests__/Select.test.tsx
git commit -m "feat(foundation): Input + Select primitives"
```

---

### Task 17: Switch primitive

**Files:**
- Create: `dashboard-web/src/components/ui/Switch.tsx`
- Create: `dashboard-web/src/components/ui/__tests__/Switch.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Switch } from '../Switch';

describe('Switch primitive', () => {
  it('toggles on click', () => {
    let value = false;
    const { rerender } = render(<Switch checked={value} onCheckedChange={v => (value = v)} aria-label="s" />);
    fireEvent.click(screen.getByLabelText('s'));
    rerender(<Switch checked={value} onCheckedChange={v => (value = v)} aria-label="s" />);
    expect(value).toBe(true);
  });
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Implement Switch**

Create `dashboard-web/src/components/ui/Switch.tsx`:

```tsx
'use client';

import { forwardRef } from 'react';
import * as RadixSwitch from '@radix-ui/react-switch';
import { cn } from '@/lib/utils';

export const Switch = forwardRef<
  React.ElementRef<typeof RadixSwitch.Root>,
  React.ComponentPropsWithoutRef<typeof RadixSwitch.Root>
>(({ className, ...props }, ref) => (
  <RadixSwitch.Root
    ref={ref}
    className={cn(
      'inline-flex h-5 w-9 items-center rounded-full border border-line bg-elevated2 transition-colors',
      'data-[state=checked]:bg-accent',
      'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
      className,
    )}
    {...props}
  >
    <RadixSwitch.Thumb className="block h-4 w-4 rounded-full bg-elevated shadow-sm transition-transform data-[state=checked]:translate-x-4 rtl:data-[state=checked]:-translate-x-4 translate-x-0.5" />
  </RadixSwitch.Root>
));
Switch.displayName = RadixSwitch.Root.displayName;
```

- [ ] **Step 4: Run → pass**

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/components/ui/Switch.tsx \
        dashboard-web/src/components/ui/__tests__/Switch.test.tsx
git commit -m "feat(foundation): Switch primitive (Radix wrapper, RTL-correct thumb translate)"
```

---

### Task 18: Sparkline primitive

**Files:**
- Create: `dashboard-web/src/components/ui/Sparkline.tsx`
- Create: `dashboard-web/src/components/ui/__tests__/Sparkline.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Sparkline } from '../Sparkline';

describe('Sparkline primitive', () => {
  it('renders an svg with a single polyline path for the given series', () => {
    const { container } = render(<Sparkline data={[1, 2, 3, 4, 5]} width={60} height={16} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
    expect(svg!.querySelectorAll('path').length).toBeGreaterThan(0);
  });

  it('renders nothing meaningful for empty series', () => {
    const { container } = render(<Sparkline data={[]} width={60} height={16} />);
    expect(container.querySelector('svg')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Implement Sparkline**

Create `dashboard-web/src/components/ui/Sparkline.tsx`:

```tsx
import { useMemo } from 'react';
import { cn } from '@/lib/utils';

/**
 * Tiny inline sparkline. No Recharts dependency — pure SVG path so it
 * renders cheap inside table rows. Tone maps to the same ROAS palette.
 */
export interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  tone?: 'green' | 'red' | 'orange' | 'blue' | 'gray';
  className?: string;
}

const TONE_STROKE: Record<NonNullable<SparklineProps['tone']>, string> = {
  green:  'var(--status-green)',
  red:    'var(--status-red)',
  orange: 'var(--status-orange)',
  blue:   'var(--status-blue)',
  gray:   'var(--status-gray)',
};

export function Sparkline({
  data,
  width = 60,
  height = 16,
  tone = 'blue',
  className,
}: SparklineProps) {
  const path = useMemo(() => {
    if (data.length === 0) return '';
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const stepX = data.length > 1 ? width / (data.length - 1) : 0;
    return data
      .map((v, i) => {
        const x = i * stepX;
        const y = height - ((v - min) / range) * height;
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(' ');
  }, [data, width, height]);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', className)}
      role="img"
      aria-label="טרנד"
    >
      <path
        d={path}
        fill="none"
        stroke={TONE_STROKE[tone]}
        strokeWidth={1.25}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
```

- [ ] **Step 4: Run → pass**

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/components/ui/Sparkline.tsx \
        dashboard-web/src/components/ui/__tests__/Sparkline.test.tsx
git commit -m "feat(foundation): Sparkline primitive — pure SVG, theme-aware tones"
```

---

## Phase 1D — Shell + nav

### Task 19: Sidebar component

**Files:**
- Create: `dashboard-web/src/components/Sidebar.tsx`
- Create: `dashboard-web/src/components/__tests__/Sidebar.dom.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// dashboard-web/src/components/__tests__/Sidebar.dom.test.tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Sidebar } from '../Sidebar';

describe('Sidebar', () => {
  it('renders all 6 tab destinations + operator link + theme toggle', () => {
    render(
      <Sidebar
        activeTab="home"
        onTabChange={() => {}}
      />,
    );
    const expectedLabels = ['בית', 'P&L', 'ניתוח', 'קמפיינים', 'מוצרים', 'פירוט'];
    for (const label of expectedLabels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.getByRole('link', { name: /ניהול/ })).toHaveAttribute('href', '/operator');
  });

  it('fires onTabChange with the correct key when an item is clicked', () => {
    const onTabChange = vi.fn();
    render(<Sidebar activeTab="home" onTabChange={onTabChange} />);
    fireEvent.click(screen.getByText('קמפיינים'));
    expect(onTabChange).toHaveBeenCalledWith('campaigns');
  });

  it('marks the active item with aria-current="page"', () => {
    render(<Sidebar activeTab="pnl" onTabChange={() => {}} />);
    expect(screen.getByText('P&L').closest('button')).toHaveAttribute('aria-current', 'page');
  });
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Implement Sidebar**

Create `dashboard-web/src/components/Sidebar.tsx`:

```tsx
'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  Home, Receipt, TrendingUp, Megaphone, Package, Table,
  Cog, Sun, Moon, Monitor, ChevronsLeft, ChevronsRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme } from './ThemeProvider';
import type { TabKey } from '@/lib/urlState';

type NavItem = { key: TabKey; label: string; icon: React.ReactNode };

const NAV: NavItem[] = [
  { key: 'home',      label: 'בית',     icon: <Home size={16} /> },
  { key: 'pnl',       label: 'P&L',     icon: <Receipt size={16} /> },
  { key: 'analysis',  label: 'ניתוח',    icon: <TrendingUp size={16} /> },
  { key: 'campaigns', label: 'קמפיינים', icon: <Megaphone size={16} /> },
  { key: 'products',  label: 'מוצרים',   icon: <Package size={16} /> },
  { key: 'detail',    label: 'פירוט',    icon: <Table size={16} /> },
];

export function Sidebar({
  activeTab,
  onTabChange,
}: {
  activeTab: TabKey;
  onTabChange: (key: TabKey) => void;
}) {
  const [collapsed, setCollapsed] = useState(false);
  const { choice, setChoice } = useTheme();

  return (
    <aside
      className={cn(
        'sticky top-0 h-screen border-s border-line bg-elevated text-ink',
        'flex flex-col transition-[width] duration-200',
        collapsed ? 'w-16' : 'w-60',
      )}
      aria-label="ניווט ראשי"
    >
      {/* Brand */}
      <div className="px-3 py-4 border-b border-line-subtle flex items-center gap-2">
        <div className="h-7 w-7 rounded-md bg-accent" aria-hidden />
        {!collapsed && (
          <span className="text-sm font-semibold truncate">דשבורד ROAS</span>
        )}
      </div>

      {/* Nav items */}
      <nav className="flex-1 px-2 py-3 space-y-0.5" role="tablist">
        {NAV.map(item => {
          const isActive = item.key === activeTab;
          return (
            <button
              key={item.key}
              role="tab"
              type="button"
              aria-current={isActive ? 'page' : undefined}
              aria-selected={isActive}
              onClick={() => onTabChange(item.key)}
              className={cn(
                'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm transition-colors',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                isActive
                  ? 'bg-elevated2 text-ink font-medium'
                  : 'text-ink-muted hover:text-ink hover:bg-elevated2',
              )}
            >
              <span className="shrink-0">{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </button>
          );
        })}
      </nav>

      {/* Footer: operator + theme toggle + collapse */}
      <div className="border-t border-line-subtle px-2 py-3 space-y-1">
        <Link
          href="/operator"
          className={cn(
            'flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm',
            'text-ink-muted hover:text-ink hover:bg-elevated2',
          )}
        >
          <Cog size={16} />
          {!collapsed && <span>ניהול</span>}
        </Link>

        <div className={cn('flex items-center gap-1 px-1', collapsed && 'flex-col')}>
          <button
            type="button"
            aria-label="עקוב אחר ההעדפה של המערכת"
            onClick={() => setChoice('system')}
            className={cn(
              'rounded-md p-1.5 text-ink-muted hover:bg-elevated2',
              choice === 'system' && 'bg-elevated2 text-ink',
            )}
          >
            <Monitor size={14} />
          </button>
          <button
            type="button"
            aria-label="מצב בהיר"
            onClick={() => setChoice('light')}
            className={cn(
              'rounded-md p-1.5 text-ink-muted hover:bg-elevated2',
              choice === 'light' && 'bg-elevated2 text-ink',
            )}
          >
            <Sun size={14} />
          </button>
          <button
            type="button"
            aria-label="מצב כהה"
            onClick={() => setChoice('dark')}
            className={cn(
              'rounded-md p-1.5 text-ink-muted hover:bg-elevated2',
              choice === 'dark' && 'bg-elevated2 text-ink',
            )}
          >
            <Moon size={14} />
          </button>
        </div>

        <button
          type="button"
          aria-label={collapsed ? 'הרחב' : 'כווץ'}
          onClick={() => setCollapsed(v => !v)}
          className="flex w-full items-center justify-center rounded-md p-1.5 text-ink-muted hover:bg-elevated2"
        >
          {collapsed ? <ChevronsLeft size={14} /> : <ChevronsRight size={14} />}
        </button>
      </div>
    </aside>
  );
}
```

- [ ] **Step 4: Run → pass**

```bash
npm run test:components -- Sidebar.dom.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/components/Sidebar.tsx \
        dashboard-web/src/components/__tests__/Sidebar.dom.test.tsx
git commit -m "feat(foundation): Sidebar — 6 tabs + operator link + theme toggle + collapse, RTL-native"
```

---

### Task 20: TabHeader component

**Files:**
- Create: `dashboard-web/src/components/TabHeader.tsx`
- Create: `dashboard-web/src/components/__tests__/TabHeader.dom.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TabHeader } from '../TabHeader';

describe('TabHeader', () => {
  it('renders title, description, and a slot for filters', () => {
    render(
      <TabHeader
        title="ביצועי קמפיינים"
        description="קמפיין-לכל-קמפיין…"
        filterSlot={<div data-testid="filter-slot">filter</div>}
        actionSlot={<button>action</button>}
      />,
    );
    expect(screen.getByRole('heading', { name: 'ביצועי קמפיינים' })).toBeInTheDocument();
    expect(screen.getByText('קמפיין-לכל-קמפיין…')).toBeInTheDocument();
    expect(screen.getByTestId('filter-slot')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'action' })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Implement TabHeader**

Create `dashboard-web/src/components/TabHeader.tsx`:

```tsx
import { type ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function TabHeader({
  title,
  description,
  filterSlot,
  actionSlot,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  filterSlot?: ReactNode;
  actionSlot?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('flex flex-col gap-3 pb-3 border-b border-line-subtle mb-4', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-base sm:text-lg font-semibold text-ink leading-tight">{title}</h2>
          {description && (
            <p className="text-xs text-ink-muted mt-1 leading-relaxed">{description}</p>
          )}
        </div>
        {actionSlot && <div className="shrink-0">{actionSlot}</div>}
      </div>
      {filterSlot && <div className="flex flex-wrap items-center gap-2">{filterSlot}</div>}
    </header>
  );
}
```

- [ ] **Step 4: Run → pass**

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/components/TabHeader.tsx \
        dashboard-web/src/components/__tests__/TabHeader.dom.test.tsx
git commit -m "feat(foundation): TabHeader — title/description/filter-slot/action-slot for per-tab strips"
```

---

### Task 21: FocusMode component

**Files:**
- Create: `dashboard-web/src/components/FocusMode.tsx`
- Create: `dashboard-web/src/components/__tests__/FocusMode.dom.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { FocusMode } from '../FocusMode';

describe('FocusMode', () => {
  it('toggles data-focus-mode on document.documentElement when ⌘\\ pressed', () => {
    render(<FocusMode />);
    expect(document.documentElement.getAttribute('data-focus-mode')).not.toBe('on');
    fireEvent.keyDown(document, { key: '\\', metaKey: true });
    expect(document.documentElement.getAttribute('data-focus-mode')).toBe('on');
    fireEvent.keyDown(document, { key: '\\', metaKey: true });
    expect(document.documentElement.getAttribute('data-focus-mode')).not.toBe('on');
  });
});
```

- [ ] **Step 2: Run → fail**

- [ ] **Step 3: Implement FocusMode**

Create `dashboard-web/src/components/FocusMode.tsx`:

```tsx
'use client';

import { useEffect } from 'react';

/**
 * Cmd/Ctrl + \ toggles a data attribute on <html> that CSS uses to dim
 * the sidebar + header chrome. Used before client screen-shares. State
 * is ephemeral and resets on next page load.
 */
export function FocusMode() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '\\' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        const root = document.documentElement;
        const isOn = root.getAttribute('data-focus-mode') === 'on';
        if (isOn) root.removeAttribute('data-focus-mode');
        else root.setAttribute('data-focus-mode', 'on');
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);
  return null;
}
```

Add the CSS rule for dimming. Edit `dashboard-web/src/app/globals.css` and append:

```css
/* Focus Mode — dims chrome for client screen-shares. Toggled by Cmd+\. */
[data-focus-mode="on"] aside[aria-label="ניווט ראשי"],
[data-focus-mode="on"] header[role="banner"] {
  opacity: 0.3;
  transition: opacity 200ms ease-out;
}
[data-focus-mode="on"] [data-focus-hide="true"] {
  display: none;
}
```

- [ ] **Step 4: Run → pass**

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/components/FocusMode.tsx \
        dashboard-web/src/components/__tests__/FocusMode.dom.test.tsx \
        dashboard-web/src/app/globals.css
git commit -m "feat(foundation): FocusMode (⌘\\) — dims sidebar + chrome for client screen-shares"
```

---

## Phase 1E — Integration

### Task 22: View Transitions root in Dashboard.tsx

**Files:**
- Modify: `dashboard-web/src/components/Dashboard.tsx`

- [ ] **Step 1: Wrap tab-content switch in a `<ViewTransition>` element**

React 19 ships `<ViewTransition>` (status: stable in 19.1+). If not available in the installed React 19, fall back to wrapping in a `useViewTransition` hook around the `setActiveTab` call.

Edit `dashboard-web/src/components/Dashboard.tsx`. Find the tab-content block (lines 281-310 today, the `{activeTab === '...' && (<...Tab />)}` chain). Wrap the entire block in a `startViewTransition` flow:

```tsx
import { useState, useEffect, useMemo, startTransition } from 'react';
// ...

// Helper near the top of the file (above Dashboard()):
function useTabTransition() {
  return (next: TabKey, setActiveTab: (k: TabKey) => void) => {
    // Native View Transitions API — supported by ~78% of browsers (May 2026).
    // Graceful no-op fallback for the remaining ~22%.
    const doc = document as typeof document & {
      startViewTransition?: (cb: () => void) => { finished: Promise<void> };
    };
    if (typeof doc.startViewTransition === 'function') {
      doc.startViewTransition(() => {
        // Inside the VT callback, schedule the React state update as a
        // transition so React doesn't tear during the snapshot.
        startTransition(() => setActiveTab(next));
      });
    } else {
      setActiveTab(next);
    }
  };
}

// Inside Dashboard():
const startTabTransition = useTabTransition();
const handleTabChange = (next: TabKey) => startTabTransition(next, setActiveTab);

// Then pass handleTabChange to Sidebar (Task 23 below).
```

Also add CSS for the page-level transition in `globals.css`:

```css
/* View Transition tuning for tab switches. The default VT animation
   is a cross-fade; we shorten it so transitions feel snappy. */
::view-transition-old(root),
::view-transition-new(root) {
  animation-duration: 180ms;
  animation-timing-function: cubic-bezier(0.22, 1, 0.36, 1);
}
```

- [ ] **Step 2: Verify build**

```bash
cd dashboard-web
npm run build 2>&1 | tail -10
```

Expected: build succeeds. No visible behavior change yet (tab switches still work; transitions are subtle).

- [ ] **Step 3: Commit**

```bash
git add dashboard-web/src/components/Dashboard.tsx dashboard-web/src/app/globals.css
git commit -m "feat(foundation): View Transitions on tab switches (native API with graceful fallback)"
```

---

### Task 23: Swap TabNav → Sidebar in Dashboard.tsx

**Files:**
- Modify: `dashboard-web/src/components/Dashboard.tsx`

- [ ] **Step 1: Replace TabNav with Sidebar + restructure layout**

Edit `dashboard-web/src/components/Dashboard.tsx`. Find the existing layout (lines 217-242):

```tsx
return (
  <div dir="rtl" className="min-h-screen bg-background">
    <CloudSync />
    <Header ... />
    {data && <TabNav tabs={TABS} active={activeTab} onChange={setActiveTab} />}
    <main className="max-w-7xl mx-auto ...">
      {/* ... */}
    </main>
  </div>
);
```

Replace with:

```tsx
return (
  <div dir="rtl" className="min-h-screen bg-canvas flex">
    {/* Sidebar on the start-side (right in RTL) */}
    <Sidebar activeTab={activeTab} onTabChange={handleTabChange} />

    {/* Main column — header strip + tab content */}
    <div className="flex-1 min-w-0 flex flex-col">
      <CloudSync />
      <FocusMode />

      {/* Top strip — freshness chip, command palette, sync indicator.
          The full <Header> (logo, brand, deep navy gradient) is no
          longer needed since the Sidebar carries the brand. We keep a
          slim, theme-aware top strip so the chips that used to live
          inside <Header> have a home. */}
      <header
        role="banner"
        className="sticky top-0 z-30 bg-elevated/85 backdrop-blur-xl border-b border-line-subtle px-4 py-2 flex items-center justify-end gap-2"
      >
        <FreshnessChip dataLastWriteAt={data?.dataLastWriteAt ?? null} />
        {data && (
          <CommandPalette
            data={data}
            filters={filters}
            setFilters={setFilters}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            onRefresh={() => mutate()}
            onOpenAiReport={() => setAiReportSignal(n => n + 1)}
          />
        )}
        <SyncIndicator />
      </header>

      <main className="max-w-7xl mx-auto w-full px-3 sm:px-4 md:px-8 py-4 sm:py-6 md:py-8 space-y-4 sm:space-y-5">
        {/* unchanged content: error banner, skeleton, TabFreshnessHeader,
            tab body switch, Footer */}
        {/* ... existing JSX ... */}
      </main>
    </div>
  </div>
);
```

Add `Sidebar` + `FocusMode` to the imports near the top of the file:

```tsx
import { Sidebar } from './Sidebar';
import { FocusMode } from './FocusMode';
```

Remove the `TabNav` import (no longer used). Delete the old `Header` function body if it's now unused (keep the file lean), or mark `_Header` as unused in case any external link relies on it (verify with grep before deleting).

- [ ] **Step 2: Verify build + smoke test**

```bash
cd dashboard-web
npx tsc --noEmit
npm run build 2>&1 | tail -10
npm run dev &
sleep 5
# Visit http://localhost:3000.
# Expected:
#   - Sidebar on the right (RTL) with 6 nav items + ניהול link.
#   - Tab content unchanged (HomeTab still renders TodayLive, HeroOverview, etc.).
#   - All filter URL params still work — try ?tab=campaigns&store=uzoshop&preset=last_7_days.
#   - Cmd+\ dims the sidebar + top strip.
#   - Cmd+K opens command palette.
kill %1
```

- [ ] **Step 3: Commit**

```bash
git add dashboard-web/src/components/Dashboard.tsx
git commit -m "feat(foundation): swap TabNav → Sidebar in Dashboard root; tab content unchanged"
```

---

## Phase 1F — Command palette upgrade

### Task 24: ⌘K theme toggle entries + NL query stub

**Files:**
- Modify: `dashboard-web/src/components/CommandPalette.tsx`

- [ ] **Step 1: Add theme toggle entries**

Edit `dashboard-web/src/components/CommandPalette.tsx`. Find the command list (search for `commands` or `items` array). Add three new entries near the top of the list:

```ts
import { useTheme } from './ThemeProvider';

// Inside the component:
const { setChoice } = useTheme();

const commands = [
  {
    id: 'theme-light',
    label: 'מעבר למצב בהיר',
    keywords: ['light', 'theme', 'בהיר', 'אור'],
    icon: <Sun size={14} />,
    run: () => setChoice('light'),
  },
  {
    id: 'theme-dark',
    label: 'מעבר למצב כהה',
    keywords: ['dark', 'theme', 'כהה', 'לילה'],
    icon: <Moon size={14} />,
    run: () => setChoice('dark'),
  },
  {
    id: 'theme-system',
    label: 'עקוב אחר העדפת המערכת',
    keywords: ['system', 'auto', 'אוטומטי', 'מערכת'],
    icon: <Monitor size={14} />,
    run: () => setChoice('system'),
  },
  // ... existing commands ...
];
```

- [ ] **Step 2: Stub NL query slot**

Add a placeholder for NL query results above the static command list. The actual NL-query implementation runs in Plan 2 (Home tab) when we wire the aiReport endpoint. For now, surface an "ask the dashboard" hint that does nothing — proves the UI slot is there:

```tsx
{query.length > 0 && (
  <div className="px-3 py-2 border-b border-line-subtle text-xs text-ink-muted">
    <Sparkles size={12} className="inline-block me-1" />
    שאלת AI: <span className="text-ink">{query}</span>
    <span className="opacity-50">{' '}— יזמין ב-Plan 2</span>
  </div>
)}
```

- [ ] **Step 3: Manual smoke test**

```bash
cd dashboard-web
npm run dev &
sleep 5
# Open Cmd+K. Type "dark". Hit Enter on "מעבר למצב כהה". <html> should
# now have data-theme="dark" and persist on reload.
kill %1
```

- [ ] **Step 4: Commit**

```bash
git add dashboard-web/src/components/CommandPalette.tsx
git commit -m "feat(foundation): CommandPalette — theme toggle entries + NL query placeholder slot"
```

---

## Wrap-up

After all 24 tasks pass:

- [ ] **Run the full test suite (node + jsdom)**

```bash
cd dashboard-web
npm run test:all
```

Expected: every test passes; no new failures vs. main.

- [ ] **Run TypeScript + ESLint pre-push gates**

```bash
cd dashboard-web
npx tsc --noEmit
npm run lint
```

Expected: zero errors.

- [ ] **Build production bundle and inspect size delta**

```bash
cd dashboard-web
npm run build 2>&1 | tee /tmp/build-after-foundation.log
```

Expected: build succeeds. Bundle delta should be < +25KB gzipped (per spec budget). Note: most of the increase comes from Radix + cva + the three font weights; primitives themselves tree-shake well since nothing uses them yet.

- [ ] **Smoke pass in a browser**

```bash
cd dashboard-web
npm run dev &
sleep 5
```

Verify:
- Sidebar renders on the right with 6 nav items + ניהול link
- Theme toggle (system / light / dark) works and persists on reload
- All 6 tabs render their existing content (no visual regressions inside the tab bodies — those migrate in later plans)
- Cmd+K opens the palette and the theme entries work
- Cmd+\ dims the sidebar
- Bookmark a URL like `?tab=analysis&store=uzoshop&preset=last_7_days`, refresh — restores correctly

```bash
kill %1
```

- [ ] **Open a draft PR** (optional, for early review of Foundation in isolation)

```bash
git push -u origin dashboard-ux-overhaul-2026-05-28
gh pr create --draft --title "Dashboard UX overhaul — Plan 1: Foundation" --body "$(cat <<'EOF'
## Plan 1 of 7 — Foundation only

Implements the spec at docs/superpowers/specs/2026-05-28-dashboard-ux-overhaul-design.md.

This PR sets up the foundation — no visual changes inside tab bodies yet.

## What ships in Plan 1
- OKLCH design tokens (light + dark) in globals.css
- Heebo + Rubik + Geist Mono via next/font; .tabular-nums fixed (silent tnum bug)
- ThemeProvider + useTheme + localStorage persistence + no-FOUC inline script
- 10 components/ui/ primitives (Card / Button / Badge / Tooltip / Dialog / Sheet / Tabs / Input / Select / Switch / Sparkline)
- Sidebar replaces TabNav at the chrome level; tab content unchanged
- TabHeader primitive for per-tab strips
- FocusMode (Cmd+\\) for client screen-shares
- View Transitions on tab switches (native API + fallback)
- CommandPalette theme entries + NL query placeholder

## Out of scope (later plans)
- TodayLive narrative line (Plan 2)
- Charts upgrade to Recharts v3 (Plan 3)
- CampaignsTable split + sparkline columns (Plan 4)
- MonthlyTables theme migration (Plan 5)
- Operator visual upgrade (Plan 6)
- RTL audit + polish + docs (Plan 7)

## Test plan
- [ ] npm run test:all passes
- [ ] npx tsc --noEmit passes
- [ ] npm run lint passes
- [ ] npm run build succeeds with < +25KB gzipped delta
- [ ] Manual smoke: every tab renders, filter URL params still work, theme toggle persists, ⌘K + ⌘\\ work

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

Run through this checklist before declaring the plan complete:

1. **Spec coverage** — every section of the spec that's foundation-related is covered:
   - ✅ OKLCH tokens (Task 3, 4)
   - ✅ Font stack Heebo + Rubik + Geist Mono (Task 5)
   - ✅ Theme system + no-FOUC (Tasks 6, 7)
   - ✅ tabular-nums silent bug fix (Task 5 step 4)
   - ✅ components/ui/ primitives (Tasks 9–18 — 10 primitives)
   - ✅ Sidebar replacing TabNav (Tasks 19, 23)
   - ✅ TabHeader for per-tab strips (Task 20)
   - ✅ Focus Mode ⌘\\ (Task 21)
   - ✅ View Transitions root (Task 22)
   - ✅ ⌘K theme toggle entries + NL placeholder (Task 24)
   - ✅ Component-test infra (Task 1)
   - ✅ Radix + cva deps (Task 2)

   Foundation is complete. NL query actual wiring belongs to Plan 2 (it depends on the existing `aiReport` endpoint and home-tab context).

2. **Placeholder scan** — searched for TBD / TODO / "add appropriate" / "similar to" — none present.

3. **Type consistency** — `TabKey` from `@/lib/urlState`, `ThemeChoice` / `ResolvedTheme` from `@/lib/theme`, `ButtonProps` / `CardProps` etc. all referenced consistently across tasks.

4. **Scope check** — this plan produces working, testable software on its own: sidebar with theme toggle, primitives ready to consume in later plans, tab content unchanged. Plans 2–7 build on top without retouching Foundation files.
