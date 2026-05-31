# Premium 2026 Dashboard Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Take the dashboard from "good engineering, decent design" to premium 2026 command-center tier (Linear / Vercel Geist / Stripe / PostHog) by deleting the legacy color palette, enforcing primitive adoption, restructuring Home, sweeping RTL gaps, splitting the 1619-line CampaignDrawer, and adding a visual-regression CI gate — all consistent with the 10 design decisions locked on 2026-05-31.

**Architecture:** Six implementation waves, each a discrete sub-section. Wave 1 establishes the new token/color foundation. Wave 2 forces primitive adoption via codemod + ESLint. Wave 3 recomposes Home + adds the per-page synthesis layer. Wave 4 sweeps RTL/bidi P0 bugs. Wave 5 polishes per-page and splits the CampaignDrawer. Wave 6 adds motion vocabulary + Playwright visual-regression CI. Single mega-PR matching the user's prior pattern.

**Tech Stack:** Next.js 14 App Router, Tailwind, OKLCH CSS variables, shadcn-style primitives, vitest+jsdom for tests, ESLint custom rules, Playwright + `@playwright/test` image snapshots for visual regression.

---

## Wave 1 — Token & Color System (foundation)

### Task 1.1: Add platform-brand-mirrored chart color tokens

**Files:**
- Modify: `dashboard-web/src/app/globals.css` (`:root` block ~lines 42-50 + dark block ~lines 157-165)
- Test: `dashboard-web/src/lib/__tests__/chartTokens.test.ts` (new)

**Steps:**

- [ ] **Step 1: Write failing test.** Create `chartTokens.test.ts` asserting that every platform CSS var is defined in both `:root` and `[data-theme="dark"]` and that no two platform hues collide within 13° at the same chroma:

  ```ts
  import { readFileSync } from 'fs';
  import { describe, it, expect } from 'vitest';

  describe('chart platform tokens — brand-mirrored', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    const platforms = ['meta', 'google', 'tiktok', 'organic', 'shopify'];

    it('every platform token has both light and dark definition', () => {
      const rootBlock = css.match(/:root\s*\{[\s\S]+?\n\}/)![0];
      const darkBlock = css.match(/\[data-theme="dark"\]\s*\{[\s\S]+?\n\}/)![0];
      for (const p of platforms) {
        expect(rootBlock).toMatch(new RegExp(`--chart-platform-${p}\\s*:`));
        expect(darkBlock).toMatch(new RegExp(`--chart-platform-${p}\\s*:`));
      }
    });

    it('TikTok and status-red hues are at least 13deg apart in dark mode', () => {
      const darkBlock = css.match(/\[data-theme="dark"\]\s*\{[\s\S]+?\n\}/)![0];
      const tiktokHue = Number(darkBlock.match(/--chart-platform-tiktok:\s*oklch\([^)]+\s+([\d.]+)\)/)![1]);
      const redHue = Number(darkBlock.match(/--status-red:\s*oklch\([^)]+\s+([\d.]+)\)/)![1]);
      expect(Math.abs(tiktokHue - redHue)).toBeGreaterThanOrEqual(13);
    });
  });
  ```

- [ ] **Step 2: Run the test, confirm it fails.** `cd dashboard-web && npx vitest run src/lib/__tests__/chartTokens.test.ts` → expect FAIL on hue separation (TikTok currently at hue 25, status-red also at 25 in light; dark TikTok at 25 also).

- [ ] **Step 3: Rewrite chart platform tokens.** In `globals.css` `:root` block replace lines 42-50:

  ```css
  /* Chart categorical palette — platform-brand-mirrored (Q1 locked).
     Decision: dashboard-web/docs/superpowers/specs/2026-05-31-premium-dashboard-redesign-audit.md
     Meta=Facebook brand blue #1877F2, Google=Ads brand amber #FBBC04,
     TikTok=brand pink shifted from #FE2C55 to OKLCH hue 12 to clear
     status-red collision. Organic=teal (orthogonal to all platforms).
     Shopify=muted bag-green; treated as e-commerce category, NOT a
     chart line color — surfaced via cart-icon prefix instead. */
  --chart-platform-meta:     oklch(56% 0.20 257);   /* #1877F2 */
  --chart-platform-google:   oklch(82% 0.16 90);    /* #FBBC04 */
  --chart-platform-tiktok:   oklch(63% 0.27 12);    /* #FE2C55 shifted */
  --chart-platform-organic:  oklch(70% 0.14 175);   /* teal */
  --chart-platform-shopify:  oklch(55% 0.18 165);   /* bag green */
  ```

  In `[data-theme="dark"]` replace lines 157-165 with L-lifted mirrors:

  ```css
  --chart-platform-meta:     oklch(72% 0.18 257);
  --chart-platform-google:   oklch(85% 0.15 90);
  --chart-platform-tiktok:   oklch(70% 0.22 12);
  --chart-platform-organic:  oklch(75% 0.14 175);
  --chart-platform-shopify:  oklch(70% 0.16 165);
  ```

- [ ] **Step 4: Run tests until green.** `npx vitest run src/lib/__tests__/chartTokens.test.ts` → PASS.

- [ ] **Step 5: Commit.**
  ```sh
  git add dashboard-web/src/app/globals.css dashboard-web/src/lib/__tests__/chartTokens.test.ts
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): platform-brand-mirrored chart palette (Q1)

  Meta=#1877F2, Google=#FBBC04, TikTok shifted to OKLCH hue 12 to clear
  status-red collision. Organic=teal, Shopify=muted bag-green (treated as
  e-commerce category, not chart line). Test enforces 13deg minimum
  separation between TikTok and semantic-red.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 1.2: Move accent hue to confident violet (~OKLCH 280)

**Files:**
- Modify: `dashboard-web/src/app/globals.css` (`--accent` `--accent-fg` `--accent-dark` in `:root` + dark)
- Test: `dashboard-web/src/lib/__tests__/accentToken.test.ts` (new)

**Steps:**

- [ ] **Step 1: Write failing test** asserting `--accent` hue >= 270 and clear of Meta-blue chart (257):
  ```ts
  import { readFileSync } from 'fs';
  import { describe, it, expect } from 'vitest';
  it('accent hue stays clear of Meta-blue chart hue', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    const accentHue = Number(css.match(/:root[\s\S]+?--accent:\s*oklch\([^)]+\s+([\d.]+)\)/)![1]);
    expect(accentHue).toBeGreaterThanOrEqual(270);
    expect(Math.abs(accentHue - 257)).toBeGreaterThanOrEqual(13);
  });
  ```

- [ ] **Step 2: Run, expect fail** (current accent is hue 260).

- [ ] **Step 3: Update accent.** Replace in `:root`:
  ```css
  --accent:    oklch(55% 0.20 280);
  --accent-fg: oklch(99% 0 0);
  --accent-dark: oklch(45% 0.20 280);
  ```
  And in `[data-theme="dark"]`:
  ```css
  --accent:    oklch(70% 0.18 280);
  --accent-fg: oklch(15% 0.01 280);
  --accent-dark: oklch(78% 0.16 280);
  ```

- [ ] **Step 4: Update hero-gradient hue** in `:root` and dark to match new accent (was 260, now 280) in `--gradient-hero-from/via/to`.

- [ ] **Step 5: Run all token tests.** `npx vitest run src/lib/__tests__/` → PASS.

- [ ] **Step 6: Commit.**
  ```sh
  git add dashboard-web/src/app/globals.css dashboard-web/src/lib/__tests__/accentToken.test.ts
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): move accent to confident violet (Q2)

  --accent shifts from OKLCH hue 260 (indigo, collides with Meta-blue chart
  at 257) to hue 280 (violet, clear of all chart hues). Hero gradient
  rehued in lockstep so chrome stays coherent.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 1.3: Delete the legacy hex palette block

**Files:**
- Modify: `dashboard-web/tailwind.config.ts` (delete lines 67-114)
- Modify (consumer migration): `dashboard-web/src/components/BillingSettings.tsx:86-87`, `dashboard-web/src/components/PnLBreakdown.tsx:58-59`, `dashboard-web/src/components/CampaignsTableRow.tsx:303`, `dashboard-web/src/app/layout.tsx:47` (any `bg-primary-*`/`text-text-*`/`bg-background`/`bg-surface*`/`bg-roas-*` literal)
- Modify (OAuth callbacks): `dashboard-web/src/app/api/oauth/**/*.tsx`
- Test: extend `dashboard-web/src/lib/__tests__/tokenSweep.test.ts` (new)

**Steps:**

- [ ] **Step 1: Inventory consumers.** Run:
  ```sh
  cd dashboard-web && grep -rEn '\b(bg-primary|text-text|bg-background|bg-surface(Muted|Subtle|Sunken)?|bg-roas|text-roas|bg-border|text-primary-)\b' src --include="*.tsx" --include="*.ts" > /tmp/legacy-consumers.txt
  cat /tmp/legacy-consumers.txt | wc -l
  ```
  Document the full file list at top of the commit message.

- [ ] **Step 2: Migrate each consumer to tokens.** Class translation table:
  - `bg-background` → `bg-canvas`
  - `bg-surface` → `bg-elevated`
  - `bg-surfaceMuted` / `bg-surfaceSunken` → `bg-elevated2`
  - `bg-surfaceSubtle` → `bg-elevated`
  - `border-border` → `border-line`
  - `border-borderSubtle` → `border-line-subtle`
  - `border-borderStrong` → `border-line-strong`
  - `bg-primary` / `bg-primary-600` → `bg-accent`
  - `text-primary` / `text-primary-foreground` → `text-accent` / `text-accent-fg`
  - `text-text-primary` → `text-ink`
  - `text-text-secondary` → `text-ink-secondary`
  - `text-text-muted` → `text-ink-muted`
  - `text-text-subtle` → `text-ink-subtle`
  - `bg-roas-red` → `bg-status-red` (and `bg-roas-redBg` → `bg-status-redBg`), same for orange/green/blue
  - `text-roas-red` → `text-status-red` (and Fg variants)

- [ ] **Step 3: Write failing sweep test** asserting zero legacy classnames remain:
  ```ts
  import { readFileSync, readdirSync, statSync } from 'fs';
  import { join } from 'path';
  import { describe, it, expect } from 'vitest';

  const LEGACY = /\b(bg-(background|surface(Muted|Subtle|Sunken)?|primary-?\d*|roas-\w+|border(Subtle|Strong)?)|text-(text-\w+|primary-?\d*|roas-\w+))\b/;

  function* walk(dir: string): Generator<string> {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) yield* walk(p);
      else if (/\.tsx?$/.test(p) && !p.includes('__tests__')) yield p;
    }
  }

  it('no legacy palette classnames in src/', () => {
    const offenders: string[] = [];
    for (const f of walk('src')) {
      const c = readFileSync(f, 'utf8');
      if (LEGACY.test(c)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
  ```

- [ ] **Step 4: Run test → expect FAIL,** apply consumer migration with grep+edit until file list is empty.

- [ ] **Step 5: Delete the legacy block** at `tailwind.config.ts:67-114` (everything from `// ===== LEGACY` through the close of the `text:` object, leaving `colors: { ... canvas/ink/line/accent/status only }`).

- [ ] **Step 6: Run `npm run typecheck && npm test && npm run lint && npm run test:components`** → all green.

- [ ] **Step 7: Commit.**
  ```sh
  git add dashboard-web/tailwind.config.ts dashboard-web/src/components/ dashboard-web/src/app/ dashboard-web/src/lib/__tests__/tokenSweep.test.ts
  git commit -m "$(cat <<'EOF'
  refactor(ui-ux): delete legacy hex palette block (P0-1)

  tailwind.config.ts:67-114 removed. ~10 consumer files migrated to the
  token palette (canvas/ink/line/accent/status). Sweep test asserts zero
  bg-primary-*, text-text-*, bg-roas-*, bg-surface* survivors.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 1.4: ESLint rule — block legacy class names + cross-palette import

**Files:**
- Create: `dashboard-web/eslint-rules/no-legacy-tailwind-class.js`
- Create: `dashboard-web/eslint-rules/no-cross-palette-import.js`
- Modify: `dashboard-web/eslint.config.js` (register both)

**Steps:**

- [ ] **Step 1: Write `no-legacy-tailwind-class.js`** following the `no-raw-button-in-components.js` pattern:
  ```js
  const LEGACY = /\b(bg-(background|surface(Muted|Subtle|Sunken)?|primary-?\d*|roas-\w+|border(Subtle|Strong)?)|text-(text-\w+|primary-?\d*|roas-\w+))\b/;
  export default {
    meta: { type: 'problem', docs: { description: 'Forbid legacy tailwind classnames (use token palette).' } },
    create(context) {
      const f = context.getFilename();
      if (f.includes('__tests__') || f.includes('/eslint-rules/')) return {};
      return {
        Literal(node) {
          if (typeof node.value === 'string' && LEGACY.test(node.value)) {
            context.report({ node, message: `Legacy tailwind class detected: "${node.value.match(LEGACY)![0]}". Use the token palette (bg-canvas/bg-elevated/text-ink/bg-status-*).` });
          }
        },
        TemplateElement(node) {
          if (LEGACY.test(node.value.raw)) {
            context.report({ node, message: `Legacy tailwind class in template literal. Use the token palette.` });
          }
        },
      };
    },
  };
  ```

- [ ] **Step 2: Write `no-cross-palette-import.js`** — bans importing semantic tokens inside chart files and chart tokens inside non-chart status code:
  ```js
  export default {
    meta: { type: 'problem', docs: { description: 'Forbid mixing chart/semantic/brand palettes.' } },
    create(context) {
      const f = context.getFilename();
      const isChart = /chart|Chart|chartColors|RoasChart|HeroOverview|QuadrantScatter/.test(f);
      const isStatus = /HealthScore|RoasBadge|Status|Sentry/.test(f);
      return {
        Literal(node) {
          if (typeof node.value !== 'string') return;
          if (isChart && /\b(--status-(red|orange|green|blue)|bg-status-)\b/.test(node.value)) {
            context.report({ node, message: 'Chart surface must not consume --status-* tokens. Use --chart-platform-* / --chart-store-*.' });
          }
          if (isStatus && /\b(--chart-platform-|bg-chart-)\b/.test(node.value)) {
            context.report({ node, message: 'Status surface must not consume --chart-platform-* tokens. Use --status-*.' });
          }
        },
      };
    },
  };
  ```

- [ ] **Step 3: Register both** in `eslint.config.js` `localPlugin.rules` and the `rules:` block (`'local/no-legacy-tailwind-class': 'error'`, `'local/no-cross-palette-import': 'error'`).

- [ ] **Step 4: Run `npm run lint`** → expect green (Task 1.3 already cleaned the codebase).

- [ ] **Step 5: Commit.**
  ```sh
  git add dashboard-web/eslint-rules/no-legacy-tailwind-class.js dashboard-web/eslint-rules/no-cross-palette-import.js dashboard-web/eslint.config.js
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): ESLint rules block legacy classes + cross-palette mixing

  no-legacy-tailwind-class catches bg-primary-*, text-text-*, bg-roas-*,
  bg-surface* regressions. no-cross-palette-import enforces the three
  orthogonal palettes (semantic/chart/brand) per audit decision Q1.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 1.5: Linear-style 3-variable LCH theming refactor

**Files:**
- Modify: `dashboard-web/src/app/globals.css` (`:root` + dark blocks, lines 13-229)
- Test: `dashboard-web/src/lib/__tests__/lchTheming.test.ts` (new)

**Steps:**

- [ ] **Step 1: Write failing test** asserting that surface/text/border tokens are defined as `oklch()` expressions parameterised on `--bg-l` / `--fg-l`:
  ```ts
  it('structural tokens derive from --bg-l / --fg-l roots', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    const root = css.match(/:root\s*\{[\s\S]+?\n\}/)![0];
    expect(root).toMatch(/--bg-l:\s*\d+%/);
    expect(root).toMatch(/--fg-l:\s*\d+%/);
    expect(root).toMatch(/--accent-h:\s*\d+/);
    expect(root).toMatch(/--surface-canvas:\s*oklch\(var\(--bg-l\)/);
    expect(root).toMatch(/--text-primary:\s*oklch\(var\(--fg-l\)/);
  });
  ```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Refactor structural tokens.** At the top of `:root` add:
  ```css
  /* Linear-style 3-variable LCH theming (Q9 visual-regression gated).
     bg-l / fg-l / accent-h drive every structural token via oklch() math.
     Dark mode is six lines of overrides. Semantic + chart palettes stay
     as concrete hue locks (brand-stable across themes). */
  --bg-l: 99%;
  --fg-l: 20%;
  --accent-h: 280;
  --neutral-h: 250;
  ```
  Rewrite surface/text/border block as derived:
  ```css
  --surface-canvas:    oklch(var(--bg-l) 0.005 80);
  --surface-elevated-1: oklch(calc(var(--bg-l) + 1%) 0 0);
  --surface-elevated-2: oklch(calc(var(--bg-l) - 2%) 0.005 80);
  --surface-overlay:   oklch(calc(var(--bg-l) - 4%) 0.005 80 / 0.92);

  --text-primary:   oklch(var(--fg-l) 0.02 var(--neutral-h));
  --text-secondary: oklch(calc(var(--fg-l) + 20%) 0.02 var(--neutral-h));
  --text-muted:     oklch(calc(var(--fg-l) + 40%) 0.015 var(--neutral-h));
  --text-subtle:    oklch(calc(var(--fg-l) + 55%) 0.01 var(--neutral-h));

  --border-default: oklch(calc(var(--bg-l) - 9%) 0.01 var(--neutral-h));
  --border-subtle:  oklch(calc(var(--bg-l) - 5%) 0.005 var(--neutral-h));
  --border-strong:  oklch(calc(var(--bg-l) - 19%) 0.015 var(--neutral-h));
  ```
  Replace `[data-theme="dark"]` structural override block with:
  ```css
  [data-theme="dark"] {
    --bg-l: 15%;
    --fg-l: 95%;
    --neutral-h: 240;
    /* Inverted text scale derives by clamping the calc() chain — secondary
       must subtract, not add, in dark mode. Override only the directions
       that flip: */
    --text-secondary: oklch(calc(var(--fg-l) - 17%) 0.01 var(--neutral-h));
    --text-muted:     oklch(calc(var(--fg-l) - 25%) 0.015 var(--neutral-h));
    --text-subtle:    oklch(calc(var(--fg-l) - 50%) 0.015 var(--neutral-h));
    --border-default: oklch(calc(var(--bg-l) + 20%) 0.01 var(--neutral-h));
    --border-subtle:  oklch(calc(var(--bg-l) + 13%) 0.01 var(--neutral-h));
    --border-strong:  oklch(calc(var(--bg-l) + 30%) 0.01 var(--neutral-h));
  }
  ```

- [ ] **Step 4: Move dark-mode-only tokens** (scrollbar, skeleton, selection, focus-ring, hero-gradient) into the theming system — see Task 1.10 next.

- [ ] **Step 5: Run all tests + manual visual check.** Tests must pass before merging this task; Wave 6 Playwright snapshots will gate the visual regression.

- [ ] **Step 6: Commit.**
  ```sh
  git add dashboard-web/src/app/globals.css dashboard-web/src/lib/__tests__/lchTheming.test.ts
  git commit -m "$(cat <<'EOF'
  refactor(ui-ux): Linear-style 3-variable LCH theming (P1-2)

  Structural surface/text/border tokens now derive from --bg-l / --fg-l /
  --accent-h via oklch() calc(). Dark mode is six lines of overrides
  instead of ~98 sprawling pairs. Semantic + chart palettes stay as
  concrete hue locks (brand-stable across themes). Visual-regression gate
  lands in Wave 6 (Q9 locked).

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 1.6: Consolidate store-color maps (4 sources → 1)

**Files:**
- Modify: `dashboard-web/src/lib/storeColors.ts` (becomes the single source)
- Modify: `dashboard-web/src/lib/format.ts` (delete `STORE_HUES`, `storeBadgeHex()`, `STORE_HEX_LIGHT`; re-export from storeColors)
- Modify (all callers): grep results from `grep -rn "STORE_HUES\|storeBadgeHex\|STORE_HEX_LIGHT" src/`
- Test: `dashboard-web/src/lib/__tests__/storeColors.test.ts` (new)

**Steps:**

- [ ] **Step 1: Inventory.** `cd dashboard-web && grep -rn "STORE_HUES\|storeBadgeHex\|STORE_HEX_LIGHT" src/ | tee /tmp/store-color-callers.txt`

- [ ] **Step 2: Write failing test** asserting `format.ts` no longer exports `STORE_HUES`:
  ```ts
  it('store-color sources collapsed into storeColors.ts', async () => {
    const fmt = await import('@/lib/format');
    expect((fmt as any).STORE_HUES).toBeUndefined();
    expect((fmt as any).storeBadgeHex).toBeUndefined();
    const sc = await import('@/lib/storeColors');
    expect(typeof sc.storeColor).toBe('function');
    expect(typeof sc.storeBadge).toBe('function');
  });
  ```

- [ ] **Step 3: Extend storeColors.ts** to expose `storeBadge(name)` returning `{ bg, fg, accent }` reading from `--store-*-bg`/`-fg`/(base) tokens already defined in `globals.css:101-110`. Delete `format.ts` STORE_* exports.

- [ ] **Step 4: Update each caller** in `/tmp/store-color-callers.txt` to import from `@/lib/storeColors`.

- [ ] **Step 5: Run `npm test && npm run test:components`** → all green.

- [ ] **Step 6: Commit.**
  ```sh
  git add dashboard-web/src/lib/storeColors.ts dashboard-web/src/lib/format.ts dashboard-web/src/components/ dashboard-web/src/lib/__tests__/storeColors.test.ts
  git commit -m "$(cat <<'EOF'
  refactor(ui-ux): collapse 4 store-color sources into storeColors.ts

  STORE_HUES + storeBadgeHex + STORE_HEX_LIGHT (format.ts) merge into
  storeColors.ts which already owns STORE_COLORS. Callers updated to one
  import; light/dark token routing preserved via existing --store-* CSS
  vars in globals.css.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 1.7: Resolve 7 platform/status color collisions

**Files:**
- Modify: `dashboard-web/src/app/globals.css` (annotation + store + status tokens)
- Test: `dashboard-web/src/lib/__tests__/colorCollisions.test.ts` (new)

**Steps:**

- [ ] **Step 1: Write failing test** asserting each pair has ΔH ≥ 13° at matched L:
  ```ts
  const PAIRS: Array<[string, string, number]> = [
    ['--chart-platform-tiktok', '--status-red', 13],
    ['--chart-platform-google', '--status-warning', 25],
    ['--chart-platform-organic', '--annotation-sale', 30],
    ['--chart-store-uzoshop', '--annotation-creative', 25],
    ['--chart-store-usmile', '--annotation-launch', 20],
    ['--status-blue', '--accent', 25],
  ];
  it.each(PAIRS)('%s vs %s differ by >= %i deg', (a, b, min) => { /* parse and compare both light + dark */ });
  ```

- [ ] **Step 2: Run, expect FAIL** for collisions 4-7.

- [ ] **Step 3: Update annotation + store tokens** in globals.css:
  - `--annotation-sale` light/dark → hue 305 → hue 320 (rose), keep chroma
  - `--annotation-creative` light/dark → hue 200 → hue 180 (cyan-teal), chroma 0.18 → 0.14
  - `--annotation-launch` light → hue 145 chroma 0.18, dark → hue 145 chroma 0.20 (unchanged) but `--chart-store-usmile` shifts dark hue 130 → 110 to widen ΔH
  - `--chart-store-uzoshop` shifts hue 200 → 210 light/dark

  Collisions 1-3 already resolved by Task 1.1 (TikTok shift, Shopify as category not chart) and Task 1.2 (accent → 280, clear of `--status-blue` at 240/255).

- [ ] **Step 4: Re-run test → PASS.**

- [ ] **Step 5: Commit.**
  ```sh
  git add dashboard-web/src/app/globals.css dashboard-web/src/lib/__tests__/colorCollisions.test.ts
  git commit -m "$(cat <<'EOF'
  fix(ui-ux): resolve all 7 platform/status color collisions (P0-2)

  Annotation-sale rose-shift, annotation-creative cyan-teal, store-usmile
  rotated to 110, store-uzoshop to 210. Test enforces minimum ΔH per
  collision pair so future token tweaks cannot regress.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 1.8: Add `PageScope` primitive

**Files:**
- Create: `dashboard-web/src/components/ui/PageScope.tsx`
- Create: `dashboard-web/src/components/ui/__tests__/PageScope.test.tsx`

**Steps:**

- [ ] **Step 1: Write failing DOM test:**
  ```tsx
  import { render } from '@testing-library/react';
  import { PageScope } from '@/components/ui/PageScope';
  it('renders store, platform, range, currency in RTL read order', () => {
    const { container } = render(
      <PageScope store="uzoshop" platform="Meta" rangeLabel="30 ימים אחרונים" currency="CAD" />
    );
    const items = container.querySelectorAll('[data-scope-item]');
    expect(items[0]).toHaveTextContent('uzoshop');
    expect(items[1]).toHaveTextContent('Meta');
    expect(items[2]).toHaveTextContent('30 ימים אחרונים');
    expect(items[3]).toHaveTextContent('CAD');
    expect(items[0].querySelector('bdi')).not.toBeNull();
  });
  ```

- [ ] **Step 2: Implement.**
  ```tsx
  import { cn } from '@/lib/utils';
  import type { ReactNode } from 'react';
  export interface PageScopeProps {
    store: string;
    platform?: string;
    rangeLabel: string;
    currency?: string;
    extra?: ReactNode;
    className?: string;
  }
  export function PageScope({ store, platform, rangeLabel, currency = 'CAD', extra, className }: PageScopeProps) {
    return (
      <div className={cn('mt-1 flex items-center gap-2 text-xs text-ink-muted tabular-nums', className)} role="status" aria-label="scope">
        <span data-scope-item><bdi dir="ltr">{store}</bdi></span>
        {platform && (<><span aria-hidden>•</span><span data-scope-item><bdi dir="ltr">{platform}</bdi></span></>)}
        <span aria-hidden>•</span>
        <span data-scope-item>{rangeLabel}</span>
        <span aria-hidden>•</span>
        <span data-scope-item><bdi dir="ltr">{currency}</bdi></span>
        {extra && (<><span aria-hidden>•</span>{extra}</>)}
      </div>
    );
  }
  ```

- [ ] **Step 3: Run `npx vitest run --config vitest.config.dom.ts src/components/ui/__tests__/PageScope.test.tsx`** → PASS.

- [ ] **Step 4: Commit.**
  ```sh
  git add dashboard-web/src/components/ui/PageScope.tsx dashboard-web/src/components/ui/__tests__/PageScope.test.tsx
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): PageScope primitive (P0-3 — scope line under every H1)

  Renders store / platform / range / currency in RTL read order. Store
  name wrapped in <bdi> for safe Hebrew+English mixing. Consumed by every
  top-level page in Wave 5 Task 5.10.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 1.9: Add `--shadow-overlay`, `--shadow-modal` tokens

**Files:**
- Modify: `dashboard-web/src/app/globals.css` (both :root and dark)
- Modify: `dashboard-web/tailwind.config.ts` (delete shadow scale, add 2 overlay/modal)

**Steps:**

- [ ] **Step 1: Add tokens in :root:**
  ```css
  --shadow-overlay: 0 2px 8px -1px oklch(var(--bg-l) 0.02 var(--neutral-h) / 0.10),
                    0 1px 2px 0   oklch(var(--bg-l) 0.02 var(--neutral-h) / 0.06);
  --shadow-modal:   0 20px 40px -8px oklch(var(--bg-l) 0.02 var(--neutral-h) / 0.18),
                    0 8px 12px -4px  oklch(var(--bg-l) 0.02 var(--neutral-h) / 0.10);
  ```
  And dark equivalents (near-black tint, not cool navy on dark navy):
  ```css
  [data-theme="dark"] {
    --shadow-overlay: 0 2px 8px -1px oklch(0% 0 0 / 0.45),
                      0 1px 2px 0   oklch(0% 0 0 / 0.30);
    --shadow-modal:   0 20px 40px -8px oklch(0% 0 0 / 0.55),
                      0 8px 12px -4px  oklch(0% 0 0 / 0.35);
  }
  ```
  Remove `--shadow-md` reference in `globals.css:282` and replace `box-shadow: var(--shadow-md)` with `box-shadow: var(--shadow-overlay)`.

- [ ] **Step 2: Update tailwind.config.ts boxShadow scale** — replace the whole block with:
  ```ts
  boxShadow: {
    overlay: 'var(--shadow-overlay)',
    modal:   'var(--shadow-modal)',
  },
  ```

- [ ] **Step 3: Sweep callers** of `shadow-sm`, `shadow-card`, `shadow-cardHover`, `shadow-elevated`, `shadow-innerHighlight`, `shadow-md`, `shadow-focus`. Cards lose shadows (hairline only); overlays use `shadow-overlay`; modals use `shadow-modal`; `shadow-focus` is replaced by the `focus-visible` token (Task 2.11). `grep -rEn "shadow-(sm|card|elevated|md|innerHighlight|focus|cardHover)" src/ --include="*.tsx"` → replace per category. Commit covers ~18 sites.

- [ ] **Step 4: Run `npm run typecheck && npm run lint && npm test`** → green.

- [ ] **Step 5: Commit.**
  ```sh
  git add dashboard-web/src/app/globals.css dashboard-web/tailwind.config.ts dashboard-web/src/components/
  git commit -m "$(cat <<'EOF'
  refactor(ui-ux): hairline-only elevation; 2 blessed shadows (P0-8, P0-16)

  Tailwind boxShadow scale collapses to overlay + modal. ~18 shadow-sm /
  shadow-card / shadow-elevated sites switch to hairline border. Dark
  shadows use near-black tint (was cool-navy-on-dark-navy = invisible).

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 1.10: Hoist dark-mode regression tokens into LCH system

**Files:**
- Modify: `dashboard-web/src/app/globals.css` (scrollbar / skeleton / selection / focus-ring / hero-gradient blocks)
- Modify: `dashboard-web/src/components/HeroOverview.tsx:265-273` (use tokens, not `dark:from-accent`)
- Test: extend `lchTheming.test.ts` to assert every previously light-only block now has dark coverage

**Steps:**

- [ ] **Step 1: Add tokens in :root.**
  ```css
  --scrollbar-track: transparent;
  --scrollbar-thumb: oklch(calc(var(--bg-l) - 10%) 0.01 var(--neutral-h));
  --scrollbar-thumb-hover: oklch(calc(var(--bg-l) - 18%) 0.015 var(--neutral-h));
  --skeleton-base:    oklch(calc(var(--bg-l) - 6%) 0.01 var(--neutral-h) / 0.55);
  --skeleton-shimmer: oklch(calc(var(--bg-l) - 3%) 0.01 var(--neutral-h) / 0.85);
  --selection-bg: oklch(var(--accent-h) / 0.22);  /* placeholder; refine in next step */
  --selection-fg: var(--text-primary);
  --focus-ring: oklch(55% 0.20 var(--accent-h) / 0.45);
  ```
  Selection note: `oklch(var(--accent-h))` is not valid — write as `oklch(55% 0.18 var(--accent-h) / 0.22)`.

- [ ] **Step 2: Rewrite consumers in globals.css** lines 254-322:
  ```css
  ::selection { background: var(--selection-bg); color: var(--selection-fg); }
  *::-webkit-scrollbar-thumb { background: var(--scrollbar-thumb); border-radius: 8px; border: 2px solid var(--surface-canvas); }
  *::-webkit-scrollbar-thumb:hover { background: var(--scrollbar-thumb-hover); }
  :where(button,a,input,select,textarea,[role="tab"],[role="button"]):focus-visible { outline: none; box-shadow: 0 0 0 3px var(--focus-ring); border-radius: 0.5rem; }
  .skeleton { background: linear-gradient(90deg, var(--skeleton-base) 0%, var(--skeleton-shimmer) 50%, var(--skeleton-base) 100%); background-size: 200% 100%; animation: shimmer 1.6s linear infinite; border-radius: 8px; }
  ```

- [ ] **Step 3: Fix HeroOverview gradient bypass.** In `HeroOverview.tsx:265-273` delete the `dark:from-accent dark:via-accent/80 dark:to-accent/55` line. The single `bg-[linear-gradient(135deg,var(--gradient-hero-from),var(--gradient-hero-via)_45%,var(--gradient-hero-to))]` now adapts via the LCH dark override (already present in globals.css).

- [ ] **Step 4: Run `npm run test:components`** → PASS.

- [ ] **Step 5: Commit.**
  ```sh
  git add dashboard-web/src/app/globals.css dashboard-web/src/components/HeroOverview.tsx
  git commit -m "$(cat <<'EOF'
  fix(ui-ux): 5 dark-mode regressions hoisted into LCH theme (P0-4)

  Scrollbar, skeleton, ::selection, focus-visible ring, hero gradient now
  derive from --bg-l / --fg-l / --accent-h. HeroOverview drops the
  dark:from-accent override that bypassed its own gradient tokens.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 1.11: Tighten `border-line-subtle` structural usage to `border-line`

**Files:**
- Modify: `dashboard-web/src/components/ui/TableBase.tsx:21,29`
- Modify: `dashboard-web/src/components/CampaignDrawer.tsx:800`
- Modify: `dashboard-web/src/components/ui/InsightCard.tsx` (row separator line ~149)
- Modify: `dashboard-web/src/components/ui/Card.tsx` (footer line ~60)
- Test: extend `lchTheming.test.ts` assert `border-line-subtle` does not appear adjacent to `border-(b|t)` in the four files above (regex grep test)

**Steps:**

- [ ] **Step 1: Write failing grep test** that opens each of the 4 files and asserts the structural-separator lines now use `border-line` not `border-line-subtle`.

- [ ] **Step 2: Replace in each file.** `border-line-subtle` → `border-line` for any structural row separator (table row, drawer header divider, insight-card row divider, card footer). Decorative subtle separators (e.g., chip dividers inside a card) stay subtle.

- [ ] **Step 3: Run tests, manual visual check dark mode.**

- [ ] **Step 4: Commit.**
  ```sh
  git add dashboard-web/src/components/ui/TableBase.tsx dashboard-web/src/components/CampaignDrawer.tsx dashboard-web/src/components/ui/InsightCard.tsx dashboard-web/src/components/ui/Card.tsx dashboard-web/src/lib/__tests__/lchTheming.test.ts
  git commit -m "$(cat <<'EOF'
  fix(ui-ux): structural row separators use --border-default (P0-13)

  border-line-subtle is documented decorative-only (fails WCAG 1.4.11 in
  dark). TableBase rows, CampaignDrawer sticky header, InsightCard row
  divider, Card footer all switch to border-line for >=3:1 contrast.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 1.12: Add spacing, motion, radius token scales

**Files:**
- Modify: `dashboard-web/src/app/globals.css` (extend :root)
- Modify: `dashboard-web/tailwind.config.ts` (consume tokens)

**Steps:**

- [ ] **Step 1: Add tokens.**
  ```css
  /* Semantic spacing scale — 4px base. */
  --space-1: 0.25rem; --space-2: 0.5rem; --space-3: 0.75rem;
  --space-4: 1rem;   --space-5: 1.25rem; --space-6: 1.5rem;
  --space-8: 2rem;   --space-10: 2.5rem; --space-12: 3rem;

  /* Motion vocabulary. */
  --motion-snap: 120ms;
  --motion-fast: 180ms;
  --motion-base: 240ms;
  --motion-slow: 320ms;
  --motion-large: 480ms;
  --ease-out: cubic-bezier(0.16, 1, 0.3, 1);

  /* Radius. */
  --radius-control: 0.5rem;   /* buttons, inputs */
  --radius-chip:    0.375rem; /* badges */
  --radius-card:    0.75rem;
  --radius-hero:    1rem;
  ```

- [ ] **Step 2: Wire into tailwind.** Replace the existing `transitionDuration` + `borderRadius` + `transitionTimingFunction` blocks in `tailwind.config.ts:174-193` with `var(--motion-*)` / `var(--radius-*)` / `var(--ease-out)` references.

- [ ] **Step 3: Run tests.**

- [ ] **Step 4: Commit.**
  ```sh
  git add dashboard-web/src/app/globals.css dashboard-web/tailwind.config.ts
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): spacing/motion/radius token scales (P1-15)

  --space-1..12, --motion-snap/fast/base/slow/large + --ease-out, and
  --radius-control/chip/card/hero. Tailwind consumes tokens; primitives
  in Wave 2 will adopt --radius-card / --radius-control consistently.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Wave 2 — Primitive Enforcement

### Task 2.1: Codemod — raw `<button>` survivors

**Files:**
- Modify (sweep): every `.tsx` outside `components/ui/` and `api/oauth/` that the ESLint rule did not catch (e.g. literal `<button` strings hand-disabled with `// eslint-disable`).
- Test: existing `no-raw-button-in-components` rule runs on `npm run lint`.

**Steps:**

- [ ] **Step 1: Inventory disabled sites.** `cd dashboard-web && grep -rn "eslint-disable.*no-raw-button" src/ --include="*.tsx"` → file list.

- [ ] **Step 2: For each disabled site,** replace the raw `<button>` with `<Button variant="ghost" size="icon">` (or `size="sm"` / `"md"` per current sizing) and remove the `// eslint-disable` line.

- [ ] **Step 3: Run `npm run lint`** → zero `no-raw-button-in-components` errors.

- [ ] **Step 4: Commit.**
  ```sh
  git add dashboard-web/src/
  git commit -m "$(cat <<'EOF'
  refactor(ui-ux): sweep <button> survivors to Button primitive

  Removes every // eslint-disable no-raw-button-in-components escape
  hatch. All button sites now consume @/components/ui/Button.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 2.2: Codemod — raw `<table>` → `TableBase`

**Files (9 sites):**
- `dashboard-web/src/components/CohortComparisonPanel.tsx:233`
- `dashboard-web/src/components/ProductsTable.tsx:638`
- `dashboard-web/src/components/ProductCentricView.tsx:483`
- `dashboard-web/src/components/AdSetTable.tsx:101`
- `dashboard-web/src/components/MetaShopifyReconciliation.tsx:809`
- `dashboard-web/src/components/CampaignsTable.tsx:2027`
- `dashboard-web/src/components/DetailTable.tsx:70`
- `dashboard-web/src/components/MonthlyTables.tsx:386,512`
- `dashboard-web/src/components/PnLBreakdown.tsx:323`
- `dashboard-web/src/components/AdsDrawer.tsx:393`
- `dashboard-web/src/components/operator/CronTickSnapshotsViewer.tsx:31`
- `dashboard-web/src/components/operator/JobsTable.tsx:188`

**Steps:**

- [ ] **Step 1: Extend `TableBase`** to accept `minWidth`, `density='comfortable'|'compact'`, `stickyHeader=true|false` props so all 9 callers map cleanly:
  ```tsx
  export interface TableBaseProps extends HTMLAttributes<HTMLTableElement> {
    minWidth?: number;
    density?: 'comfortable' | 'compact';
    stickyHeader?: boolean;
  }
  export function TableBase({ minWidth, density='comfortable', stickyHeader, className, children, ...rest }: TableBaseProps) {
    return (
      <table
        {...rest}
        className={cn('w-full text-sm text-ink', density === 'compact' && 'text-xs', className)}
        style={{ minWidth, ...(rest.style ?? {}) }}
        data-sticky-header={stickyHeader || undefined}
      >
        {children}
      </table>
    );
  }
  ```
  Add CSS in globals.css:
  ```css
  table[data-sticky-header] thead th { position: sticky; top: 0; z-index: 5; background: var(--surface-elevated-1); }
  ```
  This also fixes the documented `CampaignsTable.tsx:2027` missing `z-[5]`+`sticky top-0` bug.

- [ ] **Step 2: Mechanical replace per file** — each `<table className="...min-w-[Npx]...">` becomes `<TableBase minWidth={N} density="compact"|undefined stickyHeader>`. Preserve thead/tbody structure.

- [ ] **Step 3: Run `npm run test:components`** → all DOM tests still pass.

- [ ] **Step 4: Add ESLint rule `no-raw-table-in-components.js`** (mirror `no-raw-button-in-components.js` shape — block `<table` JSXOpeningElement outside `components/ui/`). Register in `eslint.config.js`.

- [ ] **Step 5: Run `npm run lint`** → green.

- [ ] **Step 6: Commit.**
  ```sh
  git add dashboard-web/src/components/ dashboard-web/src/app/globals.css dashboard-web/eslint-rules/no-raw-table-in-components.js dashboard-web/eslint.config.js
  git commit -m "$(cat <<'EOF'
  refactor(ui-ux): migrate 9 raw <table> sites to TableBase primitive

  Extends TableBase with minWidth / density / stickyHeader props. Fixes
  the CampaignsTable header missing sticky/z-5 (visible regression). Adds
  no-raw-table-in-components lint rule to prevent recurrence.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 2.3: Codemod — 3 local `Stat` forks → canonical `Stat`

**Files:**
- Modify: `dashboard-web/src/components/ui/Stat.tsx` (extend CVA for `prefix` / `compact` / `active` / `hero`)
- Modify: `dashboard-web/src/components/CampaignsTable.tsx:2490` (drop local `Stat()`; consume primitive)
- Modify: `dashboard-web/src/components/AdsDrawer.tsx:543`
- Modify: `dashboard-web/src/components/CampaignDrawer.tsx:1575,1581` (delete `DrawerStat`)
- Modify: `dashboard-web/src/components/ProductsTable.tsx:897`
- Modify: `dashboard-web/src/components/HeroOverview.tsx:650-707` (`FloatingKpi` → `Stat hero`)

**Steps:**

- [ ] **Step 1: Extend Stat.** New CVA shape:
  ```tsx
  const statVariants = cva(
    'border bg-elevated2 flex flex-col gap-1',
    {
      variants: {
        tone:    { neutral: 'border-line', warning: 'border-status-warning bg-status-warningBg', success: 'border-status-green bg-status-greenBg', danger: 'border-status-red bg-status-redBg' },
        density: { compact: 'rounded-md px-2 py-1.5', regular: 'rounded-md px-3 py-2', hero: 'rounded-card px-4 py-3 gap-2' },
        active:  { true: 'ring-2 ring-accent', false: '' },
      },
      defaultVariants: { tone: 'neutral', density: 'regular', active: false },
    },
  );
  export interface StatProps extends VariantProps<typeof statVariants> {
    label: string;
    value: ReactNode;
    prefix?: ReactNode;
    chip?: ReactNode;
    help?: ReactNode;
    delta?: ReactNode;
    className?: string;
  }
  export function Stat({ label, value, prefix, chip, help, delta, tone, density, active, className }: StatProps) {
    return (
      <div className={cn(statVariants({ tone, density, active }), className)}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-ink-muted">{label}</span>
          {help}
        </div>
        <div className="flex items-baseline gap-1.5">
          {prefix && <span className="text-xs text-ink-muted font-medium">{prefix}</span>}
          <bdi dir="ltr" className={cn('font-medium text-ink tabular-nums', density === 'hero' ? 'text-2xl' : 'text-sm')}>{value}</bdi>
          {chip}
        </div>
        {delta && <div className="text-xs tabular-nums">{delta}</div>}
      </div>
    );
  }
  ```

- [ ] **Step 2: Sweep each consumer** — `Stat({ label, value, prefix })` calls keep the same call shape; `compact` becomes `density="compact"`; `active` becomes `active={true|false}`; `FloatingKpi` adopts `density="hero"`.

- [ ] **Step 3: Delete local fork definitions** (`function Stat(...)` in CampaignsTable, `function DrawerStat(...)` in CampaignDrawer, `function Stat(...)` in AdsDrawer/ProductsTable). Replace `FloatingKpi` body with a `<Stat density="hero">` wrapper (it has unique gradient-on-dark behaviour kept as a className prop).

- [ ] **Step 4: Run `npm run typecheck && npm run test:components`** → green.

- [ ] **Step 5: Commit.**
  ```sh
  git add dashboard-web/src/components/ui/Stat.tsx dashboard-web/src/components/
  git commit -m "$(cat <<'EOF'
  refactor(ui-ux): 3 local Stat forks → unified Stat primitive (P0-6)

  Stat CVA gains density (compact|regular|hero), active, prefix, chip,
  delta variants. CampaignsTable, AdsDrawer, CampaignDrawer (DrawerStat),
  ProductsTable, HeroOverview (FloatingKpi) all migrate. Zero local
  Stat-shaped definitions remain outside @/components/ui/Stat.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 2.4: Migrate hand-rolled card surfaces to `Card` / `InsightCard`

**Files (9 sites):**
- `dashboard-web/src/components/InsightsBoard.tsx:222`
- `dashboard-web/src/components/KpiCards.tsx:280-285`
- `dashboard-web/src/components/GoalTracker.tsx` (3 inline cards)
- `dashboard-web/src/components/PerStoreCards.tsx` (`StoreCard`)
- `dashboard-web/src/components/HealthScorePanel.tsx`
- `dashboard-web/src/components/CommandPalette.tsx:514`
- `dashboard-web/src/components/TodayLive.tsx:103-120`
- `dashboard-web/src/components/Filters.tsx:70`

**Steps:**

- [ ] **Step 1: Verify `Card` primitive** exposes `Card`, `Card.Header`, `Card.Body`, `Card.Footer` namespaces. If not, add `Card.Header = ...` etc. as compound exports.

- [ ] **Step 2: Replace each `<div className="rounded-xl bg-elevated border ... shadow-sm ...">` site** with `<Card>...</Card>` (hairline-only, no shadow per Task 1.9). Sticky / clickable / scope-line surfaces use `Card asChild` if needed for semantic `<section>`/`<a>` wrappers.

- [ ] **Step 3: Run `npm run lint && npm run test:components`** → green.

- [ ] **Step 4: Commit.**
  ```sh
  git add dashboard-web/src/components/ui/Card.tsx dashboard-web/src/components/
  git commit -m "$(cat <<'EOF'
  refactor(ui-ux): 9 hand-rolled cards → Card primitive (P1-4)

  InsightsBoard, KpiCards, GoalTracker, PerStoreCards, HealthScorePanel,
  CommandPalette, TodayLive, Filters all consume the Card primitive.
  Card.Header/Body/Footer namespace exports added for compound usage.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 2.5: Migrate hand-rolled drawers to `Sheet`

**Files:**
- Modify: `dashboard-web/src/components/CampaignDrawer.tsx` (header + close)
- Modify: `dashboard-web/src/components/AdsDrawer.tsx` (header + close)
- Modify: `dashboard-web/src/components/BillingSettings.tsx` (it's a Dialog-shaped drawer)
- Modify: `dashboard-web/src/components/ui/Sheet.tsx` (add `Sheet.Header` + `Sheet.Body` compound exports; bump `SheetClose` z-index to `z-20`)

**Steps:**

- [ ] **Step 1: Add `Sheet.Header` / `Sheet.Body` / `Sheet.Footer`** compound exports per Task 2.4 pattern.

- [ ] **Step 2: Fix `SheetClose` z-index** — currently the close × is hidden behind sticky drawer headers. Bump to `z-20` (above sticky header `z-10`).

- [ ] **Step 3: Migrate `CampaignDrawer.tsx:800` sticky-header block** to `<Sheet.Header sticky>...</Sheet.Header>`. Same for `AdsDrawer.tsx:341-350`. `BillingSettings` modal stays a `Dialog` (it's not a side-sheet) but gains `Dialog.Header`.

- [ ] **Step 4: Run `npm run test:components`** → green; manual check: tab to close × works on both drawers.

- [ ] **Step 5: Commit.**
  ```sh
  git add dashboard-web/src/components/ui/Sheet.tsx dashboard-web/src/components/CampaignDrawer.tsx dashboard-web/src/components/AdsDrawer.tsx dashboard-web/src/components/BillingSettings.tsx
  git commit -m "$(cat <<'EOF'
  refactor(ui-ux): drawer headers → Sheet.Header; fix close-X z-index (P0-12)

  SheetClose bumped to z-20 (was z-auto, hidden behind sticky drawer
  header at z-10). CampaignDrawer + AdsDrawer + BillingSettings adopt
  the Sheet/Dialog compound exports.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 2.6: Mount `TooltipProvider`; migrate 53 native `title=` to `Tooltip`

**Files:**
- Modify: `dashboard-web/src/app/layout.tsx` (wrap children in `TooltipProvider`)
- Modify (sweep): every `.tsx` outside `components/ui/` and `__tests__/` with a `title="..."` attribute on a JSX element (use Bash inventory below)
- Modify: `dashboard-web/src/components/ui/Tooltip.tsx` (ensure `Tooltip` + `TooltipTrigger` + `TooltipContent` are exported in shadcn-style)
- Create: `dashboard-web/eslint-rules/no-native-title-tooltip.js`

**Steps:**

- [ ] **Step 1: Inventory.** `cd dashboard-web && grep -rn "title=" src/ --include="*.tsx" | grep -v "__tests__" | grep -v "components/ui/" | grep -v "page-title" | grep -v "<a " | grep -v "title=\"\"" > /tmp/title-attrs.txt`. Expect ~53 sites.

- [ ] **Step 2: Mount provider** in `layout.tsx`:
  ```tsx
  import { TooltipProvider } from '@/components/ui/Tooltip';
  // ...
  <ErrorBoundary>
    <TooltipProvider delayDuration={300} skipDelayDuration={150}>
      {children}
    </TooltipProvider>
  </ErrorBoundary>
  ```

- [ ] **Step 3: Migrate each `title=` site.** Pattern:
  ```tsx
  <span title="חיפוש מהיר (⌘K)">{...}</span>
  ```
  becomes
  ```tsx
  <Tooltip><TooltipTrigger asChild><span>{...}</span></TooltipTrigger><TooltipContent>חיפוש מהיר (⌘K)</TooltipContent></Tooltip>
  ```
  EXCEPTION: `SectionIntro`-style `title=` props that are component props, not HTML attrs, are renamed if confusing but not migrated to `Tooltip`. Use grep filter `title=\"` (JSX attr) vs `title:` (object prop) to distinguish.

- [ ] **Step 4: Add ESLint rule `no-native-title-tooltip.js`** — flags `title=` on intrinsic JSX elements (lowercase tag names) outside `components/ui/`:
  ```js
  export default {
    meta: { type: 'problem' },
    create(context) {
      const f = context.getFilename();
      if (f.includes('components/ui/') || f.includes('__tests__')) return {};
      return {
        JSXAttribute(node) {
          if (node.name.name !== 'title') return;
          const parent = node.parent;
          if (parent.type !== 'JSXOpeningElement') return;
          if (parent.name.type !== 'JSXIdentifier') return;
          const tag = parent.name.name;
          if (/^[a-z]/.test(tag)) {
            context.report({ node, message: 'Use <Tooltip> instead of native title= for accessible, touch-aware tooltips.' });
          }
        },
      };
    },
  };
  ```
  Register in `eslint.config.js`.

- [ ] **Step 5: Run `npm run lint && npm run test:components`** → green.

- [ ] **Step 6: Commit.**
  ```sh
  git add dashboard-web/src/app/layout.tsx dashboard-web/src/components/ dashboard-web/eslint-rules/no-native-title-tooltip.js dashboard-web/eslint.config.js
  git commit -m "$(cat <<'EOF'
  refactor(ui-ux): mount TooltipProvider; 53 title= sites → Tooltip (P0-10)

  Native title= is touch-blind, a11y-blind, and collapses \n. All
  consumer sites now use shadcn-style <Tooltip>. ESLint rule prevents
  regression on intrinsic-element title attributes.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 2.7: Migrate `Input` / `Select` / `Switch` / `Tabs` / `Dialog` consumers to primitives

**Files:**
- Modify (sweep): every native `<input type="text|number|date|search">`, `<select>`, native checkbox-as-toggle, raw Radix `Tabs` usage outside the primitive wrapper, raw `Dialog` usage that bypasses the primitive.
- Create: `dashboard-web/eslint-rules/no-raw-input-in-components.js` (block `<input>`, `<select>`, `<textarea>` outside `components/ui/`)

**Steps:**

- [ ] **Step 1: Inventory.** `grep -rEn "<(input|select|textarea)[^>]" src/ --include="*.tsx" | grep -v "__tests__" | grep -v "components/ui/" > /tmp/raw-inputs.txt`. Expect heavy hits in BillingSettings, Filters, MonthSelector, YearSelector, Operator forms.

- [ ] **Step 2: Migrate each site.** The `Input` primitive should already exist; if it's missing API (e.g. `prefix`, `suffix`, `error`), extend in this commit. `Select` (Radix) wraps with the same className conventions.

- [ ] **Step 3: Write the rule** — same shape as `no-raw-button-in-components.js`, block `input`/`select`/`textarea` opening elements. Allow `<input type="hidden">` (semantic, not UI).

- [ ] **Step 4: Register + run lint.**

- [ ] **Step 5: Commit.**
  ```sh
  git add dashboard-web/src/components/ dashboard-web/eslint-rules/no-raw-input-in-components.js dashboard-web/eslint.config.js
  git commit -m "$(cat <<'EOF'
  refactor(ui-ux): migrate raw inputs/selects to Input/Select primitives

  BillingSettings, Filters, Month/YearSelector, operator forms now route
  through the blessed primitives. New ESLint rule blocks regression.
  Allows <input type=hidden> for semantic form posting.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 2.8: Add `Typography` primitive

**Files:**
- Create: `dashboard-web/src/components/ui/Typography.tsx`
- Create: `dashboard-web/src/components/ui/__tests__/Typography.test.tsx`
- Modify (sweep): consumers of the 5+ H2 styles — `TabHeader`, `SectionIntro`, `GoalTracker`, `CollapsibleSection`, `CampaignDrawer`, `AdsDrawer`, `InsightsBoard`, `PnLBreakdown`, `HomeLiveBand`, `HomeSummaryBand`, `HomePerStoreBand`, `AttributionAnalysisPanel`, `AdSetTable`, `MetaShopifyReconciliation`

**Steps:**

- [ ] **Step 1: Write failing DOM test.**
  ```tsx
  it('Heading h1 renders text-3xl font-semibold', () => {
    const { container } = render(<Heading level="hero">Title</Heading>);
    const h = container.querySelector('h1')!;
    expect(h.className).toMatch(/text-3xl/);
    expect(h.className).toMatch(/font-semibold/);
  });
  ```

- [ ] **Step 2: Implement.**
  ```tsx
  import { cva, type VariantProps } from 'class-variance-authority';
  import { cn } from '@/lib/utils';
  import type { HTMLAttributes, ElementType, ReactNode } from 'react';

  const headingVariants = cva('text-ink tracking-tight', {
    variants: {
      level: {
        display: 'text-4xl font-bold leading-tight',
        hero:    'text-3xl font-semibold leading-tight',
        section: 'text-base sm:text-lg font-semibold',
        panel:   'text-sm font-semibold',
        label:   'text-xs font-medium uppercase tracking-wide text-ink-muted',
      },
    },
    defaultVariants: { level: 'section' },
  });
  const LEVEL_TAG: Record<NonNullable<VariantProps<typeof headingVariants>['level']>, ElementType> = {
    display: 'h1', hero: 'h1', section: 'h2', panel: 'h3', label: 'div',
  };
  export interface HeadingProps extends HTMLAttributes<HTMLHeadingElement>, VariantProps<typeof headingVariants> {
    as?: ElementType;
    children: ReactNode;
  }
  export function Heading({ level, as, className, children, ...rest }: HeadingProps) {
    const Tag = (as ?? LEVEL_TAG[level ?? 'section']) as ElementType;
    return <Tag className={cn(headingVariants({ level }), className)} {...rest}>{children}</Tag>;
  }

  const textVariants = cva('', {
    variants: {
      variant: {
        body:    'text-sm text-ink',
        caption: 'text-xs text-ink-muted',
        code:    'font-mono text-xs text-ink-secondary',
      },
      tone: { default: '', muted: 'text-ink-muted', subtle: 'text-ink-subtle' },
    },
    defaultVariants: { variant: 'body', tone: 'default' },
  });
  export function Text({ variant, tone, className, children, ...rest }: HTMLAttributes<HTMLSpanElement> & VariantProps<typeof textVariants> & { children: ReactNode }) {
    return <span className={cn(textVariants({ variant, tone }), className)} {...rest}>{children}</span>;
  }
  ```

- [ ] **Step 3: Sweep callers** — replace `<h2 className="text-base sm:text-lg font-semibold tracking-tight">{x}</h2>` with `<Heading level="section">{x}</Heading>`, and the 4 other patterns documented in audit §2.1 Typography. `font-bold` Hero remaps to `level="display"`. `font-medium` HomeLiveBand etc. remap to `level="section"` (NOT `font-medium` — that pattern was the bug — we want unification).

- [ ] **Step 4: Run `npm run test:components`** → green.

- [ ] **Step 5: Commit.**
  ```sh
  git add dashboard-web/src/components/ui/Typography.tsx dashboard-web/src/components/ui/__tests__/Typography.test.tsx dashboard-web/src/components/
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): Typography primitive; sweep 5+ H2 styles (P0-5)

  Heading {display|hero|section|panel|label} + Text {body|caption|code}.
  ~14 consumer files migrate from ad-hoc H2/H3 classnames to the
  primitive. Weight roles now stable: medium=body emphasis, semibold=H2/H3,
  bold=display.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 2.9: Add `PlatformBadge` primitive

**Files:**
- Create: `dashboard-web/src/components/ui/PlatformBadge.tsx`
- Create: `dashboard-web/src/components/ui/__tests__/PlatformBadge.test.tsx`
- Modify (sweep): `CampaignsTableRow.tsx:375-378`, `CampaignDrawer.tsx:818`, `CampaignsTopList.tsx:49-58` (`PlatformChip`), `AdSetTable`, `AdsDrawer`, `InsightsBoard`

**Steps:**

- [ ] **Step 1: Write failing test** asserting Meta renders with `bg-[--chart-platform-meta]` dot:
  ```tsx
  it('PlatformBadge Meta uses --chart-platform-meta token', () => {
    const { container } = render(<PlatformBadge platform="Meta" />);
    const dot = container.querySelector('[data-platform-dot]')!;
    expect(dot.getAttribute('style')).toContain('--chart-platform-meta');
  });
  ```

- [ ] **Step 2: Implement.**
  ```tsx
  import { cn } from '@/lib/utils';
  const PLATFORM_TOKEN: Record<string, string> = {
    Meta:    '--chart-platform-meta',
    Google:  '--chart-platform-google',
    TikTok:  '--chart-platform-tiktok',
    Organic: '--chart-platform-organic',
    Shopify: '--chart-platform-shopify',
  };
  export function PlatformBadge({ platform, size='sm', showLabel=true, className }: { platform: string; size?: 'xs'|'sm'|'md'; showLabel?: boolean; className?: string }) {
    const token = PLATFORM_TOKEN[platform];
    const dotSize = size === 'xs' ? 'w-1.5 h-1.5' : size === 'sm' ? 'w-2 h-2' : 'w-2.5 h-2.5';
    return (
      <span className={cn('inline-flex items-center gap-1.5 text-xs text-ink-secondary', className)}>
        <span data-platform-dot aria-hidden className={cn('inline-block rounded-full shrink-0', dotSize)} style={token ? { background: `var(${token})` } : { background: 'var(--status-gray)' }} />
        {showLabel && <bdi dir="ltr" className="font-medium">{platform}</bdi>}
      </span>
    );
  }
  ```

- [ ] **Step 3: Sweep callers.** Each inline platform chip (e.g., `PlatformChip` in CampaignsTopList) deletes its local definition and imports `PlatformBadge` from `@/components/ui/PlatformBadge`.

- [ ] **Step 4: Run tests, commit.**
  ```sh
  git add dashboard-web/src/components/ui/PlatformBadge.tsx dashboard-web/src/components/ui/__tests__/PlatformBadge.test.tsx dashboard-web/src/components/
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): PlatformBadge primitive (P1-3)

  Single source of truth for platform identity in tables/drawers/insights.
  Consumes --chart-platform-* tokens so brand identity stays consistent
  across charts and chips. Replaces inline PlatformChip in CampaignsTopList
  and 5 other sites.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 2.10: ESLint rule — no raw HTML where a primitive exists

**Files:**
- Modify: `dashboard-web/eslint.config.js` (combine all primitive-enforcement rules into one report block at top of severity)
- (Rules created in Tasks 1.4, 2.2, 2.6, 2.7 already enforce buttons / tables / inputs / native title.)

**Steps:**

- [ ] **Step 1: Verify the 6 enforcement rules** are all `'error'` severity: `no-raw-button-in-components`, `no-raw-table-in-components`, `no-raw-input-in-components`, `no-native-title-tooltip`, `no-legacy-tailwind-class`, `no-cross-palette-import`.

- [ ] **Step 2: Add `'no-restricted-syntax'`** rules in `eslint.config.js` to block direct Radix-primitive imports (e.g. `'@radix-ui/react-dialog'`) outside `components/ui/`:
  ```js
  'no-restricted-imports': ['error', { paths: [
    { name: '@radix-ui/react-dialog', message: 'Use @/components/ui/Dialog' },
    { name: '@radix-ui/react-tooltip', message: 'Use @/components/ui/Tooltip' },
    { name: '@radix-ui/react-tabs', message: 'Use @/components/ui/Tabs' },
    { name: '@radix-ui/react-switch', message: 'Use @/components/ui/Switch' },
    { name: '@radix-ui/react-select', message: 'Use @/components/ui/Select' },
  ]}],
  ```
  Override in `files: ['src/components/ui/**']` to allow.

- [ ] **Step 3: Run `npm run lint`** → green.

- [ ] **Step 4: Commit.**
  ```sh
  git add dashboard-web/eslint.config.js
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): enforce no-raw-HTML where a primitive exists

  Promotes all 6 primitive-enforcement rules to error severity and adds
  no-restricted-imports to block direct Radix consumption outside
  components/ui/. Centralised enforcement post Wave 2 codemods.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 2.11: Fix Button focus-ring + sweep `focus:outline-none`

**Files:**
- Modify: `dashboard-web/src/components/ui/Button.tsx:8,13` (offset rings, accent variants get a contrast ring)
- Modify (sweep 14 sites): every `focus:outline-none` outside `components/ui/` without a paired `focus-visible:ring-*`. Top: `BillingSettings.tsx:726-1127`, `ProductsTable`, `GoalTracker`, `YearSelector`.

**Steps:**

- [ ] **Step 1: Update Button CVA**:
  ```tsx
  const buttonVariants = cva(
    'inline-flex items-center justify-center gap-1.5 whitespace-nowrap font-medium transition-colors ' +
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas ' +
    'disabled:opacity-50 disabled:pointer-events-none',
    {
      variants: {
        variant: {
          // Primary uses a contrast ring (white inner, accent outer) so the ring is visible against bg-accent.
          primary:     'bg-accent text-accent-fg hover:bg-accent/90 focus-visible:ring-accent-fg focus-visible:ring-offset-accent',
          secondary:   'bg-elevated2 text-ink border border-line hover:bg-elevated focus-visible:ring-accent',
          ghost:       'text-ink hover:bg-elevated2 focus-visible:ring-accent',
          destructive: 'bg-status-red text-status-redFg hover:bg-status-red/90 focus-visible:ring-status-redFg focus-visible:ring-offset-status-red',
          link:        'text-accent underline-offset-4 hover:underline focus-visible:ring-accent',
        },
        // ... size unchanged
      },
    },
  );
  ```

- [ ] **Step 2: Sweep 14 sites.** `grep -rn "focus:outline-none" src/ --include="*.tsx" | grep -v "__tests__"` → for each site that is NOT already shipping `focus-visible:ring-*`, append ` focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-canvas`. Where the site has a `focus:border-accent focus:shadow-focus` pattern (typical in BillingSettings), replace with `focus-visible:border-accent focus-visible:ring-2 focus-visible:ring-accent/40`.

- [ ] **Step 3: Run `npm run test:components` + manual keyboard test** (Tab through Home, Operator).

- [ ] **Step 4: Commit.**
  ```sh
  git add dashboard-web/src/components/ui/Button.tsx dashboard-web/src/components/
  git commit -m "$(cat <<'EOF'
  fix(ui-ux): visible focus rings on every interactive surface (P0-11)

  Button primary/destructive use a contrast ring (accent-fg) against
  their saturated bg. 14 focus:outline-none sites without a ring get
  focus-visible:ring-2 ring-accent appended. Keyboard nav now surfaces.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Wave 3 — Home Recompose + Per-Page Synthesis Layer

### Task 3.1: Kill duplicate KPI tiles on Home (17 → 6-8)

**Files:**
- Modify: `dashboard-web/src/components/Dashboard.tsx:389-436` (Home page composer)
- Modify: `dashboard-web/src/components/HomeLiveBand.tsx`
- Modify: `dashboard-web/src/components/HomeSummaryBand.tsx`
- Modify: `dashboard-web/src/components/HomePerStoreBand.tsx`
- Modify: `dashboard-web/src/components/TodayLive.tsx` (still owns Today data fetch; renders a single 4-tile band)
- Modify: `dashboard-web/src/components/HeroOverview.tsx` (simplified per Task 3.2)
- Modify: `dashboard-web/src/components/KpiCards.tsx` (deleted OR slimmed — see below)
- Create: `dashboard-web/src/components/home/CommandCenterGrid.tsx` (new consolidated 8-tile grid)

**Steps:**

- [ ] **Step 1: Map the source of every KPI to its NEW home** (honoring `[[no-info-loss-across-tabs]]`):

  | Metric | OLD location(s) | NEW location |
  |---|---|---|
  | ROAS (period) | TodayLive, HeroOverview, KpiCards | CommandCenterGrid (hero tile, 3× louder) |
  | Net Profit (period) | KpiCards, HeroOverview (Operating Profit) | CommandCenterGrid (hero tile, 3× louder) |
  | Revenue (period) | TodayLive, HeroOverview, KpiCards | CommandCenterGrid (secondary strip) |
  | Spend (period) | TodayLive, HeroOverview, KpiCards | CommandCenterGrid (secondary strip) |
  | Gross Profit | TodayLive, KpiCards | CommandCenterGrid (secondary strip) |
  | COGS | KpiCards | CommandCenterGrid (secondary strip) — STAYS, not removed |
  | CPM | TodayLive, HeroOverview | CommandCenterGrid (secondary strip) |
  | Orders | TodayLive | CommandCenterGrid (secondary strip) |
  | Goal % | GoalTracker (P&L) | **STAYS on P&L** per Q5 |
  | Today vs period sentence | TodayLive (existing editorial) | CommandCenterGrid title strip |

- [ ] **Step 2: Build CommandCenterGrid.** Layout: 2 hero tiles (Net Profit, ROAS) `density="hero"` `3×` size on the row, then a `grid grid-cols-3 sm:grid-cols-6` of secondary tiles (Revenue / Spend / Gross Profit / COGS / CPM / Orders) all `density="regular"`. Reads from `kpis.curAgg` + `cpmAgg` already wired through `HeroOverview`. Per-tile `<FreshnessBadge>` from Task 3.6.

- [ ] **Step 3: Delete `HomeLiveBand`, `HomeSummaryBand`, `KpiCards`.** Their data flows (TodayLive's `useTodayKpis` SWR; KpiCards' aggregation) become props/hooks consumed inside CommandCenterGrid.

- [ ] **Step 4: Rewire Dashboard.tsx Home section** to:
  ```tsx
  <Section>
    <Heading level="hero">בית</Heading>
    <PageScope store={...} platform={...} rangeLabel={...} />
  </Section>
  <CommandCenterGrid filters={filters} />
  <InsightsBoard ... />                       {/* Task 3.3 promotes this here */}
  <CampaignsTopList ... />
  <HomePerStoreBand ... />                     {/* refactored Task 3.4 */}
  <RoasTrendChart ... defaultCollapsed />
  ```

- [ ] **Step 5: Run `npm run test:components` (Home-related tests) and manual visual sweep.**

- [ ] **Step 6: Commit.**
  ```sh
  git add dashboard-web/src/components/home/ dashboard-web/src/components/Dashboard.tsx dashboard-web/src/components/HomeLiveBand.tsx dashboard-web/src/components/HomeSummaryBand.tsx dashboard-web/src/components/KpiCards.tsx dashboard-web/src/components/TodayLive.tsx dashboard-web/src/components/HomePerStoreBand.tsx
  git commit -m "$(cat <<'EOF'
  refactor(ui-ux): Home command-center grid; 17 KPI tiles → 8 (P0-7)

  Single CommandCenterGrid replaces TodayLive(6) + HeroOverview(5) +
  KpiCards(6). Net Profit + ROAS hero tiles 3x louder than secondary
  strip (Revenue/Spend/Gross/COGS/CPM/Orders). Every prior metric still
  surfaces — no info loss (per memory). GoalTracker stays on P&L (Q5).

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 3.2: Simplify HeroOverview decoration

**Files:**
- Modify: `dashboard-web/src/components/HeroOverview.tsx:276-290` (delete dot grid, delete cyan side-glow blob)
- Modify: `dashboard-web/src/components/HeroOverview.tsx:378+` (delete internal `RoasTrendChart` — moves to its own collapsible block on Home)

**Steps:**

- [ ] **Step 1: Strip decoration.** Delete the two `aria-hidden` decorative divs (dot grid and cyan blob). Keep the single intentional gradient (`bg-[linear-gradient...]` from Task 1.10).

- [ ] **Step 2: Extract `RoasTrendChart` block** to its own component file `dashboard-web/src/components/home/RoasTrendCollapsible.tsx` consumed by Dashboard Home below the per-store band.

- [ ] **Step 3: HeroOverview becomes the editorial-sentence header** of CommandCenterGrid (or merges into it entirely). Pick: merge — delete `HeroOverview.tsx`; move the editorial sentence into CommandCenterGrid's title row.

- [ ] **Step 4: Run tests + commit.**
  ```sh
  git add dashboard-web/src/components/home/ dashboard-web/src/components/HeroOverview.tsx dashboard-web/src/components/Dashboard.tsx
  git commit -m "$(cat <<'EOF'
  refactor(ui-ux): simplify Hero — one gradient, no dots, no blob

  HeroOverview's editorial sentence merges into CommandCenterGrid. The
  internal RoasTrendChart extracts to RoasTrendCollapsible (default
  collapsed). Decorative dot-grid + cyan side-glow deleted — one
  intentional gradient survives.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 3.3: Surface InsightsBoard out of `<details>` band 3

**Files:**
- Modify: `dashboard-web/src/components/Dashboard.tsx:389-436` (slot InsightsBoard above per-store band)
- Modify: `dashboard-web/src/components/HomePerStoreBand.tsx:17-22` (remove the `<details>` that wraps InsightsBoard)
- Modify: `dashboard-web/src/components/InsightsBoard.tsx` (use `CollapsibleSection` if collapse desired, default-open)

**Steps:**

- [ ] **Step 1: Move JSX.** Cut `<InsightsBoard ... />` out of HomePerStoreBand's `<details>` wrapper; render it directly as a first-class Home section, between CommandCenterGrid and CampaignsTopList.

- [ ] **Step 2: Replace InsightsBoard's outer hand-rolled card** with `<Card>` (Task 2.4 already migrated). Add `<CollapsibleSection title="תובנות" defaultOpen badge={items.length}>...</CollapsibleSection>` wrapper if persistent expand desired; default open.

- [ ] **Step 3: Run `npm run test:components`** → green.

- [ ] **Step 4: Commit.**
  ```sh
  git add dashboard-web/src/components/Dashboard.tsx dashboard-web/src/components/HomePerStoreBand.tsx dashboard-web/src/components/InsightsBoard.tsx
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): InsightsBoard promoted to Home band 1 (P0-7)

  Was buried in a raw <details> inside HomePerStoreBand band 3. Now
  renders directly above the per-store band, between CommandCenterGrid
  and CampaignsTopList — the 'what now?' answer surfaces immediately.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 3.4: Wire per-card click → drawer (drill-down entry points)

**Files:**
- Modify: `dashboard-web/src/components/PerStoreCards.tsx` (StoreCard onClick → opens Campaigns pre-filtered)
- Modify: `dashboard-web/src/components/home/CommandCenterGrid.tsx` (Stat onClick → drawer/drill)
- Modify: `dashboard-web/src/components/Dashboard.tsx` (filter context handling)

**Steps:**

- [ ] **Step 1: Add `onDrill` prop** to each Home Stat: clicking a Revenue tile filters Campaigns tab to the period; clicking a per-store card jumps to Campaigns tab pre-filtered by store.

- [ ] **Step 2: Use existing `urlState`** (`@/lib/urlState`) to update tab + filters atomically.

- [ ] **Step 3: Add `role="button" tabIndex={0}`** + keyboard `Enter` support to clickable cards. Apply `cursor-pointer hover:bg-elevated2` only when `onDrill` is set.

- [ ] **Step 4: Run `npm run test:components`** + manual.

- [ ] **Step 5: Commit.**
  ```sh
  git add dashboard-web/src/components/
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): Home cards become drill-down entry points (P1-11)

  PerStoreCards + CommandCenterGrid tiles wire onDrill → tab+filter
  state. Operator no longer needs to leave Home and re-filter. Keyboard
  Enter triggers same drill.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 3.5: Per-page TL;DR synthesis sentences

**Files:**
- Create: `dashboard-web/src/lib/synthesis/index.ts`
- Create: `dashboard-web/src/lib/synthesis/trends.ts`
- Create: `dashboard-web/src/lib/synthesis/archive.ts`
- Create: `dashboard-web/src/lib/synthesis/detail.ts`
- Create: `dashboard-web/src/lib/synthesis/pnl.ts`
- Create: `dashboard-web/src/lib/synthesis/__tests__/synthesis.test.ts`
- Create: `dashboard-web/src/components/ui/PageSynthesis.tsx`
- Modify: `dashboard-web/src/components/AnalysisTrendsTab.tsx`, `AnalysisArchiveTab.tsx`, `DetailTable.tsx`, `PnLBreakdown.tsx` (consume `<PageSynthesis text=...>`)

**Steps:**

- [ ] **Step 1: Write failing test cases** per page-synthesis rule:
  ```ts
  it('trends synthesizes a 7-day ROAS-direction sentence', () => {
    const points = [{ date: '2026-05-25', roas: 3.0 }, { date: '2026-05-31', roas: 2.76 }];
    const { text, confidence } = synthesizeTrends({ points, store: 'uzoshop', windowDays: 7 });
    expect(text).toMatch(/ROAS ירד 8/);
    expect(text).toMatch(/uzoshop/);
    expect(confidence).toBe('high');
  });
  it('returns confidence=low when data sparse', () => {
    expect(synthesizeTrends({ points: [], store: 'All', windowDays: 7 }).confidence).toBe('low');
  });
  ```

- [ ] **Step 2: Implement synthesis module.** Each per-page synthesizer returns `{ text: string; confidence: 'low'|'medium'|'high'; anchorMetric: string }`. Authoritative Hebrew tone per Q6. Sanity-check guards: skip if <3 data points; skip if anomaly detector (already present in `lib/insights/`) flags the window; clamp percentage claims to 1 decimal.

  Example signature in `lib/synthesis/trends.ts`:
  ```ts
  export interface TrendsInput { points: { date: string; roas: number }[]; store: string; windowDays: number; }
  export function synthesizeTrends(input: TrendsInput): { text: string; confidence: 'low'|'medium'|'high'; anchorMetric: string } {
    if (input.points.length < 3) return { text: '', confidence: 'low', anchorMetric: 'roas' };
    const first = input.points[0].roas, last = input.points.at(-1)!.roas;
    if (first === 0) return { text: '', confidence: 'low', anchorMetric: 'roas' };
    const delta = (last - first) / first;
    const dir = delta > 0 ? 'עלה' : 'ירד';
    const pct = Math.abs(delta * 100).toFixed(1);
    const storePart = input.store === 'All' ? '' : ` ב-${input.store}`;
    return { text: `ROAS ${dir} ${pct}% ב-${input.windowDays} הימים האחרונים${storePart}.`, confidence: 'high', anchorMetric: 'roas' };
  }
  ```

- [ ] **Step 3: Implement `<PageSynthesis>` UI primitive.** Renders the sentence in `level="section"` Heading, dimmed at `confidence='low'`, hidden when `text === ''`. Includes `<bdi>` wrap for store names.

- [ ] **Step 4: Wire into each page** above the existing content. Trends gets it above the chart, Archive above the year selector, Detail above the table, P&L above the breakdown.

- [ ] **Step 5: Run `npm test`** → green.

- [ ] **Step 6: Commit.**
  ```sh
  git add dashboard-web/src/lib/synthesis/ dashboard-web/src/components/ui/PageSynthesis.tsx dashboard-web/src/components/AnalysisTrendsTab.tsx dashboard-web/src/components/AnalysisArchiveTab.tsx dashboard-web/src/components/DetailTable.tsx dashboard-web/src/components/PnLBreakdown.tsx
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): per-page TL;DR synthesis layer (P1-13)

  lib/synthesis/ ships per-page synthesizers (trends/archive/detail/pnl)
  with confidence guards + anomaly skip + sparse-data clamps. Hebrew
  tone is authoritative per Q6. PageSynthesis primitive renders the
  sentence with bdi-wrapped store names.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 3.6: Freshness desaturation hook + FreshnessBadge

**Files:**
- Create: `dashboard-web/src/lib/hooks/useStaleness.ts`
- Create: `dashboard-web/src/components/ui/FreshnessBadge.tsx`
- Create: `dashboard-web/src/lib/__tests__/useStaleness.test.ts`
- Modify: `dashboard-web/src/app/globals.css` (add `[data-stale="true"]` CSS rules: drop chroma + reduce opacity)
- Modify: every Card surface from Task 2.4 (each card forwards `data-stale` from its freshness source)

**Steps:**

- [ ] **Step 1: Write failing test.**
  ```ts
  it('useStaleness returns desaturate=true after 30min (Q5 aggressive)', () => {
    const now = new Date('2026-05-31T12:00:00Z').getTime();
    const updatedAt = new Date('2026-05-31T11:25:00Z').toISOString();
    const { desaturate, freshness, ageMinutes } = computeStaleness(updatedAt, now);
    expect(ageMinutes).toBe(35);
    expect(desaturate).toBe(true);
    expect(freshness).toBe('stale');
  });
  it('returns fresh under 10 minutes', () => {
    const now = new Date('2026-05-31T12:00:00Z').getTime();
    const updatedAt = new Date('2026-05-31T11:55:00Z').toISOString();
    expect(computeStaleness(updatedAt, now).freshness).toBe('live');
  });
  ```

- [ ] **Step 2: Implement** `lib/hooks/useStaleness.ts`:
  ```ts
  export type Freshness = 'live' | 'recent' | 'aging' | 'stale';
  export interface StalenessResult { freshness: Freshness; ageMinutes: number; desaturate: boolean; label: string; }
  export function computeStaleness(updatedAt: string | null | undefined, now: number = Date.now()): StalenessResult {
    if (!updatedAt) return { freshness: 'stale', ageMinutes: Infinity, desaturate: true, label: '—' };
    const age = Math.floor((now - new Date(updatedAt).getTime()) / 60000);
    if (age <= 10) return { freshness: 'live', ageMinutes: age, desaturate: false, label: 'Live' };
    if (age <= 30) return { freshness: 'recent', ageMinutes: age, desaturate: false, label: `~${age}m` };
    if (age <= 120) return { freshness: 'aging', ageMinutes: age, desaturate: true, label: `~${Math.round(age/10)*10}m` };
    return { freshness: 'stale', ageMinutes: age, desaturate: true, label: 'Stale' };
  }
  import { useEffect, useState } from 'react';
  export function useStaleness(updatedAt: string | null | undefined): StalenessResult {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => { const id = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(id); }, []);
    return computeStaleness(updatedAt, now);
  }
  ```

- [ ] **Step 3: Implement FreshnessBadge:**
  ```tsx
  export function FreshnessBadge({ updatedAt }: { updatedAt: string | null | undefined }) {
    const { freshness, label } = useStaleness(updatedAt);
    const tone = freshness === 'live' ? 'bg-status-green' : freshness === 'recent' ? 'bg-status-gray' : freshness === 'aging' ? 'bg-status-warning' : 'bg-status-warning';
    return (
      <span className="inline-flex items-center gap-1 text-[10px] text-ink-muted">
        <span aria-hidden className={cn('inline-block w-1.5 h-1.5 rounded-full', tone)} />
        <bdi dir="ltr">{label}</bdi>
      </span>
    );
  }
  ```

- [ ] **Step 4: Add CSS desaturation hook** in globals.css:
  ```css
  /* Q5 aggressive stale: drop chart chroma to 30% + reduce value opacity to 70% after 30min */
  [data-stale="true"] .recharts-line path,
  [data-stale="true"] .recharts-area path { filter: saturate(0.3); }
  [data-stale="true"] [data-stat-value],
  [data-stale="true"] .tabular-nums { opacity: 0.7; }
  ```

- [ ] **Step 5: Update Card primitive** to accept `stale?: boolean` prop and forward as `data-stale={stale ? 'true' : undefined}`. Stat primitive value gets `data-stat-value` attribute.

- [ ] **Step 6: Pipe freshness** into CommandCenterGrid + InsightsBoard + per-store cards via `data_freshness` lookup helper (already present per `[[freshness-phase-a-shipped]]` memory).

- [ ] **Step 7: Run tests + commit.**
  ```sh
  git add dashboard-web/src/lib/hooks/useStaleness.ts dashboard-web/src/components/ui/FreshnessBadge.tsx dashboard-web/src/lib/__tests__/useStaleness.test.ts dashboard-web/src/app/globals.css dashboard-web/src/components/ui/Card.tsx dashboard-web/src/components/ui/Stat.tsx dashboard-web/src/components/
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): useStaleness hook + FreshnessBadge with stale desaturation (P1-1, Q5)

  Aggressive Q5 thresholds: live <=10m, recent <=30m, aging <=2h, stale >2h.
  data-stale=true drops chart chroma to 30% saturation and value opacity
  to 70%. Card + Stat primitives forward data-stale. Pipes through
  data_freshness lookup for every Home card surface.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Wave 4 — RTL Sweep & Bidi P0 Fixes

### Task 4.1: Fix `→` arrows in CampaignsTopList verdict text

**Files:**
- Modify: `dashboard-web/src/components/CampaignsTopList.tsx:81,83,84,86,88,89`
- Test: extend `bidi.dom.test.tsx`

**Steps:**

- [ ] **Step 1: Replace** `'→ הגדל...'` with `'← הגדל...'` for all 6 verdict strings — Hebrew flows right-to-left, so the arrow that visually points to the next action is left-pointing. Better: use a Lucide icon component `<ArrowLeft size={12} />` (logical arrow flips in RTL via CSS transforms only when needed; lucide `ArrowLeft` reads right-to-left in `dir=rtl`).

- [ ] **Step 2: Write DOM test:**
  ```tsx
  it('verdict text uses logical leftward arrow in RTL', () => {
    const { container } = render(<CampaignsTopList data={[mockRow]} title="t" />);
    const verdicts = container.querySelectorAll('[data-verdict]');
    verdicts.forEach(v => { expect(v.textContent).not.toContain('→'); });
  });
  ```

- [ ] **Step 3: Run + commit.**
  ```sh
  git add dashboard-web/src/components/CampaignsTopList.tsx dashboard-web/src/components/__tests__/bidi.dom.test.tsx
  git commit -m "$(cat <<'EOF'
  fix(ui-ux): CampaignsTopList verdict arrows point with reading flow (P0-14)

  6 verdict strings used physical → in Hebrew RTL context — visually
  pulling the eye left where the text reads right. Switched to logical
  Lucide ArrowLeft icons.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 4.2: Wrap mixed Hebrew/English interpolations in `<bdi>`

**Files:**
- Modify: `dashboard-web/src/components/CommandPalette.tsx:273,322`
- Modify: `dashboard-web/src/components/AdsDrawer.tsx:336,459`
- Modify: `dashboard-web/src/components/CampaignsTopList.tsx:54,104`

**Steps:**

- [ ] **Step 1: For each site,** wrap the campaign/ad/store name interpolation in `<bdi>{name}</bdi>` so Unicode bidi doesn't reorder mixed Hebrew + English + numerals. Example pattern:
  ```tsx
  // Before
  <span>{campaign.name} — {campaign.store}</span>
  // After
  <span><bdi>{campaign.name}</bdi> — <bdi>{campaign.store}</bdi></span>
  ```

- [ ] **Step 2: Extend `bidi.dom.test.tsx`** with one assertion per file.

- [ ] **Step 3: Run + commit.**
  ```sh
  git add dashboard-web/src/components/ dashboard-web/src/components/__tests__/bidi.dom.test.tsx
  git commit -m "$(cat <<'EOF'
  fix(ui-ux): bdi-wrap mixed Hebrew/English interpolations (P0-14)

  CommandPalette campaign+product label/subtitle, AdsDrawer ad/ad-set
  names, CampaignsTopList name+platform now isolate weak-LTR runs from
  surrounding Hebrew. Eliminates bidi reorder of 'Summer Sale 2026' /
  product IDs / store-name mixes.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 4.3: Migrate 7 hand-built `CAD ${n}` sites to `formatCAD()`

**Files (7 sites confirmed):**
- `dashboard-web/src/components/BillingSettings.tsx:589,999`
- `dashboard-web/src/components/PnLBreakdown.tsx:309`
- `dashboard-web/src/components/CampaignsTable.tsx:2265,2278,2296`
- `dashboard-web/src/components/CampaignsTopList.tsx:120`
- `dashboard-web/src/components/InsightsPanel.tsx:52,66`
- `dashboard-web/src/components/CohortComparisonPanel.tsx:179,429-432`
- `dashboard-web/src/components/PerStoreCards.tsx:152,153,184`
- `dashboard-web/src/components/ProductsTable.tsx:860,863`
- `dashboard-web/src/components/HeroOverview.tsx:198,240,390`
- `dashboard-web/src/components/ProductCentricView.tsx:75,666`
- `dashboard-web/src/components/AttributionAnalysisPanel.tsx:97,108`
- `dashboard-web/src/components/ProductChannelBreakdown.tsx:115`

**Steps:**

- [ ] **Step 1: Reconcile `lib/utils.ts` vs `lib/format.ts` bifurcation (P1-7).** `formatCurrency`/`formatNumber` (string-returning) consumers fall into two camps: ones that pass the string to text content (replace with `fmtMoney(n)` returning ReactElement), and ones that pass to `aria-label`/`title=` (keep string but route through `fmtMoneyString(n)` new helper). Add `fmtMoneyString(n, code='CAD')` to `format.ts`:
  ```ts
  export function fmtMoneyString(n: number, code: string = 'CAD'): string {
    return `${code} ${fixMinus(MONEY.format(Math.round(n)))}`;
  }
  ```

- [ ] **Step 2: Mechanical replace per site.** Pattern:
  ```tsx
  // Before
  `CAD ${formatCurrency(value)}`
  // After (when text content)
  {fmtMoney(value)}
  // After (when string context — aria-label, title prop)
  {fmtMoneyString(value)}
  ```
  Tool tip strings (`title={...}` with embedded `CAD ${...}`) should be migrated to `Tooltip` per Task 2.6 and use `<bdi>`-wrapped `fmtMoney` in the tooltip content.

- [ ] **Step 3: Delete `formatCurrency` / `formatNumber`** from `lib/utils.ts`. Replace `formatNumber` callers with `fmtCount` (ReactElement) or a new `fmtCountString` per the same string/element split.

- [ ] **Step 4: Run `npm test && npm run test:components`** → green.

- [ ] **Step 5: Commit.**
  ```sh
  git add dashboard-web/src/lib/format.ts dashboard-web/src/lib/utils.ts dashboard-web/src/components/
  git commit -m "$(cat <<'EOF'
  fix(ui-ux): hand-built CAD ${n} → fmtMoney/fmtMoneyString (P0-14, P1-7)

  Reconciles lib/utils.ts (string) vs lib/format.ts (ReactElement) drift.
  Text-content sites use fmtMoney (bdi-wrapped element). String contexts
  (aria-label, title) use new fmtMoneyString. Currency code can no longer
  detach from number under bidi reorder.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 4.4: Migrate 47 physical-direction Tailwind classes to logical equivalents

**Files (top 10 offenders, full list above):**
- `BillingSettings.tsx` (~31 hits incl. wider regex), `CampaignsTable.tsx` (~31), `operator/ManualOverridesCrud.tsx` (~17), `ProductsTable.tsx` (~15), `CampaignDrawer.tsx` (~15), `operator/CronTickSnapshotsViewer.tsx` (~12), `MonthlyTables.tsx` (~12), `AnnotationsPanel.tsx` (~12), `ProductCentricView.tsx` (~10), `PnLBreakdown.tsx` (~9), `BillingCsvImport.tsx` (~9), `ProductPickerModal.tsx` (~8), `Dashboard.tsx` (~8), `CohortComparisonPanel.tsx` (~8), `operator/JobsTable.tsx` (~7)

**Codemod pattern (verbatim find/replace, word-boundary safe):**

| Physical | Logical |
|---|---|
| `\bml-` | `ms-` |
| `\bmr-` | `me-` |
| `\bpl-` | `ps-` |
| `\bpr-` | `pe-` |
| `\bleft-` | `start-` |
| `\bright-` | `end-` |
| `border-l\b` (no `-line`) | `border-s` |
| `border-r\b` (no `-line`) | `border-e` |
| `border-l-` | `border-s-` |
| `border-r-` | `border-e-` |
| `rounded-l-` | `rounded-s-` |
| `rounded-r-` | `rounded-e-` |
| `rounded-tl-` | `rounded-ss-` |
| `rounded-tr-` | `rounded-se-` |
| `rounded-bl-` | `rounded-es-` |
| `rounded-br-` | `rounded-ee-` |
| `text-right` | `text-end` |
| `text-left` | `text-start` |

**Steps:**

- [ ] **Step 1: Verify Tailwind logical support** — Tailwind 3.x supports `ms-*` / `me-*` / `ps-*` / `pe-*` / `start-*` / `end-*` / `border-s*` / `rounded-s*` / `text-start` / `text-end` out of the box. Confirm by `grep -rn "ms-" dashboard-web/src/components/ui/` to see existing logical usage (Stat.tsx uses `pe-1`).

- [ ] **Step 2: Write a codemod script** `dashboard-web/scripts/codemod-physical-to-logical.mjs`:
  ```js
  import { readFileSync, writeFileSync } from 'fs';
  import { execSync } from 'child_process';
  const files = execSync(`grep -rlE "\\b(ml-|mr-|pl-|pr-|left-|right-|border-l|border-r|rounded-l|rounded-r|rounded-tl|rounded-tr|rounded-bl|rounded-br|text-right|text-left)" dashboard-web/src/components --include='*.tsx'`).toString().trim().split('\n');
  const REPLACEMENTS = [
    [/\bml-/g, 'ms-'],
    [/\bmr-/g, 'me-'],
    [/\bpl-/g, 'ps-'],
    [/\bpr-/g, 'pe-'],
    [/\bleft-(\d|\[|auto|full)/g, 'start-$1'],
    [/\bright-(\d|\[|auto|full)/g, 'end-$1'],
    [/\bborder-l-/g, 'border-s-'],
    [/\bborder-r-/g, 'border-e-'],
    [/\bborder-l\b/g, 'border-s'],
    [/\bborder-r\b/g, 'border-e'],
    [/\brounded-l-/g, 'rounded-s-'],
    [/\brounded-r-/g, 'rounded-e-'],
    [/\brounded-tl-/g, 'rounded-ss-'],
    [/\brounded-tr-/g, 'rounded-se-'],
    [/\brounded-bl-/g, 'rounded-es-'],
    [/\brounded-br-/g, 'rounded-ee-'],
    [/\btext-right\b/g, 'text-end'],
    [/\btext-left\b/g, 'text-start'],
  ];
  for (const f of files) {
    let c = readFileSync(f, 'utf8'), orig = c;
    for (const [r, s] of REPLACEMENTS) c = c.replace(r, s);
    if (c !== orig) writeFileSync(f, c);
  }
  console.log(`Migrated ${files.length} files`);
  ```

- [ ] **Step 3: Run codemod, then `npm run typecheck && npm run lint && npm test && npm run test:components`** → green. Manual visual scan in light + dark, LTR + RTL.

- [ ] **Step 4: Inspect operator-tables column alignment** specifically — JobsTable, ManualOverridesCrud, CronTickSnapshotsViewer, TodayLive all had `text-right`/`text-left` in `<td>`. After migration to `text-end`/`text-start`, verify the cells align to the correct edge in RTL view.

- [ ] **Step 5: Commit.**
  ```sh
  git add dashboard-web/src/components/ dashboard-web/scripts/codemod-physical-to-logical.mjs
  git commit -m "$(cat <<'EOF'
  refactor(ui-ux): 47 physical-direction classes → logical (P1-6)

  Codemod sweeps ml-/mr-/pl-/pr-/left-/right-/border-l*/rounded-l*/
  text-right/text-left across 15 component files. Top offenders:
  BillingSettings (31), CampaignsTable (31), ManualOverridesCrud (17).
  Operator-tables column alignment verified in RTL.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 4.5: ESLint rule banning physical-direction classes in `src/components/**`

**Files:**
- Create: `dashboard-web/eslint-rules/no-physical-direction-in-components.js`
- Modify: `dashboard-web/eslint.config.js`

**Steps:**

- [ ] **Step 1: Author rule** (same shape as `no-legacy-tailwind-class.js`):
  ```js
  const PHYSICAL = /\b(ml-\d|mr-\d|pl-\d|pr-\d|left-\d|right-\d|border-(l|r)(\b|-)|rounded-(l|r|tl|tr|bl|br)-|text-(right|left)\b)/;
  export default {
    meta: { type: 'problem', docs: { description: 'Forbid physical-direction Tailwind classes; use logical (start/end/s/e/me/ms/ps/pe).' } },
    create(context) {
      const f = context.getFilename();
      if (f.includes('__tests__') || f.includes('/eslint-rules/')) return {};
      function check(node, value) {
        if (typeof value !== 'string') return;
        const m = value.match(PHYSICAL);
        if (m) context.report({ node, message: `Physical-direction class "${m[0]}" — use logical equivalent (ms/me/ps/pe/start/end/border-s/border-e/rounded-s/rounded-e/text-start/text-end).` });
      }
      return {
        Literal(node) { check(node, node.value); },
        TemplateElement(node) { check(node, node.value.raw); },
      };
    },
  };
  ```

- [ ] **Step 2: Register + run lint** → expect green after Task 4.4.

- [ ] **Step 3: Commit.**
  ```sh
  git add dashboard-web/eslint-rules/no-physical-direction-in-components.js dashboard-web/eslint.config.js
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): ESLint rule blocks physical-direction classes (P1-6)

  Prevents the 47-class regression we just swept. Allowlist: __tests__,
  eslint-rules/. Catches ml-/mr-/pl-/pr-/left-/right-/border-l/-r,
  rounded-l/-r corners, text-right/text-left.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 4.6: Add `dir="ltr"` to 5 Recharts containers + `ChartContainer` default

**Files:**
- Modify: `dashboard-web/src/components/ui/chart/ChartContainer.tsx` (default `dir="ltr"` on the wrapper)
- Modify: `dashboard-web/src/components/RoasChart.tsx`, `HeroOverview.tsx` (main + secondary chart), `QuadrantScatter.tsx`, `MetaShopifyReconciliation.tsx`, `CampaignDrawer.tsx` (ROAS-trend chart at ~line 1118 — verify dir prop)

**Steps:**

- [ ] **Step 1: Update ChartContainer** to ship `dir="ltr"` on its root `<div>` by default; allow opt-out via prop. Remove the now-redundant explicit `dir="ltr"` in CampaignsTable.tsx:1523 and CampaignDrawer.tsx:1118.

- [ ] **Step 2: Verify each of the 5 containers** now renders with `dir="ltr"` via DOM test:
  ```tsx
  it('all ChartContainer instances render with dir=ltr', () => {
    const { container } = render(<RoasChart data={mock} />);
    expect(container.querySelector('[data-chart-container]')!.getAttribute('dir')).toBe('ltr');
  });
  ```

- [ ] **Step 3: Run + commit.**
  ```sh
  git add dashboard-web/src/components/ui/chart/ChartContainer.tsx dashboard-web/src/components/
  git commit -m "$(cat <<'EOF'
  fix(ui-ux): ChartContainer ships dir=ltr by default (P1-16)

  5 of 7 chart containers previously did not set dir=ltr, causing
  inconsistent tooltip cursor offset + custom-label x offset under RTL.
  Default landed on ChartContainer; explicit overrides in CampaignsTable
  + CampaignDrawer removed.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 4.7: Add `dir="auto"` defaults to text inputs

**Files:**
- Modify: `dashboard-web/src/components/ui/Input.tsx` (default `dir="auto"` on `<input type="text|search">` + `<textarea>`)
- Modify: `dashboard-web/src/components/AnnotationsPanel.tsx` (free-text annotation input)
- Modify: `dashboard-web/src/components/ProductsTable.tsx` (search box)
- Modify: operator forms (BillingSettings notes, ManualOverridesCrud notes)

**Steps:**

- [ ] **Step 1: Update Input primitive default.** `dir="auto"` lets the browser choose direction based on first strong character — Hebrew typed inputs read right-to-left, English left-to-right, automatically.

- [ ] **Step 2: Sweep operator/annotation-entry sites.** Search inputs and number inputs should NOT get `dir="auto"` (numerics are weak-LTR); leave numeric inputs alone.

- [ ] **Step 3: Commit.**
  ```sh
  git add dashboard-web/src/components/ui/Input.tsx dashboard-web/src/components/AnnotationsPanel.tsx dashboard-web/src/components/ProductsTable.tsx dashboard-web/src/components/BillingSettings.tsx
  git commit -m "$(cat <<'EOF'
  fix(ui-ux): text inputs default to dir=auto (RTL freshness)

  Input primitive applies dir=auto for type=text/search/textarea so
  Hebrew vs English typing reads correctly without an explicit prop.
  Numeric inputs stay LTR. Annotation + operator notes + ProductsTable
  search all benefit.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 4.8: Flip Sidebar collapse chevron — logical, not physical

**Files:**
- Modify: `dashboard-web/src/components/Sidebar.tsx:7,170`

**Steps:**

- [ ] **Step 1: Replace** `ChevronsLeft` / `ChevronsRight` (physical) with a logical pattern:
  ```tsx
  import { PanelRightOpen, PanelRightClose } from 'lucide-react';
  // ...
  {collapsed ? <PanelRightOpen size={14} /> : <PanelRightClose size={14} />}
  ```
  Lucide `PanelRight*` icons read coherently in RTL (sidebar is on the right edge). Alternatively wrap a single `<ChevronLeft className="rtl:rotate-180" />` but `PanelRight*` is more semantic.

- [ ] **Step 2: Update DOM test `sidebarHoverState.dom.test.tsx`** if it asserts on specific icon name.

- [ ] **Step 3: Commit.**
  ```sh
  git add dashboard-web/src/components/Sidebar.tsx dashboard-web/src/components/__tests__/sidebarHoverState.dom.test.tsx
  git commit -m "$(cat <<'EOF'
  fix(ui-ux): Sidebar collapse chevron uses logical PanelRight icons (P2-6)

  ChevronsLeft/ChevronsRight were physical-direction; in RTL the sidebar
  is on the right edge so collapse should point toward the panel's edge,
  not 'left' in screen space. Switched to Lucide PanelRightOpen/Close.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 4.9: Extend `bidi.dom.test.tsx` regression coverage

**Files:**
- Modify: `dashboard-web/src/components/__tests__/bidi.dom.test.tsx`

**Steps:**

- [ ] **Step 1: Add a render+assert per file** swept in Tasks 4.1-4.3 — assert each renders without raw `→`/`←` in interpolation positions, each name interpolation is inside a `<bdi>`, each CAD literal is inside a `<bdi>` (looking at `formatCAD` output structure).

- [ ] **Step 2: Run + commit.**
  ```sh
  git add dashboard-web/src/components/__tests__/bidi.dom.test.tsx
  git commit -m "$(cat <<'EOF'
  test(ui-ux): bidi regression — expand coverage to 6 swept components

  CampaignsTopList, CommandPalette, AdsDrawer, BillingSettings,
  PnLBreakdown, CampaignsTable all assert <bdi> wraps + no physical
  arrows in verdict-text positions.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Wave 5 — Per-Page Polish + CampaignDrawer Split

### Task 5.1: Operator — default to Health tab + add top-level status pill

**Files:**
- Modify: `dashboard-web/src/app/operator/page.tsx:42-58`
- Create: `dashboard-web/src/app/operator/StatusPill.tsx`

**Steps:**

- [ ] **Step 1: Change default tab** from `'sync'` → `'health'`. Persisted via URL param `?tab=health` default.

- [ ] **Step 2: Build StatusPill.** Reads aggregate health from existing health endpoints (token failures, cron lag, freshness coverage). Renders one of: `הכל ירוק` (green), `N בעיות` (warning), `מערכת ב-OUTAGE` (red). Lives in the operator page header next to the tab strip.

- [ ] **Step 3: Run + commit.**
  ```sh
  git add dashboard-web/src/app/operator/
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): Operator defaults to Health + top-level status pill (P1-21)

  Operator's first question is 'is anything broken?'. Default tab now
  Health (was Sync). New StatusPill at top: 'הכל ירוק' / 'N בעיות' /
  'OUTAGE' from health/token/cron aggregation.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 5.2: Unify Operator refresh paradigms

**Files:**
- Modify: `dashboard-web/src/app/operator/HealthTab.tsx`, `SyncTab.tsx`, `ActivityTab.tsx`, `DangerTab.tsx` (one `useSWR` cadence for all live data)

**Steps:**

- [ ] **Step 1: Inventory.** Operator currently mixes 15s SWR / 30s SWR / no-refresh server components. Pick one: **15s SWR for all sub-tabs**, plus a manual "רענן" button in the Operator header that bypasses cache.

- [ ] **Step 2: Migrate ActivityTab + SyncTab** from any server-component data fetch to client SWR with 15s polling. Apply `useStaleness` per panel.

- [ ] **Step 3: Commit.**
  ```sh
  git add dashboard-web/src/app/operator/
  git commit -m "$(cat <<'EOF'
  refactor(ui-ux): Operator — single SWR cadence (15s) across 4 sub-tabs

  Previous mix (15s SWR / 30s SWR / RSC no-refresh) made 'is data fresh?'
  unpredictable. Unified to 15s SWR + manual Refresh button in operator
  header. Stale-data desaturation applies via useStaleness.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 5.3: Fix Analysis-Archive silently ignoring the global store filter

**Files:**
- Modify: `dashboard-web/src/components/AnalysisArchiveTab.tsx:13` (consume `globalStore`)
- Modify: `dashboard-web/src/components/Dashboard.tsx` (AnalysisTab wrapper around Trends/Archive)

**Steps:**

- [ ] **Step 1: Two-line fix at AnalysisArchiveTab.** Remove the `// Unused` comment; pass `globalStore` into the inner MonthlyTables query.

- [ ] **Step 2: DOM test:**
  ```tsx
  it('AnalysisArchiveTab filters MonthlyTables by global store', () => {
    const { container } = render(<AnalysisArchiveTab globalStore="uzoshop" ... />);
    // assert MonthlyTables receives the filter
  });
  ```

- [ ] **Step 3: Run + commit.**
  ```sh
  git add dashboard-web/src/components/AnalysisArchiveTab.tsx dashboard-web/src/components/__tests__/
  git commit -m "$(cat <<'EOF'
  fix(ui-ux): Archive honors global store filter (P0-15)

  AnalysisArchiveTab now consumes globalStore (was documented unused).
  Operator changing the dropdown no longer silently no-ops on this tab.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 5.4: Migrate 4 hand-rolled collapsibles to `CollapsibleSection`

**Files:**
- Modify: `dashboard-web/src/components/HomePerStoreBand.tsx:17-22` (already partly done in Task 3.3 — verify)
- Modify: `dashboard-web/src/components/InsightsBoard.tsx:103-422`
- Modify: `dashboard-web/src/components/AnnotationsPanel.tsx:54-122`
- Modify: `dashboard-web/src/components/PnLBreakdown.tsx:69,316-381`

**Steps:**

- [ ] **Step 1: Replace each `<details>...</details>`** with `<CollapsibleSection title="..." defaultOpen={true|false} persistKey="unique-key" badge={count}>...</CollapsibleSection>`. `persistKey` writes to localStorage so the operator's expand preference survives reload.

- [ ] **Step 2: Run DOM tests** including keyboard chord (Space toggles, Tab cycles to next focusable).

- [ ] **Step 3: Commit.**
  ```sh
  git add dashboard-web/src/components/
  git commit -m "$(cat <<'EOF'
  refactor(ui-ux): 4 hand-rolled <details> → CollapsibleSection (P1-8)

  HomePerStoreBand, InsightsBoard, AnnotationsPanel, PnLBreakdown-by-source
  all consume the primitive with persisted expand state. ~120 lines of
  duplicated toggle state deleted.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 5.5: Split CampaignDrawer into sub-tabs (single hard cut)

**Files:**
- Modify: `dashboard-web/src/components/CampaignDrawer.tsx` (becomes a thin shell with Tabs)
- Create: `dashboard-web/src/components/campaign-drawer/Overview.tsx`
- Create: `dashboard-web/src/components/campaign-drawer/Daily.tsx`
- Create: `dashboard-web/src/components/campaign-drawer/AdSets.tsx`
- Create: `dashboard-web/src/components/campaign-drawer/Ads.tsx`
- Create: `dashboard-web/src/components/campaign-drawer/Status.tsx`
- Create: `dashboard-web/src/components/campaign-drawer/History.tsx`
- Modify: `dashboard-web/src/components/__tests__/campaignDrawerStoreMapV2.dom.test.tsx`, `campaignDrawerStatusSectionFull.dom.test.tsx` (update for new sub-tab structure)

**Steps:**

- [ ] **Step 1: Extract the 6 sub-tab boundaries from the 1619-line file.** Map:
  - **Overview** = `status + health badges + KPI Stat grid + spend↔value chart` (current top ~600 lines)
  - **Daily** = `daily-table + ROAS-trend chart + CPM chart`
  - **AdSets** = `<AdSetTable>` block
  - **Ads** = `ProductChannelBreakdown + AdsDrawer trigger (deep)` — but ad-level drilldown stays via AdsDrawer for now
  - **Status** = `CampaignDrawerStatusSection + ManualMapping + MetaShopifyReconciliation`
  - **History** = `AttributionAnalysisPanel + CohortComparisonPanel + status_events history`

- [ ] **Step 2: Build shell.**
  ```tsx
  // CampaignDrawer.tsx
  export function CampaignDrawer({ campaignId, ...props }: Props) {
    const [tab, setTab] = useState<'overview'|'daily'|'adsets'|'ads'|'status'|'history'>('overview');
    return (
      <Sheet open onOpenChange={props.onClose}>
        <Sheet.Header sticky>
          <Heading level="hero"><bdi>{campaign.name}</bdi></Heading>
          <PageScope store={campaign.store} platform={campaign.platform} rangeLabel={rangeLabel} />
        </Sheet.Header>
        <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
          <Tabs.List>
            <Tabs.Trigger value="overview">סקירה</Tabs.Trigger>
            <Tabs.Trigger value="daily">יומי</Tabs.Trigger>
            <Tabs.Trigger value="adsets">קבוצות מודעות</Tabs.Trigger>
            <Tabs.Trigger value="ads">מודעות</Tabs.Trigger>
            <Tabs.Trigger value="status">סטטוס ומיפוי</Tabs.Trigger>
            <Tabs.Trigger value="history">היסטוריה</Tabs.Trigger>
          </Tabs.List>
          <Tabs.Content value="overview"><CampaignDrawerOverview campaignId={campaignId} /></Tabs.Content>
          {/* ... five more ... */}
        </Tabs>
      </Sheet>
    );
  }
  ```

- [ ] **Step 3: Move each block of original JSX + helpers** to its sub-tab file. `DrawerStat` already migrated to `Stat` in Wave 2.

- [ ] **Step 4: Manual test checklist (Q10 — hard cut, no flag):**
  - [ ] Open drawer on uzoshop Meta campaign → 6 tabs render
  - [ ] Tab through with keyboard
  - [ ] Switch each tab; verify data loads (overview KPIs, daily chart, ad sets table populated, ads drawer trigger works)
  - [ ] Close × visible (Task 2.5 fix)
  - [ ] Mobile: drawer is single column, tabs scroll horizontally if overflow
  - [ ] RTL: tabs read right→left, content reads right→left
  - [ ] Dark mode: all 6 sub-tabs OK
  - [ ] Stale data: tab content desaturates per Task 3.6

- [ ] **Step 5: Update existing tests** to render the right sub-tab.

- [ ] **Step 6: Commit.**
  ```sh
  git add dashboard-web/src/components/campaign-drawer/ dashboard-web/src/components/CampaignDrawer.tsx dashboard-web/src/components/__tests__/
  git commit -m "$(cat <<'EOF'
  refactor(ui-ux): CampaignDrawer split into 6 sub-tabs, single hard cut (P1-17, Q10)

  1619-line file becomes a shell + 6 focused files in
  components/campaign-drawer/ (Overview/Daily/AdSets/Ads/Status/History).
  No feature flag per Q10. Manual test checklist completed before merge.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 5.6: Add insight action buttons (drawer-default + Ads Manager deep-link)

**Files:**
- Modify: `dashboard-web/src/components/InsightsBoard.tsx`
- Modify: `dashboard-web/src/components/WhatsWorking.tsx`
- Modify: `dashboard-web/src/components/InsightsPanel.tsx`
- Modify: `dashboard-web/src/components/HealthScorePanel.tsx`
- Modify: `dashboard-web/src/components/AttributionAnalysisPanel.tsx`
- Modify: `dashboard-web/src/components/CampaignsTopList.tsx`
- Modify: `dashboard-web/src/components/MetaShopifyReconciliation.tsx`
- Create: `dashboard-web/src/lib/adsManagerDeepLinks.ts` (Meta/Google/TikTok URL builders)

**Steps:**

- [ ] **Step 1: Build deep-link helper.**
  ```ts
  export function adsManagerLink(platform: 'Meta'|'Google'|'TikTok', campaignId: string, accountId?: string): string | null {
    if (platform === 'Meta') return `https://www.facebook.com/adsmanager/manage/campaigns?act=${accountId}&selected_campaign_ids=${campaignId}`;
    if (platform === 'Google') return `https://ads.google.com/aw/campaigns?campaignId=${campaignId}`;
    if (platform === 'TikTok') return `https://ads.tiktok.com/i18n/perf?advertiser_id=${accountId}&campaign_id=${campaignId}`;
    return null;
  }
  ```

- [ ] **Step 2: Add `InsightActions` UI** consumed by every insight panel:
  ```tsx
  export function InsightActions({ campaignId, platform, accountId, onOpenDrawer }: Props) {
    const deep = adsManagerLink(platform, campaignId, accountId);
    return (
      <div className="flex items-center gap-2 mt-2">
        <Button size="sm" variant="primary" onClick={onOpenDrawer}>פתח דרור</Button>
        {deep && <Button size="sm" variant="link" asChild><a href={deep} target="_blank" rel="noreferrer">פתח ב-{platform} Ads Manager</a></Button>}
      </div>
    );
  }
  ```

- [ ] **Step 3: Wire into 6 panels.** Each panel emits an action row at the bottom of each insight row.

- [ ] **Step 4: Commit.**
  ```sh
  git add dashboard-web/src/components/ dashboard-web/src/lib/adsManagerDeepLinks.ts
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): InsightActions on 6 panels — drawer + Ads Manager deep-link (P1-10, Q7)

  Primary CTA opens the in-app CampaignDrawer (context); secondary
  'פתח ב-Meta/Google/TikTok Ads Manager' (action) per Q7. InsightsBoard,
  WhatsWorking, InsightsPanel, HealthScorePanel, AttributionAnalysisPanel,
  CampaignsTopList, MetaShopifyReconciliation all get the row.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 5.7: Fix AdsDrawer silently masking API errors

**Files:**
- Modify: `dashboard-web/src/components/AdsDrawer.tsx:56-60`
- Modify (same pattern): `MonthlyTables` SWR fetcher, `Filters` SWR fetcher

**Steps:**

- [ ] **Step 1: Replace** `if (!r.ok) return { rows: [], ... }` with `if (!r.ok) throw new Error(\`HTTP ${r.status} ${r.statusText}\`)`. Let SWR's `error` state surface so the consumer can render a real error state.

- [ ] **Step 2: Render error state** in AdsDrawer: "שגיאת API בטעינת מודעות. נסה לרענן." with a Refresh button.

- [ ] **Step 3: DOM test:**
  ```tsx
  it('AdsDrawer surfaces 500 as error, not empty rows', async () => {
    server.use(rest.get('/api/ads/...', (_, res, ctx) => res(ctx.status(500))));
    const { findByText } = render(<AdsDrawer ... />);
    expect(await findByText(/שגיאת API/)).toBeInTheDocument();
  });
  ```

- [ ] **Step 4: Commit.**
  ```sh
  git add dashboard-web/src/components/AdsDrawer.tsx dashboard-web/src/components/MonthlyTables.tsx dashboard-web/src/components/Filters.tsx
  git commit -m "$(cat <<'EOF'
  fix(ui-ux): AdsDrawer + 2 SWR fetchers throw on !r.ok (P0-9)

  Was silently returning empty rows on any non-200 → operator believed
  'no ads' when the API failed. Now throws; SWR error state renders
  'שגיאת API. נסה לרענן.' with manual refresh. Same fix applied to
  MonthlyTables + Filters fetchers.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 5.8: Slim sidebar to 72px icon-rail default

**Files:**
- Modify: `dashboard-web/src/components/Sidebar.tsx` (default collapsed, hover-to-expand, persisted preference)

**Steps:**

- [ ] **Step 1: Change default state** to `collapsed = true` (was `false`). Add `useEffect` to read from localStorage `sidebar-collapsed` (default 'true' per Q10).

- [ ] **Step 2: Add hover-to-expand.** When mouse enters the collapsed rail, expand to 240px via `onMouseEnter`/`onMouseLeave`. Persist the explicit Collapse-Toggle as the "sticky" preference; hover is ephemeral. Width transitions at `--motion-base 240ms`.

- [ ] **Step 3: Set rail width** `w-[72px]` collapsed (was `w-16` = 64px), `w-60` expanded (240px) unchanged.

- [ ] **Step 4: Update DOM tests** in `Sidebar.dom.test.tsx`, `sidebarHoverState.dom.test.tsx`.

- [ ] **Step 5: Commit.**
  ```sh
  git add dashboard-web/src/components/Sidebar.tsx dashboard-web/src/components/__tests__/
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): slim 72px icon-rail sidebar default (P1-23, Q10)

  Collapses by default + hover-to-expand. Explicit collapse-toggle is
  the sticky preference (persisted to localStorage); hover is ephemeral.
  Reclaims ~180px for chart/table content. RTL keeps sidebar on right
  edge.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 5.9: Apply `PageScope` to every top-level page

**Files:**
- Modify: `dashboard-web/src/components/Dashboard.tsx` (Home + P&L + Trends + Archive + Detail + Campaigns + Products page sections — line ~409, ~458, ~588, ~645, ~725 etc.)
- Modify: `dashboard-web/src/app/operator/page.tsx`

**Steps:**

- [ ] **Step 1: For each page section,** insert `<PageScope store={...} platform={...} rangeLabel={...} />` directly after the page H1. Hebrew range label uses `fmtDateRangeShort(filters.range)` (add helper if not present).

- [ ] **Step 2: Run + commit.**
  ```sh
  git add dashboard-web/src/components/Dashboard.tsx dashboard-web/src/app/operator/page.tsx
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): PageScope rendered under every page H1 (P0-3)

  Home, P&L, Trends, Archive, Detail, Campaigns, Products, Operator all
  show 'store • platform • range • CAD' under the title. RTL read order:
  store first on right. Eliminates 'wait, am I looking at all stores?'
  cognitive tax.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 5.10: Kill emoji-mixed-with-Lucide iconography

**Files:**
- Modify: `dashboard-web/src/lib/annotations.ts:50` (replace `ANNOTATION_KIND_EMOJI` with Lucide icon map)
- Modify: `dashboard-web/src/components/HeroOverview.tsx:25,563,564` (consume new map)
- Modify: `dashboard-web/src/components/PerStoreCards.tsx:119` (replace `🏪` with `<Store size={14} />`)
- Modify: `dashboard-web/src/components/CampaignsTableRow.tsx:320,340,363` (replace `⏸`/`🏷️`/`⏳` with `<PauseCircle/>` / `<Tag/>` / `<Clock/>`)
- Modify: `dashboard-web/src/components/HealthScorePanel.tsx:145` (replace `⏳`)
- Modify: `dashboard-web/src/components/CampaignDrawer.tsx:1340` (replace `🏪`)
- Modify: `dashboard-web/src/components/CampaignDrawerStatusSection.tsx:66` (replace `⏳`)
- Create: `dashboard-web/eslint-rules/no-emoji-in-jsx.js`

**Steps:**

- [ ] **Step 1: Replace `ANNOTATION_KIND_EMOJI` map.** New `ANNOTATION_KIND_ICON: Record<AnnotationKind, LucideIcon>`:
  ```ts
  import { Rocket, Pause, DollarSign, Tag, Sparkles, Image, Truck, MoreHorizontal } from 'lucide-react';
  export const ANNOTATION_KIND_ICON = {
    launch: Rocket, pause: Pause, budget: DollarSign, pricing: Tag,
    sale: Sparkles, creative: Image, supplier: Truck, other: MoreHorizontal,
  };
  ```
  Callers do `const Icon = ANNOTATION_KIND_ICON[kind]; <Icon size={14} />` instead of rendering the emoji string.

- [ ] **Step 2: Replace inline emoji** in 6 components per the file list.

- [ ] **Step 3: ESLint rule.** Block emoji literals in JSX text/templates outside `lib/annotations.ts` (data file) and `__tests__/`:
  ```js
  const EMOJI = /\p{Extended_Pictographic}/u;
  export default {
    meta: { type: 'problem' },
    create(context) {
      const f = context.getFilename();
      if (f.includes('__tests__') || f.endsWith('annotations.ts')) return {};
      return {
        Literal(node) {
          if (typeof node.value === 'string' && EMOJI.test(node.value)) {
            context.report({ node, message: 'Emoji + Lucide icon mix is forbidden. Use a Lucide icon instead.' });
          }
        },
        TemplateElement(node) {
          if (EMOJI.test(node.value.raw)) context.report({ node, message: 'Emoji in JSX — use Lucide.' });
        },
        JSXText(node) {
          if (EMOJI.test(node.value)) context.report({ node, message: 'Emoji in JSX text — use Lucide.' });
        },
      };
    },
  };
  ```
  Register in `eslint.config.js`.

- [ ] **Step 4: Run lint + tests + commit.**
  ```sh
  git add dashboard-web/src/lib/annotations.ts dashboard-web/src/components/ dashboard-web/eslint-rules/no-emoji-in-jsx.js dashboard-web/eslint.config.js
  git commit -m "$(cat <<'EOF'
  refactor(ui-ux): kill emoji + Lucide mix; ESLint guard (P1-14)

  Annotations + per-store cards + campaign-row chips + health/freshness
  badges + drawer status pills all switch to Lucide. Single ESLint rule
  blocks regression (allowlist: annotations.ts data file, __tests__).

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 5.11: Confirm GoalTracker stays on P&L only (Q5)

**Files:**
- Verify: `dashboard-web/src/components/Dashboard.tsx:465` (GoalTracker rendered only under P&L section)
- Verify: `dashboard-web/src/components/home/CommandCenterGrid.tsx` does NOT render GoalTracker

**Steps:**

- [ ] **Step 1: Audit.** `grep -n "GoalTracker" dashboard-web/src/components/Dashboard.tsx`. Must appear once under P&L section only.

- [ ] **Step 2: DOM regression test:**
  ```tsx
  it('GoalTracker renders only on P&L tab, not Home', () => {
    const { queryByTestId, rerender } = render(<Dashboard initialTab="home" />);
    expect(queryByTestId('goal-tracker')).toBeNull();
    rerender(<Dashboard initialTab="pnl" />);
    expect(queryByTestId('goal-tracker')).not.toBeNull();
  });
  ```

- [ ] **Step 3: Commit (if any change needed).**
  ```sh
  git add dashboard-web/src/components/__tests__/
  git commit -m "$(cat <<'EOF'
  test(ui-ux): regression — GoalTracker stays on P&L only (Q5)

  Per Q5 locked decision, GoalTracker does NOT move to Home (audit
  recommendation was overridden). Test prevents regression.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 5.12: Confirm gate on `WhatsappTestButtons`

**Files:**
- Modify: `dashboard-web/src/components/operator/WhatsappTestButtons.tsx`

**Steps:**

- [ ] **Step 1: Wrap each test-button click** with a `<Dialog>` "האם לשלוח WhatsApp לטלפון של dor (+972524809540) עכשיו?" → אישור / ביטול.

- [ ] **Step 2: DOM test** that clicking the button without confirm does NOT call the network.

- [ ] **Step 3: Commit.**
  ```sh
  git add dashboard-web/src/components/operator/WhatsappTestButtons.tsx
  git commit -m "$(cat <<'EOF'
  fix(ui-ux): WhatsappTestButtons gated by confirm dialog (P0-17)

  Sends real production WhatsApp on click — operator now must confirm
  the recipient phone before send. Test asserts no network call without
  confirm.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Wave 6 — Motion Vocabulary + Visual Regression CI

### Task 6.1: Apply motion vocabulary to Sheet, Skeleton, Tabs, hover responses

**Files:**
- Modify: `dashboard-web/src/components/ui/Sheet.tsx` (drawer slide-in uses `--motion-base var(--ease-out)`)
- Modify: `dashboard-web/src/app/globals.css` (Skeleton → real-content swap uses `--motion-fast`; tab transitions `--motion-snap`)
- Modify: `dashboard-web/tailwind.config.ts` (motion utility classnames)

**Steps:**

- [ ] **Step 1: Codify motion-vocab** in `tailwind.config.ts`:
  ```ts
  transitionDuration: {
    snap: 'var(--motion-snap)',
    fast: 'var(--motion-fast)',
    base: 'var(--motion-base)',
    slow: 'var(--motion-slow)',
    large: 'var(--motion-large)',
  },
  transitionTimingFunction: {
    DEFAULT: 'var(--ease-out)',
  },
  ```

- [ ] **Step 2: Sweep components** that should use the new utilities:
  - Sheet entrance: `duration-base ease-out`
  - Tab content swap: `duration-snap`
  - Card hover: `duration-fast`
  - Drawer width animation on fullscreen toggle: `duration-large`
  - Skeleton → real swap: `duration-fast`

- [ ] **Step 3: Run + commit.**
  ```sh
  git add dashboard-web/tailwind.config.ts dashboard-web/src/components/ui/Sheet.tsx dashboard-web/src/app/globals.css
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): motion vocabulary applied across primitives

  Sheet uses --motion-base (240ms), tab content --motion-snap (120ms),
  Skeleton swap --motion-fast (180ms), drawer fullscreen --motion-large
  (480ms). All ease-out cubic, no spring. Motion communicates state
  change only, never delight.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 6.2: Honor `prefers-reduced-motion: reduce`

**Files:**
- Modify: `dashboard-web/src/app/globals.css` (extend the existing `@media (prefers-reduced-motion: reduce)` block — currently lines ~327-336)

**Steps:**

- [ ] **Step 1: Confirm existing rule** already zeroes animation-duration + transition-duration. Extend to also kill the skeleton shimmer:
  ```css
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after {
      animation-duration: 0.01ms !important;
      transition-duration: 0.01ms !important;
    }
    .skeleton {
      animation: none !important;
      background: var(--skeleton-base);
    }
  }
  ```

- [ ] **Step 2: Commit.**
  ```sh
  git add dashboard-web/src/app/globals.css
  git commit -m "$(cat <<'EOF'
  fix(ui-ux): skeleton shimmer respects prefers-reduced-motion

  prefers-reduced-motion: reduce now also kills the .skeleton shimmer
  keyframe. Falls back to a static base color (no movement).

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 6.3: Install Playwright + image-snapshot CI gate

**Files:**
- Modify: `dashboard-web/package.json` (add `@playwright/test`, add `test:visual` script)
- Create: `dashboard-web/playwright.config.ts`
- Create: `dashboard-web/tests/visual/pages.spec.ts`
- Create: `dashboard-web/tests/visual/primitives.spec.ts`
- Modify: `.github/workflows/*.yml` (add Playwright step) — if no workflow yet, create `dashboard-web/.github/workflows/visual.yml`

**Steps:**

- [ ] **Step 1: Install.**
  ```sh
  cd dashboard-web && npm install -D @playwright/test && npx playwright install --with-deps chromium
  ```

- [ ] **Step 2: Add scripts to package.json:**
  ```json
  "test:visual": "playwright test --config=playwright.config.ts",
  "test:visual:update": "playwright test --config=playwright.config.ts --update-snapshots",
  ```

- [ ] **Step 3: Author `playwright.config.ts`:**
  ```ts
  import { defineConfig } from '@playwright/test';
  export default defineConfig({
    testDir: './tests/visual',
    timeout: 30_000,
    expect: { toHaveScreenshot: { maxDiffPixels: 100, threshold: 0.02 } },
    use: { baseURL: 'http://localhost:3000', viewport: { width: 1440, height: 900 }, locale: 'he-IL' },
    projects: [
      { name: 'light', use: { colorScheme: 'light' } },
      { name: 'dark',  use: { colorScheme: 'dark' } },
    ],
    webServer: { command: 'npm run dev', url: 'http://localhost:3000', reuseExistingServer: !process.env.CI, timeout: 120_000 },
  });
  ```

- [ ] **Step 4: Author `pages.spec.ts`.** Page list: Home / Trends / Archive / P&L / Detail / Operator-Sync / Operator-Health / Operator-Activity / Operator-Danger. For each: navigate, wait for `[data-loaded=true]` marker (add one to each page's outermost section), `await expect(page).toHaveScreenshot()`.

- [ ] **Step 5: Author `primitives.spec.ts`.** A simple `/dev/primitives` route (Next.js page) renders every primitive in every state. Snapshot the page in light + dark.

- [ ] **Step 6: Generate baselines** (`npm run test:visual:update`) on a clean post-Wave-5 worktree. Commit the `__snapshots__/` directory.

- [ ] **Step 7: Wire to CI.** `.github/workflows/visual.yml`:
  ```yaml
  name: Visual Regression
  on: [pull_request]
  jobs:
    visual:
      runs-on: ubuntu-latest
      defaults: { run: { working-directory: dashboard-web } }
      steps:
        - uses: actions/checkout@v4
        - uses: actions/setup-node@v4
          with: { node-version: 22, cache: npm, cache-dependency-path: dashboard-web/package-lock.json }
        - run: npm ci
        - run: npx playwright install --with-deps chromium
        - run: npm run test:visual
        - if: failure()
          uses: actions/upload-artifact@v4
          with: { name: playwright-report, path: dashboard-web/playwright-report/ }
  ```

- [ ] **Step 8: Commit.**
  ```sh
  git add dashboard-web/package.json dashboard-web/package-lock.json dashboard-web/playwright.config.ts dashboard-web/tests/visual/ .github/workflows/visual.yml
  git commit -m "$(cat <<'EOF'
  feat(ui-ux): Playwright image-snapshot visual-regression CI (Q9)

  Per Q9 locked decision: dark-mode visual-regression CI as guardrail
  for the 3-variable LCH theming refactor. Snaps every page in light +
  dark + a /dev/primitives canvas of every primitive state. CI fails
  on >2% pixel diff.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 6.4: Update User Manual to v2.5.0

**Files:**
- Modify: `docs/ROAS-Dashboard-User-Manual.md`

**Steps:**

- [ ] **Step 1: Bump version header** to `2.5.0` with dated changelog entry covering:
  - New CommandCenterGrid (8 tiles, 2 hero)
  - PageScope line under every page H1
  - Slim 72px icon-rail sidebar default + hover-to-expand
  - Per-card freshness badge + stale desaturation (Q5 aggressive)
  - Insight action buttons (drawer + Ads Manager deep-link)
  - CampaignDrawer 6 sub-tabs
  - Operator default Health tab + StatusPill
  - Hebrew TL;DR sentences on Trends/Archive/Detail/P&L
  - Brand-mirrored chart palette (Meta blue / Google amber / TikTok pink shifted / Organic teal / Shopify-as-category)
  - GoalTracker stays on P&L (no change per Q5)

- [ ] **Step 2: Commit.**
  ```sh
  git add docs/ROAS-Dashboard-User-Manual.md
  git commit -m "$(cat <<'EOF'
  docs(ui-ux): User Manual 2.5.0 — Premium 2026 redesign

  Captures the full Wave 1-6 user-facing changes: new Home, scope line,
  slim sidebar, stale-data desaturation, insight actions, drawer split,
  brand-mirrored chart palette, synthesis sentences.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

### Task 6.5: Update ARCHITECTURE.md

**Files:**
- Modify: `docs/ARCHITECTURE.md`

**Steps:**

- [ ] **Step 1: Add §27 — "Design Token Architecture (Phase 2 2026-05-31)"** documenting:
  - Three orthogonal palette layers (semantic / chart-brand-mirrored / brand)
  - 3-variable LCH theming (--bg-l / --fg-l / --accent-h) + how dark mode derives
  - --shadow-overlay / --shadow-modal (only two blessed shadows)
  - --space-* / --motion-* / --radius-* semantic scales
  - Primitive enforcement via 8 ESLint rules (no-raw-button/table/input, no-native-title-tooltip, no-legacy-tailwind-class, no-physical-direction-in-components, no-cross-palette-import, no-emoji-in-jsx) + no-restricted-imports for Radix
  - synthesis-layer module at `lib/synthesis/` (per-page TL;DR)
  - useStaleness hook + FreshnessBadge + `[data-stale]` CSS contract
  - Playwright visual-regression CI gate

- [ ] **Step 2: Update §26 (component primitives section)** if present to reference the new Typography, PlatformBadge, PageScope, FreshnessBadge, PageSynthesis additions.

- [ ] **Step 3: Commit.**
  ```sh
  git add docs/ARCHITECTURE.md
  git commit -m "$(cat <<'EOF'
  docs(ui-ux): ARCHITECTURE §27 — design-token + primitive system

  Documents the three orthogonal palettes, 3-variable LCH theming, the
  8 ESLint enforcement rules, lib/synthesis module, useStaleness +
  FreshnessBadge contract, and the Playwright visual-regression CI gate.

  Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
  EOF
  )"
  ```

---

## Rollout Notes

### Wave dependencies

- **Wave 1 blocks all others** — tokens, accent hue, chart palette, theming refactor are the substrate. No Wave 2+ work proceeds before Wave 1 ships.
- **Wave 2 mostly blocks Wave 3-5** — primitives renamed/extended in Wave 2 (`Stat` CVA shape, `Card` compound exports, `Sheet.Header`) are consumed by Home recompose (Wave 3), CampaignDrawer split (Wave 5). Run waves 2 → 3 → 5 in strict order.
- **Wave 4 (RTL) is parallel-safe with Wave 3 + 5** after Wave 2 finishes — the codemods only touch className strings; primitive APIs are stable.
- **Wave 6 (motion + visual regression) lands last** — visual snapshots can only be taken once the surface is stable. Generating baselines mid-wave wastes the gate.

### Single mega-PR

Per user request: one PR named `ui-ux: Premium 2026 dashboard redesign (Waves 1-6)`. Commit hygiene matters — each task above produces exactly one well-scoped commit so the PR's commit log reads as a sub-plan. Reviewer can step through commit-by-commit instead of file-by-file.

### Pre-merge checklist (run on the worktree, NOT a local dev server — per the global memory)

- [ ] `cd dashboard-web && npm run typecheck` → 0 errors
- [ ] `npm test` → all green (extended bidi suite + token sweep + synthesis + staleness + chart-collision tests)
- [ ] `npm run test:components` → all green (Typography, PageScope, PlatformBadge, FreshnessBadge, Stat-density, drawer-subtabs)
- [ ] `npm run lint` → 0 errors with all 8 new rules at `'error'` severity
- [ ] `npm run test:visual` → all snapshots match (light + dark + primitive canvas)
- [ ] Manual light-mode pass: walk Home → P&L → Trends → Archive → Detail → Campaigns → Products → Operator-all-sub-tabs
- [ ] Manual dark-mode pass: same walk
- [ ] Manual RTL pass: every page reads right→left; sidebar on right edge; no arrows point opposite reading flow
- [ ] Manual mixed-Hebrew-English pass: open CommandPalette, search "uzo Summer", verify no bidi reorder; open AdsDrawer on a Meta campaign with Hebrew + English ad names; verify CAD prefixes stay attached to numbers
- [ ] Manual keyboard pass: Tab through Home, every interactive element has visible focus ring; primary Button focus ring visible against accent bg

### Production deploy notes

- No `vercel.json` change required — tailwind/eslint changes are pure build-time, no runtime env additions
- No Supabase migration shipped in this PR
- No new env vars
- Operator (`/operator`) is gated by existing secret banner — no auth change
- Sentry release tag bumps automatically via existing CI

### Memory updates after ship

After merge to main:

- **Update `[[ui-ux-overhaul-plan-ready]]`** memory → mark superseded by `[[phase1-audit-decisions-2026-05-31]]`-derived implementation; keep as historical reference.
- **Update `[[dashboard-ux-overhaul-in-progress]]`** memory → add a new "Premium 2026 redesign DEPLOYED" line citing the merge commit + User Manual 2.5.0.
- **Create new memory `[[premium-2026-redesign-shipped]]`** → records the wave-1-6 ship date, the 8 ESLint rules now enforced, the visual-regression CI gate, the GoalTracker-on-P&L Q5 decision (still binding).
- **Update `[[freshness-phase-a-shipped]]`** → cross-reference the new FreshnessBadge + useStaleness consumption.
- **Keep `[[monthly-goal-is-global]]`** binding (Q5 is about placement, not scope — still in force).
- **Keep `[[no-info-loss-across-tabs]]`** binding (Task 3.1 explicitly mapped every removed surface).

---

## Self-Review

### Spec coverage — P0/P1 → task pointer

| Spec item | Task |
|---|---|
| P0-1 delete legacy palette | Task 1.3 |
| P0-2 brand-mirrored chart palette | Task 1.1 + 1.7 |
| P0-3 PageScope | Task 1.8 + 5.9 |
| P0-4 5 dark-mode surfaces | Task 1.10 |
| P0-5 Typography primitive | Task 2.8 |
| P0-6 unified Stat | Task 2.3 |
| P0-7 Home recompose | Task 3.1 + 3.3 |
| P0-8 hairline-only elevation | Task 1.9 |
| P0-9 silent-error swallowing | Task 5.7 |
| P0-10 TooltipProvider + 53 native title | Task 2.6 |
| P0-11 Button focus ring | Task 2.11 |
| P0-12 drawer close-X z-index | Task 2.5 |
| P0-13 border-line-subtle → border-line | Task 1.11 |
| P0-14 6 visible Hebrew bidi bugs | Task 4.1 + 4.2 + 4.3 |
| P0-15 Archive global filter | Task 5.3 |
| P0-16 shadow-overlay/shadow-modal tokens | Task 1.9 |
| P0-17 WhatsappTestButtons confirm | Task 5.12 |
| P1-1 FreshnessBadge + desaturation | Task 3.6 |
| P1-2 3-variable LCH theming | Task 1.5 |
| P1-3 PlatformBadge | Task 2.9 |
| P1-4 Card sweep (9 sites) | Task 2.4 |
| P1-5 unified sort headers | Task 2.2 (TableBase extension covers TableHeaderCell sortable in same commit) |
| P1-6 physical-direction lint + sweep | Task 4.4 + 4.5 |
| P1-7 `<Num>`/`<BiDi>` (CAD migration) | Task 4.3 (delivers fmtMoney/fmtMoneyString consolidation; explicit `<Num>` element is folded into format.ts ReactElement output) |
| P1-8 CollapsibleSection migration | Task 5.4 |
| P1-9 Skeleton primitive | folded into Task 6.1 (skeleton shimmer + reduced-motion + motion vocab) — see also AdsDrawer error states in Task 5.7 |
| P1-10 actionable insights | Task 5.6 |
| P1-11 clickable per-store + per-platform | Task 3.4 |
| P1-12 per-platform rollup | covered by CommandCenterGrid layout in Task 3.1 (Meta/Google/TikTok totals row) |
| P1-13 per-page synthesis | Task 3.5 |
| P1-14 emoji → Lucide | Task 5.10 |
| P1-15 spacing/motion/radius tokens | Task 1.12 |
| P1-16 ChartContainer dir=ltr default | Task 4.6 |
| P1-17 CampaignDrawer sub-tabs | Task 5.5 |
| P1-18 Products sub-tab URL state | folded into Task 5.3 wrapper-cleanup (verify in same commit) |
| P1-19 icon size scale | folded into ESLint set in Task 2.10 (`no-icon-size-literal` deferred — see Open Gaps below) |
| P1-20 override-badge on in-table filter toolbars | folded into Task 3.4 (per-card drill makes the in-table filter clearer via shared global filter context) |
| P1-21 Operator status pill + default Health | Task 5.1 |
| P1-22 inline BillingSettings into PnL | folded into Task 5.4 (CollapsibleSection migration in PnLBreakdown puts BillingSettings inline in the by-source row) |
| P1-23 slim sidebar | Task 5.8 |

**Open gaps acknowledged:**

- **P1-19 `no-icon-size-literal` ESLint rule + size-scale lock** — not authored explicitly. To avoid scope creep, the icon-size lock is deferred to a follow-up PR. The brief covered ESLint enforcement of the other 8 rules; locking 3 sizes (sm=12, md=14, lg=18, hero=24) is a single-rule add that does not block the redesign.
- **P2-* items** — explicitly out of scope per the wave-ordering in §6 of the spec; none promised in this plan.

### Name consistency

- `PageScope` — defined Task 1.8, consumed Task 5.5 (drawer header) + Task 5.9 (every page)
- `Heading` / `Text` (Typography) — defined Task 2.8, consumed throughout Wave 3 + 5
- `PlatformBadge` — defined Task 2.9, consumed throughout Wave 5
- `useStaleness` / `computeStaleness` — defined Task 3.6, consumed by every Card in Wave 3 + Task 5.2 (operator)
- `FreshnessBadge` — defined Task 3.6, consumed throughout Wave 3
- `CommandCenterGrid` — defined Task 3.1, no other consumer
- `PageSynthesis` — defined Task 3.5, consumed by 4 pages
- `Stat` density/active/prefix variants — defined Task 2.3, consumed in Wave 3 (`density="hero"` for the two hero tiles)
- `Sheet.Header` — defined Task 2.5, consumed Task 5.5 (CampaignDrawer split)

### No placeholders

Searched final plan output for: `TBD`, `TODO`, `fill in`, `similar to`, `appropriate`, `handle edge cases` → none found.

### Q1-Q10 decision honoring

- **Q1** brand-mirrored chart — Task 1.1
- **Q2** confident violet accent — Task 1.2
- **Q3** Shopify as category (no chart line) — Task 1.1 (Shopify present in token but with comment: "treated as e-commerce category, NOT a chart line color")
- **Q4** slim 72px icon-rail — Task 5.8
- **Q5** aggressive 30% chroma after 30 min — Task 3.6 (`computeStaleness` thresholds explicit)
- **Q6** authoritative Hebrew TL;DR — Task 3.5 (synthesis output uses "ROAS ירד 8%" tone)
- **Q7** insight action = both (drawer default + Ads Manager deep-link) — Task 5.6
- **Q8** GoalTracker stays on P&L — Task 5.11
- **Q9** dark-mode visual regression CI — Task 6.3
- **Q10** CampaignDrawer hard cut (no flag) — Task 5.5
