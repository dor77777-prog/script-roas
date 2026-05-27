# A5 — Filters & Reactivity + URL State
**Agent:** A5  
**Date:** 2026-05-28  
**Invariants:** INV-11, INV-12, INV-13  
**Severity model:** P0 = wrong number shown / NaN / contract violation; P1 = reactivity bug / stale data; P2 = cosmetic / unlikely edge.

---

## Executive summary

The core filter→component reactivity chain is correct: `filterRows()` client-slices by store and range, `aggregateByStore()` and `aggregate()` compute fresh KPIs, all keyed memos re-run on `[data, filters, billingTick]`. The intentional non-reactors (GoalTracker, TodayLive, MonthlyTables range) are implemented correctly. Two P1 issues were found: (1) a malformed URL parameter pattern (`?range.from=&range.to=`) silently falls through to the 90-day default without any error surfaced to the user; (2) MonthlyTables ignores the global `filters.store` — it manages an independent internal store dropdown that does NOT synchronise with the global store filter, and this is undocumented in the User Manual. One P2 issue: `TabKey` is defined in both `Dashboard.tsx` (local) and `urlState.ts` (exported), creating a silent drift risk.

---

## Findings

### F-A5-01 | P1 | INV-11 | `dashboard-web/src/lib/dateRange.ts:48-67` + route `src/app/api/data/route.ts`

**Seed reference:** S1

**What was tested:**  
Two curl calls against production:
- Correct: `GET /api/data?from=2026-05-01&to=2026-05-26` → 78 rows, date range 2026-05-01..2026-05-26 ✓
- Malformed: `GET /api/data?range.from=2026-05-01&range.to=2026-05-26` → 84 rows, date range 2026-05-01..2026-05-28

**What goes wrong:**  
`parseRangeParams()` reads `searchParams.get('from')` and `searchParams.get('to')`. The malformed params `range.from` / `range.to` return `null`, which satisfies `!from && !to` → returns `defaultRange()` (last 90 days). The caller receives **a wider, different date window than requested** with no error, no 400, no indication to the user.

This only matters if a user or tool hand-crafts a URL with `range.from` / `range.to` syntax (the dashboard's own `buildDateRangeKey` always writes `?from=&to=`, so the normal SPA flow is safe). However, shared URLs from older formats, direct API consumers, or the audit harness could silently get the wrong date window.

**Live evidence:**  
```
curl "https://roas-dashboard-smoky.vercel.app/api/data?range.from=2026-05-01&range.to=2026-05-26"
→ 84 rows covering 2026-05-01..2026-05-28  (should be 78 rows covering May 1-26)
```

**Why wrong:**  
Silent default rather than a 400 with an explanatory error. The contract in `parseRangeParams` says "both keys absent → default" but the intent is "unknown key name → likely typo → should 400 or ignore visibly." The user cannot distinguish "I got the range I asked for" from "my params were silently ignored."

**Severity:** P1 — a user or harness using the wrong parameter naming convention receives a date window different from what they intended, with no feedback. Not P0 because the dashboard's own client code (buildDateRangeKey) always uses the correct `from`/`to` form.

**Suggested fix:**  
Document the `?from=&to=` convention in the route's JSDoc. Optionally, if `range.from` or `range.to` are present in params but `from`/`to` are absent, return a 400 with a hint. Alternatively, accept and alias `range.from` → `from` for backwards compat.

---

### F-A5-02 | P2 | INV-12 | `dashboard-web/src/components/MonthlyTables.tsx:111` + `Dashboard.tsx:493`

**What was tested:**  
Code inspection of `MonthlyTables` props and internal state. The component is called with `stores={data.stores}` (all stores, never filtered). It initialises `storeFilter = useState(stores[0] || 'All')` and maintains its own internal store dropdown. The global `filters.store` is never passed in.

**What goes wrong:**  
When the operator selects a specific store in the global filter (e.g., "uzoshop"), all other components (KpiCards, PerStoreCards, RoasChart, DetailTable) narrow to that store. But MonthlyTables continues to show whichever store was active in its own internal dropdown (default: `stores[0]`, which is `360usmile` alphabetically from `['360usmile', 'Zol Plus', 'uzoshop']`). The operator sees a mismatch: every other component shows uzoshop, but MonthlyTables still shows 360usmile.

**Intentionality assessment:**  
The range ignorance IS intentional and documented ("הטבלאות החודשיות מציגות עד 17 חודשים אחורה — בלי תלות בטווח שבחרת", SectionIntro in AnalysisTab). However, the User Manual section 6.2 (MonthlyTables) does NOT mention that the global store filter is ignored. The memory note only says "MonthlyTables ignores the range filter." The operator could reasonably expect that selecting "uzoshop" globally would pre-select uzoshop in MonthlyTables too.

**Severity:** P2 — confusing UX rather than a wrong number. The MonthlyTables' own store filter gives the correct numbers for whatever store it shows; the issue is that it doesn't auto-sync to the global store selection.

**Suggested fix (low-effort):**  
Pass `selectedStore={filters.store}` to `MonthlyTables` and use it as the `storeFilter` initial value (or a controlled prop). When `filters.store !== 'All'`, initialise `storeFilter` to `filters.store`. Add a note to User Manual section 6.2 that the monthly tables have their own independent store dropdown.

---

### F-A5-03 | P2 | INV-13 / URL round-trip | `dashboard-web/src/lib/urlState.ts:79` + `Dashboard.tsx:79`

**What was tested:**  
`TabKey` is defined twice:
- `urlState.ts:24`: `export type TabKey = 'home' | 'pnl' | 'analysis' | 'campaigns' | 'products' | 'detail';`
- `Dashboard.tsx:79`: `type TabKey = 'home' | 'pnl' | 'analysis' | 'campaigns' | 'products' | 'detail';` (local, not imported from urlState)

**What goes wrong:**  
No current bug — both definitions are identical. But if a new tab is added to one and not the other, `readDashboardState` could silently reject the new tab value (returning default 'home') even though the Dashboard component renders it. This is a silent drift risk.

**Severity:** P2 — maintenance hazard, not a current bug. The URL state round-trip for all existing tabs (home, pnl, analysis, campaigns, products, detail) works correctly: verified via Python simulation that `writeDashboardState ∘ readDashboardState` = identity for all tab/preset/store combinations.

**Suggested fix:**  
In `Dashboard.tsx`, import `TabKey` from `urlState.ts` instead of redefining it locally:
```typescript
import { readDashboardState, syncUrl, type TabKey } from '@/lib/urlState';
```

---

## Verified correct behaviors (no finding)

### INV-11 — Client-side store slicing

**Live evidence:**  
`GET /api/data?from=2026-05-22&to=2026-05-28&store=uzoshop` returns all 3 stores (21 rows). Server confirms store param is ignored. Client code:

```typescript
// Dashboard.tsx:170
const cur = filterRows(data.rows, filters.range, filters.store);
```

`filterRows()` in analytics.ts applies `store !== 'All' && r.storeName !== store` correctly. Per-store numbers verified:
- All stores: revenue=17,259.95 CAD (May 22-28)
- uzoshop: 15,217.14 | Zol Plus: 1,470.87 | 360usmile: 571.94
- Sum of per-store = 17,259.95 ✓ (exact match, difference < 0.01)

### INV-11 — parseRangeParams error handling (single param)

`GET /api/data?from=2026-05-01` (no `to`) → HTTP 400 ✓  
`GET /api/data?from=&to=` → silently defaults to 90-day range ✓ (empty string treated as absent — correct per JS `!''` === `true`)

### INV-12 — GoalTracker ignores filters (intentional)

GoalTracker signature: `{ data: DashboardData }` — no `filters` prop. `forecastMonthEnd(data.rows)` self-slices to `r.date >= monthStart && r.date <= today` at insights.ts:486, ignoring both `filters.range` and `filters.store`. Confirmed intentional per memory note and GoalTracker.tsx docstring (2026-05-23 operator correction).

### INV-12 — TodayLive ignores filters (intentional)

TodayLive fetches its own independent SWR key `/api/data?from=${today}&to=${today}`. The `rows` prop passed from Dashboard is marked `_parentRows` and immediately voided (`void _parentRows`). Confirmed intentional per TodayLive.tsx:151-171 fix commentary (2026-05-23 operator-reported fix). Live widget always shows today regardless of global range filter. ✓

### INV-12 — MonthlyTables ignores RANGE (intentional)

MonthlyTables fetches its own `/api/data` SWR key covering `isoMonthsAgo(17)..isoToday()`. The `historyRange` memo has empty deps (`[]`) — never recomputed on filter change. AnalysisTab's SectionIntro explicitly tells the operator "הטבלאות החודשיות מציגות עד 17 חודשים אחורה — בלי תלות בטווח שבחרת." ✓

### INV-12 — InsightsBoard ignores filters (intentional)

InsightsBoard signature: `{ data: DashboardData }` only. It fetches its own campaigns and products via separate SWR calls without filter params. It operates on the full data.rows from the parent's current SWR window (filtered by range but not store). This is intentional — anomaly detection needs cross-store data to be meaningful. ✓

### INV-13 — previousRange() correctness

`previousRange()` in `presets.ts`:
```typescript
const days = Math.round((to.getTime() - from.getTime()) / 86400000) + 1;
const prevTo = addDays(from, -1);
const prevFrom = addDays(prevTo, -(days - 1));
```

For `last_7_days` (May 22-28 = 7 days): prevTo = May 21, prevFrom = May 15 → 7-day prior window ✓  
For 1-day window: 1 day prior (yesterday) ✓  
For 31-day window: immediately-preceding 31 days ✓  
For 58-day window: immediately-preceding 58 days ✓

**Live delta verification:**
- Current window (May 22-28): revenue = 17,259.95 CAD, spend = 7,611.57, ROAS = 2.268
- Previous window (May 15-21): revenue = 18,446.19 CAD, spend = 7,620.83, ROAS = 2.421
- Revenue delta: −6.4% (correctly shows prior-period decline)

KpiCards and HeroOverview both use `previousRange(filters.range)` from `presets.ts` (confirmed at Dashboard.tsx:171 and HeroOverview.tsx:101). CampaignDrawer and CampaignsTable use `getPreviousPeriod()` from `dateRange.ts` — mathematically equivalent for all tested ranges.

### INV-13 — Two previousRange implementations are equivalent

`presets.previousRange` and `dateRange.getPreviousPeriod` produce identical results for all tested cases (1-day, 7-day, 31-day, 58-day). The formulas differ slightly in style (one computes `days` with `+1`, one uses `lengthMs = toMs - fromMs`) but produce the same result because both land on the same integer-day boundaries. ✓

### URL state round-trip (INV-13 adjacent)

`writeDashboardState ∘ readDashboardState` is identity for all valid combinations:
- `tab='pnl'`, `preset='this_month'`, `store='All'` → URL `?tab=pnl`, round-trip restores correctly ✓
- `tab='campaigns'`, `preset='custom'`, `from='2026-05-01'`, `to='2026-05-28'`, `store='Zol Plus'` → URL encodes store as `Zol+Plus`, decoded correctly to `Zol Plus` ✓
- Default state (`tab='home'`, `preset='this_month'`, `store='All'`) → produces empty URL `""` ✓
- Malformed custom URL (`?preset=custom&from=2026-05-01`, no `to`) → silently falls back to `defaults.filters.range`; no error shown (acceptable — bookmarking a partially-formed URL is an edge case, not a user-reachable path from normal UI)

### Future-date cap in Filters (INV-11)

`Filters.tsx` uses `applyFromCandidate` and `applyToCandidate` from `rangeClamp.ts`, both of which call `clampDateToToday(candidate, today)`. The date inputs carry `max={todayInIsrael()}`. Verified at `Filters.tsx:188-218`. Future dates are clamped to today; empty inputs return `null` → no-op. ✓

---

## Summary table

| ID | Severity | Invariant | File:line | Status |
|----|----------|-----------|-----------|--------|
| F-A5-01 | P1 | INV-11 / S1 | `dateRange.ts:48-67`, `api/data/route.ts:36` | **BUG** — malformed URL params silently default to wrong date window |
| F-A5-02 | P2 | INV-12 | `MonthlyTables.tsx:111`, `Dashboard.tsx:493` | **UX gap** — global store filter not synced to MonthlyTables internal dropdown |
| F-A5-03 | P2 | URL round-trip | `urlState.ts:24`, `Dashboard.tsx:79` | **Maintenance risk** — TabKey duplicated in two files |
| INV-11 store slicing | ✓ OK | INV-11 | `analytics.ts:100-110` | Client slicing correct; server correctly ignores ?store= |
| INV-12 GoalTracker | ✓ OK | INV-12 | `GoalTracker.tsx:42`, `insights.ts:486` | Intentionally global; ignores both store and range |
| INV-12 TodayLive | ✓ OK | INV-12 | `TodayLive.tsx:186-191` | Always fetches today-to-today; independent of parent range |
| INV-12 MonthlyTables (range) | ✓ OK | INV-12 | `MonthlyTables.tsx:113-116` | Fixed-window 17-month own SWR fetch; range intentionally ignored |
| INV-13 previousRange math | ✓ OK | INV-13 | `presets.ts:124-131` | Equal-length prior window; verified live (−6.4% delta) |
| INV-13 two implementations | ✓ OK | INV-13 | `presets.ts:124` vs `dateRange.ts:219` | Mathematically equivalent for all tested ranges |
| URL round-trip | ✓ OK | URL state | `urlState.ts` | Identity for all valid state combinations including special chars in store name |
| Future-date cap | ✓ OK | INV-11 | `Filters.tsx:188-218`, `rangeClamp.ts` | Clamped to Asia/Jerusalem today; empty input is no-op |
