# Dashboard UX/UI Overhaul — Plan 05b: P&L tab

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax. Tasks 1 + 2 are worktree-parallel candidates.

**Goal:** Token migration of the P&L tab: BillingSettings (1,171 lines, 103 tokens — largest single file), PnLBreakdown (508 lines, 48 tokens + a focused income-statement typesetting polish on `PnLLine`), and the PnLTab wrapper in Dashboard.tsx (2 tokens). The typesetting work is intentionally scoped — only `PnLLine`'s row layout becomes a ledger-style 3-column grid; no data-shape changes, no new sub-items, no income-statement restructuring.

**Architecture:** BillingSettings + PnLBreakdown token migration are pure className edits. The `PnLLine` typesetting polish converts its flex-based row from `<li className="flex items-center gap-3 ...">` to a CSS-grid row with fixed-width amount/running columns, so the CAD prefix + figures + running totals align on a ledger column across every line. The `formatCurrency()` output and the `tone`/`note`/`running` semantics stay unchanged.

**Tech Stack:** No new deps.

**Branch:** Continue on `dashboard-ux-overhaul-2026-05-28` from tag `plan-05a-analysis-tab-done` (once Plan 5a lands).

---

## Scope

| File | Lines | Legacy tokens | Notes |
|------|-------|---------------|-------|
| BillingSettings.tsx | 1,171 | 103 | Largest single file in Plan 5. Modal/sheet UI |
| PnLBreakdown.tsx | 508 | 48 + typesetting | Income-statement layout polish on `PnLLine` |
| Dashboard.tsx (PnLTab region ~440-480) | — | 2 | Wrapper around `BillingSettings` + `PnLBreakdown` |

**OUT of scope (Plans 5a/5c):**
- MonthlyTables, RoasChart → Plan 5a
- DetailTable → Plan 5c
- AnalysisTab/DetailTab in Dashboard.tsx → Plans 5a/5c

---

## Parallelism plan

```
                    ┌─ Worktree A: Task 1 (BillingSettings tokens) ────┐
PARALLEL ──────────┤                                                    │
                    └─ Worktree B: Task 2 (PnLBreakdown tokens) ────────┤
                                                                        ▼
                                                          Task 3 (PnLLine typesetting)
                                                                        │
                                                                        ▼
                                                          Task 4 (PnLTab wrapper)
                                                                        │
                                                                        ▼
                                                          Task 5 (audit + tag)
```

Tasks 1 + 2 touch DIFFERENT files — true worktree-parallel candidates. Task 3 touches `PnLBreakdown.tsx` (Task 2's file), so must wait for Task 2 to merge. Tasks 4 + 5 are sequential.

---

## Migration map (Plan 2 SSOT)

Identical to Plans 2, 4a-c, 5a. The single tricky case for Plan 5b:

**Special handling — `bg-gradient-to-br from-primary/[0.06]` in PnLBreakdown line 153**

This is `from-primary` with an arbitrary opacity `/[0.06]` in bracket notation — the standard grep won't catch it because the alpha bracket isn't a project token prefix. Migrate to `from-accent/[0.06]` (same semantics under Plan 2 SSOT: `primary` → `accent`).

```
- className="px-4 sm:px-6 pt-4 sm:pt-6 pb-3 sm:pb-4 bg-gradient-to-br from-primary/[0.06] via-surface to-surface relative"
+ className="px-4 sm:px-6 pt-4 sm:pt-6 pb-3 sm:pb-4 bg-gradient-to-br from-accent/[0.06] via-elevated to-elevated relative"
```

**Special handling — `SOURCE_COLOR` map (lines 55-62)**

```ts
const SOURCE_COLOR: Record<CostSource, string> = {
  // text-blue-700, text-purple-700, text-amber-700 — raw Tailwind palette
};
```

These are intentional categorical colors for cost sources (not legacy tokens). LEAVE AS-IS. Per Plan 2 SSOT non-negotiables: Tailwind base palette (`text-blue-*`, `text-purple-*`, `text-amber-*`, `text-emerald-*`, etc.) stays.

---

## Task 1: BillingSettings token migration (worktree-parallel)

**File:** `dashboard-web/src/components/BillingSettings.tsx` (1,171 lines, 103 legacy tokens).

Pure mechanical migration. No data shape changes, no form-validation logic touches, no modal-trigger logic touches.

- [ ] **Step 1: Pre-scan**
  ```bash
  grep -nE "bg-(background|surface|surfaceMuted|surfaceSubtle|surfaceSunken|primary[-]?(dark|light)?|roas-)|border-(border\b|borderSubtle|borderStrong|roas-)|text-(text-|primary[-]?(dark|light)?|roas-)|shadow-card[^H]|shadow-card$" /Users/dorperetz/script-roas/dashboard-web/src/components/BillingSettings.tsx | wc -l
  ```
  Expected: ~103.

- [ ] **Step 2: Apply Plan 2 SSOT map.**
  Substring traps:
  - `bg-surfaceMuted` BEFORE `bg-surface`
  - `border-borderSubtle` BEFORE `border-border`
  - `text-text-primary` BEFORE `text-primary`
  - `primary-dark`/`primary-light` BEFORE `primary`

- [ ] **Step 3: Verify clean grep + tsc + tests + build.**

- [ ] **Step 4: Commit**
  ```bash
  cd /Users/dorperetz/script-roas
  git add dashboard-web/src/components/BillingSettings.tsx
  git commit -m "refactor(pnl): BillingSettings token migration (103 → 0 legacy tokens)"
  ```

---

## Task 2: PnLBreakdown token migration (worktree-parallel)

**File:** `dashboard-web/src/components/PnLBreakdown.tsx` (508 lines, 48 legacy tokens + the arbitrary-opacity case from above).

- [ ] **Step 1: Pre-scan** — confirm 48 broad-grep matches.

- [ ] **Step 2: Apply migration map** — including the special-case `from-primary/[0.06]` → `from-accent/[0.06]` substitution at line 153. The `via-surface to-surface` in the same className also migrates to `via-elevated to-elevated`.

  Watch the SOURCE_COLOR map (lines 55-62) — those `text-blue-700` / `text-purple-700` / `text-amber-700` values STAY (Tailwind base palette, categorical, not legacy tokens).

- [ ] **Step 3: Verify clean grep + tsc + tests + build.**

- [ ] **Step 4: Commit**
  ```bash
  cd /Users/dorperetz/script-roas
  git add dashboard-web/src/components/PnLBreakdown.tsx
  git commit -m "refactor(pnl): PnLBreakdown token migration"
  ```

---

## Task 3: `PnLLine` income-statement typesetting

**File:** `dashboard-web/src/components/PnLBreakdown.tsx` — only the `PnLLine` function around line 439-507.

### Current shape

```tsx
<li className="flex items-center gap-3 py-2 border-b border-borderSubtle/40 last:border-b-0">
  <div className="min-w-0 flex-1"> {/* label + optional note */} </div>
  <div className="text-end shrink-0 min-w-[110px]"> {/* CAD amount + % */} </div>
  <div className="text-end shrink-0 hidden sm:block min-w-[110px] border-s border-borderSubtle ps-3">
    {/* "נשאר" running total */}
  </div>
</li>
```

The flex layout works but each column's width drifts row-to-row because `min-w-[110px]` isn't a fixed width — long currency strings (8+ digit revenues) push the amount column wider than the running-total column, breaking visual ledger alignment.

### Target shape — fixed CSS-grid ledger

```tsx
<li
  className={cn(
    'grid items-center gap-x-3 py-2 border-b border-line-subtle/40 last:border-b-0',
    'grid-cols-[1fr_120px] sm:grid-cols-[1fr_120px_140px]',
  )}
>
  {/* Column 1: label + optional note */}
  <div className="min-w-0">
    <div className="text-sm text-ink font-medium leading-snug">{label}</div>
    {note && <div className="text-[10px] sm:text-[11px] text-ink-muted mt-0.5 leading-snug">{note}</div>}
  </div>

  {/* Column 2: amount + percentage */}
  <div className="text-end">
    <div
      className={cn(
        'text-sm font-semibold tabular-nums leading-tight font-mono',
        tone === 'positive' && 'text-ink',
        tone === 'cost' && 'text-ink-secondary',
      )}
    >
      <span className="text-[10px] text-ink-muted font-medium me-1 font-sans">CAD</span>
      {formatCurrency(amount)}
    </div>
    <div className="text-[10px] text-ink-muted tabular-nums mt-0.5 font-mono">
      {pct > 0 && tone === 'positive' ? '100%' : `${pct.toFixed(1)}%`}
    </div>
  </div>

  {/* Column 3: running total — desktop only */}
  <div className="text-end hidden sm:block border-s border-line-subtle ps-3">
    <div className="text-[10px] text-ink-muted uppercase tracking-wide leading-tight">נשאר</div>
    {running === null ? (
      <span className="text-xs text-ink-secondary opacity-50" aria-label="הערה — לא משפיע על הסכום הרץ">—</span>
    ) : (
      <div
        className={cn(
          'text-xs font-semibold tabular-nums leading-tight mt-0.5 font-mono',
          running >= 0 ? 'text-ink' : 'text-status-red',
        )}
      >
        {formatCurrency(running)}
      </div>
    )}
  </div>
</li>
```

What changed:
1. `flex items-center gap-3` → `grid items-center gap-x-3` with `grid-cols-[1fr_120px]` mobile / `grid-cols-[1fr_120px_140px]` desktop. **Fixed-width columns** mean every row's amount and running-total spans the same horizontal range — true ledger alignment.
2. Added `font-mono` to all tabular-number spans (currency amounts, percentages, running totals). The CAD prefix stays `font-sans` so the alphabetic label reads naturally. This activates Geist Mono for the ledger figures, matching the 2026 vocabulary established for chart tooltips in Plan 3.
3. Token migration in this block already done in Task 2 (`text-text-primary` → `text-ink`, etc.) — Task 3 just re-applies them inside the new grid structure.
4. `me-1` instead of `ml-1` on the CAD prefix (RTL-aware logical property — Plan 7 RTL audit would flag the old form).
5. The running-total column drops `hidden sm:block min-w-[110px]` (now driven by grid template) but keeps `hidden sm:block` so mobile still shows only label+amount.

### Steps

- [ ] **Step 1: Read the current `PnLLine` body** (lines 439-507 in current file; may shift slightly after Task 2's migration).

- [ ] **Step 2: Replace the `<li>` JSX with the target shape above.**

- [ ] **Step 3: Verify tsc + visual sanity**
  ```bash
  cd /Users/dorperetz/script-roas/dashboard-web
  npx tsc --noEmit ; echo "tsc=$?"
  npm run test 2>&1 | tail -3
  npm run test:components 2>&1 | tail -3
  npm run build 2>&1 | tail -5
  ```

  No new tests — the `PnLLine` component is purely presentational, and structural layout changes are visual.

- [ ] **Step 4: Commit**
  ```bash
  cd /Users/dorperetz/script-roas
  git add dashboard-web/src/components/PnLBreakdown.tsx
  git commit -m "feat(pnl): PnLLine ledger-grid typesetting (font-mono figures, fixed-width columns)"
  ```

---

## Task 4: Dashboard.tsx PnLTab wrapper

**File:** `dashboard-web/src/components/Dashboard.tsx` — ONLY the `PnLTab` function body.

- [ ] **Step 1: Find** `^function PnLTab` to locate the region (around line 437 per recon; may shift).

- [ ] **Step 2: Apply migration map** ONLY within that function body. Don't touch AnalysisTab/DetailTab/HomeTab/CampaignsTab/ProductsTab.

  Expected: ~2 token edits.

- [ ] **Step 3: Verify region clean grep + tsc + tests + build.**

- [ ] **Step 4: Commit**
  ```bash
  cd /Users/dorperetz/script-roas
  git add dashboard-web/src/components/Dashboard.tsx
  git commit -m "refactor(pnl): Dashboard.tsx PnLTab wrapper token migration"
  ```

---

## Task 5: Wrap-up audit + tag

- [ ] **Step 1: Grep both Plan 5b files**
  ```bash
  cd /Users/dorperetz/script-roas
  for f in dashboard-web/src/components/BillingSettings.tsx dashboard-web/src/components/PnLBreakdown.tsx; do
    echo "=== $f ==="
    grep -nE "bg-(background|surface|surfaceMuted|surfaceSubtle|surfaceSunken|primary[-]?(dark|light)?|roas-)|border-(border\b|borderSubtle|borderStrong|roas-)|text-(text-|primary[-]?(dark|light)?|roas-)|shadow-card[^H]|shadow-card$" "$f" || echo "(clean)"
  done
  ```
  Both must print `(clean)`.

- [ ] **Step 2: PnLTab region grep**
  ```bash
  PT_START=$(grep -n "^function PnLTab" /Users/dorperetz/script-roas/dashboard-web/src/components/Dashboard.tsx | cut -d: -f1)
  PT_END=$((PT_START+60))
  sed -n "${PT_START},${PT_END}p" /Users/dorperetz/script-roas/dashboard-web/src/components/Dashboard.tsx \
    | grep -cE "bg-(background|surface|surfaceMuted|surfaceSubtle|surfaceSunken|primary[-]?(dark|light)?|roas-)|border-(border\b|borderSubtle|borderStrong|roas-)|text-(text-|primary[-]?(dark|light)?|roas-)|shadow-card[^H]|shadow-card$"
  ```
  Expected: 0.

- [ ] **Step 3: Out-of-scope check**
  ```bash
  git diff --name-only plan-05a-analysis-tab-done..HEAD -- \
    dashboard-web/src/components/RoasChart.tsx \
    dashboard-web/src/components/MonthlyTables.tsx \
    dashboard-web/src/components/DetailTable.tsx
  ```
  Expected: empty.

- [ ] **Step 4: Full test + build**
  ```bash
  cd /Users/dorperetz/script-roas/dashboard-web
  npx tsc --noEmit ; echo "tsc=$?"
  npm run test:all 2>&1 | tail -5
  npm run build 2>&1 | tail -5
  ```

- [ ] **Step 5: Tag**
  ```bash
  cd /Users/dorperetz/script-roas
  git tag plan-05b-pnl-tab-done
  ```

---

## Self-Review

- ✅ BillingSettings (103 tokens) — Task 1
- ✅ PnLBreakdown (48 tokens + `from-primary/[0.06]` special) — Task 2
- ✅ `PnLLine` ledger-grid typesetting — Task 3 (scoped to one function; semantics unchanged)
- ✅ PnLTab wrapper (2 tokens) — Task 4
- ✅ `SOURCE_COLOR` Tailwind base palette preserved
- ✅ No data shape changes
- ✅ No business logic changes (formatCurrency call unchanged, tone/note/running props unchanged)
- ✅ Plan 5a/5c files NOT touched
