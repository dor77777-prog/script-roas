# Dashboard UX/UI Overhaul — Plan 04b: CampaignDrawer + embedded panels + view transitions

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking. **Tasks 1-4 are worktree-parallel candidates** — dispatch them simultaneously with `Agent { isolation: "worktree" }` for ~4× wall-clock speedup.

**Goal:** Token-migrate the CampaignDrawer and the 5 panels embedded inside it (HealthScorePanel, CohortComparisonPanel, AttributionAnalysisPanel, ProductChannelBreakdown, MetaShopifyReconciliation), migrate the 3 Recharts charts (2 in CampaignDrawer, 1 in MetaShopifyReconciliation) to the Plan 3 chart primitives, and add a View Transitions animation to the drawer-open state setter (mirrors the existing tab-transition pattern).

**Architecture:** All 5 panels are pure data-in/JSX-out — token migration is purely className edits, no logic touches. The drawer is a fixed overlay; the view-transition wraps the parent state setter (currently `setDrawerCampaign(...)` in CampaignsTable) with `document.startViewTransition` so the drawer entrance becomes a CSS-driven morph instead of the current `animate-fade-in`. The chart migrations follow Plan 3's pattern: wrap with `<ChartContainer>`, swap the tooltip body to `<ChartTooltip>` + primitives, migrate Recharts SVG color literals to `var(--chart-*)` CSS vars.

**Tech Stack:** No new deps. Uses Plan 3's `components/ui/chart/{ChartContainer,ChartTooltip,ChartLegend}` primitives.

**Branch:** Continue on `dashboard-ux-overhaul-2026-05-28` after Plan 4a's `plan-04a-campaigns-table-done` tag lands. Commits use `refactor(panels)`, `refactor(drawer)`, `refactor(charts)`, `feat(drawer)` prefixes.

---

## Scope — single source of truth

**Files touched by Plan 4b:**

| File | Lines | Legacy tokens | Charts? |
|------|-------|---------------|---------|
| HealthScorePanel.tsx | 233 | 26 | no |
| CohortComparisonPanel.tsx | 511 | 41 | no |
| AttributionAnalysisPanel.tsx | 164 | 6 | no |
| ProductChannelBreakdown.tsx | 165 | 11 | no |
| MetaShopifyReconciliation.tsx | 848 | 41 | 1 (ComposedChart) |
| CampaignDrawer.tsx | 1,413 | 53 | 2 (AreaChart + LineChart) |
| globals.css | — | — | view-transition-name rules |
| CampaignsTable.tsx | 2,456 | (already migrated in 4a) | — | view-transition wrapper around setDrawerCampaign |

**Token migration map:** Plan 2 SSOT (same as Plans 2 + 4a). Preserve `shadow-cardHover`, `shadow-elevated` (custom cool-tinted, no Tailwind md/lg defaults).

**Chart migration map:** Plan 3 SSOT.
- `<ResponsiveContainer>` → `<ChartContainer height="100%" className="...">`
- Hardcoded SVG colors that already use `CHART_COLORS.*` STAY (the CHART_COLORS object is Plan-4/5 territory — leave alone unless a token explicitly maps).
- Tooltip body's `dir="rtl"` chrome `<div>` → `<ChartTooltip>` primitive (chrome owned centrally).
- Numeric value spans → `<ChartTooltipValue>` (brings `font-mono` for free).

---

## Parallelism plan

```
                    ┌─ Worktree A: Task 1 (HealthScorePanel tokens)
                    ├─ Worktree B: Task 2 (CohortComparisonPanel tokens)
PARALLEL ──────────┼─ Worktree C: Task 3 (AttributionAnalysisPanel tokens)
                    ├─ Worktree D: Task 4 (ProductChannelBreakdown tokens)
                    └─ Worktree E: Task 5 (MetaShopifyReconciliation tokens + chart)
                              │
                              ▼  (rebase all 5 worktrees back to main branch)
                       Task 6 (CampaignDrawer tokens + 2 charts)
                              │
                              ▼
                       Task 7 (view-transition drawer-open)
                              │
                              ▼
                       Task 8 (wrap-up audit + tag)
```

Tasks 1-5 touch DIFFERENT files with NO logic dependencies → safe to run in parallel worktrees. Task 5 includes both token + chart migration in the same dispatch because both touch the same file.

Task 6 (CampaignDrawer) is sequential because:
- It's the biggest file (1413 lines, 53 tokens, 2 charts) — one focused implementer minimizes risk
- Token + chart migrations both touch the same file, so they can't conflict-free parallelize anyway

Task 7 (view-transition) is sequential and small (~10 lines of code).

Task 8 (audit) is verification-only.

---

## Shared task template — token migration of one panel

Tasks 1-4 each follow this exact pattern. The implementer in each worktree:

1. **Pre-scan** the file with the broad grep (paste below) — confirm the token count matches Plan 4b's scope table.
2. **Apply** the Plan 2 SSOT migration map.
3. **Verify** the post-migration grep returns `(clean)`, `tsc --noEmit` exits 0.
4. **Commit** with the message specified per task.

Migration map (Plan 2 SSOT, identical to Plans 2 + 4a):

| Legacy | New |
|--------|-----|
| `bg-background` | `bg-canvas` |
| `bg-surface` | `bg-elevated` |
| `bg-surfaceMuted` / `bg-surfaceSubtle` | `bg-elevated2` |
| `bg-surfaceSunken` | `bg-canvas` |
| `border-border` | `border-line` |
| `border-borderSubtle` | `border-line-subtle` |
| `border-borderStrong` | `border-line-strong` |
| `text-text-primary` | `text-ink` |
| `text-text-secondary` | `text-ink-secondary` |
| `text-text-muted` | `text-ink-muted` |
| `text-text-subtle` | `text-ink-subtle` |
| `text-primary` | `text-accent` |
| `bg-primary` | `bg-accent` |
| `text-primary-dark`/`bg-primary-dark` | `text-accent`/`bg-accent` |
| `hover:bg-primary-dark` | `hover:bg-accent/80` |
| `from-primary-dark` | `from-accent` |
| `via-primary` | `via-accent` |
| `to-primary-light` | `to-accent/80` |
| `bg-primary-light`/`text-primary-light` | `bg-accent`/`text-accent` |
| `bg-roas-{c}Bg` | `bg-status-{c}Bg` (red/orange/green/blue) |
| `text-roas-{c}` | `text-status-{c}` |
| `border-roas-{c}` | `border-status-{c}` |
| `shadow-card` | `shadow-sm` |
| `shadow-cardHover` | KEEP (no Tailwind md default) |
| `shadow-elevated` | KEEP (no Tailwind lg default) |

Broad grep:
```
bg-(background|surface|surfaceMuted|surfaceSubtle|surfaceSunken|primary[-]?(dark|light)?|roas-)|border-(border\b|borderSubtle|borderStrong|roas-)|text-(text-|primary[-]?(dark|light)?|roas-)|shadow-card[^H]|shadow-card$
```

Tailwind base palette DO NOT migrate: `text-white`, `text-black`, `text-amber-*`, `bg-amber-*`, `text-emerald-*`, `text-rose-*`, `text-cyan-*`.

---

## Task 1: HealthScorePanel token migration (worktree-parallel)

**File:** `dashboard-web/src/components/HealthScorePanel.tsx` (233 lines, 26 tokens).

- [ ] Pre-scan → confirm 26 legacy tokens.
- [ ] Apply migration map. The panel renders a single score with band-based colors; the band → tone mapping (`text-status-green`, `text-status-red`, etc.) maps 1-to-1.
- [ ] Verify post-migration grep returns `(clean)`; `tsc --noEmit` clean; tests pass.
- [ ] Commit:
```bash
git add dashboard-web/src/components/HealthScorePanel.tsx
git commit -m "refactor(panels): HealthScorePanel token migration"
```

---

## Task 2: CohortComparisonPanel token migration (worktree-parallel)

**File:** `dashboard-web/src/components/CohortComparisonPanel.tsx` (511 lines, 41 tokens).

- [ ] Pre-scan → confirm 41 tokens.
- [ ] Apply migration map. Cohort-comparison rows use ROAS bands — same `status-*` mapping.
- [ ] Verify + commit:
```bash
git add dashboard-web/src/components/CohortComparisonPanel.tsx
git commit -m "refactor(panels): CohortComparisonPanel token migration"
```

---

## Task 3: AttributionAnalysisPanel token migration (worktree-parallel)

**File:** `dashboard-web/src/components/AttributionAnalysisPanel.tsx` (164 lines, 6 tokens).

- [ ] Pre-scan → confirm 6 tokens.
- [ ] Apply migration map.
- [ ] Verify + commit:
```bash
git add dashboard-web/src/components/AttributionAnalysisPanel.tsx
git commit -m "refactor(panels): AttributionAnalysisPanel token migration"
```

---

## Task 4: ProductChannelBreakdown token migration (worktree-parallel)

**File:** `dashboard-web/src/components/ProductChannelBreakdown.tsx` (165 lines, 11 tokens).

- [ ] Pre-scan → confirm 11 tokens.
- [ ] Apply migration map.
- [ ] Verify + commit:
```bash
git add dashboard-web/src/components/ProductChannelBreakdown.tsx
git commit -m "refactor(panels): ProductChannelBreakdown token migration"
```

---

## Task 5: MetaShopifyReconciliation token + chart migration (worktree-parallel)

**File:** `dashboard-web/src/components/MetaShopifyReconciliation.tsx` (848 lines, 41 tokens, 1 ComposedChart at lines 628-731).

### Step 1 — Token migration (apply broad map; 41 references).

Same pattern as Tasks 1-4. Pre-scan → migrate → verify clean grep.

### Step 2 — Add chart primitive imports

Find the imports block. Add:

```tsx
import { ChartContainer } from '@/components/ui/chart/ChartContainer';
import {
  ChartTooltip,
  ChartTooltipLabel,
  ChartTooltipRow,
  ChartTooltipValue,
} from '@/components/ui/chart/ChartTooltip';
```

Remove `ResponsiveContainer` from the recharts import (if no other consumers in file — grep to confirm).

### Step 3 — Wrap chart in ChartContainer

Find the chart block at line 628:

```tsx
<ResponsiveContainer width="100%" height="100%">
  <ComposedChart data={reconciliation.series} margin={{...}}>
    ...
  </ComposedChart>
</ResponsiveContainer>
```

Replace with:

```tsx
<ChartContainer className="..." height="100%">
  <ComposedChart data={reconciliation.series} margin={{...}}>
    ...
  </ComposedChart>
</ChartContainer>
```

(Inherit the existing `className` from the outer `<div>` if it set `h-...` sizing — adapt as needed.)

### Step 4 — Migrate the tooltip body

Find the `<Tooltip content={...}>` block at line 661. Replace the inner returned JSX with `<ChartTooltip>` primitives, preserving the destructuring + null guard + Hebrew labels + `tabular-nums` math. Use `<ChartTooltipRow color={CHART_COLORS.meta} label="Meta">...<ChartTooltipValue>{...}</ChartTooltipValue></ChartTooltipRow>` per series.

### Step 5 — Verify and commit

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit ; echo "tsc=$?"
npm run test 2>&1 | tail -3
npm run build 2>&1 | tail -5
```

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/components/MetaShopifyReconciliation.tsx
git commit -m "refactor(panels): MetaShopifyReconciliation tokens + Recharts → ChartContainer/ChartTooltip"
```

---

## Task 6: CampaignDrawer token + chart migration (sequential, after Tasks 1-5 rebased)

**File:** `dashboard-web/src/components/CampaignDrawer.tsx` (1,413 lines, 53 tokens, 2 charts).

This file is the biggest single migration in Plan 4b. The 2 charts:
1. **AreaChart** at lines 783-832 (spend/value daily area chart in summary header).
2. **LineChart** at lines 1004-1133 (CPM/ROAS dual-axis line chart).

### Step 1 — Token migration (53 tokens, broad map).

Identical pattern to Tasks 1-4. Pre-scan → migrate → verify clean grep.

### Step 2 — Add chart primitive imports

```tsx
import { ChartContainer } from '@/components/ui/chart/ChartContainer';
import {
  ChartTooltip,
  ChartTooltipLabel,
  ChartTooltipRow,
  ChartTooltipValue,
} from '@/components/ui/chart/ChartTooltip';
```

Remove `ResponsiveContainer` from recharts import.

### Step 3 — Migrate AreaChart (lines 783-832)

Wrap `<ResponsiveContainer>` → `<ChartContainer>`. Migrate the tooltip body (around line 817) to `<ChartTooltip>` + primitives. Preserve the SVG gradient `<defs>` block and per-series `Area`/`Line` props (the `CHART_COLORS.*` references stay).

### Step 4 — Migrate LineChart (lines 1004-1133)

Same pattern. The LineChart has dual YAxis (one for CPM, one for ROAS) — preserve both. Tooltip body (around line 1047) migrates to `<ChartTooltip>` + primitives, preserving the CPM/prevCpm/ROAS row structure.

### Step 5 — Verify and commit

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit ; echo "tsc=$?"
npm run test 2>&1 | tail -3
npm run test:components 2>&1 | tail -3
npm run build 2>&1 | tail -5
```

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/components/CampaignDrawer.tsx
git commit -m "refactor(drawer): CampaignDrawer tokens + 2 Recharts → ChartContainer/ChartTooltip"
```

---

## Task 7: View-transition on drawer open

**Files:**
- Modify: `dashboard-web/src/components/CampaignsTable.tsx`
- Modify: `dashboard-web/src/app/globals.css`

Mirror the existing `useTabTransition` pattern (Dashboard.tsx lines 86-99). The drawer is opened by `setDrawerCampaign(...)` in CampaignsTable. Wrap that state setter with `document.startViewTransition` so the entrance becomes a CSS-driven morph.

### Step 1 — Find the drawer-open state setters

**Pre-flight verified (2026-05-29):** CampaignsTable uses THREE separate state vars (not a single `drawerCampaign`):
- `drillCampaignId` / `setDrillCampaignId` at line 464
- `drillPlatform` / `setDrillPlatform` at line 468
- `drillStoreId` / `setDrillStoreId` at line 472

The single open call site is in the `onDrillCampaign` inline callback around line 1954-1958 (line numbers may shift after Plan 4a's token migrations land — grep for `onDrillCampaign={(`).

The close site is around line 1997 (`onClose={() => { setDrillCampaignId(null); ... }}`).

### Step 2 — Add `startViewTransition` + `startTransition` wrapper

Mirror the existing `useTabTransition` pattern (Dashboard.tsx lines 86-99): wrap React's `startTransition` inside `document.startViewTransition`. Both are needed — the inner `startTransition` keeps the state update non-blocking so the view-transition snapshot completes cleanly.

First, add `startTransition` to the React import in CampaignsTable (currently `useEffect, useMemo, useRef, useState` — add `startTransition`).

Then replace the `onDrillCampaign` body:

```tsx
onDrillCampaign={(campaignId, platform, storeId) => {
  const doc = document as typeof document & {
    startViewTransition?: (cb: () => void) => { finished: Promise<void> };
  };
  if (typeof doc.startViewTransition === 'function') {
    doc.startViewTransition(() => {
      startTransition(() => {
        setDrillCampaignId(campaignId);
        setDrillPlatform(platform);
        setDrillStoreId(storeId);
      });
    });
  } else {
    setDrillCampaignId(campaignId);
    setDrillPlatform(platform);
    setDrillStoreId(storeId);
  }
}}
```

All three state setters wrap in ONE atomic `startTransition` callback so React batches them into a single re-render (which the view-transition then snapshots).

Close handler (`onClose={...}`) does NOT get the view-transition wrap — exit animation is governed by the existing CSS keyframe + the panel's `view-transition-name`.

### Step 3 — Add `view-transition-name` rules to globals.css

In `dashboard-web/src/app/globals.css`, add a small block:

```css
/* Drawer entrance morph — used by the View Transitions API call in
   CampaignsTable when opening CampaignDrawer. The fixed overlay
   inherits the default cross-fade; the panel itself gets the matched
   element transition via view-transition-name. */
@media (prefers-reduced-motion: no-preference) {
  ::view-transition-old(drawer-panel),
  ::view-transition-new(drawer-panel) {
    animation-duration: 220ms;
    animation-timing-function: cubic-bezier(0.2, 0.8, 0.2, 1);
  }
}
```

### Step 4 — Tag the drawer panel with `view-transition-name`

In `dashboard-web/src/components/CampaignDrawer.tsx`, find the `<aside>` element (grep for `<aside` — there's exactly one in the file; pre-flight found it at line 698, but line numbers shift after Plan 4b Tasks 5-6 chart migrations).

Add the `view-transition-name` inline style AND remove the conflicting `animate-fade-in-up` class (view-transition's morph supersedes the keyframe animation in browsers that support it; the keyframe stays as the no-VT fallback when `startViewTransition` is unavailable in the parent component — the `else` branch in Step 2 still triggers the existing CSS animation):

```tsx
<aside
  className="..."  // remove 'animate-fade-in-up' from this string
  style={{ viewTransitionName: 'drawer-panel' as never }}
>
  ...
</aside>
```

(The `as never` cast is the existing project pattern for declaring custom CSS properties via the `style` prop without a TypeScript complaint.)

**About removing `animate-fade-in-up`:** With View Transitions API, the browser snapshots both states and morphs between them. The keyframe animation would fire simultaneously, producing visible double-animation. The trade-off: in browsers without View Transitions support (Safari < 18), the panel will appear with no animation. That's acceptable — the panel content is the important payload, not the entrance flourish. Plan 7 can add a `@supports not (view-transition-name: foo)` fallback if the lack of animation in legacy Safari is noticed.

### Step 5 — Verify

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit ; echo "tsc=$?"
npm run build 2>&1 | tail -5
npm run test:components 2>&1 | tail -3
```

### Step 6 — Commit

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/components/CampaignsTable.tsx \
        dashboard-web/src/components/CampaignDrawer.tsx \
        dashboard-web/src/app/globals.css
git commit -m "feat(drawer): View-Transition entrance morph on drawer open"
```

---

## Task 8: Wrap-up audit + tag

- [ ] **Step 1: Final legacy-token grep across all Plan 4b files**

```bash
cd /Users/dorperetz/script-roas
for f in \
  dashboard-web/src/components/HealthScorePanel.tsx \
  dashboard-web/src/components/CohortComparisonPanel.tsx \
  dashboard-web/src/components/AttributionAnalysisPanel.tsx \
  dashboard-web/src/components/ProductChannelBreakdown.tsx \
  dashboard-web/src/components/MetaShopifyReconciliation.tsx \
  dashboard-web/src/components/CampaignDrawer.tsx ; do
  echo "=== $f ==="
  grep -nE "bg-(background|surface|surfaceMuted|surfaceSubtle|surfaceSunken|primary[-]?(dark|light)?|roas-)|border-(border\b|borderSubtle|borderStrong|roas-)|text-(text-|primary[-]?(dark|light)?|roas-)|shadow-card[^H]|shadow-card$" "$f" || echo "(clean)"
done
```

Every section must print `(clean)`.

- [ ] **Step 2: Confirm Plan 4b didn't touch out-of-scope files**

```bash
git diff --name-only plan-04a-campaigns-table-done..HEAD -- \
  dashboard-web/src/components/ProductsTable.tsx \
  dashboard-web/src/components/ProductCentricView.tsx \
  dashboard-web/src/components/ProductPickerModal.tsx \
  dashboard-web/src/components/DetailTable.tsx \
  dashboard-web/src/components/MonthlyTables.tsx
```

Expected: empty (Plan 4c + Plan 5 territory).

- [ ] **Step 3: Full test + build**

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit ; echo "tsc=$?"
npm run test:all 2>&1 | tail -5
npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Tag**

```bash
git tag plan-04b-drawer-panels-done
```

---

## Self-Review

1. **Spec coverage:**
   - ✅ HealthScorePanel migration — Task 1
   - ✅ CohortComparisonPanel migration — Task 2
   - ✅ AttributionAnalysisPanel migration — Task 3
   - ✅ ProductChannelBreakdown migration — Task 4
   - ✅ MetaShopifyReconciliation tokens + chart — Task 5
   - ✅ CampaignDrawer tokens + 2 charts — Task 6
   - ✅ View-transition drawer open — Task 7

2. **Non-negotiables preserved:**
   - Panel logic untouched (all 5 are pure data-in/JSX-out).
   - `buildReconciliation` and `computeDayDelta` exports from MetaShopifyReconciliation preserved.
   - `CHART_COLORS.*` references preserved (Plan 4/5 will address them if needed).
   - Per-series chart logic preserved byte-for-byte (only Recharts SVG color literals not from `CHART_COLORS` migrate).
   - Drawer triggering mechanism (`open: boolean` prop) preserved.
   - `useTabTransition` pattern preserved as the reference for the new view-transition wrapper.

3. **Parallelism declared:**
   - Tasks 1-5: worktree-parallel.
   - Task 6: sequential (single file, biggest scope).
   - Task 7: sequential (small, 2 small files).
   - Task 8: serial last.

4. **Placeholder scan:** No "TBD" / "similar to". Every step has executable code or a commit command. Task 6's chart-migration steps reference Plan 3's patterns by example; the implementer follows the same pattern they used for HeroOverview / RoasChart in Plan 3.

5. **Test count expectations:** No new test files in Plan 4b. Existing tests should remain green: 1300 node + 43 component (after Plan 4a's lib tests land).
