---
phase: 04-component-decomposition
plan: 01
subsystem: ui
tags: [react, typescript, refactoring, hooks, presentational-components, dashboard]

# Dependency graph
requires:
  - phase: 02-foundations
    provides: "84-test Vitest suite covering analytics/attribution helpers — used as the regression net for every task commit"
provides:
  - "4 reusable hooks under src/lib/hooks/ (useCampaignTrueRevenue, useCampaignAttribution, useBillingRecurring, useBillingOneTime)"
  - "6 presentational sub-components under src/components/ (CampaignsTableRow, AttributionAnalysisPanel, MetaShopifyReconciliation, ProductChannelBreakdown, AdSetTable, BillingCsvImport)"
  - "Named exports: pearson, pearsonWithLag (from MetaShopifyReconciliation.tsx) for downstream phases 5/6/7"
  - "Live-update propagation: Dashboard memo now refreshes on 'roas-billing-changed' (fixes pre-existing P&L staleness)"
  - "Hook directory convention (src/lib/hooks/) established for all future React hooks"
affects: [phase-05-scalability, phase-06-security-and-cloud-sync, phase-07-observability]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Hooks directory convention: src/lib/hooks/use<Domain>.ts"
    - "Flat presentational components in src/components/ (no per-parent subdirs)"
    - "Dumb sub-components: zero useSWR / zero localStorage direct access / zero 'roas-*-changed' listeners"
    - "Container/presenter split for table rows (CampaignsTableRow + AdSetTable own only row JSX; parent owns data)"
    - "Co-located pure helpers (pearson, pearsonWithLag) re-exported from owning component for downstream reuse"
    - "Tab-content conditional render (not display:none) preserves React unmount + form state"

key-files:
  created:
    - dashboard-web/src/lib/hooks/useCampaignTrueRevenue.ts
    - dashboard-web/src/lib/hooks/useCampaignAttribution.ts
    - dashboard-web/src/lib/hooks/useBillingRecurring.ts
    - dashboard-web/src/lib/hooks/useBillingOneTime.ts
    - dashboard-web/src/components/CampaignsTableRow.tsx
    - dashboard-web/src/components/AttributionAnalysisPanel.tsx
    - dashboard-web/src/components/MetaShopifyReconciliation.tsx
    - dashboard-web/src/components/ProductChannelBreakdown.tsx
    - dashboard-web/src/components/AdSetTable.tsx
    - dashboard-web/src/components/BillingCsvImport.tsx
  modified:
    - dashboard-web/src/components/CampaignsTable.tsx
    - dashboard-web/src/components/CampaignDrawer.tsx
    - dashboard-web/src/components/BillingSettings.tsx
    - dashboard-web/src/components/Dashboard.tsx

key-decisions:
  - "D-01: All new hook files live under src/lib/hooks/ (new directory introduced this phase). Convention for phases 5/6/7."
  - "D-02: All new sub-components live flat in src/components/ — no per-parent subdirs. Matches existing ~30-file flat convention."
  - "D-03: Regression confidence = npm run build (per task) + npm run test (84 Phase 2 tests, per task) + manual smoke (per checkpoint). No new tests this phase."
  - "D-04 override invoked for 3 shells (CampaignsTable 1098L, CampaignDrawer 596L, BillingSettings 994L) — further sub-extraction would split form state or orchestration and was deemed worse than the line-count budget."
  - "D-06: Tasks executed sequentially in 3 groups (CampaignsTable → CampaignDrawer → BillingSettings), gated by 2 in-phase human-verify checkpoints + 1 final phase-wide smoke."
  - "D-07: Each of the 12 implementation tasks (T-A..T-L) landed as ONE atomic commit. 12 tasks = 12 commits (+ 1 follow-up fix commit)."

patterns-established:
  - "Hook directory: src/lib/hooks/use<Domain>.ts (4 hooks created this phase, future React hooks follow this)"
  - "Sub-component flat layout: src/components/<Name>.tsx (no per-parent subdir; co-located TypeScript types in same file)"
  - "Custom-event live-update: cross-component refresh via window.dispatchEvent + useEffect addEventListener pair; deps-include tick counter in parent useMemo when localStorage-backed helpers feed the memo (Dashboard.tsx billingTick pattern)"
  - "Pearson helpers (pearson, pearsonWithLag) live in MetaShopifyReconciliation.tsx as named exports for downstream phases 5/6/7"

requirements-completed:
  - PH4-CT-A
  - PH4-CT-B
  - PH4-CT-C
  - PH4-CT-D
  - PH4-CD-E
  - PH4-CD-F
  - PH4-CD-G
  - PH4-CD-H
  - PH4-CD-I
  - PH4-BS-J
  - PH4-BS-K
  - PH4-BS-L
  - PH4-SMOKE

# Metrics
duration: 1h 30m
completed: 2026-05-19
---

# Phase 04 Plan 01: Component Decomposition Summary

**Three 1300+L React shells split into focused ≤600L modules via 4 hook extractions + 6 dumb presentational sub-components, with byte-identical Hebrew literals / Tailwind classes / memo deps / SVG hex colors and an 84-test Vitest regression net green after every atomic commit.**

## Performance

- **Duration:** 1h 30m
- **Started:** 2026-05-18T23:27:20+03:00 (T-A commit)
- **Completed:** 2026-05-19T00:57:44+03:00 (follow-up fix commit)
- **Tasks:** 12 implementation tasks (T-A..T-L) + 1 follow-up fix
- **Files modified:** 14 (10 new + 4 modified)

## Accomplishments

- Extracted `useCampaignTrueRevenue` hook (297L, byte-identical body lift from CampaignsTable.tsx:552-682) — preserves memo dep array `[mode, data, productsResp, ordersAttrResp, productMap, aggregated, localRange]`.
- Extracted `useCampaignAttribution` hook (124L) — preserves `null` (not `undefined`) for ad-sets with no usable data.
- Extracted `CampaignsTableRow` sub-component (359L) — dumb table row; 14 `<td>` cells; zero hooks of its own.
- Shrank `CampaignsTable.tsx` shell from 1740L to **1098L** (D-04 override).
- Extracted `AttributionAnalysisPanel` (140L), `MetaShopifyReconciliation` (310L), `ProductChannelBreakdown` (83L), `AdSetTable` (293L) — all 4 drawer panels are dumb / presentational.
- Co-located + named-exported `pearson` and `pearsonWithLag` from `MetaShopifyReconciliation.tsx` for downstream consumers.
- Shrank `CampaignDrawer.tsx` shell from 1326L to **596L** (D-04 override).
- Extracted `useBillingRecurring` (52L) + `useBillingOneTime` (37L) hooks — both listen to the SAME `'roas-billing-changed'` event (no separate one-time event).
- Extracted `BillingCsvImport` (316L) — 4-stage CSV import (paste/file → parse → preview → confirm).
- Shrank `BillingSettings.tsx` shell from 1296L to **994L** (D-04 override; orchestrator function ~185L — further splitting would fragment form state).
- **Fixed a pre-existing P&L live-update bug** discovered during the final smoke (see Issues Encountered).
- 84/84 Vitest tests + `npm run build` green after every atomic commit.

## Task Commits

Each task was committed atomically (D-07):

1. **T-A: Extract useCampaignTrueRevenue hook** — `f326fc0` (refactor)
2. **T-B: Extract useCampaignAttribution hook** — `ebb111f` (refactor)
3. **T-C: Extract CampaignsTableRow sub-component** — `918b210` (refactor)
4. **T-D: Shrink CampaignsTable shell to 1098 lines** — `be29a10` (refactor)
5. **T-E: Extract AttributionAnalysisPanel sub-component** — `0506b82` (refactor)
6. **T-F: Extract MetaShopifyReconciliation + pearson exports** — `31ec45b` (refactor)
7. **T-G: Extract ProductChannelBreakdown sub-component** — `b809ca3` (refactor)
8. **T-H: Extract AdSetTable sub-component** — `8f56a1e` (refactor)
9. **T-I: Shrink CampaignDrawer shell to 596 lines** — `ee9e3ac` (refactor)
10. **T-J: Extract useBillingRecurring + useBillingOneTime hooks** — `e5787da` (refactor)
11. **T-K: Extract BillingCsvImport sub-component** — `7506bcc` (refactor)
12. **T-L: Shrink BillingSettings shell to 994 lines (D-04 override)** — `87e8861` (refactor)
13. **Follow-up fix: Propagate 'roas-billing-changed' to Dashboard memo** — `4f9cbb6` (fix)

## Files Created/Modified

**Created (10):**
- `dashboard-web/src/lib/hooks/useCampaignTrueRevenue.ts` (297L) — memoized `Map<campaignKey, TrueRevenueInfo>` lifted byte-identical from CampaignsTable
- `dashboard-web/src/lib/hooks/useCampaignAttribution.ts` (124L) — memoized `Map<adSetKey, AttributionAnalysis | null>` lifted byte-identical from CampaignDrawer
- `dashboard-web/src/lib/hooks/useBillingRecurring.ts` (52L) — localStorage ↔ React state ↔ event for recurring costs
- `dashboard-web/src/lib/hooks/useBillingOneTime.ts` (37L) — localStorage ↔ React state ↔ event for one-time costs
- `dashboard-web/src/components/CampaignsTableRow.tsx` (359L) — single `<tr>` with 14 `<td>` cells; trust chip rendering
- `dashboard-web/src/components/AttributionAnalysisPanel.tsx` (140L) — trust verdict callout
- `dashboard-web/src/components/MetaShopifyReconciliation.tsx` (310L) — Pearson r + ComposedChart + `dir="rtl"` tooltip; named exports `pearson` + `pearsonWithLag`
- `dashboard-web/src/components/ProductChannelBreakdown.tsx` (83L) — 4-segment channel breakdown bar
- `dashboard-web/src/components/AdSetTable.tsx` (293L) — 7-col sortable ad-sets table; consumes trust chip from prop Map (zero direct `analyzeAttributionForAdSet` calls)
- `dashboard-web/src/components/BillingCsvImport.tsx` (316L) — 4-stage CSV import flow

**Modified (4):**
- `dashboard-web/src/components/CampaignsTable.tsx` — shell shrunk from 1740L → 1098L
- `dashboard-web/src/components/CampaignDrawer.tsx` — shell shrunk from 1326L → 596L; drawer panel render order preserved (Attribution → ProductChannel → MetaShopify → AdSetTable)
- `dashboard-web/src/components/BillingSettings.tsx` — shell shrunk from 1296L → 994L; tab content uses conditional render (not display:none); `SOURCE_LABEL` + `SOURCE_COLOR` now exported for BillingCsvImport
- `dashboard-web/src/components/Dashboard.tsx` — added `billingTick` state + `'roas-billing-changed'` listener; included in `filtered` useMemo deps

## Decisions Made

- **D-04 override invoked for all 3 shells** (1098L / 596L / 994L). Further sub-extraction would either split form state (BillingSettings), fragment the drawer orchestration (CampaignDrawer), or fragment the table orchestration (CampaignsTable) — the cost was deemed worse than the line-count budget. Rationale per shell:
  - **CampaignsTable.tsx (1098L):** owns sort/filter/optimization-toggle state + drawer mount; only the row JSX was a clean extraction point.
  - **CampaignDrawer.tsx (596L):** above the 500L target only because of the AdsDrawer nested-drawer state machine + the WR-01 stacking contract; splitting it would require lifting drawer-stack state up one level.
  - **BillingSettings.tsx (994L):** the orchestrator function itself is ~185L; the remaining bulk is per-tab inline JSX that would need its own form-state lift to extract.
- **Co-located pure helpers** (pearson, pearsonWithLag) named-exported from `MetaShopifyReconciliation.tsx` instead of being moved to `src/lib/` — they're co-located with their primary consumer; the named exports satisfy future-phase reuse without an over-eager `lib/stats.ts` extraction.
- **`SOURCE_LABEL` + `SOURCE_COLOR` exported from BillingSettings.tsx** (Option B per PATTERNS.md — minimal-diff path) instead of being moved to a shared util. `PnLBreakdown.tsx` retains its own duplicate copy; unifying both copies is explicitly out of Phase 04 scope.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Removed literal `'roas-billing-onetime-changed'` from hook docstrings**
- **Found during:** Task T-J (`useBillingRecurring` + `useBillingOneTime` extraction)
- **Issue:** Initial docstrings annotated the wrong event name `'roas-billing-onetime-changed'` as a "do not use" warning. The plan's verification grep treats ANY occurrence of that literal string under `src/lib/hooks/` as a contract violation, regardless of whether it's in code or in comments.
- **Fix:** Reworded the docstrings to reference "one-time variant" instead of the literal wrong event name. The intent (warning future readers about the easy mistake) is preserved; the grep gate now passes.
- **Files modified:** `dashboard-web/src/lib/hooks/useBillingRecurring.ts`, `dashboard-web/src/lib/hooks/useBillingOneTime.ts`
- **Verification:** `grep -rc 'roas-billing-onetime-changed' dashboard-web/src/lib/hooks/` returns 0 across all 4 hook files.
- **Committed in:** `e5787da` (part of T-J commit — fix applied before commit)

---

**Total deviations:** 1 auto-fix (Rule 1 — bug)
**Impact on plan:** Single docstring cleanup; no scope creep.

## Issues Encountered

**Pre-existing live-update gap in P&L (discovered during final phase-wide smoke):**

User reported during checkpoint 3/3 that editing a recurring or one-time cost in BillingSettings did NOT update the P&L card / KPI totals until a full page reload. Investigation confirmed this was **not** a regression from any of the 12 refactor commits — none of them touched `Dashboard.tsx`, `PnLBreakdown.tsx`, `billing.ts`, or `analytics.ts` (last commits to those files predate phase 04 by multiple commits).

**Root cause:** `Dashboard.tsx` builds `filtered = useMemo(..., [data, filters])` which invokes `aggregate()` from `analytics.ts`; `aggregate()` reads billing from localStorage via `billingForRange()` to compute `fixedCosts`. But `billing` was NOT a memo dep, so the cached `filtered.curAgg.fixedCosts` value (passed as `current.fixedCosts` prop to KpiCards, PerStoreCards, PnLBreakdown) stayed stale. `PnLBreakdown`'s own internal `'roas-billing-changed'` listener only refreshed its per-source breakdown state, not the displayed total (which comes from the prop).

**Fix:** Added a `billingTick` counter in `Dashboard.tsx` that increments on every `'roas-billing-changed'` event, included in the `filtered` memo deps. `aggregate()` now re-runs whenever billing changes, producing fresh `fixedCosts` for all downstream consumers.

**Committed in:** `4f9cbb6` (separate `fix(04-01)` commit after the 12 refactor tasks). User approved the fix in production via Vercel deploy verification.

**Scope note:** This was technically outside Phase 04's mechanical-refactor scope, but the user chose to fix it inline since it surfaced during this phase's smoke and the fix was tiny (~10 lines, 1 commit, isolated to Dashboard.tsx).

## User Setup Required

None — no external service configuration required.

## Next Phase Readiness

- All 4 new hooks and 6 new sub-components are ready for reuse in Phase 5 (scalability) and downstream.
- `pearson` + `pearsonWithLag` named exports from `MetaShopifyReconciliation.tsx` are available for Phase 5/6/7 reconciliation work.
- Hook directory convention (`src/lib/hooks/use<Domain>.ts`) is now established — future React hooks should follow it.
- D-04 overrides for the 3 shells are documented; if Phase 5 needs to further shrink them, it should start by lifting form / drawer-stack state.
- **Follow-up backlog:** `PnLBreakdown.tsx` still holds its own duplicate copy of `SOURCE_LABEL` + `SOURCE_COLOR`; unifying with `BillingSettings.tsx` exports is a small future refactor.

---
*Phase: 04-component-decomposition*
*Completed: 2026-05-19*
