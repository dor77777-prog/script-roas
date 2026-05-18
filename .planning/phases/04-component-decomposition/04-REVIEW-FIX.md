---
phase: 04-component-decomposition
fixed_at: 2026-05-19T01:24:00Z
review_path: .planning/phases/04-component-decomposition/04-REVIEW.md
iteration: 1
findings_in_scope: 6
fixed: 6
skipped: 0
status: all_fixed
---

# Phase 04: Code Review Fix Report

**Fixed at:** 2026-05-19T01:24:00Z
**Source review:** `.planning/phases/04-component-decomposition/04-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 6 (1 BLOCKER + 5 WARNINGS — INFO excluded)
- Fixed: 6
- Skipped: 0
- Status: all_fixed

All 6 in-scope findings were applied cleanly. After each commit, `npm run build` and `npm run test` were re-run inside an isolated worktree; both stayed green (84/84 vitest tests passing, `next build` completing the 12-route static export). No findings required rollback.

## Fixed Issues

### CR-01: Duplicate-detection not recomputed when `defaultStore` changes in BillingCsvImport

**Files modified:** `dashboard-web/src/components/BillingCsvImport.tsx`
**Commit:** `aa0698b`
**Applied fix:** Extended the destination-store `<select>` onChange handler to re-run `findMatchingRecurring(r, next, currentRecurring)` for every existing preview row and update both `skip` and `duplicateOfId` against the new store. Existing user edits to `type` are preserved. Fixed at the onChange seam (not inside `buildPreview`) because `buildPreview` is also called from `parse()` and `handleFile()` where it should NOT touch user-edited `type` choices — the recompute is store-change-specific.

The mechanical effect: when a user switches the destination store from "Store A" to "Store B" mid-import, rows previously flagged duplicate-of-A get their `skip` checkbox correctly cleared (now unique-to-B), and rows now duplicate-of-B get their `skip` flipped on. Without the fix, a row could silently slip through with `skip=false` and double-add a monthly recurring cost that then permanently inflates P&L.

### WR-01: `useBillingRecurring` / `useBillingOneTime` return non-memoized setters

**Files modified:** `dashboard-web/src/lib/hooks/useBillingRecurring.ts`, `dashboard-web/src/lib/hooks/useBillingOneTime.ts`
**Commit:** `b131edf`
**Applied fix:** Imported `useCallback` from React in both hooks and wrapped `persist` with `useCallback(..., [])`. The empty dep array is correct: the raw `setRecurring` / `setOneTime` state setters are React-stable per spec, and `writeRecurring` / `writeOneTime` are module-scoped. The returned `setRecurring` / `setOneTime` now has a stable identity across renders, so future consumers passing it into `useMemo` deps or into `React.memo`'d child props won't invalidate every parent render.

### WR-02: `defaultStore` in BillingCsvImport ignores `storeNames` prop changes

**Files modified:** `dashboard-web/src/components/BillingCsvImport.tsx`
**Commit:** `6db8aea`
**Applied fix:** Added `useEffect` import and inserted a sync effect that watches `[storeNames, defaultStore, currentRecurring]`. When `defaultStore` is no longer a member of `storeNames` (and isn't the special `'All'` fallback), reset to `storeNames[0] ?? 'All'`. The effect ALSO applies the CR-01 recompute (`findMatchingRecurring` against the new store) on existing preview rows, preventing a second silent-store-change path from reintroducing CR-01's double-add risk. Dep `currentRecurring` is included because the recompute branch reads it.

### WR-03: Double re-render on every billing write

**Files modified:** `dashboard-web/src/lib/hooks/useBillingRecurring.ts`, `dashboard-web/src/lib/hooks/useBillingOneTime.ts`
**Commit:** `6a1ae09`
**Applied fix:** Added a `selfWritePending = useRef(false)` to each hook. In `persist`, set the flag to `true` immediately before calling `writeRecurring(next)` / `writeOneTime(next)`. The custom-event dispatch inside `safeWrite` is synchronous, so the hook's own listener observes the flag on the same call stack, clears it, and skips the redundant `setRecurring(readRecurring())` / `setOneTime(readOneTime())`. The self-bounce — which produced two distinct re-renders outside React event-handler boundaries (e.g. from a Promise callback in the CSV import flow) — is suppressed. Cross-hook re-reads (the one-time listener responding to a recurring write or vice versa) are intentionally unaffected, since the shared-event channel is the entire point of having both hooks listen to `'roas-billing-changed'`.

### WR-04: `useCampaignAttribution` retypes `analyzeAttributionForAdSet` return implicitly via `ReturnType`

**Files modified:** `dashboard-web/src/lib/hooks/useCampaignAttribution.ts`
**Commit:** `2be3568`
**Applied fix:** Imported `AttributionAnalysis` as a type-only import from `@/lib/attributionAnalysis` (alongside the existing value import of `analyzeAttributionForAdSet`). Replaced both occurrences of `ReturnType<typeof analyzeAttributionForAdSet>` (the hook's return type annotation and the `new Map<...>` allocation inside the second `useMemo`) with the explicit `AttributionAnalysis | null`. The hook's published contract and the AdSetTable's prop type (`Map<string, AttributionAnalysis | null>`) now reference the same named type, so a future change to `analyzeAttributionForAdSet`'s return shape will surface as a TypeScript error at the hook boundary rather than silently propagating.

### WR-05: `useCampaignTrueRevenue` dep list relies on destructure stability

**Files modified:** `dashboard-web/src/lib/hooks/useCampaignTrueRevenue.ts`
**Commit:** `96e65f3`
**Applied fix:** Added an "IMPORTANT — `localRange` reference-equality contract" paragraph to the hook's JSDoc, with a concrete do/don't example showing that `setLocalRange({ from, to })` is the required pattern and the mutating `setLocalRange(prev => { prev.from = ...; return prev; })` shape would silently break invalidation. Pure docstring change — no runtime effect — but locks down the contract against a future regression that the linter can't catch (it sees `localRange` as a dep and is satisfied; the failure mode is reference equality at runtime).

The review also noted that the destructure pattern is fragile if a future maintainer reads `opts.newField` directly without destructuring. The current code already destructures all seven fields at the top of the hook with each appearing in the dep array, so no code change was required — the docstring is the right intervention.

## Skipped Issues

None — all 6 in-scope findings were applied cleanly.

## INFO findings (out of scope this iteration)

The following Info-tier findings from REVIEW.md were intentionally NOT touched this run (per `fix_scope=critical_warning`):

- IN-01: `info` variable shadowing in `CampaignsTableRow`
- IN-02: `persist` identifier overloaded across both billing hooks
- IN-03: `parse()` and `handleFile()` duplicate the `parseShopifyBillsCsv` + `buildPreview` chain in `BillingCsvImport`
- IN-04: `TONE_BG` triplicated across `CampaignsTable`, `CampaignsTableRow`, `AdSetTable` (sanctioned by PATTERNS.md)

Re-run with `fix_scope=all` if these should be addressed.

## Verification record

After each fix:
- `cd dashboard-web && npm run build` — exit 0, 12 static routes generated, no TypeScript errors
- `cd dashboard-web && npm run test` — exit 0, 84/84 vitest tests passing across 8 test files

No fix triggered the rollback path. All commits made from an isolated worktree (`gsd-reviewfix/04-76976`) and will be fast-forwarded onto `main` by the orchestrator's cleanup tail.

---

_Fixed: 2026-05-19T01:24:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
