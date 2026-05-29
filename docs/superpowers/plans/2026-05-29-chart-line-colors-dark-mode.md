# Chart line colors — brand-true palette + dark-mode contrast sweep

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the categorical chart line colors (per-platform + per-store) from hardcoded hex literals to theme-aware CSS variables, using a brand-true palette (Meta blue, Google amber, TikTok red, Organic light purple, Shopify brighter green) and a non-overlapping store palette (uzoshop cyan, Zol Plus hot pink, 360usmile lime). Light mode gets the rebrand; dark mode gets brighter values on top so lines pass WCAG AA Large against the dark canvas.

**Architecture:** Add 8 `--chart-platform-*` and `--chart-store-*` CSS variables to `globals.css` `:root` (light defaults) and `[data-theme="dark"]` (brighter OKLCH overrides). Rewrite the three consumers — `storeColors.ts`, `chartColors.ts`, `KpiCards.tsx` — to return `var(...)` strings. KpiCards sparkline collapses to existing `--status-green` / `--status-red` / `--accent` tokens (no new sparkline vars needed). Add a globals.css parity test that guards against half-migrations (every `--chart-*` in `:root` must have a `[data-theme="dark"]` override).

**Tech Stack:** Next.js 15 + React 19, Recharts 3.8.1, Tailwind with CSS-var color strategy, Vitest, OKLCH color space.

**Reference spec:** [docs/superpowers/specs/2026-05-29-chart-line-colors-dark-mode-design.md](../specs/2026-05-29-chart-line-colors-dark-mode-design.md)

---

## File Structure

**New files:**
- `dashboard-web/src/app/__tests__/globals-chart-vars.test.ts` — parses globals.css and asserts every `--chart-*` declared in `:root` has a `[data-theme="dark"]` override. Guards against half-migrations.

**Modified files:**
- `dashboard-web/src/app/globals.css` — add 8 `--chart-platform-*` + `--chart-store-*` tokens (light defaults) and 8 OKLCH dark overrides.
- `dashboard-web/src/lib/storeColors.ts` — `STORE_COLORS` map values switch from hex to `var(--chart-store-*)`. Stale "// navy / amber / teal" trailing comments updated to "// cyan / hot pink / lime". `FALLBACK_PALETTE` left as hex.
- `dashboard-web/src/lib/chartColors.ts` — `CHART_COLORS.{meta,google,tiktok,organic,shopify}` switch to `var(--chart-platform-*)`. Bonus cleanup: `cpm` / `roas` / `value` / `spend` switch to `var(--status-*)` tokens. `cpmPrev` stays `#fbbf24`. Top-of-file header comment rewritten to document the new brand-true contract.
- `dashboard-web/src/components/KpiCards.tsx` (lines 271-273) — three hardcoded `rgb(...)` literals switch to `var(--status-green)` / `var(--status-red)` / `var(--accent)`.
- `dashboard-web/src/components/RoasChart.tsx` (line 22) — stale comment `// '#1c4587' navy` updated to `// '#06b6d4' cyan in light, oklch(75% 0.13 200) in dark`.
- `dashboard-web/src/lib/__tests__/storeColors.test.ts` — hex regex + per-store hex assertions updated to var-string equality.
- `dashboard-web/src/lib/__tests__/chartColors.test.ts` — platform hex assertions updated to var-string equality; anti-`#ec4899` regression on TikTok removed (it's now the legitimate Zol Plus store color); meta/google assertions reflect brand swap; cpm/roas/value/spend assertions point to status tokens.
- `docs/ROAS-Dashboard-User-Manual.md` — bump version 2.1.12 → 2.1.13, add Hebrew changelog entry.

**Out of scope (do NOT touch in this plan):**
- `dashboard-web/src/lib/annotations.ts` — `ANNOTATION_KIND_COLOR` event colors (`launch: '#15803d'`, `pricing: '#d97706'`) are a separate semantic family per spec.
- `dashboard-web/src/components/HeroOverview.tsx` — hero gradient is accent-driven, not categorical.
- ROAS status thresholds, `roasLabel()`, status bg/fg cell tokens.
- `FALLBACK_PALETTE` for unknown stores.

---

## Task 1: Add chart-token parity test (RED) + globals.css token surface (GREEN)

**Files:**
- Create: `dashboard-web/src/app/__tests__/globals-chart-vars.test.ts`
- Modify: `dashboard-web/src/app/globals.css` (add lines under `:root` and `[data-theme="dark"]`)

- [ ] **Step 1: Write the failing parity test**

Create `dashboard-web/src/app/__tests__/globals-chart-vars.test.ts`:

```typescript
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const CSS_PATH = join(__dirname, '..', 'globals.css');

/** Extract everything between `selector { ... }`. Returns the body or null. */
function extractBlock(css: string, selector: string): string | null {
  // Match: <selector>\s*{ ... } at top level. Naive but works for our flat top-level
  // blocks (no nested braces inside :root / [data-theme="dark"]).
  const escapedSelector = selector.replace(/[[\]\\^$.*+?()|{}]/g, '\\$&');
  const re = new RegExp(`${escapedSelector}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm');
  const match = css.match(re);
  return match ? match[1] : null;
}

/** Extract all `--chart-*` custom property names declared in a CSS block. */
function chartVarsIn(block: string): Set<string> {
  const names = new Set<string>();
  const re = /(--chart-[a-zA-Z0-9-]+)\s*:/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(block)) !== null) names.add(m[1]);
  return names;
}

describe('globals.css — chart-var theme parity', () => {
  const css = readFileSync(CSS_PATH, 'utf8');
  const rootBlock = extractBlock(css, ':root');
  const darkBlock = extractBlock(css, '[data-theme="dark"]');

  it('both :root and [data-theme="dark"] blocks exist', () => {
    expect(rootBlock, ':root block').not.toBeNull();
    expect(darkBlock, '[data-theme="dark"] block').not.toBeNull();
  });

  it('every --chart-* in :root also has a [data-theme="dark"] override', () => {
    const rootVars = chartVarsIn(rootBlock!);
    const darkVars = chartVarsIn(darkBlock!);
    const missingInDark = [...rootVars].filter(v => !darkVars.has(v));
    expect(missingInDark, 'vars defined in :root but not in dark').toEqual([]);
  });

  it('every --chart-* in [data-theme="dark"] also has a :root default', () => {
    const rootVars = chartVarsIn(rootBlock!);
    const darkVars = chartVarsIn(darkBlock!);
    const missingInRoot = [...darkVars].filter(v => !rootVars.has(v));
    expect(missingInRoot, 'vars defined in dark but not in :root').toEqual([]);
  });

  it('declares the expected per-platform and per-store chart vars', () => {
    const rootVars = chartVarsIn(rootBlock!);
    const expected = [
      '--chart-platform-meta',
      '--chart-platform-google',
      '--chart-platform-tiktok',
      '--chart-platform-organic',
      '--chart-platform-shopify',
      '--chart-store-uzoshop',
      '--chart-store-zolplus',
      '--chart-store-usmile',
    ];
    for (const name of expected) {
      expect(rootVars.has(name), `:root must declare ${name}`).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `cd dashboard-web && npm test -- src/app/__tests__/globals-chart-vars.test.ts`

Expected: 2 tests FAIL (the "every --chart-* in :root has a dark override" passes trivially because there are zero chart vars yet, but the "declares the expected per-platform and per-store chart vars" test FAILS — none of `--chart-platform-meta` etc are defined).

- [ ] **Step 3: Add the chart tokens to globals.css**

In `dashboard-web/src/app/globals.css`, find the `:root` block (starts ~line 13). Locate the section after the existing `--accent-dark: oklch(45% 0.18 260);` line (~line 34, just before the ROAS status comment block). Insert this new section:

```css
  /* Chart categorical palette — brand-true platforms + non-platform store hues.
     Light defaults below; dark overrides under [data-theme="dark"].
     Spec: docs/superpowers/specs/2026-05-29-chart-line-colors-dark-mode-design.md
     Replaces the prior "should NOT theme-swap" contract: hue families now reflect
     real brand identity (Meta blue, Google amber, TikTok red, etc.), and colorblind
     disambiguation is handled by stroke patterns + legend, not by hue separation. */
  --chart-platform-meta:     #2563eb;
  --chart-platform-google:   #d97706;
  --chart-platform-tiktok:   #ef4444;
  --chart-platform-organic:  #a855f7;
  --chart-platform-shopify:  #10b981;

  --chart-store-uzoshop:  #06b6d4;
  --chart-store-zolplus:  #ec4899;
  --chart-store-usmile:   #84cc16;
```

Then in the `[data-theme="dark"]` block (starts ~line 67), locate the section after the existing `--accent-dark: oklch(75% 0.16 260);` line (~line 91, just before the ROAS status comment block). Insert this new section:

```css
  /* Chart categorical palette — dark overrides.
     Tuned to OKLCH L ~70-78% so every line sits ~5:1 against the dark canvas
     (passes WCAG AA Large for stroke widths >=2px, which is the baseline for
     all chart lines in this codebase). Hue preserved per series identity. */
  --chart-platform-meta:     oklch(70% 0.18 260);
  --chart-platform-google:   oklch(75% 0.16 60);
  --chart-platform-tiktok:   oklch(72% 0.22 25);
  --chart-platform-organic:  oklch(75% 0.18 305);
  --chart-platform-shopify:  oklch(75% 0.18 155);

  --chart-store-uzoshop:  oklch(75% 0.13 200);
  --chart-store-zolplus:  oklch(72% 0.20 340);
  --chart-store-usmile:   oklch(78% 0.20 130);
```

- [ ] **Step 4: Re-run the parity test, confirm it passes**

Run: `cd dashboard-web && npm test -- src/app/__tests__/globals-chart-vars.test.ts`

Expected: all 4 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/app/__tests__/globals-chart-vars.test.ts dashboard-web/src/app/globals.css
git commit -m "$(cat <<'EOF'
feat(charts): add brand-true chart palette CSS vars (light + dark)

Hoists categorical chart line colors (per-platform + per-store) from
hardcoded hex literals into theme-aware --chart-* CSS variables.
Light defaults reflect true brand identity (Meta blue, Google amber,
TikTok red, Organic light purple, Shopify brighter green) and store
colors move into non-platform hue space (uzoshop cyan, Zol Plus
hot pink, 360usmile lime). Dark overrides land at OKLCH L ~70-78%
so every line clears WCAG AA Large against the dark canvas.

New globals-chart-vars.test.ts guards every --chart-* declared in
:root against missing [data-theme="dark"] overrides (and vice versa).

Spec: docs/superpowers/specs/2026-05-29-chart-line-colors-dark-mode-design.md
EOF
)"
```

---

## Task 2: Migrate storeColors.ts to CSS vars

**Files:**
- Modify: `dashboard-web/src/lib/storeColors.ts`
- Modify: `dashboard-web/src/lib/__tests__/storeColors.test.ts`

- [ ] **Step 1: Update the test to expect var strings (RED)**

In `dashboard-web/src/lib/__tests__/storeColors.test.ts`, make the following edits.

Replace the regex on line 20:

```typescript
// BEFORE
expect(STORE_COLORS[store]).toMatch(/^#[0-9a-fA-F]{6}$/);

// AFTER
expect(STORE_COLORS[store]).toMatch(/^var\(--chart-store-/);
```

Replace lines 33-43 (the three "uzoshop is navy" / "Zol Plus is amber" / "360usmile is teal" tests) with:

```typescript
  it('uzoshop is keyed to the cyan chart-store CSS var', () => {
    expect(STORE_COLORS.uzoshop).toBe('var(--chart-store-uzoshop)');
  });

  it('Zol Plus is keyed to the hot-pink chart-store CSS var', () => {
    expect(STORE_COLORS['Zol Plus']).toBe('var(--chart-store-zolplus)');
  });

  it('360usmile is keyed to the lime chart-store CSS var', () => {
    expect(STORE_COLORS['360usmile']).toBe('var(--chart-store-usmile)');
  });
```

The unknown-store fallback test (lines 45-55) stays as-is — FALLBACK_PALETTE stays hex.

- [ ] **Step 2: Run the test, confirm it fails**

Run: `cd dashboard-web && npm test -- src/lib/__tests__/storeColors.test.ts`

Expected: 4 tests FAIL (the three per-store tests + the regex check) because the production code still returns hex literals.

- [ ] **Step 3: Update storeColors.ts to return var strings (GREEN)**

In `dashboard-web/src/lib/storeColors.ts`, replace the `STORE_COLORS` constant. The file's header docstring should also be updated to reflect the new palette intent.

Replace lines 1-26 with:

```typescript
/**
 * Canonical per-store color palette — single source of truth.
 *
 * Stores route through theme-aware CSS vars defined in globals.css
 * (--chart-store-uzoshop / --chart-store-zolplus / --chart-store-usmile).
 * Light defaults pin to bright Tailwind palette hexes; dark overrides
 * land at OKLCH L ~72-78% so lines stay legible against the dark canvas.
 *
 * The three store hues — cyan / hot pink / lime — sit outside every
 * platform color (Meta blue, Google amber, TikTok red, Organic purple,
 * Shopify green) so a chart that overlays per-store lines on top of
 * per-platform lines never reads as one channel echoing another.
 *
 * Fallback palette for unknown stores stays as hex literals — unknown-store
 * lookup is an edge case (only triggers if a 4th store is added) and
 * doesn't justify a dark-mode override path.
 */

export const STORE_COLORS: Record<string, string> = {
  uzoshop:    'var(--chart-store-uzoshop)', // cyan (light) / bright cyan (dark)
  'Zol Plus': 'var(--chart-store-zolplus)', // hot pink (light) / bright pink (dark)
  '360usmile':'var(--chart-store-usmile)',  // lime (light) / bright lime (dark)
};
```

(Lines 28-46 — `FALLBACK_PALETTE` and `storeColor()` function — stay byte-identical.)

- [ ] **Step 4: Re-run the test, confirm it passes**

Run: `cd dashboard-web && npm test -- src/lib/__tests__/storeColors.test.ts`

Expected: all 7 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/lib/storeColors.ts dashboard-web/src/lib/__tests__/storeColors.test.ts
git commit -m "$(cat <<'EOF'
feat(charts): route STORE_COLORS through theme-aware CSS vars

uzoshop / Zol Plus / 360usmile now resolve to --chart-store-uzoshop /
--chart-store-zolplus / --chart-store-usmile (defined in globals.css
under both :root and [data-theme=\"dark\"]). Light values are bright
Tailwind cyan / pink / lime; dark overrides land at OKLCH L ~72-78%.

Docstring rewritten to document the new "non-platform hue space"
contract and to explain why FALLBACK_PALETTE stays hex.

Tests updated to assert var-string equality + var-prefix regex.
EOF
)"
```

---

## Task 3: Migrate chartColors.ts to CSS vars + rewrite header comment

**Files:**
- Modify: `dashboard-web/src/lib/chartColors.ts`
- Modify: `dashboard-web/src/lib/__tests__/chartColors.test.ts`

- [ ] **Step 1: Update the test to expect var strings (RED)**

Replace the entire contents of `dashboard-web/src/lib/__tests__/chartColors.test.ts` with:

```typescript
import { describe, expect, it } from 'vitest';
import { CHART_COLORS } from '@/lib/chartColors';

describe('CHART_COLORS — brand-true palette (2026-05-29 rev2)', () => {
  it('Meta routes to the brand-blue chart-platform CSS var', () => {
    expect(CHART_COLORS.meta).toBe('var(--chart-platform-meta)');
  });

  it('Google routes to the brand-amber chart-platform CSS var', () => {
    expect(CHART_COLORS.google).toBe('var(--chart-platform-google)');
  });

  it('TikTok routes to the brand-red chart-platform CSS var', () => {
    expect(CHART_COLORS.tiktok).toBe('var(--chart-platform-tiktok)');
  });

  it('Organic routes to the brand-purple chart-platform CSS var', () => {
    expect(CHART_COLORS.organic).toBe('var(--chart-platform-organic)');
  });

  it('Shopify routes to the brand-green chart-platform CSS var', () => {
    expect(CHART_COLORS.shopify).toBe('var(--chart-platform-shopify)');
  });

  it('CPM routes to the status-orange semantic token (was platform color)', () => {
    expect(CHART_COLORS.cpm).toBe('var(--status-orange)');
  });

  it('CPM previous-period comparator stays a hex literal (lighter amber)', () => {
    // cpmPrev is intentionally a frozen lighter amber so the previous-period
    // line reads as a softer "ghost" against the live cpm line. Not a brand
    // identity, not a status — a deliberate fixed-hue comparator.
    expect(CHART_COLORS.cpmPrev).toBe('#fbbf24');
  });

  it('ROAS and value route to the status-green semantic token', () => {
    expect(CHART_COLORS.roas).toBe('var(--status-green)');
    expect(CHART_COLORS.value).toBe('var(--status-green)');
  });

  it('Spend routes to the status-red semantic token', () => {
    expect(CHART_COLORS.spend).toBe('var(--status-red)');
  });

  it('Axis colors continue to resolve to the theme-aware --chart-axis var', () => {
    expect(CHART_COLORS.axis).toBe('var(--chart-axis)');
    expect(CHART_COLORS.reconciliationAxis).toBe('var(--chart-axis)');
  });
});
```

- [ ] **Step 2: Run the test, confirm it fails**

Run: `cd dashboard-web && npm test -- src/lib/__tests__/chartColors.test.ts`

Expected: most tests FAIL — production code still has the old hex literals (Meta amber, Google blue, TikTok slate, etc.).

- [ ] **Step 3: Rewrite chartColors.ts**

Replace the entire contents of `dashboard-web/src/lib/chartColors.ts` with:

```typescript
// Single source of truth for the chart palette.
//
// All categorical line colors (per-platform + per-store) route through
// theme-aware --chart-* CSS variables defined in globals.css. Light
// defaults reflect true brand identity:
//   - Meta:    blue   (#2563eb / oklch(70% 0.18 260) dark)
//   - Google:  amber  (#d97706 / oklch(75% 0.16 60)  dark)
//   - TikTok:  red    (#ef4444 / oklch(72% 0.22 25)  dark)
//   - Organic: purple (#a855f7 / oklch(75% 0.18 305) dark)
//   - Shopify: green  (#10b981 / oklch(75% 0.18 155) dark)
//
// Per-store colors sit OUTSIDE every platform hue family (cyan / hot pink /
// lime) so a chart that overlays per-store lines on per-platform lines
// never reads as one channel echoing another. See lib/storeColors.ts.
//
// Status colors (cpm, roas, value, spend) route through the existing
// --status-orange / --status-green / --status-red semantic tokens — they
// are not brand identities, just channel labels keyed to the dashboard's
// existing color language.
//
// Colorblind contract (revised 2026-05-29):
//   The prior contract from audit-2026-05-23-v2 pinned TikTok outside the
//   magenta/purple hue family for protanopia/deuteranopia separation from
//   Organic purple. That contract was retired when TikTok moved to the
//   brand-true neon red. Disambiguation channels that survive:
//     1. Stroke pattern (Shopify rendered with a 6-3 dashed pattern + 2.5px
//        stroke vs Meta's 1.5px solid). RoasChart owns this convention.
//     2. Legend swatch + label. Every chart that uses categorical colors
//        renders a visible legend; total hue collapse still leaves the
//        textual label as a fallback identifier.
//   The trade-off (brand identity > colorblind hue safety) is intentional
//   and was approved by the operator on 2026-05-29.
export const CHART_COLORS = {
  axis: 'var(--chart-axis)',
  reconciliationAxis: 'var(--chart-axis)',
  meta:    'var(--chart-platform-meta)',
  google:  'var(--chart-platform-google)',
  tiktok:  'var(--chart-platform-tiktok)',
  organic: 'var(--chart-platform-organic)',
  shopify: 'var(--chart-platform-shopify)',
  cpm:     'var(--status-orange)',
  cpmPrev: '#fbbf24',
  roas:    'var(--status-green)',
  value:   'var(--status-green)',
  spend:   'var(--status-red)',
} as const;

export type ChartColorKey = keyof typeof CHART_COLORS;
```

- [ ] **Step 4: Re-run the test, confirm it passes**

Run: `cd dashboard-web && npm test -- src/lib/__tests__/chartColors.test.ts`

Expected: all 10 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/lib/chartColors.ts dashboard-web/src/lib/__tests__/chartColors.test.ts
git commit -m "$(cat <<'EOF'
feat(charts): route CHART_COLORS through brand-true CSS vars + status tokens

CHART_COLORS.{meta,google,tiktok,organic,shopify} now resolve to
--chart-platform-* vars (defined in globals.css). cpm / roas / value /
spend collapse to --status-orange / --status-green / --status-red
semantic tokens — they were always statuses, not identities, and
hotfix-12 had already moved adjacent chart chrome to semantic vars.
cpmPrev stays as the frozen lighter amber comparator (#fbbf24).

Header comment rewritten:
  - Documents the new brand-true palette (Meta blue, Google amber,
    TikTok red, Organic purple, Shopify green) with both light hexes
    and dark OKLCH targets.
  - Explicitly retires the audit-2026-05-23-v2 "TikTok outside magenta"
    colorblind contract in favour of brand identity. Disambiguation
    falls back to stroke pattern + legend label.

Tests rewritten: var-string assertions, anti-#ec4899 regression
removed (now legitimately the Zol Plus store color), meta/google
flipped to reflect the brand-true swap, status assertions added
for cpm/roas/value/spend.
EOF
)"
```

---

## Task 4: Migrate KpiCards sparkline + RoasChart stale comment

**Files:**
- Modify: `dashboard-web/src/components/KpiCards.tsx:268-273`
- Modify: `dashboard-web/src/components/RoasChart.tsx:22`

No tests in this task — the sparkline color is a runtime CSS-var resolution that cannot be unit-tested without jsdom + computed-style hacks. Visual verification covers it in the final gate.

- [ ] **Step 1: Update KpiCards sparkColor literals**

In `dashboard-web/src/components/KpiCards.tsx`, find the `sparkColor` constant near line 268-273. Replace these lines:

```typescript
  // Sparkline color follows the card's tone: red for "bad" trend, green for
  // "good" trend, primary for neutral.
  const sparkColor =
    accent === 'pos' ? 'rgb(21, 128, 61)' // roas-green
    : accent === 'neg' ? 'rgb(220, 38, 38)' // roas-red
    : 'rgb(13, 54, 128)'; // primary
```

With:

```typescript
  // Sparkline color follows the card's tone: red for "bad" trend, green for
  // "good" trend, accent (dashboard primary) for neutral. All three resolve
  // through theme-aware CSS vars so the sparkline brightens in dark mode
  // without per-mode plumbing. Sparkline reads `color` via currentColor;
  // the parent div sets `style.color = sparkColor`, so the var resolution
  // cascades naturally.
  const sparkColor =
    accent === 'pos' ? 'var(--status-green)'
    : accent === 'neg' ? 'var(--status-red)'
    : 'var(--accent)';
```

- [ ] **Step 2: Update RoasChart stale comment**

In `dashboard-web/src/components/RoasChart.tsx`, find line 22:

```typescript
const PRIMARY_COLOR = STORE_COLORS.uzoshop; // '#1c4587' navy
```

Replace with:

```typescript
const PRIMARY_COLOR = STORE_COLORS.uzoshop; // 'var(--chart-store-uzoshop)' — cyan (light) / bright cyan (dark)
```

(The actual code is unchanged — `STORE_COLORS.uzoshop` already returns the right value after Task 2; only the trailing comment was stale.)

- [ ] **Step 3: Run the full test suite to confirm nothing else broke**

Run: `cd dashboard-web && npm test`

Expected: all tests PASS. Test count grows by ~7 from the baseline 1,300 node + 47 DOM = 1,347: globals-chart-vars adds 4 new `it()` blocks, and chartColors grows from 7 to 10 (three new per-status assertions: cpm → status-orange, roas/value grouped → status-green, spend → status-red). storeColors count is unchanged (3 hex tests replaced 1-for-1 with 3 var tests; regex assertion updated in place).

- [ ] **Step 4: Commit**

```bash
git add dashboard-web/src/components/KpiCards.tsx dashboard-web/src/components/RoasChart.tsx
git commit -m "$(cat <<'EOF'
feat(charts): KpiCards sparkline + RoasChart comment use brand-true vars

KpiCards sparkline switches from hardcoded rgb() literals to
var(--status-green) / var(--status-red) / var(--accent). Sparkline
reads color via currentColor, so the var resolves naturally through
the parent div's style.color.

RoasChart line 22 trailing comment updated to reflect that
PRIMARY_COLOR is now a CSS var pointing at cyan (no longer #1c4587
navy). Code unchanged — STORE_COLORS.uzoshop now returns the var
string after the storeColors.ts migration.
EOF
)"
```

---

## Task 5: User Manual 2.1.13 changelog + version bump

**Files:**
- Modify: `docs/ROAS-Dashboard-User-Manual.md` (line 10 — version header; line 2566 — footer; new changelog section after line ~205)

- [ ] **Step 1: Bump the header version**

In `docs/ROAS-Dashboard-User-Manual.md`, change line 10:

```markdown
│      גרסה:        2.1.12                         │
```

to:

```markdown
│      גרסה:        2.1.13                         │
```

- [ ] **Step 2: Bump the footer version**

In the same file, find the bottom footer (~line 2566):

```markdown
**גרסה:** 2.1.12 · **תאריך עדכון:** 2026-05-29
```

Change to:

```markdown
**גרסה:** 2.1.13 · **תאריך עדכון:** 2026-05-29
```

- [ ] **Step 3: Add the 2.1.13 changelog entry**

Find the existing changelog section beginning with `### Hotfix 2.1.12 (2026-05-29) — Chart contrast sweep (dark-mode visibility)` (around line 184). It will be followed by an empty line and then the body of the 2.1.12 entry. Read forward until you find the next `### Hotfix` heading or section heading — the 2.1.12 entry ends just before that.

Insert a new section **above** the 2.1.12 entry (so 2.1.13 reads first, newest-on-top per existing convention):

```markdown
### Hotfix 2.1.13 (2026-05-29) — Brand-true chart palette + dark-mode readability

צבעי הקווים בגרפים עודכנו כדי לשקף נכון את זהויות המותגים:

- **Meta** עברה לכחול (היה ענבר).
- **Google** עברה לענבר/צהוב (היה כחול).
- **TikTok** עברה לאדום ניאון (היה אפור slate).
- **Organic** עברה לסגול בהיר (היה סגול כהה).
- **Shopify** עברה לירוק בהיר (היה ירוק כהה).

בנוסף, הצבעים לפי חנות עברו למרחב גוונים שלא חופף לאף פלטפורמה:

- **uzoshop** — ציאן (היה נייבי כהה שהיה כמעט בלתי-נראה ב-dark mode).
- **Zol Plus** — מג'נטה חמה (היה ענבר — התנגש עם Google אחרי ההחלפה).
- **360usmile** — ליים (היה טורקיז).

ב-dark mode כל הקווים מתבהרים אוטומטית לרמת OKLCH L ~70-78% כדי לעמוד ב-WCAG AA Large. ב-light mode הצבעים החדשים הם hexes של Tailwind (cyan-500, pink-500, lime-500 וכו') — בהירים אבל קריאים גם על רקע בהיר.

```

- [ ] **Step 4: Commit**

```bash
git add docs/ROAS-Dashboard-User-Manual.md
git commit -m "$(cat <<'EOF'
docs(user-manual): 2.1.13 — brand-true chart palette changelog

Documents the platform color swap (Meta blue / Google amber /
TikTok red / Organic light purple / Shopify brighter green) and
the per-store palette move into non-platform hue space
(uzoshop cyan / Zol Plus hot pink / 360usmile lime). Notes that
dark-mode lines automatically brighten to OKLCH L ~70-78% for
WCAG AA Large contrast.
EOF
)"
```

---

## Task 6: Full verification gate + production deploy verification

**Files:** none modified — this is a verification-only task.

- [ ] **Step 1: Run the full unit-test suite**

Run: `cd dashboard-web && npm test`

Expected output:
- All node tests PASS.
- 4 new tests from `globals-chart-vars.test.ts` PASS.
- 3 new tests in `chartColors.test.ts` PASS (cpm/roas/value/spend → status tokens).
- Total node test count ≈ 1,300 + 7 = 1,307 node + 47 DOM = ~1,354 (give or take if other tests landed in parallel).

If any test fails, fix it before proceeding.

- [ ] **Step 2: Run typecheck**

Run: `cd dashboard-web && npm run typecheck`

Expected: clean — no TypeScript errors.

- [ ] **Step 3: Run production build**

Run: `cd dashboard-web && npm run build`

Expected: clean — build succeeds, no warnings about missing env vars beyond the usual baseline.

- [ ] **Step 4: Push to main and wait for Vercel deploy**

```bash
git push origin main
```

Wait for the Vercel build to finish (usually ~2 minutes). Confirm deployment at https://roas-dashboard-smoky.vercel.app/.

- [ ] **Step 5: Production visual verification — light mode**

Per [[feedback-no-localhost-checks]], verify against production URL only.

Open https://roas-dashboard-smoky.vercel.app/ in a browser, default light mode. Take screenshots of:
- בית tab — Hero KPI cards. Confirm sparklines are now using `--accent` (cool indigo) for neutral cards, `--status-green` for positive cards, `--status-red` for negative cards. Visually identical to prior light mode except for the indigo shift on neutral sparkline (was navy `#0d3680`-ish).
- בית tab — RoasChart "מגמת ROAS לאורך זמן". Confirm:
  - **uzoshop is now cyan** (was dark navy).
  - **Zol Plus is now hot pink** (was amber).
  - **360usmile is now lime** (was teal).
- קמפיינים tab — CampaignsTable. Confirm platform dots:
  - **Meta is now blue** (was amber).
  - **Google is now amber** (was blue).
  - **TikTok is now red** (was slate-gray).
  - **Organic is now lighter purple**.
  - **Shopify is now brighter green**.
- Open a campaign drawer → CampaignDrawer charts. Same verification on attribution + reconciliation charts.

If any line is hard to read on the light canvas (white background), note it — but the spec accepts vivid Tailwind 500-600 hexes as fit-for-purpose on light.

- [ ] **Step 6: Production visual verification — dark mode**

Toggle to dark mode (theme switcher in the sidebar). Re-screenshot the same views.

Confirm:
- Every line is clearly readable against the dark canvas — no "dark-on-dark" disappearance like the prior uzoshop navy.
- The 5 platform lines (Meta blue, Google amber, TikTok red, Organic purple, Shopify green) all sit at perceptual L ~70-78% — none look "muddy" or "near-canvas".
- The 3 store lines (cyan, pink, lime) are visibly different from any platform on the same chart.
- KpiCards sparkline neutral tone is now the dark-mode `--accent` (brighter indigo), not the prior near-invisible navy.

- [ ] **Step 7: If everything looks correct, update memory**

Add a memory entry confirming the deploy succeeded. Use the user's auto-memory at `/Users/dorperetz/.claude/projects/-Users-dorperetz-script-roas/memory/`.

Add a new file `project_chart_palette_brand_true_shipped.md`:

```markdown
---
name: chart-palette-brand-true-shipped
description: Chart line color rebrand + dark-mode contrast sweep shipped 2026-05-29. Platform swap (Meta↔Google), TikTok→red, stores reslotted to cyan/pink/lime.
metadata:
  type: project
---

Chart line color rebrand SHIPPED 2026-05-29 to production
(https://roas-dashboard-smoky.vercel.app/, main HEAD after merge).
Replaces hotfix-12's "kept categorical colors as hex per brand identity"
caveat with brand-TRUE colors.

**Why:** Operator iterated on hotfix-12's dark-mode contrast sweep. The
remaining categorical hex literals still read as dark-on-dark (uzoshop
navy ~1.5:1) and the platform assignments were brand-mismatched
(Meta=amber, Google=blue).

**How to apply:**
- Categorical chart colors live as --chart-platform-* and --chart-store-*
  CSS vars in globals.css. Light hexes pin to bright Tailwind 500-600;
  dark overrides land at OKLCH L ~70-78%.
- Adding a 4th store or new platform: add the var to BOTH :root AND
  [data-theme="dark"] blocks. The parity test at
  src/app/__tests__/globals-chart-vars.test.ts guards against half-migrations.
- Colorblind disambiguation now relies on stroke pattern (Shopify dashed)
  + legend label, NOT on hue separation. The audit-2026-05-23-v2
  "TikTok outside magenta" rule was intentionally retired.

Related: [[dashboard-ux-overhaul-in-progress]] (hotfix-12 lineage),
[[script-roas-dashboard]].

Spec: docs/superpowers/specs/2026-05-29-chart-line-colors-dark-mode-design.md
Plan: docs/superpowers/plans/2026-05-29-chart-line-colors-dark-mode.md
```

Then add this line to `MEMORY.md`:

```markdown
- [Chart palette rebrand SHIPPED 2026-05-29](project_chart_palette_brand_true_shipped.md) — Brand-true platform colors (Meta blue, Google amber, TikTok red) + stores moved to non-platform hue space (cyan/pink/lime). User Manual 2.1.13.
```

- [ ] **Step 8: (No commit for memory updates — they live in `~/.claude/projects/.../memory/`, outside the repo.)**

---

## Acceptance criteria summary

The plan is complete when:
1. ✅ All 6 tasks above are committed.
2. ✅ `npm test` passes with ~1,351 tests (4 new from Task 1).
3. ✅ `npm run typecheck` clean.
4. ✅ `npm run build` clean.
5. ✅ `git push origin main` succeeds and Vercel deploy succeeds.
6. ✅ Production visual verification confirms platform + store palette changes in both light and dark mode.
7. ✅ User Manual reads version 2.1.13 with the new changelog entry.
8. ✅ Memory updated with the shipped record.
