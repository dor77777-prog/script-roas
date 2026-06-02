# Per-month monthly goal + range-aware lookback — TDD plan

**Date:** 2026-06-02. **Status:** ready. **Approved mockup:** `docs/superpowers/mockups/2026-06-02-goal-tracker/goal-tracker-mockup.html` (UI must match it — same EXISTING GoalTracker layout 1:1 + the per-month additions only).

## Goal (locked decisions)
Evolve `GoalTracker` from a single global current-month target to **per-month goals with range-aware lookback** — while keeping it **business-wide (NOT per-store)** and keeping the existing visual layout 1:1.
- **Storage:** per-month `byMonth` map (mirror cogsSettings/salarySettings), replacing the single `roas-dashboard:monthly-revenue-goal` number. New cloud-synced key.
- **Carry-forward default:** a month with no explicit goal inherits the **last explicitly-set earlier month's** goal (tagged "נגרר מ-<month>"). No earlier set goal → no goal ("אין יעד שהוגדר").
- **Range-aware, single calendar month only:** when `filters.range` is exactly one calendar month (or the `this_month`/`today` presets resolve inside one month) → show THAT month. Past complete month → final actual vs target → "✓ עמד" / "✗ לא עמד". Current month → MTD + end-of-month forecast (the EXISTING behavior). A range spanning >1 calendar month → empty state "מעקב יעד זמין לחודש בודד".
- **Month stepper** `‹ month ›` in the header (next to the ✎); ✎ edits THAT month's goal.
- Constraints: business-wide only (no per-store); CAPI-irrelevant; no DB migration (rides on `dashboard_state` KV like cogs-settings).

## Architecture
- `src/lib/goalSettings.ts` (NEW) — `GoalSettings = { v:number; byMonth: Record<'YYYY-MM', number> }`. Helpers: `defaultGoalSettings`, `effectiveGoal(s, month): { value:number|null; carriedFrom:string|null }` (byMonth[month] → else the latest set month < month → else null), `read/writeGoalSettings` (localStorage + `pushCloudKey` + `roas-goal-changed` event), `monthFromRange(range): string|null` (returns 'YYYY-MM' iff from/to are within ONE calendar month, else null), and a one-time **migration**: if no `goal-settings` key but the legacy `roas-dashboard:monthly-revenue-goal` exists, seed `byMonth[currentMonth] = legacyValue` (preserves current pacing; past months stay unset until edited).
  - KEY = `roas-dashboard:goal-settings`. Keep reading the legacy key for migration only.
- `src/lib/cloudSync.ts` — add `'roas-dashboard:goal-settings'` to `STATE_KEYS` + `CHANGE_EVENTS` (`roas-goal-changed`). **Leave** the legacy `monthly-revenue-goal` entry (back-compat hydrate).
- `src/lib/dashboardStateKeys.ts` — add `'goal-settings'` to `ALLOWED_STATE_KEYS`. (The `stateKeysParity.test.ts` guard enforces both lists carry it.)
- `src/lib/hooks/useGoalSettings.ts` (NEW) — reactive hook mirroring useCogsSettings (re-read on `roas-goal-changed` + storage).
- `src/components/GoalTracker.tsx` — REWIRE to per-month range-aware (details in T3). Receives the selected range.
- `src/components/Dashboard.tsx` — pass `range={filters.range}` to `<GoalTracker>`.

## Tasks (each: TDD → spec-review → quality-review → commit to main, NO push)

### T1 — goalSettings model + helpers + migration + persistence
CREATE `src/lib/goalSettings.ts` + `src/lib/__tests__/goalSettings.test.ts`. TDD.
- Implement the shape + helpers above. `effectiveGoal` carry-forward: find max key in byMonth that is `<= month`? NO — `< month` for "carried from earlier" but `byMonth[month]` exact wins first; if exact set, carriedFrom=null; else the latest key `< month`, carriedFrom=that key; else {value:null,carriedFrom:null}.
- `monthFromRange({from,to})`: parse 'YYYY-MM-DD'; if from.slice(0,7)===to.slice(0,7) AND from is that month's day-01-or-later AND to is within that month → return from.slice(0,7); else null. (Single calendar month detection. A full-month range or a partial within one month both map to that month; a cross-month range → null.)
- Migration tested: legacy number present, no goal-settings → read seeds byMonth[currentMonth].
- Tolerate malformed JSON → default. `writeGoalSettings` dispatches event + pushCloudKey. Tests mock cloudSync.
- NOTE: tsc may be red until T2 registers the key in StateKey union — same pattern as salaries T1; run tsc at end of T2.

### T2 — register cloud key + useGoalSettings hook
EDIT `src/lib/cloudSync.ts` (STATE_KEYS + CHANGE_EVENTS) + `src/lib/dashboardStateKeys.ts` (ALLOWED_STATE_KEYS). CREATE `src/lib/hooks/useGoalSettings.ts` + `src/lib/hooks/__tests__/useGoalSettings.dom.test.tsx`. Run `npx vitest run src/lib/__tests__/stateKeysParity.test.ts` (must stay GREEN — both lists carry `goal-settings`) + `npx tsc --noEmit` (now clean).

### T3 — GoalTracker rewire (range-aware, per-month) — MATCH THE MOCKUP + KEEP LAYOUT 1:1
EDIT `src/components/GoalTracker.tsx` + DOM tests `src/components/__tests__/goalTrackerPerMonth.dom.test.tsx`.
**First read** the current GoalTracker fully + the approved mockup. Preserve the EXISTING 3-metric grid (נצבר עד כה · יעד החודש · חיזוי/תוצאה · status badge · thin bar + יעד-יומי tick · footer), the empty-goal/editing modes, and the forecast logic for the current month.
New props: `range: { from:string; to:string }` (the selected range). Behavior:
- `selMonth = monthFromRange(range)`. If `null` → render the **empty state** ("מעקב יעד זמין לחודש בודד · בחר חודש קלנדרי אחד") — no fetch.
- Else fetch all-stores `/api/data` for that month's window: current month → `[monthStart-7, today]` (existing, for forecast); past complete month → `[monthStart, monthEnd]`.
- `goal = effectiveGoal(goalSettings, selMonth)`.
- Header: keep the icon + "יעד חודשי" + a `‹ selMonth ›` stepper (prev/next month — updates an internal selected-month that drives the view; do NOT mutate the global filter unless trivial — internal state is fine for the mockup) + ✎ (edits `byMonth[selMonth]`).
  - NOTE: simplest correct wiring — the stepper sets a local `viewMonth` state initialized from `selMonth`; all computations use `viewMonth`. (If you prefer to drive it off the global range only, that's acceptable too — but the mockup shows in-card ‹ › navigation, so local viewMonth is expected.)
- CURRENT month (viewMonth === current IL month): EXISTING layout — נצבר עד כה (MTD) + % מהיעד, יעד החודש + חסרים, חיזוי סוף חודש + מעל/מתחת, bar + tick, footer יום N/M · נשארו · יעד יומי. Status badge = pacing (מקדים/בקצב/מפגר).
- PAST complete month: same grid but 3rd column = "תוצאה מול יעד" (final actual − goal, over/under %); status badge = "✓ עמד ביעד" (actual≥goal) / "✗ לא עמד"; bar = final % (green/red); footer = "ביצוע סופי · N ימים" (no forecast/days-left). "נצבר עד כה" label → "הכנסות בחודש".
- Carry-forward: if `goal.carriedFrom` → show a subtle "נגרר מ-<carriedFrom>" tag near the goal/header (mockup state ④).
- No explicit goal AND no carry (value null): show the existing "קבע יעד" empty-goal card for that month.
- All numbers via `<Money>`/tabular-nums; tokens; AA; light+dark — per the readability standard. Business-wide (all stores) — never per-store.
DOM tests: single-month current → pacing renders; past month with goal met → "עמד" badge + תוצאה column; past missed → "לא עמד"; carry-forward tag; non-single-month range → empty state; stepper changes the viewed month.

### T4 — Dashboard wiring
EDIT `src/components/Dashboard.tsx`: `<GoalTracker data={data} range={filters.range} />`. Confirm no other consumer of the old single-goal API breaks (the legacy `readGoal/writeGoal` may stay for migration; remove its UI usage only). tsc + the GoalTracker DOM suites green.

### T5 — docs
UM new entry (per-month goal + lookback; how to use the ‹ month › stepper; business-wide). ARCHITECTURE: goalSettings model + range-aware + the new synced key (parity-guarded) + migration from the legacy key.

## Verify
`npx tsc --noEmit` · `npx vitest run` · `npx vitest run --config vitest.config.dom.ts` · `npm run lint` (0 errors) all green. Then apply = push (no DB migration). docs-currency: components touched → UM required; lib-only otherwise → ARCHITECTURE recommended.
