# Phase 4: Component Decomposition — Context

**Gathered:** 2026-05-18
**Status:** Ready for planning (existing 04-PLAN.md must be replanned to honor decisions below)
**Source:** User conversation + existing 04-PLAN.md (pre-context) + ROADMAP.md "Phase 4: Component Decomposition" + .planning/codebase/CONVENTIONS.md + STACK.md

<domain>
## Phase Boundary

פיצול שלוש קומפוננטות React שמנות (`CampaignsTable.tsx` 1740 שורות, `CampaignDrawer.tsx` 1443 שורות, `BillingSettings.tsx` 1328 שורות — סה"כ 4511) למודולים ממוקדים של עד ~500 שורות, עם hooks חדשים שמרכזים לוגיקה לא-טריוויאלית. ה-test suite של Phase 2 (84 tests) הוא רשת הביטחון מול regression.

**In scope:**
- פיצול `CampaignsTable.tsx` → shell + `CampaignsTableRow` + `useCampaignTrueRevenue` + `useCampaignAttribution` (4 קבצים)
- פיצול `CampaignDrawer.tsx` → shell + `AttributionAnalysisPanel` + `MetaShopifyReconciliation` + `ProductChannelBreakdown` + `AdSetTable` (5 קבצים)
- פיצול `BillingSettings.tsx` → shell + `useBillingRecurring` + `useBillingOneTime` + `BillingCsvImport` (4 קבצים)
- שמירה byte-identical של 3 חלקי לוגיקה קריטיים: `trueRevenueByKey` memo, `attributionByAdSet`/`dailyMetaByAdSet` memos, Pearson r + lag detection
- `npm run build` + `npm run test` עוברים אחרי כל task (84 tests של Phase 2 הם הגנת הregression)

**Out of scope:**
- כתיבת tests חדשים לקבצים שנוצרים (D-03 — הפיצול הוא מכני, ה-tests של Phase 2 מכסים את ה-helpers ב-`lib/`)
- שינוי לוגיקה (refactor only, no behavior change) — UI, רוויות, חישובים, סדר DOM — הכל זהה לפני ואחרי
- ארגון חדש של תיקיית `components/` ל-subdirs פר parent (D-02 — נשארים flat)
- העברה של כל ה-hooks הקיימים — הם לא קיימים, פאזה זו יוצרת את הראשונים (D-01 קובע convention עתידי)
- Visual regression tooling (Playwright/Storybook) — overkill ל-refactor פנימי
- ה-3 קומפוננטות הגדולות אחרות שלא בליסט (Dashboard, ProductsTable, AdsDrawer וכו') — phase 4 הוא רק שלושת ה-1300+ liners

</domain>

<decisions>
## Implementation Decisions

### File Organization

- **D-01:** **Hooks חדשים חיים תחת `dashboard-web/src/lib/hooks/`** (תיקייה חדשה — לא קיימת היום, אין hooks בפרויקט בכלל). זה קובע convention לכל ה-hooks העתידיים בפרויקט: phases 5/6/7 שיוסיפו hooks חדשים שמים אותם שם.
- **D-02:** **Sub-components נשארים flat ב-`dashboard-web/src/components/`** — בלי subdirs פר-parent. תואם את ה-convention הקיים (כל ~30 הקבצים שטוחים שם). שינוי ל-subdirs היה דורש העברה של `CampaignDrawer.tsx` / `BillingSettings.tsx` / `CampaignsTable.tsx` עצמם פנימה ועדכון imports בכל האפליקציה — לא שווה.

### Regression Confidence

- **D-03:** **Existing tests + build + manual smoke** — לא נכתבים tests חדשים בפאזה זו. הגנת הregression היא:
  1. `npm run build` עובר אחרי כל task (יתפוס TypeScript errors / missing exports)
  2. `npm run test` עובר אחרי כל task (84 tests של Phase 2 מכסים את ה-helpers ב-`lib/` שה-hooks קוראים אליהם)
  3. Manual smoke בסוף: פתיחת dashboard → לעבור בכל 3 הטאבים (Campaigns / Drawer / Billing) → drill-down → לוודא שכלום לא נשבר ויזואלית
- **D-03b:** Hook unit tests (לדוגמה ל-`useCampaignTrueRevenue` — שמכיל את ה-`trueRevenueByKey` memo המורכב) — **נדחה ל-Phase 7 (Observability)** אם regression בפועל יקרה. הסיבה: הפיצול הוא extraction מכני (copy/paste verbatim של `useMemo` בלוקים שכבר עברו validation במשך חודשים בproduction).

### Line Cap Interpretation

- **D-04:** **`≤500 שורות` הוא target רך, לא hard cap.** מותר עד ~600 אם הפיצול הטבעי הבא היה יוצר wrapper מלאכותי. הפואנטה של הphase היא הפחתת cognitive load — לא הקפצה על מספר. אם executor רוצה לחרוג מ-500 הוא חייב לציין בטסק: כמה שורות, איזה seams נשקלו, ולמה אין justifiable seam נוסף. ה-verifier מקבל את הסטייה המתועדת.
- **D-04b:** Success Criterion #1 ב-ROADMAP נשאר "All 3 original components ≤500 lines after refactor" — אם בסוף קובץ מסוים יוצא 540, ה-verifier יסמן בו override כפי שעשה ב-Phase 2 (truth #5, safeDecode preemptive).

### Hebrew RTL Preservation (guardrail, not a true gray area)

- **D-05:** כל ה-Hebrew string literals ב-JSX (`'אמין'`, `'אין המרות'`, `'הוצאה CAD ...'`, וכו') מועברים **verbatim** עם ה-JSX שלהם. אסור לתרגם, לנרמל, או לשנות סדר. Phase 8 (i18n) יטפל בextraction ל-`strings.he.ts` — כאן רק העברה מקובץ לקובץ.

### Decomposition Execution (Claude's Discretion)

- **D-06:** סדר ביצוע ה-10 tasks ופרלליזציה ביניהם — Claude's discretion ל-planner. נטייה: סדרתי (CampaignsTable → CampaignDrawer → BillingSettings) כדי שכל פאזה תוכל לוודא `npm run test` ירוק לפני הבאה, ולא לערבב 3 refactors גדולים במקביל באותו working tree.
- **D-07:** Per-task atomic commits — task אחד = commit אחד. אם executor מגלה הצרכה לפיצול נוסף תוך כדי (D-04), זה task משלו עם commit נפרד.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### ROADMAP + Plan Source
- `.planning/ROADMAP.md` §"Phase 4: Component Decomposition" — original goal, 3-component requirement breakdown, 6 success criteria
- `.planning/phases/04-component-decomposition/04-PLAN.md` — existing plan (pre-context). The new plan should preserve the artifact list + key_links from this file's frontmatter, but reorganize tasks per D-06 and adjust paths per D-01/D-02.

### Coding Conventions (codebase maps)
- `.planning/codebase/CONVENTIONS.md` — TypeScript strict, `type` not `interface`, no `any`, PascalCase components, camelCase helpers, double-colon composite keys, `roas-dashboard:` localStorage prefix, custom event naming `roas-{topic}-changed`
- `.planning/codebase/STACK.md` — Next.js 15 + React 19 + TypeScript strict, Vitest test runner
- `.planning/codebase/ARCHITECTURE.md` — dashboard-web/ vs Apps Script split, no shared code

### Test Safety Net (regression source)
- `.planning/phases/02-foundations/02-VERIFICATION.md` — confirms 84 tests across 8 files all pass; this is the regression floor for Phase 4
- `dashboard-web/src/lib/__tests__/` — 8 test files covering the lib/ helpers that the new hooks will call (analyzeAttribution, orderMatchesCampaign, analyzeProductChannel, computeWindowStability, detectOutlierDays, analyzeAttributionForAd, analyzeAttributionForAdSet, utils)
- `dashboard-web/vitest.config.ts` — Vitest config

### Existing Components (the 3 fat files to split — verbatim source for the refactor)
- `dashboard-web/src/components/CampaignsTable.tsx` (1740 lines) — source for `CampaignsTableRow.tsx` + `useCampaignTrueRevenue.ts` (lines 552-682 verbatim) + `useCampaignAttribution.ts`
- `dashboard-web/src/components/CampaignDrawer.tsx` (1443 lines) — source for `AttributionAnalysisPanel.tsx` + `MetaShopifyReconciliation.tsx` (Pearson r + lag detection) + `ProductChannelBreakdown.tsx` + `AdSetTable.tsx`
- `dashboard-web/src/components/BillingSettings.tsx` (1328 lines) — source for `useBillingRecurring.ts` + `useBillingOneTime.ts` + `BillingCsvImport.tsx`

### Prior phase patterns
- `.planning/phases/02-foundations/02-PLAN.md` — Phase 2 PLAN — established the test infrastructure that Phase 4 leans on
- `.planning/phases/03-ci-cd-apps-script/03-CONTEXT.md` — Phase 3 CONTEXT (most recent decided phase) — establishes the Hebrew + English-technical-terms bilingual convention used in this file

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Phase 2 Vitest harness** (`dashboard-web/vitest.config.ts` + `dashboard-web/src/lib/__tests__/fixtures.ts`): already-deterministic test factories ready to consume if Phase 7 adds hook tests later (D-03b)
- **`AttributionAnalysisPanel` is "already partially separated"** per ROADMAP — the existing CampaignDrawer already has a clear seam around this panel; should be the easiest extraction
- **`pearson` + `pearsonWithLag` functions** inside CampaignDrawer can be hoisted to `MetaShopifyReconciliation.tsx` as named exports (per existing 04-PLAN.md artifacts list — confirmed valid)
- **`analyzeAttribution`** (in `src/lib/attributionAnalysis.ts` — Phase 1) is the pure function that `useCampaignAttribution` will memoize; do NOT re-implement, just consume via Map memo

### Established Patterns
- **Flat `components/` directory:** ~30 components already share one dir; D-02 keeps this. New sub-components add ~6-7 more files to the same dir (~37 total) — manageable.
- **Pure-helper-in-`lib/` pattern:** `attributionAnalysis.ts`, `ordersAttribution.ts`, `cloudSync.ts`, etc. — D-01 introduces `lib/hooks/` as a parallel home for React hooks; doesn't disturb the pure-helper convention.
- **`useMemo` with stable dep arrays:** the `trueRevenueByKey` memo (CampaignsTable.tsx:552-682) has ~6-8 dependencies — must be lifted verbatim into the hook with the SAME dep array. Dep array drift is the single most likely regression source.
- **`type` not `interface`:** all extracted types (e.g., `TrueRevenueInfo`, `ConfidenceLevel`) follow this.
- **No `any`:** strict TS — extracted hooks must preserve full type narrowing from the source.

### Integration Points
- **`Dashboard.tsx`** is the top-level mount for `CampaignsTable.tsx` and (indirectly) `CampaignDrawer.tsx` + `BillingSettings.tsx`. Import paths in `Dashboard.tsx` do NOT change (D-02: flat `components/` keeps existing imports valid).
- **`cloudSync.ts` STATE_KEYS** — `BillingSettings` uses `roas-dashboard:billing-recurring` + `roas-dashboard:billing-onetime`. The hooks `useBillingRecurring` / `useBillingOneTime` must continue reading/writing the SAME keys + dispatching the SAME custom events (`roas-billing-changed`) so cloudSync still picks them up.
- **No new `STATE_KEYS` entries** — the refactor doesn't add new persistent state, only relocates the logic that reads/writes existing state.

</code_context>

<specifics>
## Specific Ideas

- **`trueRevenueByKey` lines 552-682 must be byte-identical** when lifted to `useCampaignTrueRevenue.ts`. The hook signature should be `useCampaignTrueRevenue({ mode, data, productsResp, ordersAttrResp, productMap, aggregated, localRange })` returning `Map<string, TrueRevenueInfo>` — same shape as the current local Map.
- **`useCampaignAttribution` returns `Map<key, AttributionAnalysis | null>`** — null preserved for cases the current code returns null (don't normalize to undefined).
- **`AttributionAnalysisPanel` already partially separated** — per ROADMAP this is the easiest extraction. Verify the existing partial seam in `CampaignDrawer.tsx` matches the new file's responsibility before duplicating.
- **`MetaShopifyReconciliation` exports `pearson` and `pearsonWithLag`** as named functions (not just the React component). Per existing 04-PLAN.md artifacts list — these may be called from other places later (Phase 5/6 monitoring).
- **`AdSetTable` preserves: sort headers + per-row optimization toggle + drill-into-ads + per-ad-set ROAS Shopify chip** — all 4 behaviors must work identically. The optimization toggle dispatches `roas-campaign-optimized-changed` event; don't break this wiring.
- **`BillingCsvImport` preserves: parse + preview + per-row override + confirm** — the 4-stage CSV flow stays in one component, not split further.

</specifics>

<deferred>
## Deferred Ideas

- **Hook unit tests** (e.g., for `useCampaignTrueRevenue`'s `trueRevenueByKey` invariants) → **Phase 7 (Observability)** if a regression actually shows up. Adding `@testing-library/react` for hook tests is non-trivial — defer until justified.
- **Visual regression tooling** (Playwright screenshots of the 3 tabs before/after refactor) → **not planned** — overkill for an internal refactor. Manual smoke is sufficient at this scale.
- **Per-parent subdirectories under `components/`** (e.g., `components/CampaignDrawer/`) → **deferred indefinitely**. Reconsider only when flat `components/` becomes unwieldy (~50+ files). Phase 4 keeps the convention.
- **Hybrid prefixed naming** (e.g., `CampaignDrawerAttributionPanel.tsx`) → **rejected** — chose flat unprefixed instead (D-02). Don't revisit.
- **Splitting the 3 other large files** (Dashboard, ProductsTable, AdsDrawer if they exceed 500 lines) → **out of scope for Phase 4** (ROADMAP names exactly 3 components). Track separately if they later cross the line.
- **`engines` field in root `package.json`** (Phase 3 code review IN-01) → **Phase 7** (along with other DX hardening recommendations from REVIEW.md).

</deferred>

---

*Phase: 04-component-decomposition*
*Context gathered: 2026-05-18*
