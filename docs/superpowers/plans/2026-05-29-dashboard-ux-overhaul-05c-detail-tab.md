# Dashboard UX/UI Overhaul — Plan 05c: פירוט (Detail) tab

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Token migration of DetailTable (18 tokens) + DetailTab wrapper in Dashboard.tsx (4 tokens), PLUS a theme-aware fix for the hardcoded `bg-black text-white` spend-without-revenue alarm cell (which would be near-invisible in dark mode). Sparkline column per spec — implemented as a store-level micro-sparkline of recent days' ROAS that the row already has access to via the parent's `data.rows` window.

**Architecture:** DetailTable's `roasCellStyle()` returns inline classNames for the ROAS cell — the spend-without-revenue branch currently returns `bg-black text-white` which is theme-hostile. Fix: return `bg-status-red text-white` (alarming red works correctly in both themes; black-on-dark loses contrast). The sparkline column adds a new `<th>` and `<td>` rendering the last N days' ROAS for the row's store group. Implementation is small because we slice from the existing `rows: DailyRow[]` prop, no new data fetching.

**Tech Stack:** No new deps. Uses Plan 1 `Sparkline` primitive.

**Branch:** Continue on `dashboard-ux-overhaul-2026-05-28` from tag `plan-05b-pnl-tab-done` (once Plan 5b lands). Tasks 1-3 can run independently of Plan 5b; if execution wall-clock matters, dispatch Plan 5c in parallel with Plan 5b via `Agent { isolation: "worktree" }`.

---

## Scope

| File | Lines | Legacy tokens | Notes |
|------|-------|---------------|-------|
| DetailTable.tsx | 144 | 18 | + dark-mode alarm fix + sparkline column |
| Dashboard.tsx (DetailTab region ~706-748) | — | 4 | Wrapper around `<DetailTable bare />` |

**OUT of scope (Plans 5a/5b):**
- MonthlyTables, RoasChart → Plan 5a
- PnLBreakdown, BillingSettings → Plan 5b

---

## Parallelism plan

Plan 5c is small (3 tasks). Single batched implementer is fastest.

```
Task 1 (DetailTable tokens + alarm fix + sparkline)
                  │
                  ▼
Task 2 (DetailTab wrapper)
                  │
                  ▼
Task 3 (audit + tag)
```

---

## Task 1: DetailTable token migration + theme-aware alarm + sparkline column

**File:** `dashboard-web/src/components/DetailTable.tsx` (144 lines, 18 legacy tokens).

### Step 1 — Pre-scan

```bash
grep -nE "bg-(background|surface|surfaceMuted|surfaceSubtle|surfaceSunken|primary[-]?(dark|light)?|roas-)|border-(border\b|borderSubtle|borderStrong|roas-)|text-(text-|primary[-]?(dark|light)?|roas-)|shadow-card[^H]|shadow-card$" /Users/dorperetz/script-roas/dashboard-web/src/components/DetailTable.tsx | wc -l
```

Expected: 18.

### Step 2 — Apply migration map (Plan 2 SSOT)

Identical to prior plans. Tailwind base palette (`text-white`, `text-amber-*`) stays.

### Step 3 — Fix the theme-hostile alarm cell

Find `roasCellStyle()` around lines 17-21. Current:

```ts
if (revenue === 0 && totalSpend > 0) return { className: 'bg-black text-white', text: '0' };
```

`bg-black` on a dark theme background is near-invisible. Replace with the project's status-red token (alarming red works correctly in both themes):

```ts
if (revenue === 0 && totalSpend > 0) return { className: 'bg-status-red text-white', text: '0' };
```

The `text-white` stays — Tailwind base palette, correct on the red fill in both themes.

### Step 4 — Add the sparkline column

The Detail table renders one row per `(date, storeName)` pair. The sparkline should show the ROAS trend for that row's STORE over the last N days within the visible range — a tiny per-store micro-trend that lets the operator scan for store-level momentum.

The component already accepts `rows: DailyRow[]` (the full slice for the visible range). Inside the row map, derive the store's daily ROAS series:

```tsx
import { Sparkline } from './ui/Sparkline';

// Inside the component, just above the row-iteration JSX, precompute the
// per-store ROAS series so each row doesn't recompute it:
const storeSeriesByStore = useMemo(() => {
  const out = new Map<string, number[]>();
  // Group rows by storeName, sort by date, project ROAS.
  const byStore = new Map<string, DailyRow[]>();
  for (const r of rows) {
    const arr = byStore.get(r.storeName) ?? [];
    arr.push(r);
    byStore.set(r.storeName, arr);
  }
  for (const [store, arr] of byStore) {
    const sorted = [...arr].sort((a, b) => (a.date < b.date ? -1 : 1));
    out.set(store, sorted.map(r => (Number.isFinite(r.roas) ? r.roas : 0)));
  }
  return out;
}, [rows]);
```

Then add a new `<th>` and `<td>`:

In the `<thead>`:
```tsx
<th className="px-2 py-2 text-center text-[10px] uppercase tracking-wide text-ink-muted font-medium w-[80px]">
  מגמת חנות
</th>
```

In the row JSX:
```tsx
<td className="px-2 py-2 text-center align-middle">
  {(() => {
    const series = storeSeriesByStore.get(r.storeName) ?? [];
    return series.length >= 2 ? (
      <Sparkline data={series} tone="blue" width={64} height={20} className="inline-block" />
    ) : (
      <span className="text-ink-muted">—</span>
    );
  })()}
</td>
```

Place the new column right after the store-name column and before the spend columns — matches the CampaignsTable Sparkline column placement from Plan 4a.

If `useMemo` isn't already imported in DetailTable, add it from React.

### Step 5 — Verify

```bash
cd /Users/dorperetz/script-roas/dashboard-web
npx tsc --noEmit ; echo "tsc=$?"
npm run test 2>&1 | tail -3
npm run test:components 2>&1 | tail -3
npm run build 2>&1 | tail -5
```

Expected: tsc=0, tests pass, build clean.

### Step 6 — Commit

```bash
cd /Users/dorperetz/script-roas
git add dashboard-web/src/components/DetailTable.tsx
git commit -m "feat(detail): DetailTable tokens + theme-aware spend-without-revenue alarm + store sparkline column"
```

---

## Task 2: Dashboard.tsx DetailTab wrapper

**File:** `dashboard-web/src/components/Dashboard.tsx` — ONLY the `DetailTab` function body.

- [ ] **Step 1: Find** `^function DetailTab` (around line 706 per recon; may shift).

- [ ] **Step 2: Apply migration map** ONLY within DetailTab. Don't touch other tabs.

  Expected: ~4 edits — typically the inline wrapper `rounded-xl bg-surface border border-border shadow-card overflow-hidden` around `<DetailTable bare />`.

- [ ] **Step 3: Verify region clean + tsc + tests + build.**

- [ ] **Step 4: Commit**
  ```bash
  cd /Users/dorperetz/script-roas
  git add dashboard-web/src/components/Dashboard.tsx
  git commit -m "refactor(detail): Dashboard.tsx DetailTab wrapper token migration"
  ```

---

## Task 3: Wrap-up audit + tag

- [ ] **Step 1: DetailTable grep clean.**
  ```bash
  grep -nE "bg-(background|surface|surfaceMuted|surfaceSubtle|surfaceSunken|primary[-]?(dark|light)?|roas-)|border-(border\b|borderSubtle|borderStrong|roas-)|text-(text-|primary[-]?(dark|light)?|roas-)|shadow-card[^H]|shadow-card$" /Users/dorperetz/script-roas/dashboard-web/src/components/DetailTable.tsx || echo "(clean)"
  ```

- [ ] **Step 2: DetailTab region grep.**
  ```bash
  DT_START=$(grep -n "^function DetailTab" /Users/dorperetz/script-roas/dashboard-web/src/components/Dashboard.tsx | cut -d: -f1)
  sed -n "${DT_START},$((DT_START+60))p" /Users/dorperetz/script-roas/dashboard-web/src/components/Dashboard.tsx \
    | grep -cE "bg-(background|surface|surfaceMuted|surfaceSubtle|surfaceSunken|primary[-]?(dark|light)?|roas-)|border-(border\b|borderSubtle|borderStrong|roas-)|text-(text-|primary[-]?(dark|light)?|roas-)|shadow-card[^H]|shadow-card$"
  ```

- [ ] **Step 3: Out-of-scope check.**
  ```bash
  git diff --name-only plan-05b-pnl-tab-done..HEAD -- \
    dashboard-web/src/components/RoasChart.tsx \
    dashboard-web/src/components/MonthlyTables.tsx \
    dashboard-web/src/components/PnLBreakdown.tsx \
    dashboard-web/src/components/BillingSettings.tsx
  ```

- [ ] **Step 4: Full test + build.**

- [ ] **Step 5: Tag**
  ```bash
  git tag plan-05c-detail-tab-done
  ```

---

## Self-Review

- ✅ DetailTable token migration (18 tokens) — Task 1
- ✅ Theme-aware alarm cell (bg-black → bg-status-red) — Task 1
- ✅ Store-sparkline column — Task 1
- ✅ DetailTab wrapper (4 tokens) — Task 2
- ✅ No data shape changes (rows: DailyRow[] prop unchanged)
- ✅ `roasCellStyle()` semantics preserved (still returns `{className, text}` shape)
- ✅ Plan 5a/5b files NOT touched
