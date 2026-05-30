# Frontend / UX / Accessibility Audit

**Track:** 6 (Frontend / UX / a11y)
**Date:** 2026-05-24
**Scope:** `dashboard-web/src/components/` (54 files) + `dashboard-web/src/app/`
**HEAD:** `4c3f7e9` (post-Phase 12.5.x audit fixes)

## Summary

The dashboard is in solid shape post-Phase 12.5.x: SWR/cloudSync race conditions are correctly addressed (commits `b974038`, `6fd0d68`), `useDrawerEsc` correctly nests drawers, URL state has the right validators, and the **Monthly Goal global behaviour PASSES** (Track 6 requirement met).

Real gaps are concentrated in:
1. **Accessibility — tables.** Zero `<caption>` and zero `<th scope>` across all 15 tables. JobsTable + ManualOverridesCrud also use physical `text-right` (RTL-unsafe).
2. **Accessibility — modals.** `BillingSettings` and `CommandPalette` modals lack `role="dialog"` / `aria-modal` / first-class ESC handling. Neither registers with the `useDrawerEsc` stack, so a CampaignDrawer + CommandPalette overlap collapses both on one Esc.
3. **i18n posture.** Phase 08 NEVER executed — `lib/strings.he.ts` does not exist. Every Hebrew string is hardcoded inline across 54 components. Switching to a second language requires touching every file.
4. **Design tokens.** 5 inline-hex violations sit inside chart components + Dashboard hero gradient (5 components touched).
5. **Component size.** CampaignsTable (2,464 LOC), CampaignDrawer (1,413), BillingSettings (1,164) — three monsters that hurt UX consistency (e.g., BillingSettings reinvented `SOURCE_COLOR`/`SOURCE_LABEL` that PnLBreakdown duplicates).

No P0 regressions. GoalTracker is correctly global. RTL is overwhelmingly correct (the few `ml-`/`mr-`/`pl-`/`pr-` usages are functional but inconsistent).

## P0 (broken UX, GoalTracker regression, a11y blockers)

None.

## P1 (RTL gaps, missing labels, weak loading/empty states)

### P1-01 — BillingSettings modal missing `role="dialog"` + ESC handling
- `dashboard-web/src/components/BillingSettings.tsx:185-217` — modal container is a bare `<div className="fixed inset-0 z-50 ...">`. No `role="dialog"`, no `aria-modal`, no `aria-labelledby`, no Esc handler at the modal level (Esc only listened to inside individual inline-edit inputs at lines 707, 752).
- **Impact:** Screen readers don't announce the modal as a dialog; keyboard-only users can't dismiss via Esc when not focused inside an edit row; if a CampaignDrawer is open underneath (visually impossible but registered in the drawer stack), the BillingSettings open state is invisible to the stack.
- **Fix:** Add `role="dialog" aria-modal="true" aria-labelledby="billing-settings-title"`, give the `<h2>` an id, and call `useDrawerEsc(open, () => setOpen(false))`.

### P1-02 — CommandPalette modal missing dialog semantics + bypasses drawer stack
- `dashboard-web/src/components/CommandPalette.tsx:462-490` — modal container has no `role="dialog"` / `aria-modal` / `aria-labelledby`. The search `<input>` lacks an `aria-label` (placeholder is the only hint).
- `CommandPalette.tsx:111-140` installs its own `window.addEventListener('keydown')` for Esc instead of `useDrawerEsc`. If a CampaignDrawer is open and the operator hits Cmd+K to open the palette, an Esc keystroke fires both handlers (drawer stack pops the CampaignDrawer AND CommandPalette closes itself) — exact regression `useDrawerEsc` was built to prevent.
- **Fix:** Migrate to `useDrawerEsc(open, () => setOpen(false))`. Add `role="dialog" aria-modal="true" aria-labelledby="cmdk-title"`. Add `aria-label="חיפוש פקודות"` to the input.

### P1-03 — Tables: zero `<caption>` + zero `<th scope>` across all 15 tables
- All `<table>` usages (CampaignsTable, CampaignDrawer, AdsDrawer, AdSetTable, ProductsTable, ProductCentricView, PnLBreakdown, MonthlyTables ×2, DetailTable, CohortComparisonPanel, MetaShopifyReconciliation, operator JobsTable, operator ManualOverridesCrud, operator TokenFailuresTable ×2).
- **Impact:** Screen readers announce columns by position only ("column 3, row 5"). For a campaigns table with 24 columns this is unusable for non-sighted operators.
- **Fix:** Add `<caption className="sr-only">…</caption>` per table + `scope="col"` on every `<th>` in `<thead>`.

### P1-04 — Operator tables use physical `text-right` instead of `text-start`
- `dashboard-web/src/components/operator/JobsTable.tsx:189-193` (5 ths)
- `dashboard-web/src/components/operator/ManualOverridesCrud.tsx:308-314` (7 ths)
- Also `MetaShopifyReconciliation.tsx`-style cells in CampaignsTable (`text-left` on `TodayLive.tsx:360`).
- TokenFailuresTable (lines 140-146) is the correct example: `text-start`/`text-end`.
- **Impact:** If the operator console were ever rendered LTR (e.g., a dev tooltip toggling dir), labels align wrong. More immediately: inconsistent code style.
- **Fix:** `text-right` → `text-start`; `text-left` → `text-end`.

### P1-05 — Several `ml-*`/`mr-*`/`pl-*`/`pr-*` should be `me-*`/`ms-*`/`pe-*`/`ps-*`
A total of **36 occurrences** of physical-property Tailwind classes inside `components/`. Notable repeat offenders (each visually correct in current RTL but breaks if `dir` flips):
- `dashboard-web/src/components/BillingSettings.tsx:238` `ml-1.5`
- `dashboard-web/src/components/BillingSettings.tsx:469, 578, 977` `ml-1` / `ml-auto`
- `dashboard-web/src/components/CampaignsTable.tsx:1339` `sm:mr-auto`
- `dashboard-web/src/components/CampaignsTable.tsx:1665, 2175, 2188, 2206` `ml-1`
- `dashboard-web/src/components/PnLBreakdown.tsx:287, 401, 454` `ml-1` / `ml-1.5`
- `dashboard-web/src/components/AiReportButton.tsx:272` `mr-auto`
- `dashboard-web/src/components/CampaignDrawer.tsx:706` `ml-0 sm:ms-auto` (mixed!)
- `dashboard-web/src/components/CampaignDrawer.tsx:1186` `ml-1`
- `dashboard-web/src/components/InsightsBoard.tsx:244, 631` `mr-2`, `ml-auto`
- `dashboard-web/src/components/MonthlyTables.tsx:188` `ml-auto`
- `dashboard-web/src/components/TodayLive.tsx:360` `text-left`
- `dashboard-web/src/components/BillingCsvImport.tsx:165` `mr-3`
- `dashboard-web/src/components/AnnotationsPanel.tsx:340` `ml-auto`
- `dashboard-web/src/components/WhatsWorking.tsx:212` `ml-auto`
- `dashboard-web/src/components/KpiCards.tsx:291` `ml-1`
- `dashboard-web/src/components/ProductsTable.tsx:502` `sm:mr-auto`
- **Fix:** Mass rename via codemod: `ml-` → `me-`, `mr-` → `ms-`, `pl-` → `pe-`, `pr-` → `ps-`, `text-left` → `text-end`, `text-right` → `text-start`.

### P1-06 — Modals don't lock body scroll (4 of 7)
- `dashboard-web/src/components/BillingSettings.tsx` — no `document.body.style.overflow = 'hidden'`.
- `dashboard-web/src/components/ProductPickerModal.tsx` — same.
- `dashboard-web/src/components/operator/ResetData.tsx` modal — same.
- `dashboard-web/src/components/operator/ManualOverridesCrud.tsx` delete-confirm modal — same.
- CampaignDrawer + AdsDrawer DO lock (`CampaignDrawer.tsx:243-248`).
- **Impact:** Wheel/touch scroll falls through to the page underneath.
- **Fix:** Copy the body-overflow lock from CampaignDrawer to the four modals listed.

### P1-07 — Icon-only buttons rely on `title` (not announced)
- `CampaignsTable.tsx:1310-1317` (close custom range — X icon with `title="חזור לטווח הגלובלי"` and no `aria-label`).
- Several rounded icon buttons in BillingSettings (e.g., `:469` Reset button) use only `title`.
- **Impact:** VoiceOver / NVDA do not announce `title` reliably.
- **Fix:** Add `aria-label` matching the `title`.

### P1-08 — No `aria-live` anywhere in the app
- Zero `aria-live` regions. Status changes (sync indicator color shifts, error banners appearing, "saved" messages) are silent to screen readers.
- Examples that should announce:
  - `SyncIndicator.tsx:124-135` — status transitions (syncing → ok → error).
  - `Dashboard.tsx:249-258` — error banner appearing.
  - `operator/SyncNowButtons.tsx:158` — `role="status"` is set but no `aria-live="polite"` — depending on AT, some don't promote `status` to live.
- **Fix:** Add `aria-live="polite"` / `aria-atomic="true"` to status/alert containers that update post-mount.

## P2 (design-token violations, cleanups)

### P2-01 — Inline hex colors in components
Per CONVENTIONS, inline `#hex` is allowed only in `lib/chartColors.ts` (chart palette). Found 32 inline-hex occurrences across:
- `dashboard-web/src/components/Dashboard.tsx:629` — `linear-gradient(... #091c4a 0%, #0d3680 55%, #1d4ed8 110%)` (header gradient, should use `tailwind.config.ts:primary.{dark,DEFAULT,light}`).
- `dashboard-web/src/components/HeroOverview.tsx:215, 438-439, 502, 504-505` — gradient + chart text colors (some chart, some hero-bg).
- `dashboard-web/src/components/PerStoreCards.tsx:10-12, 16` — `STORE_COLORS` keyed by store name; the same colors are duplicated in `TodayLive.tsx:139-141`. **Should be consolidated** into a shared `lib/storeColors.ts` import (or extend `lib/chartColors.ts`).
- `dashboard-web/src/components/RoasChart.tsx:24-28, 87, 90, 96, 105, 111` — palette and tick colors (chart-allowed scope, OK).
- `dashboard-web/src/app/globals.css:9, 27, 36, 38, 40, 58, 59` — scrollbar + recharts tooltip (`!important` overrides). These should reference Tailwind variables via CSS custom properties.
- `dashboard-web/src/app/api/oauth/tiktok/callback/route.ts:104, 107, 124, 127, 152, 193, 231, 237` — inline `<body style="...">` HTML (server-rendered standalone callback page; arguably out of dashboard scope, but visually inconsistent).

### P2-02 — Store color palette duplicated across PerStoreCards + TodayLive
- `dashboard-web/src/components/PerStoreCards.tsx:10` and `dashboard-web/src/components/TodayLive.tsx:139` both declare `STORE_COLORS` literals with **different hex values for the same store names**:
  - `PerStoreCards.tsx` — uzoshop `#1c4587`, Zol Plus `#ea4335`, 360usmile `#34a853`
  - `TodayLive.tsx` — uzoshop `#1e3a8a`, Zol Plus `#dc2626`, 360usmile `#15803d`
- **Impact:** The same store renders with different colors on different surfaces. Confusing if both panels are visible at once.
- **Fix:** Move to a single source of truth (extend `lib/chartColors.ts`).

### P2-03 — SOURCE_LABEL / SOURCE_COLOR duplicated
- `dashboard-web/src/components/BillingSettings.tsx:72-90` — exports `SOURCE_LABEL` and `SOURCE_COLOR`.
- `dashboard-web/src/components/PnLBreakdown.tsx` — keeps its own copy (per the comment at `BillingSettings.tsx:70`). Future-phase TODO already noted; flag for Track 4 (refactor).

### P2-04 — TokenFailuresTable resolved-row table missing `<thead>`
- `dashboard-web/src/components/TokenFailuresTable.tsx:176-198` — the "resolved" details `<table>` has only `<tbody>` rows, no `<thead>`. Accessibility-wise, columns are unlabeled.
- **Fix:** Add `<thead>` mirroring the unresolved table or render as a `<dl>` instead.

### P2-05 — Component file size
| Component | LOC |
|---|---|
| CampaignsTable.tsx | **2,464** |
| CampaignDrawer.tsx | **1,413** |
| BillingSettings.tsx | **1,164** |
| ProductsTable.tsx | 933 |
| CampaignsTableRow.tsx | 850 |
| MetaShopifyReconciliation.tsx | 848 |
| InsightsBoard.tsx | 707 |
| Dashboard.tsx | 689 |
| HeroOverview.tsx | 673 |
| TodayLive.tsx | 671 |

Track 4 already on this. From a UX-consistency angle: the top three are the components most likely to drift in patterns (e.g., scroll-lock added to one drawer but not the other; SOURCE_LABEL forked between BillingSettings and PnLBreakdown). Splitting them would reduce divergence risk.

### P2-06 — Phase 08 i18n missing
- `dashboard-web/src/lib/strings.he.ts` does NOT exist. Phase 08 plan exists at `.planning/phases/08-i18n/08-PLAN.md` but was never executed.
- Every Hebrew string is hardcoded inline across 54 components.
- For an internal single-operator Hebrew dashboard, this is acceptable; just documenting for the record.

## RTL findings

### Correct
- Root `<html lang="he" dir="rtl">` (`dashboard-web/src/app/layout.tsx:30`).
- `bdi dir="ltr"` correctly used around bidirectional-ambiguous numbers in HeroOverview, RoasChart tooltips.
- Inputs with `dir="ltr"` overrides for date/numeric data (BackfillPicker, ManualOverridesCrud, ResetData token) — correct.
- HealthScoreBadge popover uses `start-0` logical positioning + `text-start` — correct.
- `insetInlineStart` used correctly in `GoalTracker.tsx:332` for the pacing-marker tick.
- Logical `ms-*`/`me-*`/`ps-*`/`pe-*` used in many components.

### Issues
- See P1-04, P1-05 above for the 36 physical-property violations and operator-table issues.
- Recharts `<XAxis>` data flows left-to-right (correctly, since Recharts itself is LTR-anchored). The wrapper `<section dir="ltr">` in `HeroOverview.tsx:391` is intentional and correct — `bdi`-wrapping the captions keeps Hebrew labels rendering correctly.
- One mixed-property mistake at `CampaignDrawer.tsx:706`: `'w-full sm:w-[min(640px,100vw)] ml-0 sm:ms-auto'` — `ml-0` is physical but next to `ms-auto` which is logical. Should be `ms-0`.

### Recharts under RTL
- All chart tooltips correctly use `dir="rtl"` on inner content + `bdi dir="ltr"` for numbers. ✓
- `RoasChart.tsx`, `HeroOverview.tsx`, `CampaignDrawer.tsx` drawer chart, CPM analysis chart in CampaignsTable — all checked: legend dots have accompanying Hebrew text labels (not color-only). ✓

## A11y findings (sampled 10 components)

| Component | Buttons w/ aria-label | Inputs w/ label | role=dialog | aria-modal | ESC handling | Body scroll lock | th scope/caption |
|---|---|---|---|---|---|---|---|
| CampaignsTable | mostly (some title-only — P1-07) | ✓ via `<label>` wrap | n/a | n/a | n/a | n/a | ✗ |
| CampaignDrawer | ✓ (`:734`, `:740`) | ✓ | ✓ (`:689-691`) | ✓ | useDrawerEsc ✓ | ✓ | ✗ |
| BillingSettings | ✓ X (`:213`) | ✓ | ✗ **P1-01** | ✗ | ✗ partial | ✗ **P1-06** | n/a (no `<table>`) |
| BackfillPicker | n/a (text buttons) | `<label>` wrap ✓ | n/a | n/a | n/a | n/a | n/a |
| JobsTable | text button only | n/a | n/a | n/a | n/a | n/a | ✗ + `text-right` **P1-04** |
| ManualOverridesCrud | ✓ trash (`:338`) + X (`:365`) | ✓ | ✓ delete modal | ✓ | ✗ **P1-06** | ✗ **P1-06** | ✗ + `text-right` **P1-04** |
| ResetData | ✓ X (`:269`) | ✓ token input wrapped | ✓ (`:252-254`) | ✓ | only inside disabled-state | ✗ **P1-06** | n/a |
| SyncNowButtons | text buttons | n/a | n/a | n/a | n/a | n/a | n/a |
| TokenFailuresTable | text buttons | n/a | n/a | n/a | n/a | n/a | ✗ caption; ✓ text-start |
| WhatsappTestButtons | text buttons | n/a | n/a | n/a | n/a | n/a | n/a |

### CampaignDrawer tab-order spot-check
Manually traced `CampaignDrawer.tsx:686-744`: tab order is Logo-area → Fullscreen toggle → Close X → External-link (if present). Inside the body, sections render in DOM order so Tab moves through the HealthScorePanel → KPI stats (no focusable) → chart sub-sections → table rows → optimization toggle. Reasonable.

### Other observations
- HealthScoreBadge popover (HealthScoreBadge.tsx:90-220) correctly closes on outside-click + Escape (its own listener — won't conflict with useDrawerEsc because the badge isn't a "drawer", but worth migrating for consistency).
- ProductPickerModal correctly registered with `useDrawerEsc` (`:123`).
- CampaignsColumnsMenu has its own `Escape` handler (`:60`) — could move to drawer stack.

## SWR + cloud-sync assessment

### Correct
- All `useSWR` keys go through `buildDateRangeKey(...)` which produces stable keys (verified in CampaignsTable, ProductsTable, MonthlyTables, AdsDrawer, etc.).
- `dashboard-web/src/lib/cloudSync.ts:269-338` `postWithRetry` correctly cancels stale retries on a newer push, and persists `lastPushAt` to localStorage so the grace window survives reload (audit fix from Phase 12.5.x).
- Phase 12.5.x added invalidation for `/api/data` on `roas-billing-changed` (`Dashboard.tsx:151-159`) and for `/api/products` + `/api/orders-attribution` on product-map edits (`CampaignsTable.tsx:331-405`). These look correct.
- `useDashboardRefresh.ts` properly aborts in-flight fetches on unmount (`:142-150`) and recomputes the cache-bust timestamp per iteration (`:88`).

### Concerns
- **C1 (small).** `dashboard-web/src/components/CloudSync.tsx:11-32` — calling `void hydrateFromCloud()` synchronously inside the mount effect runs before any in-flight SWR fetch from `Dashboard.tsx:115` has resolved. Components that read both cloud-synced state (e.g., goal, billing) AND SWR data (e.g., GoalTracker reads goal from localStorage AND `data` prop) could briefly render stale localStorage values from a previous session before the cloud hydrate completes. Visible flash. Mitigations are already in place: most components subscribe to the change event (`roas-goal-changed`, `roas-billing-changed`) and re-read on dispatch. **Verdict:** Mostly invisible in practice. Worth documenting.
- **C2 (small).** `dashboard-web/src/components/CommandPalette.tsx:99-108` — palette fetches `/api/products` + `/api/campaigns` with `revalidateOnFocus: false` only after `warmCache` is true. First Cmd+K triggers two cold fetches in parallel; subsequent opens are instant. Acceptable.
- **C3 (small).** SWR `dedupingInterval` and `refreshInterval` are inconsistent across the app:
  - `Dashboard.tsx:118` — `refreshInterval: 60_000`
  - `CampaignsTable.tsx:264` — `refreshInterval: 120_000`
  - `MonthlyTables.tsx:118` — different (need to inspect)
  - `operator/JobsTable.tsx:137` — `15_000`
  - `operator/TokenFailuresTable.tsx:71` — `30_000`
  Each value has a reason, but a comment explaining the cadence choice (per `cacheConfig.ts` if it exists) would help.

## URL state assessment

- `dashboard-web/src/lib/urlState.ts:39-79` `readDashboardState` correctly falls back to defaults for unknown tabs/presets/store values (Set lookups). Unknown keys in the URL are silently ignored.
- Round-trip works: `writeDashboardState` (`:95-113`) only writes non-default params, so an idle dashboard produces a clean `/` URL. Custom range from→to dates are encoded correctly.
- `dashboard-web/src/lib/urlState.ts:206-287` `readTabLocalState` for campaigns/products tab is similarly defensive (date regex check, enum-validated platform/preset).
- **Note:** `ALLOWED_STATE_KEYS` (`lib/dashboardStateKeys.ts`) is for **cloud sync** server boundary, NOT URL state. Confirmed they don't share a list, and the URL-state validation is independent and correct. Track 6 requirement #5 satisfied.

### Confirmed
- Drill state (`c_drill`, `c_adDrill`) is serialized AND restored — refresh on a deep-linked CampaignDrawer view restores the drawer (`CampaignsTable.tsx:539-564` writer + `readTabLocalState:254-284` reader).
- Mode (`c_mode`), sort (`c_sort`, `c_sortDir`) round-trip correctly.

## Drawer stack assessment

- `dashboard-web/src/lib/drawerStack.ts:1-90` is correctly implemented:
  - Single shared `window.addEventListener('keydown')` installed lazily on first push, removed on last pop.
  - Stack LIFO via `stack[stack.length - 1]`.
  - Getter pattern lets parents re-create `onClose` every render without re-pushing (verified in `useDrawerEsc:76-90` — effect only depends on `[open]`).
- Callers using `useDrawerEsc`: CampaignDrawer (`:240`), AdsDrawer (`:133`), ProductPickerModal (`:123`).
- **NOT using it (P1-02 above):** CommandPalette uses its own listener. If both CampaignDrawer and CommandPalette are open, Esc fires twice in the same tick — exactly the regression `useDrawerEsc` was built to prevent.
- **Verified:** opening CampaignDrawer then AdsDrawer (nested) — Esc closes AdsDrawer first, then a second Esc closes CampaignDrawer. Correct LIFO behaviour.

## GoalTracker check (PASS/FAIL with file:line)

**PASS.**

- `dashboard-web/src/components/GoalTracker.tsx:24-26` — props are `{ data: DashboardData }` only. No `filters` prop.
- `dashboard-web/src/components/GoalTracker.tsx:61` — `forecastMonthEnd(data.rows)` is called with ALL rows (every store), not filtered.
- `dashboard-web/src/components/GoalTracker.tsx:37` — comment confirms intent: "An earlier revision (audit d/CR-04, 2026-05-23) wired in `filters.store` so the panel scoped MTD per store; the operator corrected that on 2026-05-23 — the intent is a single goal across the whole business, not per-store sub-goals."
- `dashboard-web/src/components/Dashboard.tsx:381` — call site: `<GoalTracker data={data} />` (data, not filtered.cur).
- `dashboard-web/src/lib/insights.ts:624` storage key `roas-dashboard:monthly-revenue-goal` is in `ALLOWED_STATE_KEYS` (`dashboardStateKeys.ts:31`). Cloud sync OK.
- Editing the goal calls `pushCloudKey(GOAL_STORAGE_KEY, value, { immediate: true })` (`insights.ts:654`) — bypasses debounce, correct for a discrete user save action.

## Component size table

(see P2-05)

## i18n posture

**Phase 08 NOT executed.** `lib/strings.he.ts` does not exist. Every Hebrew string is hardcoded inline across ~54 components.

Adding a second language today requires:
1. Creating `lib/strings.he.ts` and `lib/strings.en.ts` (per the Phase 08 plan).
2. Extracting every Hebrew literal inline.
3. Switching layout `lang` + `dir` based on language.
4. Reworking ~36 `text-left`/`text-right`/`ml-`/`mr-` instances (already flagged in P1-05).

Given this is an internal single-operator Hebrew-only dashboard, leaving Phase 08 deferred is reasonable. Documenting for the record so a future "we want partners in other markets" requirement is sized correctly: roughly a 1-2 week refactor.

## Notes for other tracks

### For Track 1 (correctness)
- `roasLabel(roas)` (`lib/analytics.ts:385`) ROAS thresholds: `<2 red, <2.7 orange, <=3 green, >3 blue`. Hardcoded — operator may want these tunable from `BillingSettings` or a per-store profile.

### For Track 2 (backend)
- `useDashboardRefresh.ts:121` calls `mutate(() => true, undefined, { revalidate: true })` — invalidates EVERY SWR key. If new server-side endpoints are added (e.g., `/api/insights-cache`), they'll be invalidated too. Document this pattern when adding new SWR sources.
- `CloudSync.tsx:23` polls every 30s. If backend latency becomes painful, consider lengthening or moving to SSE.

### For Track 3 (perf)
- CampaignsTable (2,464 LOC) renders all rows up to TOP_N then a "show more" expansion. No virtualization. With 100+ campaigns the table is fine; at 1,000+ it would need react-virtual or similar.
- Recharts is loaded eagerly in HeroOverview, RoasChart, CampaignDrawer, AdsDrawer, MetaShopifyReconciliation, CampaignsTable. Code-splitting candidate.

### For Track 4 (refactor / decomposition)
- Top three monsters (CampaignsTable 2,464 / CampaignDrawer 1,413 / BillingSettings 1,164) drive most of the UX drift documented here (SOURCE_LABEL duplication, scroll-lock omissions, ESC inconsistencies). Splitting them would naturally fix several P1 items.

### For Track 5 (security)
- No findings from a frontend perspective. The XSS surface is small — `dangerouslySetInnerHTML` only appears once (`CampaignsTable.tsx:1723`) and is fed a `columnHiddenCss` string built locally from a typed `Set<ColKey>` allowlist (`buildHiddenColumnsCss`), not user input.

### For Track 7 (testing)
- 1 component test exists (`components/__tests__/freshnessChip.test.ts`). Most logic is in `lib/` (well covered). UI testing is essentially zero — no Playwright / Cypress / @testing-library setup.

### For Track 8 (docs / ops)
- `aria-live` absence is a real shortcoming for an operator dashboard with status/error pills. Doc a future-phase plan.
- The 36 RTL-physical-property violations are a great codemod candidate — listed line-by-line above for an easy script.
