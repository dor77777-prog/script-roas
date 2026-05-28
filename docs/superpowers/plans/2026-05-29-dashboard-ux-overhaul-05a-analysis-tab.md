# Dashboard UX/UI Overhaul — Plan 05a: ניתוח (Analysis) tab

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Token migration of the ניתוח tab: RoasChart chrome (6 tokens — Plan 3 only migrated chart internals), MonthlyTables (24 tokens — 17-month horizon + `roasLabel()` color SSOT MUST be preserved byte-for-byte), and the AnalysisTab wrapper inside Dashboard.tsx (4 tokens). Mechanical migration only — no layout changes, no new features.

**Architecture:** Three pure className edits on three distinct files. No logic, no data, no algorithm touches. The MonthlyTables non-negotiable: the 17-month horizon constant + the `ROAS_BG` color map keyed on `roasLabel().tone` survive unchanged — only the *values* in `ROAS_BG` migrate from `bg-roas-*` to `bg-status-*` per the SSOT.

**Tech Stack:** No new deps. Uses Plan 2 SSOT migration map.

**Branch:** Continue on `dashboard-ux-overhaul-2026-05-28` from tag `plan-04b-drawer-panels-done` at `15aa75d`. Commits use `refactor(analysis)` prefix.

---

## Scope

| File | Lines | Legacy tokens | Notes |
|------|-------|---------------|-------|
| RoasChart.tsx | 219 | 6 | Chrome only — Plan 3 migrated chart internals |
| MonthlyTables.tsx | 522 | 24 | Pure swap. 17-month horizon + `roasLabel()` SSOT preserved |
| Dashboard.tsx (AnalysisTab region) | — | 4 | Two inline wrapper divs around `<RoasChart bare>` + `<MonthlyTables bare>` |

**OUT of scope (Plans 5b/5c):**
- PnLBreakdown.tsx + BillingSettings.tsx → Plan 5b
- DetailTable.tsx → Plan 5c
- Dashboard.tsx PnLTab + DetailTab regions → 5b + 5c

---

## Parallelism plan

Three independent files. Worktree-parallel candidates OR single batched implementer. Given the small per-file scope (~34 tokens total), a single batched implementer doing 3 commits in sequence is fastest.

```
Task 1 (RoasChart chrome) ─┐
Task 2 (MonthlyTables) ────┼─► Task 4 (audit + tag)
Task 3 (AnalysisTab) ──────┘
```

---

## Task 1: RoasChart chrome token migration

**File:** `dashboard-web/src/components/RoasChart.tsx` (~219 lines, 6 legacy tokens).

Plan 3 migrated the chart internals (CartesianGrid, axes, ReferenceLine, Tooltip body). Plan 5a finishes the surrounding chrome: section wrapper at line ~211 + section header `<h2>` + legend tokens at lines 72/79/80.

- [ ] **Step 1: Pre-scan**
  ```bash
  grep -nE "bg-(background|surface|surfaceMuted|surfaceSubtle|surfaceSunken|primary[-]?(dark|light)?|roas-)|border-(border\b|borderSubtle|borderStrong|roas-)|text-(text-|primary[-]?(dark|light)?|roas-)|shadow-card[^H]|shadow-card$" /Users/dorperetz/script-roas/dashboard-web/src/components/RoasChart.tsx
  ```
  Confirm 6 matches.

- [ ] **Step 2: Apply migration map** (Plan 2 SSOT — same as Plans 2, 4a, 4b, 4c):
  - `bg-surface` → `bg-elevated`
  - `border-border` → `border-line`
  - `text-text-primary` → `text-ink`
  - `text-text-secondary` → `text-ink-secondary`
  - `text-text-muted` → `text-ink-muted`
  - `border-roas-green/70` → `border-status-green/70` (alpha preserved)
  - `shadow-card` → `shadow-sm` (custom cool-tinted, NOT shadow-cardHover/elevated)

- [ ] **Step 3: Verify clean grep + tsc**

- [ ] **Step 4: Commit**
  ```bash
  cd /Users/dorperetz/script-roas
  git add dashboard-web/src/components/RoasChart.tsx
  git commit -m "refactor(analysis): RoasChart chrome token migration (section + header + legend)"
  ```

---

## Task 2: MonthlyTables token migration

**File:** `dashboard-web/src/components/MonthlyTables.tsx` (522 lines, 24 tokens).

### Non-negotiables (verify each survives)

- `import { roasLabel } from '@/lib/analytics'` at line 9 — UNCHANGED.
- `const MONTHLY_TABLES_HISTORY_MONTHS = 17` at line 39 — UNCHANGED.
- `const ROAS_BG: Record<string, string>` at line ~91 — KEYS unchanged; VALUES migrate from `bg-roas-*` to `bg-status-*` per SSOT.
- `roasCellStyle()` function at line ~113 — call to `roasLabel(roas).tone` UNCHANGED; the returned `tone` is the key into `ROAS_BG`.
- Two internal section wrappers at lines ~322 and ~445 — both `rounded-xl bg-surface border border-border shadow-card` — migrate per SSOT.

### Steps

- [ ] **Step 1: Pre-scan → confirm 24 matches.**

- [ ] **Step 2: Apply migration map.**
  - All `bg-surface` → `bg-elevated`
  - All `border-border` → `border-line`
  - All `bg-roas-{c}Bg` → `bg-status-{c}Bg` (red/orange/green/blue/gray)
  - All `text-text-*` per SSOT
  - All `shadow-card` → `shadow-sm`
  - DO NOT touch: `roasLabel()` call, `MONTHLY_TABLES_HISTORY_MONTHS` constant, the column structure, the date-range memo (line ~137), the per-store tab nav (`tabs` array), the daily-detail vs monthly-aggregate switching logic.

- [ ] **Step 3: Verify clean grep + tsc + tests + build.**
  Tests should still be 1300 + 47 = 1347 (no new tests added).

- [ ] **Step 4: Commit**
  ```bash
  git add dashboard-web/src/components/MonthlyTables.tsx
  git commit -m "refactor(analysis): MonthlyTables token migration (17-month horizon + roasLabel SSOT preserved)"
  ```

---

## Task 3: Dashboard.tsx AnalysisTab wrapper token migration

**File:** `dashboard-web/src/components/Dashboard.tsx` — ONLY the `AnalysisTab` function region (around lines 481-571 per recon; may have shifted post-Plan 4c). Grep `^function AnalysisTab` to locate.

The wrapper divs around `<RoasChart bare />` and `<MonthlyTables bare />` use 4 legacy tokens — typically `rounded-xl bg-surface border border-border shadow-card overflow-hidden`.

- [ ] **Step 1: Find AnalysisTab function.**
  ```bash
  grep -n "^function AnalysisTab" /Users/dorperetz/script-roas/dashboard-web/src/components/Dashboard.tsx
  ```

- [ ] **Step 2: Pre-scan the region.**
  Use the function's start line + ~100 lines as the slice. Confirm ~4 legacy tokens.

- [ ] **Step 3: Apply migration map ONLY within the AnalysisTab function body.**
  DO NOT touch PnLTab, DetailTab, HomeTab, CampaignsTab, ProductsTab — those are Plan 5b/5c/done.

- [ ] **Step 4: Verify the AnalysisTab region is clean. Full-file grep will still show other tabs' legacy tokens (Plan 5b/5c).**

- [ ] **Step 5: Commit**
  ```bash
  git add dashboard-web/src/components/Dashboard.tsx
  git commit -m "refactor(analysis): Dashboard.tsx AnalysisTab wrapper token migration"
  ```

---

## Task 4: Wrap-up audit + tag

- [ ] **Step 1: Final grep on Plan 5a files.**
  ```bash
  cd /Users/dorperetz/script-roas
  for f in dashboard-web/src/components/RoasChart.tsx dashboard-web/src/components/MonthlyTables.tsx; do
    echo "=== $f ==="
    grep -nE "bg-(background|surface|surfaceMuted|surfaceSubtle|surfaceSunken|primary[-]?(dark|light)?|roas-)|border-(border\b|borderSubtle|borderStrong|roas-)|text-(text-|primary[-]?(dark|light)?|roas-)|shadow-card[^H]|shadow-card$" "$f" || echo "(clean)"
  done
  ```

  Plus AnalysisTab region:
  ```bash
  AT_START=$(grep -n "^function AnalysisTab" /Users/dorperetz/script-roas/dashboard-web/src/components/Dashboard.tsx | cut -d: -f1)
  sed -n "${AT_START},$((AT_START+100))p" /Users/dorperetz/script-roas/dashboard-web/src/components/Dashboard.tsx \
    | grep -cE "bg-(background|surface|surfaceMuted|surfaceSubtle|surfaceSunken|primary[-]?(dark|light)?|roas-)|border-(border\b|borderSubtle|borderStrong|roas-)|text-(text-|primary[-]?(dark|light)?|roas-)|shadow-card[^H]|shadow-card$"
  ```

  RoasChart + MonthlyTables → `(clean)`. AnalysisTab region count → 0.

- [ ] **Step 2: Out-of-scope check.**
  ```bash
  git diff --name-only plan-04b-drawer-panels-done..HEAD -- \
    dashboard-web/src/components/PnLBreakdown.tsx \
    dashboard-web/src/components/BillingSettings.tsx \
    dashboard-web/src/components/DetailTable.tsx
  ```
  Expected: empty (Plans 5b/5c territory).

- [ ] **Step 3: tsc + tests + build.**
  ```bash
  cd /Users/dorperetz/script-roas/dashboard-web
  npx tsc --noEmit ; echo "tsc=$?"
  npm run test 2>&1 | grep -E "Test Files|Tests "
  npm run test:components 2>&1 | grep -E "Test Files|Tests "
  npm run build 2>&1 | tail -5
  ```
  Expected: tsc=0, 1300 + 47 pass, build clean.

- [ ] **Step 4: Tag**
  ```bash
  git tag plan-05a-analysis-tab-done
  ```

---

## Self-Review

- ✅ RoasChart chrome (6 tokens) — Task 1
- ✅ MonthlyTables (24 tokens, non-negotiables preserved) — Task 2
- ✅ AnalysisTab wrapper (4 tokens) — Task 3
- ✅ No layout changes
- ✅ No algorithm changes
- ✅ No tests added (mechanical migration only)
- ✅ Plan 5b/5c files NOT touched

Migration map identical to Plans 2/4. Plan 7 will polish anything that surfaces during visual review.
