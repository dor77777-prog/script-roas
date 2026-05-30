---
audit: consolidated correctness report (5 parallel audits)
reviewed: 2026-05-23
verdict: PARTIALLY TRUSTWORTHY — 19 CRITICAL findings affect what you see on the dashboard today; 34 HIGH degrade trust further.
sources:
  - revenue-allocation-REVIEW.md (3 CRITICAL, 4 HIGH)
  - multi-mapping-REVIEW.md (2 CRITICAL, 5 HIGH)
  - data-pipeline-REVIEW.md (3 BLOCKER, 6 HIGH)
  - dashboard-fidelity-REVIEW.md (7 BLOCKER, 11 WARNING)
  - health-and-conclusions-REVIEW.md (4 CRITICAL, 8 HIGH)
---

# Consolidated Correctness Audit — 2026-05-23

## Operator's question

> "When I look at the dashboard, am I seeing real data, real conclusions?"

## One-paragraph verdict

**Mostly yes — with material exceptions.** The platform's foundations are well-built: refund algorithm, timezone handling, store isolation, idempotent UPSERTs, and most of the pure algorithms (health score base, cannibalization detection structure, product-centric pivot math) are correct. **But** there are 19 distinct CRITICAL defects where the displayed number, label, or conclusion silently diverges from reality. Five categories of risk:

1. **Refund-heavy products** show inflated ROAS Shopify (refund-only rows silently dropped).
2. **Multi-mapping cohort chips** rank tiny-spend anomalies above mature campaigns and display Pixel ROAS under a "Shopify" label.
3. **The new multi-mapped filter** breaks the summary-card totals (totals stay across full set; rows shrink).
4. **The Meta↔Shopify reconciliation panel** silently excludes TikTok from "dark traffic %" and per-day deltas — misleading on uzoshop's TikTok-active days.
5. **AI Report + daily WhatsApp** have computation drift vs the dashboard (multi-mapping double-counts, store ordering is non-deterministic, in-report Health Score systematically inflated).

The pipeline is solid for today's data volume, but Google Ads pagination is unimplemented (silent data loss above ~10K rows) and cron-live can't recover yesterday's spend if cronDaily fails (24h stale with a freshness chip that lies).

---

## Top 10 findings — ranked by operator decision impact

These are the findings where wrong dashboard data → wrong scale/pause/budget call.

| # | Finding | File:line | Operator impact |
|---|---------|-----------|----------------|
| 1 | **Cohort ranking has no minimum-spend floor.** A $40 / ROAS-12 anomaly scores 3× higher than a $20K / ROAS-4 mature campaign. | `multiMappingCohort.ts:117-124` | Operator told to **scale the anomaly + pause the mature campaign** — opposite of correct. Affects every "leader / weakest" chip + health score adjustment shipped this week. |
| 2 | **Cohort panel "ROAS Shopify" column shows Pixel ROAS.** Drawer wires `conversionValue/spend` (Meta-Pixel claim) into both `roasShopifyByKey` AND `roasShopifyPlatformByKey`. | `CampaignDrawer.tsx:484-510` + `CohortComparisonPanel.tsx:133` | Operator validates the "you are weakest" chip against the displayed ROAS Shopify column — both wrong together. Chip's verdict misrepresents which campaign actually earns Shopify revenue. |
| 3 | **Summary card totals don't match filtered rows when "🔗 multi-mapped only" is ON.** Totals iterate `aggregated` (unfiltered); rows render `aggregatedFiltered`. | `CampaignsTable.tsx:637-660` | Operator sees 5 rows summing to $12K with "Total: $80K". Silently misleading. Exact failure mode of "do I see real data". |
| 4 | **Reconciliation `darkTrafficPercent` + per-day "פער" silently exclude TikTok.** TikTok was added to the chart (Phase 05.7.9) but missed in two numerator sites. | `MetaShopifyReconciliation.tsx:357-362, 780-781` | Uzoshop's TikTok-active day shows "−50% פער" red when reality is −20%. Dark traffic chip overstates. Operator may pause Meta thinking platform under-claim is dire when it's normal. |
| 5 | **Refund-only `products_daily` rows dropped silently** by `net <= 0 && units <= 0` filter. Cross-day refunds disappear from per-campaign ROAS. | `useCampaignTrueRevenue.ts:275` (+ allocator at `campaignProductMap.ts:315`) | Refund-heavy products show inflated ROAS Shopify. Operator scales a campaign that's actually losing money to refunds. |
| 6 | **AI Report multi-mapping section double-counts revenue.** Uses naive `netRevenue × spend share` instead of `allocateProductRevenue` — exactly the double-count the operator was warned about. | `aiReport.ts:1734-1816` | AI says "Scale Meta Campaign A — it owns Product X" when in reality Google has the gclid deterministic attribution. Wrong scale recommendation. |
| 7 | **Daily WhatsApp store ordering is non-deterministic** (`Object.keys()` of unordered Supabase query). | `templateParams.ts:131-139` | Same store appears in `{2}` Monday and `{3}` Tuesday. Operator glancing at the message attributes spend to wrong store. |
| 8 | **cron-live can't refresh yesterday's spend.** Only "today" gets refreshed. If cronDaily fails its 00:05 IL run, yesterday's Meta/Google/TikTok spend stays stale for up to 24h — but freshness chip says "fresh" because cron-live bumps `updated_at` for revenue. | `cronLive.ts:438-672` | Operator looks at yesterday's ROAS, makes a budget decision on 24h-stale spend, and has NO visible warning. |
| 9 | **Cannibalization detector fires NONE when a cohort member is paused mid-range; fires HIGH when one is launched mid-range.** Split-half comparison can't tell "scaled A" from "launched B / paused B". | `cannibalizationDetection.ts:230-355` | Operator's natural flow ("I paused the weak one + scaled the strong one") produces silent false negatives. Conversely, launching an experiment trips false HIGH. |
| 10 | **`isWeakest` chip fires for 2-member cohorts** (no `cohortSize >= 3` guard at the UI layer). Health-score adjustment correctly skips it; UI doesn't. | `multiMappingCohort.ts:235` + `CohortComparisonPanel.tsx:286-296` | Operator sees loud red "אתה החלש" chip on a 2-campaign cohort and pauses the loser when "someone had to be second" is the only reason. |

---

## Findings by audit scope

### Revenue allocation chain
- **3 CRITICAL** all in refund handling: `Math.max(0, ...)` absorbs negative remainder; refund-only rows dropped at two filter sites.
- **4 HIGH:** dailyMeta unfiltered to range; Google-deterministic orders leak to Meta when no Google mapping; line-item revenue is pre-refund; silent failure if API caller forgets `?lineItems=true`.
- **Solid:** refund algorithm (`shopifyRevenueRefunds.ts`), TZ handling, cross-store isolation, deterministic-first design intent, FX consistency for happy path.
- **Operator can trust:** Per-campaign ROAS Shopify for products with no recent refunds, single-platform mappings. **Do not trust** the per-platform column for products where one platform is mapped but the other had the click-id.

### Multi-mapping intelligence (the feature shipped this week)
- **2 CRITICAL:** Ranking has no spend floor; cohort panel ROAS column mislabeled.
- **5 HIGH:** Tie-breaker is a no-op in prod (callers pass same map twice); `isWeakest` fires for 2-cohorts; cannibalization false-NONE/false-HIGH on composition change; LOW cannibalization below DOW noise; product-centric pivot swallows revenue when cohort spend is 0.
- **Solid:** Cross-store isolation, pure functions, test coverage, split-half boundary math, insufficient-data short-circuits.
- **Operator can trust:** The feature exists and runs; **do not trust** the leader/weakest verdict for scale/pause decisions until top fixes land.

### Data pipeline & freshness
- **3 BLOCKER:** Google Ads has no pagination (silent loss >10K rows); cron-live spend-staleness for yesterday/day-before; Shopify Window B truncation on backfills.
- **6 HIGH:** cronDaily throws on platform failure (kills entire run); Meta currency defaults to ILS (3.8× under-conversion risk); FX path drift; dead enrollments code; TikTok pagination off-by-one warn; default range includes incomplete "today".
- **Solid:** Asia/Jerusalem TZ everywhere, Shopify refund algorithm centralized, UPSERTs idempotent, Meta + TikTok + Shopify pagination correct, per-store credential scoping correct.
- **Operator can trust:** Day-level totals for the past 7 days under normal conditions; **do not trust** the freshness chip alone (it bumps from cron-live revenue while spend stays stale).

### Dashboard display fidelity
- **7 BLOCKER:** Multi-mapped filter doesn't update totals; reconciliation excludes TikTok in math + copy says "4 channels"; "Infinity" pill when no positive ROAS days; TodayLive "—" ambiguous (loading vs zero); FreshnessChip uses local TZ; `formatCurrency` returns "−0" for tiny negatives.
- **11 WARNING:** Sort caret claims active column during loading; cohort `effectiveStatus` uses first-seen vs latest; tiny deterministic revenue values look like real ROAS; mismatch in spend sources between table footer and reconciliation panel; etc.
- **Solid:** Per-row money formatting after the `Math.round` fix, sort direction caret, column reorder lock-step, hidden columns preserving totals, multi-mapping chip count, unmapped chip platform filter, range-keyed SWR.
- **Operator can trust:** Per-row numbers in the table; **do not trust** the summary card when multi-mapped filter is on, and don't trust the reconciliation panel's dark-traffic % on TikTok-active days.

### Health Score + AI Report + daily summary
- **4 CRITICAL:** AI Report multi-mapping double-counts; daily WhatsApp store order is non-deterministic; AI Report Health Score table diverges from dashboard; in-report `TrueRevenueInfo` synthesized with malformed type cast.
- **8 HIGH:** Google gets fixed 0.5 trust mult (silently halves all Google scores); ROAS thresholds platform-agnostic; new-campaign trajectory neutral inflates A grade; daily summary send-failures silently dropped; no recipient allowlist; AI top-campaigns ranked by Pixel ROAS; WhatsWorking week comparison includes partial today; multi-mapping store filter heuristic drops orphan mappings.
- **Solid:** Health score weights, grade ladder, insufficient-data gate; attribution analyzer; cpm-vs-ROAS interpretation matrix; AI Report Pixel↔Shopify reconciliation section; daily summary value computations.
- **Operator can trust:** Health Score as relative ranking *within a single platform/store*; **do not trust** cross-platform Health Score comparisons (Google penalized by ~16 points vs Meta for same ROAS), and don't trust the AI Report's in-report Health Score (different from dashboard).

---

## What the operator should NOT trust today (cheat sheet)

| Place in UI | Why not to trust |
|-------------|-----------------|
| **Cohort panel — ROAS Shopify column** | Shows Pixel ROAS (Meta-claimed), not actual Shopify ROAS. Mislabeled. |
| **Cohort panel — leader 🥇 / weakest 🥈 chip** | Ranking dominated by raw ROAS with no spend floor — tiny experiments win over mature campaigns. |
| **CampaignsTable summary cards when multi-mapped filter is ON** | Totals show full dataset; rows show filtered subset. Cards don't update. |
| **Reconciliation panel "Dark Traffic %" + day-table "פער" column** | Silently excludes TikTok from the math. On uzoshop's TikTok days, deltas look dramatically worse than reality. |
| **Health Score on Google PMax campaigns** | Fixed 0.5 trust multiplier halves the score vs equivalent Meta campaigns. Don't compare Google to Meta Health Scores directly. |
| **Health Score on brand-new campaigns (4 active days, $30-$200 spend)** | Trajectory component returns neutral 60 (= +15 weighted), inflating new campaigns to A-grade prematurely. |
| **AI Report — "Top campaigns" list** | Ranked by Pixel-claimed ROAS, not Shopify ROAS. A campaign with great Meta-claimed value and zero Shopify orders sits at the top. |
| **AI Report — "מוצרים משותפים" (multi-mapping section)** | Uses naive spend-share split. Systematically over-credits high-spend campaigns on cross-platform cohorts. |
| **AI Report — in-report Health Score table** | Synthesized from coverage only; lacks window-stability/outlier downgrades. Systematically higher than dashboard. |
| **Daily WhatsApp summary — store position `{2}` vs `{3}` vs `{4}`** | Non-deterministic ordering. Read the Hebrew store name in each block, not the position. |
| **TodayLive orders "—"** | Could mean "still loading" or "zero orders". Indistinguishable. |
| **"Infinity" min-ROAS pill** | Renders literally when no day in the series had positive ROAS. |
| **`-0` cells** | `formatCurrency(-0.4, 0)` returns `"-0"`. Tiny negative values display as `-0` and look like a rendering glitch. |
| **Yesterday's ad spend if cronDaily failed at 00:05 IL** | cron-live cannot recover it. Freshness chip lies (revenue is fresh, spend is 24h stale). |
| **"What's Working" — week-over-week deltas at 11am** | "This week" includes partial today; "last week" is a full 7-day window. Comparison is biased down all morning. |
| **AI Report "wasted day" critical alert at 8am** | "Today" check fires before Shopify revenue catches up. Stale by 11am. |
| **`InsightsPanel` "bottom store"** | No spend floor — a brand new store with $1 spend and $0.50 revenue gets flagged. |

---

## What the operator CAN trust today (cheat sheet)

| Place in UI | Why to trust |
|-------------|-------------|
| **Per-row ROAS, spend, conversion value in CampaignsTable** | Cross-validated against drawer; same source; same filter. |
| **ROAS Shopify column on single-platform mapped products with no recent refunds** | Allocator behaves correctly on this happy path. |
| **Shopify refund handling (cross-day, line-item-level)** | Centralized algorithm, gap-closure-08 invariants tested. |
| **Currency conversion for happy-path days** | Frankfurter rates per business day; CAD source-of-truth. |
| **Asia/Jerusalem timezone everywhere** | Consistently applied at fetch + write + read; off-by-one explicitly tested. |
| **Daily summary values per store (when ordering doesn't matter)** | Each individual number is correct; only positions can drift across days. |
| **AI Report totals** | Same source as CampaignsTable footer; will match for same range/filter. |
| **Effective_status freshness (within 10 min)** | cron-live correctly refreshes all 3 stores × all 3 platforms per cycle. |
| **Health Score as relative ranking within a single platform** | Weights sum to 1; grade ladder monotonic; insufficient-data gate prevents F-grade on early campaigns. |
| **Hidden columns / column reorder** | Header + body iterate same `columnOrder`; totals correctly include hidden columns. |
| **Multi-mapping chip count `🔗 +N`** | Correctly excludes self. |
| **Unmapped chip `🏷️ לא ממופה`** | Correctly excludes Google (per spec). |
| **Range-keyed SWR caching** | Date range change triggers fresh fetch; no stale-cache shadow. |
| **Drawer ROAS == row ROAS for the same campaign** | Same source data, same filter. |
| **AI Report "Pixel ↔ Shopify reconciliation" section** | Highest-quality section in the report; honest about per-campaign trust. |

---

## Recommended fix order (by ROI = operator-impact ÷ effort)

### Tier 1 — Ship these first (cheap + high impact, all <2h each)

1. **Fix summary card totals to track filter** (FIND-01 display). `CampaignsTable.tsx:637-660` swap `aggregated` → `aggregatedFiltered`. Single-line fix + dep array update.
2. **Add TikTok to `darkTrafficPercent` + per-day delta** (FIND-02 display). Two-line fix in `MetaShopifyReconciliation.tsx`. Add TikTok `<th>`+`<td>` for visibility.
3. **Gate `isWeakest` chip on cohortSize >= 3** (HIGH-02 multi-mapping). One-line fix at `multiMappingCohort.ts:235`.
4. **Sort daily summary store ordering** (CR-02 health/conclusions). `.sort((a,b) => storeName.localeCompare)` at `templateParams.ts:131`.
5. **Fix `formatCurrency(-0)` and `Infinity` literals** (FIND-04, FIND-07 display). Guard in `utils.ts:8-20` + `HeroOverview.tsx:389-392`.
6. **Distinguish "loading" vs "zero" in TodayLive** (FIND-05 display). Use skeleton/loading text instead of `—`.

### Tier 2 — Material correctness improvements (medium effort, high impact)

7. **Cohort ranking minimum-spend floor** (CRITICAL-02 multi-mapping). Bayesian shrinkage at `multiMappingCohort.ts:117-124`. ~15 lines + 3 tests.
8. **Cohort panel: thread real Shopify ROAS into drawer** (CRITICAL-01 multi-mapping). Compute `roasShopifyByKey` and `roasShopifyPlatformByKey` from real allocator output in `CampaignDrawer.tsx:484-510`. ~25 lines.
9. **Wire `allocateProductRevenue` into AI Report multi-mapping section** (CR-01 health/conclusions). `aiReport.ts:1734-1816` — replace naive split with real allocator. ~30 lines.
10. **Fix refund-only row drop in revenue allocation** (CR-02 + CR-03 revenue). Change `<= 0` to `=== 0 && === 0` filters at `useCampaignTrueRevenue.ts:275` + `campaignProductMap.ts:315`. Add regression test for cross-day refund.
11. **Cannibalization: composition-change detection** (HIGH-03 multi-mapping). Add `'composition_changed'` verdict when cohort members joined/left mid-range. ~40 lines.

### Tier 3 — Pipeline hardening (larger effort, prevents future incidents)

12. **Google Ads pagination** (CR-01 pipeline). Add `nextPageToken` loop + safety cap. ~20 lines but unblocks growth.
13. **cron-live: refresh yesterday + day-before spend, OR add `*_spend_updated_at` columns + freshness chip awareness** (CR-02 pipeline). Architectural — choose option.
14. **cron-daily soft-fail per platform** (HG-01 pipeline). Wrap each `step.run('fetch-tiktok'/'fetch-meta'/'fetch-google')` in try/catch with zero-spend sentinel — mirror cron-live's pattern.
15. **WhatsApp recipient allowlist** (HR-05 health/conclusions). Env-var allowlist enforced in `sendWhatsAppTemplate`.
16. **WhatsApp send-failure visibility** (HR-04 health/conclusions). Throw on `recipientsFailed.length > 0` so Inngest marks run failed.

### Tier 4 — Calibration improvements

17. Per-platform ROAS thresholds in Health Score (HR-02).
18. Per-platform trust modulator for Google PMax (HR-01).
19. New-campaign trajectory weight renormalization (HR-03).
20. Per-store COGS rates (MR-01).
21. Cannibalization LOW threshold raise + DOW-rotation guard (HIGH-04 multi-mapping).
22. Cohort panel show paused peers dimmed (FIND-22 display).
23. Cross-view consistency disclosure on AI Report Health Score (CR-03 disclaimer).

### Tier 5 — Code quality / dedup (low urgency)

24. Lift `STORE_NAMES`, `STORES_WITH_TIKTOK` to single source (MD-01, MD-02 pipeline).
25. Lift `pearson` to shared `lib/stats.ts` (LR-02 health/conclusions).
26. Hoist `isStatusOff` to shared helper (LR-06 health/conclusions).
27. Lock `roasShopifyPlatformByKey` real wiring in both production callers (HIGH-01 multi-mapping).

---

## Severity totals

| Severity | Revenue | Multi-mapping | Pipeline | Display | Health/AI | Total |
|----------|---------|--------------|----------|---------|-----------|-------|
| CRITICAL/BLOCKER | 3 | 2 | 3 | 7 | 4 | **19** |
| HIGH/WARNING     | 4 | 5 | 6 | 11 | 8 | **34** |
| MEDIUM           | 5 | 6 | 7 | 0 | 9 | **27** |
| LOW/INFO         | 3 | 4 | 7 | 6 | 6 | **26** |
| **Grand total**  |   |   |   |   |   | **106** |

---

## Source documents (full evidence)

All findings cite file:line evidence and propose fixes. Full reports:
- [revenue-allocation-REVIEW.md](.planning/audit-2026-05-23/revenue-allocation-REVIEW.md)
- [multi-mapping-REVIEW.md](.planning/audit-2026-05-23/multi-mapping-REVIEW.md)
- [data-pipeline-REVIEW.md](.planning/audit-2026-05-23/data-pipeline-REVIEW.md)
- [dashboard-fidelity-REVIEW.md](.planning/audit-2026-05-23/dashboard-fidelity-REVIEW.md)
- [health-and-conclusions-REVIEW.md](.planning/audit-2026-05-23/health-and-conclusions-REVIEW.md)

_Reviewer: Claude (5 parallel adversarial audits, 2026-05-23)_
