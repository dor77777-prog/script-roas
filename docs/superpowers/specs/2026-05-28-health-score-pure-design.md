# Health Score — Pure Function of Data (Remove Operator Flags)

**Date:** 2026-05-28
**Status:** Approved (brainstorming complete, pending plan)
**Branch:** `health-score-pure-2026-05-28`

## Goal

Make the Campaign Health Score a pure function of objective campaign data. Remove the two flags that allow UI state (operator mark) and operational status to bias the score: `optimized` (+15) and `isCurrentlyOff` (−30). Both stay as visual annotations (existing badges/chips) but no longer influence the score number.

## Why

The operator observed that ticking the "סמן כאופטימיזציה פעילה" checkbox on a campaign row changes the displayed Health Score for that row (up or down depending on the mark direction). Investigation revealed this is intentional design — `applyOperatorAdjustment` adds `+15` for `optimized=true` and `−30` for `isCurrentlyOff=true` AFTER the weighted-sum (`campaignHealthScore.ts:352-371`).

Conflict: the operator's mental model is "Health Score is an objective metric from data; checkbox state shouldn't change it." Mixing operator metadata into the score makes the metric subjective and creates the appearance of a bug (especially because the same operator may later wonder why their own toggle changed history).

## The change

### Removed from the score
- `optimized: boolean` input — no longer affects score.
- `isCurrentlyOff: boolean` input — no longer affects score.
- `applyOperatorAdjustment(...)` function — deleted.
- `operatorAdjustment: number` field on `CampaignHealth` output — deleted.
- `operatorAdjustmentReasons: string[]` field on `CampaignHealth` output — deleted.

### Kept (visual annotations only)
- The "סמן כאופטימיזציה פעילה" checkbox on each row — keeps `optimized: Set<string>` state, keeps the cloud-sync helper, keeps the row badge "✓ אופטימיזציה" (or whatever the current visual is).
- The "currently off" / "off-chip" indicator on each row — keeps the badge derived from `isCampaignOff(...)`.
- These are passive annotations of operator action / status, NOT inputs to the score.

### Score formula after change
The score is now the **weighted sum** of the 4 components (profitability 40 / volume 15 / trajectory 25 / attribution 20) plus the existing cohort adjustment (`applyCohortAdjustmentOnce`). That cohort adjustment stays because it's derived from data (cohort rank, cannibalization risk), not operator metadata.

### Inputs to `computeCampaignHealth` after change
```ts
type HealthScoreInputs = {
  aggregated: Aggregated;
  trueRevenueInfo: TrueRevenueInfo | undefined;
  cpmRoasAnalysis: CpmRoasAnalysis | undefined;
};
```
Two fields dropped (`optimized`, `isCurrentlyOff`).

## Files affected (~8)

1. `dashboard-web/src/lib/campaignHealthScore.ts` — remove `applyOperatorAdjustment`, drop fields from `HealthScoreInputs` + `CampaignHealth`, remove the function call from `computeCampaignHealth`.
2. `dashboard-web/src/lib/__tests__/campaignHealthScore.test.ts` — drop / update every test that asserts the +15 / −30 adjustment behavior.
3. `dashboard-web/src/components/CampaignsTable.tsx` — stop passing `optimized` and `isCurrentlyOff` into `computeCampaignHealth` (lines around 770-779). The `optimized` Set + `isCampaignOff(...)` helper stay (they still drive the row badges).
4. `dashboard-web/src/components/CampaignsTableRow.tsx` — if it reads `health.operatorAdjustment` or `health.operatorAdjustmentReasons`, drop those reads.
5. `dashboard-web/src/components/HealthScoreBadge.tsx` — drop any rendering of `operatorAdjustment` reasons.
6. `dashboard-web/src/components/HealthScorePanel.tsx` — drop the "operator adjustments" section if present.
7. `dashboard-web/src/lib/aiReport.ts` — drop any reference to `operatorAdjustment` in the AI-report assembly.
8. `dashboard-web/src/lib/__tests__/aiReportTikTokStatus.test.ts` — update if it asserts the operator-adjusted score.

## Anti-misleading guarantees

- **No new test infrastructure.** All updates land on existing test files. Net test count may DROP (deleted +15/-30 cases) — acceptable; we're removing behavior, not adding it.
- **No silent score drift.** The cohort adjustment (`applyCohortAdjustmentOnce`) stays untouched. Existing campaigns with cohort context still get the same cohort delta they get today; only the operator/off adjustments are zeroed.
- **Backward compat for stored marks.** The `campaign-optimized` cloud-sync key + the `optimized` Set state stay. Existing operator marks aren't deleted — they just stop influencing the score going forward.
- **Visible labels stay.** "אופטימיזציה" badge, "currently off" chip — both keep rendering exactly as today; they were never tied to the score field directly.

## Magnitude of behavior change

Every campaign currently marked as `optimized` will show a score **15 points lower** than today (immediately after deploy). Every campaign currently flagged `isCurrentlyOff` will show a score **30 points higher**. Combinations: ±15 / ±30 / ±45 depending on flag state. These are one-time shifts; they reflect the score finally becoming an objective measure of data.

## Out of scope

- Re-weighting the 4 base components (40/15/25/20 stays).
- Changing the cohort adjustment logic.
- Removing the badges / cloud sync of operator marks.
- Renaming the score (still "Health Score").

## Effort

~1-2 hours TDD: drop function + fields → update tests → update component consumers → docs.
