# Dashboard Re-skin (Mesh, Light + Dark) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-skin the ROAS dashboard to a "mesh rich gradient" visual language that ships in both **light and dark mode** (runtime toggle), changing only visuals — layout, IA, data, and ROAS-band thresholds stay 1:1.

**Architecture:** The app is token-driven (every color is a `var(--*)` in `globals.css :root`, mapped to Tailwind aliases). The theme system was built dual-mode and only *disabled* (hard-pinned to dark). So the re-skin is mostly: (a) re-activate the existing theme plumbing, (b) author a light token set + tokenize the few hardcoded-oklch blocks, (c) fix the platform-color desaturation issue via the existing `data-platform` hook, (d) close mobile gaps, (e) keep guards (ESLint/vitest/Playwright) green and extend them for light.

**Tech stack:** Next.js (App Router) · React · Tailwind v3.4 (CSS-var color strategy) · OKLCH tokens in `globals.css` · Radix primitives wrapped in `components/ui/*` · Recharts + a hand-rolled SVG chart · vitest + Playwright. Hebrew RTL. App dir: `dashboard-web/`. Prod: `roas-dashboard-smoky.vercel.app`. Work on `main` (operator preference, no branches).

**Spec:** `docs/superpowers/specs/2026-05-31-dashboard-reskin-mesh-lightdark-design.md`
**Mockup (visual target):** `docs/superpowers/mockups/2026-05-31-light-reskin/dashboard-mockups.html` (open with `open <path>`; direction `mesh` = light, `dark-mesh` = dark).

---

## Codebase map (embedded from the 5-agent scan — self-contained; do NOT re-scan)

**Theming seam (all dark-only today):**
- `dashboard-web/src/app/globals.css` — single `:root` token block (~L15-221). No `[data-theme]` override blocks exist. Band gradients are at `.glass[data-band]` **L561-709** and use **hardcoded `oklch()` literals, NOT `--band-*` vars**. Body mesh wash (radials + animated conic) **L229-263**. Freshness desaturation `.glass[data-freshness]` **L791-798**. Fresh-chips **L805-814**. Per-store cells `.cell.*` **L838-875**. Platform tokens `--chart-platform-{meta,google,tiktok}` **L23-27**. Band tokens `--band-*` **L48-52**. Ink stack `--text*` **L109-112**. Glass `--glass-1/2/3` **L98-102** (white-alpha → only works on dark).
- `dashboard-web/tailwind.config.ts` — maps aliases→vars; **L24** `darkMode: ['selector','[data-theme="dark"]']` (wired, unused).
- `dashboard-web/src/components/ThemeProvider.tsx:39` — `const resolved = 'dark'` (the pin); effect L41-48 re-asserts `data-theme="dark"`.
- `dashboard-web/src/app/layout.tsx:62` — hardcoded `<html ... data-theme="dark">`; `viewport.themeColor='#0a0c1d'` (L49).
- `dashboard-web/src/lib/theme.ts` — **intact, dead** `resolveTheme(choice, osPrefersDark)` (L37-44), `ThemeChoice='system'|'light'|'dark'`, `readStoredTheme`/`writeStoredTheme`, key `roas-theme`.
- Toggle UI already exists: `components/Sidebar.tsx:192-232` (Sun/Moon/Monitor) + `components/CommandPalette.tsx:427-456` (`theme-*` commands) — inert until resolver reactivated.

**Hardcoded-oklch blocks to tokenize (won't flip with a var override):** `.glass[data-band]` strong/muted ladders (globals.css L561-709); `.fresh-chip.*` + `.cell.*`; `CommandCenterHero.tsx` `BAND_STROKE` (L353-359) + `NEUTRAL_SPARK_STROKE` (L368); `RoasTargetChart.tsx` pin `textShadow` (~L609).

**ROAS-band logic (DO NOT change thresholds):** `dashboard-web/src/lib/format/useRoasBandGradient.ts` (L41-44, red<2/orange2-2.7/green2.7-3/blue≥3/gray); `roasLabel()` in `dashboard-web/src/lib/analytics.ts:423-428`. Card binding via `<Card band bandStrength freshness>` → `data-*` (`components/ui/Card.tsx:210-212`). Per-store: `components/home/PerStoreRow.tsx` (`StoreCard` L166-356). Hero: `components/home/CommandCenterHero.tsx` (L473-475). Cell-coloring copies (consolidate, unify failure cell): `components/MonthlyTables.tsx:114-137` (`bg-black` zero), `components/DetailTable.tsx:13-25` (`bg-status-red` zero), `components/CampaignsTableRow.tsx:57-63`.

**Platform-color fix target:** `components/home/PerStoreRow.tsx:318-356` renders `<div class="cell" data-cell="cpm" data-platform={p}><PlatformBadge.../></div>` — `data-platform` is rendered but **unused in CSS**. `components/ui/PlatformBadge.tsx` (dot = `bg-current` + inline `boxShadow:'0 0 8px currentColor'` L169; `PLATFORM_COLOR` L84-90 → `text-chart-*`). Root cause: band tint bleed + `filter:saturate()` cascade from `.glass[data-freshness]`.

**Charts:** Home `RoasTargetChart.tsx` = hand-rolled SVG, reads `--chart-*` vars (globals.css L185-190) — re-theme via vars, JSX untouched (keep `data-testid` hooks). Recharts wrappers `components/ui/chart/ChartContainer.tsx` inject `--chart-grid/axis/cursor/target`. Colors source: `lib/chartColors.ts`.

**Mobile gaps:** `sm:`-first (535 `sm:`); `md:` = sidebar desktop/mobile fork (`Sidebar.tsx:374-453`, mobile drawer + scroll-lock). GAPS: `/operator` (`components/operator/*`) near-zero responsive; content columns don't re-expand on `lg/xl`; **known clip bug** `components/CampaignsTable.tsx:2444` (tooltip clipped by `overflow-auto` — needs Floating-UI/portal; also `HealthScoreBadge.tsx:90-107`); `components/TabHeader.tsx` + several `ui/*` primitives lack breakpoints.

**Guards:** ESLint `eslint-rules/*` (all `error`): `no-hex-color-in-components`, `no-dark-variant-in-components` (light/dark via tokens, not `dark:`), `no-physical-direction-in-components` (logical props/RTL), `no-cross-palette-import`, `no-raw-{button,table,input}`, `no-native-title-tooltip`, `no-legacy-tailwind-class`, `no-emoji-in-jsx`(warn). vitest token guards: `src/lib/__tests__/{glassTokens,chartTokens,colorCollisions,tokenSweep}.test.ts`. Playwright: `playwright.config.ts` pins `colorScheme:'dark'` (dark-only); snapshots `tests/visual/{pages,states}.spec.ts` (26).

**Commands:** `cd dashboard-web && npm run test` (vitest) · `npm run lint` · `npx tsc --noEmit` · `npx playwright test` · `npm run dev` (local only — but **verify on prod URL**, never localhost). Verify visually by opening prod and toggling theme.

---

## Phase 0 — Pre-flight & safety net

### Task 0.1: Establish the baseline is green
**Files:** none (read-only).
- [ ] **Step 1:** `cd dashboard-web && npx tsc --noEmit` — Expected: clean.
- [ ] **Step 2:** `npm run test` — Expected: all pass. Record the count.
- [ ] **Step 3:** `npm run lint` — Expected: clean.
- [ ] **Step 4:** `npx playwright test` — Expected: 26 dark snapshots pass (or note pre-existing failures). Do NOT proceed if baseline is red for unrelated reasons; surface it.

### Task 0.2: Add the token-completeness test FIRST (red), so light coverage is enforced
**Files:** Create `dashboard-web/src/lib/__tests__/themeParity.test.ts`
- [ ] **Step 1: Write the failing test** — parse `globals.css`, collect every `--token` declared in the base `:root`, and assert each also has a value under `[data-theme="light"]` (and `[data-theme="dark"]` if you invert to light-default). Skeleton:
```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

const css = readFileSync(join(__dirname, '../../app/globals.css'), 'utf8');
function tokensIn(block: string): Set<string> {
  return new Set([...block.matchAll(/(--[\w-]+)\s*:/g)].map(m => m[1]));
}
function blockFor(selector: string): string {
  const i = css.indexOf(selector);
  if (i < 0) return '';
  const start = css.indexOf('{', i);
  let depth = 0, j = start;
  for (; j < css.length; j++) { if (css[j] === '{') depth++; else if (css[j] === '}') { depth--; if (!depth) break; } }
  return css.slice(start, j);
}
describe('theme token parity', () => {
  it('every :root token has a light-mode value', () => {
    const root = tokensIn(blockFor(':root'));
    const light = tokensIn(blockFor('[data-theme="light"]'));
    const missing = [...root].filter(t => !light.has(t));
    expect(missing, `light theme missing: ${missing.join(', ')}`).toHaveLength(0);
  });
});
```
- [ ] **Step 2: Run — verify it FAILS** (no `[data-theme="light"]` block yet). Run: `npm run test -- themeParity`. Expected: FAIL listing all tokens missing.
- [ ] **Step 3: Commit** the test (red is intentional — it's the gate the next phase satisfies):
```bash
git add src/lib/__tests__/themeParity.test.ts && git commit -m "test(ui-ux): add theme-parity guard (red until light tokens land)"
```

---

## Phase 1 — Reactivate light/dark plumbing

### Task 1.1: Un-pin ThemeProvider to use the existing resolver
**Files:** Modify `dashboard-web/src/components/ThemeProvider.tsx`
- [ ] **Step 1:** Restore OS-pref state + resolver. Replace the hard-pin (`const resolved = 'dark'`) and the "re-assert dark" effect with:
```tsx
const [osPrefersDark, setOsPrefersDark] = useState(true);
useEffect(() => {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  setOsPrefersDark(mq.matches);
  const on = (e: MediaQueryListEvent) => setOsPrefersDark(e.matches);
  mq.addEventListener('change', on);
  return () => mq.removeEventListener('change', on);
}, []);
const resolved = resolveTheme(choice, osPrefersDark); // resolveTheme already in lib/theme.ts
useEffect(() => {
  document.documentElement.setAttribute('data-theme', resolved);
}, [resolved]);
```
Keep `choice`/`setChoice`/persistence as-is (already wired to `lib/theme.ts`).
- [ ] **Step 2:** `npx tsc --noEmit` — Expected: clean.
- [ ] **Step 3: Commit:** `git add src/components/ThemeProvider.tsx && git commit -m "feat(ui-ux): reactivate theme resolver (light/dark/system)"`

### Task 1.2: Un-hardcode layout + add pre-paint FOUC script + theme-aware themeColor
**Files:** Modify `dashboard-web/src/app/layout.tsx`
- [ ] **Step 1:** Remove the literal `data-theme="dark"` from `<html>` (keep `lang="he" dir="rtl"`). Add a pre-hydration inline script in `<head>` that sets `data-theme` before paint:
```tsx
<script dangerouslySetInnerHTML={{ __html: `(function(){try{var c=localStorage.getItem('roas-theme');var d=window.matchMedia('(prefers-color-scheme: dark)').matches;var t=(c==='light'||c==='dark')?c:(d?'dark':'light');document.documentElement.setAttribute('data-theme',t);}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();` }} />
```
- [ ] **Step 2:** Make `viewport.themeColor` theme-aware (array form):
```ts
export const viewport = { themeColor: [
  { media: '(prefers-color-scheme: dark)', color: '#0a0c1d' },
  { media: '(prefers-color-scheme: light)', color: '#f3f4f8' },
] };
```
- [ ] **Step 3:** `npx tsc --noEmit` — clean. Manually confirm no hydration warning in dev console.
- [ ] **Step 4: Commit:** `git add src/app/layout.tsx && git commit -m "feat(ui-ux): pre-paint theme bootstrap + theme-aware themeColor (no FOUC)"`

---

## Phase 2 — Light token set + tokenize hardcoded gradients

> This is the heaviest visual phase. The `themeParity` test (0.2) turns green here. Tune exact OKLCH light values against the mockup (`mesh` direction) and the WCAG contrast check; the values below are starting points.

### Task 2.1: Author the `[data-theme="light"]` token block
**Files:** Modify `dashboard-web/src/app/globals.css`
- [ ] **Step 1:** Immediately after the `:root{…}` block, add `[data-theme="light"]{…}` re-declaring **every** token (`themeParity` enumerates them). Light starting values (tune to mockup): canvas `oklch(96% 0.005 250)`/`oklch(99% 0 0)`; glass→opaque neutral surfaces `oklch(100% 0 0)` / `oklch(98% 0.004 250)` / `oklch(96% 0.006 250)`; `--glass-edge: oklch(20% 0.02 260 / 0.08)`; ink `--text: oklch(22% 0.03 265)`, `--text-2/-muted/-subtle` lightening; keep `--band-*`, `--status-*`, `--chart-platform-*` hues but verify legibility on light; `--accent` violet unchanged. Also add `[data-theme="dark"]{}` only if you inverted defaults (otherwise the existing `:root` stays the dark set — simplest: keep `:root` = dark, add `[data-theme="light"]` overrides; update `themeParity` to compare `:root` vs `[data-theme="light"]`).
- [ ] **Step 2:** Fork the **body mesh wash** (L229-263): wrap the dark radials/conic so light gets a softer light-canvas variant — e.g. `[data-theme="light"] body { background: <light radials> }` and tone/ý the `body::before` conic for light.
- [ ] **Step 3: Run** `npm run test -- themeParity` — Expected: PASS (every token has a light value).
- [ ] **Step 4: Run** `npm run test -- glassTokens chartTokens colorCollisions tokenSweep` — Expected: PASS (don't break existing guards).
- [ ] **Step 5: Commit:** `git add src/app/globals.css src/lib/__tests__/themeParity.test.ts && git commit -m "feat(ui-ux): light token set + light body mesh; theme-parity green"`

### Task 2.2: Tokenize the `.glass[data-band]` gradients so they flip per theme
**Files:** Modify `dashboard-web/src/app/globals.css` (L561-709)
- [ ] **Step 1:** Refactor each strong/muted band ladder to consume `--band-*` (+ per-theme slab/halo opacity vars like `--band-slab-strong: 0.85` / `--band-base-tint: 0.38` defined in `:root` and overridden under `[data-theme="light"]`) instead of inline literal `oklch(...)`. Match the mockup's `mesh` (light) and `dark-mesh` (dark) richness.
- [ ] **Step 2:** Verify WCAG: white text on each band slab in light must hold ≥4.5:1 (or switch banded-card text to dark ink in light if a band is too pale). Adjust slab opacity per band.
- [ ] **Step 3: Run** `npm run test` — Expected: still green.
- [ ] **Step 4: Commit:** `git add src/app/globals.css && git commit -m "refactor(ui-ux): tokenize band gradients for light+dark"`

### Task 2.3: Tokenize the remaining hardcoded oklch (sparklines, chips, pins)
**Files:** Modify `components/home/CommandCenterHero.tsx` (BAND_STROKE L353-359, NEUTRAL_SPARK_STROKE L368), `components/home/RoasTargetChart.tsx` (pin textShadow ~L609), and `globals.css` `.fresh-chip.*`/`.cell.*`.
- [ ] **Step 1:** Replace inline oklch with `var(--band-*)`/`var(--chart-*)` reads (add chart-namespaced vars if the lint `no-cross-palette-import` forbids `--band-*` in chart files — mirror via `--chart-*`). For the hero sparklines, read CSS vars via `getComputedStyle` or pass a CSS var string to the stroke (SVG `stroke="var(--band-green)"` works).
- [ ] **Step 2:** `npm run lint` — Expected: clean (no `no-hex`/`no-cross-palette` violations).
- [ ] **Step 3: Run** `npm run test` — green.
- [ ] **Step 4: Commit:** `git add -A && git commit -m "refactor(ui-ux): tokenize hero sparklines, fresh-chips, chart pins (theme-aware)"`

---

## Phase 3 — Platform-color emphasis fix

### Task 3.1: Make platform dots survive band tint + desaturation
**Files:** Modify `dashboard-web/src/app/globals.css`; verify `components/home/PerStoreRow.tsx:318-356` already emits `data-platform`.
- [ ] **Step 1:** Add CSS keyed on the existing hook:
```css
.cell[data-platform="meta"]   { background: oklch(from var(--chart-platform-meta)   l c h / 0.10); }
.cell[data-platform="google"] { background: oklch(from var(--chart-platform-google) l c h / 0.10); }
.cell[data-platform="tiktok"] { background: oklch(from var(--chart-platform-tiktok) l c h / 0.10); }
/* keep the platform dot vivid regardless of card band/freshness */
.cell[data-platform] .platform-dot { box-shadow: 0 0 0 2px var(--surface), 0 0 6px color-mix(in oklab, currentColor 60%, transparent); }
/* exempt the platform cell from the parent freshness desaturation */
.glass[data-freshness] .cell[data-platform] { filter: saturate(1) !important; }
```
(Adjust selector to the real dot class in `PlatformBadge.tsx`; add a stable class/`data-` if needed — that's a 1-line primitive edit, allowed.)
- [ ] **Step 2:** Open the mockup's analog and the prod page; confirm on a RED/AMBER/GREEN card AND on a stale card the Meta/Google/TikTok dots read distinctly.
- [ ] **Step 3:** If `PlatformBadge.tsx` needs a stable dot class, add it (no behavior change). `npm run lint && npx tsc --noEmit` — clean.
- [ ] **Step 4: Commit:** `git add -A && git commit -m "fix(ui-ux): platform-color dots pop on banded + stale cards (data-platform hook)"`

---

## Phase 4 — ROAS cell consolidation

### Task 4.1: Unify the failure ('0') cell + dedupe cell-coloring
**Files:** `components/MonthlyTables.tsx:114-137`, `components/DetailTable.tsx:13-25`, `components/CampaignsTableRow.tsx:57-63`; optionally a new shared helper `src/lib/format/roasCell.ts`.
- [ ] **Step 1: Write/adjust a test** asserting `roasCell(roas=anything, revenue=0, spend>0)` → the single failure token (decide: `--cell-fail` = black). Put the helper + test under `src/lib/format/`.
- [ ] **Step 2:** Extract one `roasCell()` helper consumed by all three call sites; add `--cell-fail` token (light+dark) in globals.css.
- [ ] **Step 3: Run** `npm run test` — green; the MonthlyTables/DetailTable discrepancy is gone.
- [ ] **Step 4: Commit:** `git add -A && git commit -m "refactor(ui-ux): single roasCell helper; unify failure cell to black across tables"`

---

## Phase 5 — Per-tab visual verification (light + dark)

> No structural changes — confirm each tab re-skins correctly in both themes and fix any tab-local hardcoded color or contrast miss found.

### Task 5.1..5.7: One task per surface
For each of **Home, P&L, Analysis(Trends+History), Campaigns(+Drawer), Products, Detail, Operator**:
- [ ] **Step 1:** Toggle light + dark on prod; walk the surface; screenshot-compare against the mockup `mesh`/`dark-mesh`.
- [ ] **Step 2:** Fix any leftover hardcoded color / low-contrast spot (e.g. `Stat.tsx` `text-orange-200` raw Tailwind in hero compoundVariants — tokenize). Keep edits token-driven; `npm run lint` clean.
- [ ] **Step 3: Commit** per surface: `git commit -m "fix(ui-ux): <tab> light/dark polish"`.

---

## Phase 6 — Mobile workstream

### Task 6.1: Operator responsive
**Files:** `dashboard-web/src/components/operator/*` + `src/app/operator/*`.
- [ ] **Step 1:** Add `sm:`-first layouts (stack cards, wrap toolbars, `overflow-x-auto` tables). - [ ] **Step 2:** Verify at ≤520px. - [ ] **Step 3: Commit.**

### Task 6.2: Fix the clipped-tooltip bug
**Files:** `components/CampaignsTable.tsx:2444` + `components/HealthScoreBadge.tsx:90-107`.
- [ ] **Step 1:** Portal the column-header tooltip + HealthScoreBadge popover (Floating-UI/Radix) so they escape `overflow-auto`. - [ ] **Step 2:** Verify on mobile no clipping. - [ ] **Step 3: Commit.**

### Task 6.3: TabHeader + large-desktop columns + bare primitives
**Files:** `components/TabHeader.tsx`, the `grid` cards that stop at `sm:`, relevant `ui/*`.
- [ ] **Step 1:** Add `lg:`/`xl:` re-expansion where content underuses wide screens; add breakpoints to `TabHeader`. - [ ] **Step 2:** Verify. - [ ] **Step 3: Commit.**

---

## Phase 7 — Tests, CI, docs

### Task 7.1: Playwright light + dark snapshots
**Files:** `dashboard-web/playwright.config.ts`, `tests/visual/*`.
- [ ] **Step 1:** Add a `light` project (`colorScheme:'light'` + force `data-theme=light`) alongside the dark one. - [ ] **Step 2:** Regenerate snapshots: `npx playwright test --update-snapshots`. Review every diff deliberately. - [ ] **Step 3: Commit.**

### Task 7.2: Full green gate + docs
- [ ] **Step 1:** `npx tsc --noEmit && npm run lint && npm run test && npx playwright test` — all green.
- [ ] **Step 2:** Update **User Manual** (UX: light/dark toggle) and **ARCHITECTURE** (§ token/theming dual-mode) per the "keep docs current" rule.
- [ ] **Step 3: Commit:** `git commit -m "docs(ui-ux): light/dark in User Manual + ARCHITECTURE; CI light snapshots"`.
- [ ] **Step 4:** Manual prod verification: open `roas-dashboard-smoky.vercel.app`, toggle theme via Sidebar, walk all tabs + drawer + mobile.

---

## Self-Review (run before execution)

- **Spec coverage:** light/dark ✅(P1-2) · mesh cards/tokenized gradients ✅(2.2) · 4-band + failure cell ✅(4.1) · platform-color fix ✅(3.1) · charts-keep-axes ✅(token-only, no JSX change) · mobile ✅(P6) · guards/tests ✅(0.2,7.1) · per-tab ✅(P5). No spec section unmapped.
- **Placeholder scan:** OKLCH light values are starting points tuned in 2.1-2.2 against the mockup + WCAG gate — this is design tuning, not a placeholder; method + gate are concrete.
- **Type consistency:** `resolveTheme(choice, osPrefersDark)` matches `lib/theme.ts`; `roasCell()` is the single new helper used by all three tables; `data-theme="light"` selector matches the `themeParity` test + tailwind `darkMode` hook.

---

## Execution handoff
On approval, execute via **superpowers:subagent-driven-development** (fresh subagent per task, review between) — recommended for this many discrete, verifiable tasks — or **superpowers:executing-plans** (inline, batched with checkpoints). Work on `main`, commit per task, push only when the operator asks.
