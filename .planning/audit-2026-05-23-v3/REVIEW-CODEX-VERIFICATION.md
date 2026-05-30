# Codex Cross-Verification of v3 Opus Findings
Date: 2026-05-23 · Cross-verifier: codex-cli / GPT-5

## Verdict summary
| Finding | Verdict | Note (1 line) |
|---|---|---|
| CRIT-1 (O3-CR-01) | VERIFY | `aggregateByStore` calls `aggregate()` with singleton store lists, so `All` billing rows are charged once per store. |
| CRIT-2 (O2-CR-01) | VERIFY-WITH-CAVEAT | Double-count is real; fix must also stop using broad `facebookShare` for chips, not only segment widths. |
| CRIT-3 (O2-CR-02) | VERIFY | `dailySeries` drops missing calendar days and `RoasChart` uses categorical labels. |
| CRIT-4 (O2-CR-03) | VERIFY-WITH-CAVEAT | Sparkline is not true net; fix needs daily fees/fixed allocation or no net sparkline. |
| CRIT-5 (O4-CR-01) | VERIFY | `cadFor()` and inline TikTok FX can throw after earlier upserts in `persist-batch`. |
| HIGH-1 (O1-H-1) | REJECT | `todayInIsrael()` is recomputed on every render; a 30s ticker forces re-render after midnight. |
| HIGH-2 (O1-H-2) | VERIFY | RTL input uses logical `pe-9` but icon is physically `right-2.5`. |
| HIGH-3 (O1-H-3) | VERIFY | Custom date inputs forward raw values, with no `max`, empty guard, or range normalization. |
| HIGH-4 (O2-HI-01) | VERIFY | Column visibility helpers write `{ hidden }` only and drop `order`. |
| HIGH-5 (O2-HI-02) | VERIFY | Button `onMouseLeave` closes before cursor can cross the `mt-2` gap to the popover. |
| HIGH-6 (O2-HI-03) | VERIFY | Composite sort key lets secondary ROAS/spend change the primary ROAS rank. |
| HIGH-7 (O2-HI-04) | VERIFY | COGS sparkline recomputes with global 0.25 instead of row COGS. |
| HIGH-8 (O2-HI-05) | VERIFY | Missing store/date entries are filled as 0 and chart has `connectNulls`. |
| HIGH-9 (O3-HI-01) | VERIFY | MTD uses `r.cogs`; projection subtracts global `COGS_RATE_OF_REVENUE`. |
| HIGH-10 (O3-HI-02) | VERIFY | Last-7 baseline is `[today-6, today]`, so it includes the incomplete current day. |
| HIGH-11 (O3-HI-03) | VERIFY | `revenueGrowthPct` is explicitly `Infinity` when early revenue is 0 and late revenue positive. |
| HIGH-12 (O4-HI-01) | VERIFY-WITH-CAVEAT | Rejections fail the whole batch; additionally returned Supabase `{ error }` objects are not checked. |
| HIGH-13 (O4-HI-02) | VERIFY | EOD runs 5 minutes after cron-daily; empty `data_daily` renders the no-data template. |
| HIGH-14 (O4-HI-03) | VERIFY | Regex-only date validation accepts impossible dates; `Date.UTC` normalizes them downstream. |

## Detailed verdicts
### CRIT-1 (O3-CR-01)
**Verdict:** VERIFY  
**Reasoning:** `aggregate()` derives `storeNames` from the rows and passes them into `billingForRange` (`analytics.ts:148-159`). `aggregateByStore()` buckets rows by store, then calls `aggregate(list, range)` per singleton list (`analytics.ts:212-220`). Meanwhile `billingForRange()` handles `r.store === 'All'` by charging once and splitting across `storeNames.length` (`billing.ts:196-206`). In a singleton per-store aggregate, each store gets the full `All` amount because `storeNames.length === 1`; the global aggregate gets the amount once split across all stores.  
**Fix correctness:** Correct. The per-store path needs a full in-scope store list or pre-split fixed-cost attribution before singleton aggregation.

### CRIT-2 (O2-CR-01)
**Verdict:** VERIFY-WITH-CAVEAT  
**Reasoning:** The breakdown buckets every order by raw source first (`attributionAnalysis.ts:1091-1099`), then also increments Facebook when `source` is meta or `fbclidPresent === true` (`attributionAnalysis.ts:1101-1108`). The renderer separately subtracts `facebookOrders`, Google by-source buckets, TikTok, and direct from `total` (`ProductChannelBreakdown.tsx:41-49`) and renders widths from those counts (`ProductChannelBreakdown.tsx:95-100`). A `google-paid` order with `fbclidPresent` is therefore in both `fb` and `google`, and residual `other` is clamped away.  
**Fix correctness:** Option B is directionally right for the bar, but the recommendation chips still use `breakdown.facebookShare` (`ProductChannelBreakdown.tsx:50, 104-118`), which is based on the broad OR count. Fix both display counts and share/chip logic if the intended chart is mutually exclusive source attribution.

### CRIT-3 (O2-CR-02)
**Verdict:** VERIFY  
**Reasoning:** `dailySeries()` only creates entries when a row exists for that date (`analytics.ts:232-248`) and returns `Array.from(map.values())` (`analytics.ts:256`), so absent calendar days disappear. `RoasChart` maps those rows to `dateLabel` strings (`RoasChart.tsx:50-53`) and uses `XAxis dataKey="dateLabel"` (`RoasChart.tsx:88-94`), a categorical axis with evenly spaced remaining points.  
**Fix correctness:** Correct. Thread the selected range into `dailySeries`, fill calendar dates, use `null` for missing values, and render with `connectNulls={false}`.

### CRIT-4 (O2-CR-03)
**Verdict:** VERIFY-WITH-CAVEAT  
**Reasoning:** The card displays `current.trueNetProfit` (`KpiCards.tsx:179-188`), but the sparkline data is `revenue - spend - cogs` (`KpiCards.tsx:109-113`). It excludes transaction fees and fixed costs, while `aggregate()` defines `trueNetProfit = revenue - spend - cogs - transactionFees - fixedCosts` (`analytics.ts:160-176`).  
**Fix correctness:** The recommended fix is correct only if daily fees and fixed costs are allocated consistently. If that allocation is not available, removing the net-profit sparkline is safer than showing a different metric.

### CRIT-5 (O4-CR-01)
**Verdict:** VERIFY  
**Reasoning:** Inside `persist-batch`, inline TikTok spend conversion calls `getFxRate()` directly (`cronDaily.ts:396-408`), and `cadFor()` also calls `getFxRate()` without catch (`cronDaily.ts:440-451`). `getFxRate()` throws on non-OK or missing rates (`fx.ts:57-70`). The same step writes `data_daily` first (`cronDaily.ts:453-483`) and `products_daily` next (`cronDaily.ts:485-513`) before building campaign/ad payloads that await `cadFor()` (`cronDaily.ts:550-600`, `679-737`, `808-823`). A later FX failure leaves earlier writes committed.  
**Fix correctness:** Correct. The sentinel/omit-field approach matches the desired "preserve prior CAD value" behavior, but the inline TikTok spend conversion at `396-408` also needs the same policy or a deliberate all-or-nothing decision before any DB write.

### HIGH-1 (O1-H-1)
**Verdict:** REJECT  
**Reasoning:** `today` is not state initialized once at mount; it is a render-local `const today = todayInIsrael()` (`TodayLive.tsx:188`). The component has a `setInterval` that updates `now` every 30 seconds (`TodayLive.tsx:182-185`), forcing a re-render. After midnight, the next tick recomputes `today`, changing the SWR keys (`TodayLive.tsx:196-227`).  
**Fix correctness:** No fix needed for the claimed mount pin. A tighter midnight-specific timer would reduce the maximum 30-second lag, but the stated stale-all-night bug is not present.

### HIGH-2 (O1-H-2)
**Verdict:** VERIFY  
**Reasoning:** The search icon is positioned with physical `right-2.5` (`ProductPickerModal.tsx:279-280`), while the input reserves logical end padding via `pe-9` (`ProductPickerModal.tsx:281-287`). In RTL, logical end is left, so the right-side icon overlaps the text start/cursor area.  
**Fix correctness:** Correct: use `end-2.5` or align the reserved padding with the physical side.

### HIGH-3 (O1-H-3)
**Verdict:** VERIFY  
**Reasoning:** Filters custom date inputs directly forward `e.target.value` into `filters.range.from` and `.to` (`Filters.tsx:148-163`). There is no empty-value guard, `max={today}`, future-date clamp, or inverted-range swap. `CampaignsTable` has those guards locally (`CampaignsTable.tsx:1083-1114` in the cited range).  
**Fix correctness:** Correct. Extract and reuse the guarded date-range helper.

### HIGH-4 (O2-HI-01)
**Verdict:** VERIFY  
**Reasoning:** `toggleCampaignsColumnHidden()` reads `cur` but writes `const next = { hidden: ... }` (`campaignsColumnPrefs.ts:223-232`). `restoreAllCampaignsColumns()` writes `const next = { hidden: [] }` (`campaignsColumnPrefs.ts:237-240`). Neither preserves `cur.order`.  
**Fix correctness:** Correct. Use `{ ...cur, hidden: ... }` in both helpers.

### HIGH-5 (O2-HI-02)
**Verdict:** VERIFY  
**Reasoning:** The trigger closes the popover immediately on `onMouseLeave` (`MetricHelp.tsx:45-50`). The popover is rendered below with `top-full mt-2` (`MetricHelp.tsx:63-76`), so there is a physical gap; leaving the 16x16 trigger unmounts the popover before its `onMouseEnter` can fire.  
**Fix correctness:** Correct. A short close-delay or removing the gap fixes the hover transit.

### HIGH-6 (O2-HI-03)
**Verdict:** VERIFY  
**Reasoning:** The intra-platform sort computes `roasShopify * 1e6 + roasShopifyPlatform * 1e3 + spend` (`CohortComparisonPanel.tsx:261-264`). Any secondary term of 1,000 ROAS contributes 1,000,000, equal to +1.0 primary ROAS; spend can also cross tie boundaries.  
**Fix correctness:** Correct. Use explicit lexicographic comparisons.

### HIGH-7 (O2-HI-04)
**Verdict:** VERIFY  
**Reasoning:** Sparkline COGS is recomputed as `r.revenue * COGS_RATE_OF_REVENUE` (`KpiCards.tsx:112`) and imports the global constant (`KpiCards.tsx:15`). The aggregate path uses row COGS when present and only backfills per-store rates for legacy rows (`analytics.ts:131-136`).  
**Fix correctness:** Correct. Use row `r.cogs` with the same `hasCogs` fallback policy as `aggregate()`.

### HIGH-8 (O2-HI-05)
**Verdict:** VERIFY  
**Reasoning:** `dailySeries()` explicitly fills missing store entries with 0 (`analytics.ts:249-254`). `RoasChart` renders those values as normal numeric points and also has `connectNulls` enabled (`RoasChart.tsx:153-164`). A missing store-day becomes a ROAS=0 point, not a gap.  
**Fix correctness:** Correct. Missing store/day values should be `null`, and the chart should not connect nulls.

### HIGH-9 (O3-HI-01)
**Verdict:** VERIFY  
**Reasoning:** Month-to-date net accumulates actual `r.cogs` (`insights.ts:470-479`), while projected net subtracts `projectedRev * COGS_RATE_OF_REVENUE` (`insights.ts:497-501`). That mixes per-store stored COGS with the global 25% projection rate.  
**Fix correctness:** Correct. Deriving an observed COGS rate from a stable recent window is better than reverting to the global constant.

### HIGH-10 (O3-HI-02)
**Verdict:** VERIFY  
**Reasoning:** The seven-day baseline starts at `addDays(today, -6)` and includes rows `<= today` (`insights.ts:481-491`). That is a seven-calendar-day inclusive window ending today, so the current incomplete day is part of the daily average.  
**Fix correctness:** Correct. Use completed days only, e.g. `[today-7, today-1]`.

### HIGH-11 (O3-HI-03)
**Verdict:** VERIFY  
**Reasoning:** Both the composition-changed branch and normal branch emit `Infinity` when early revenue is 0 and late revenue is positive (`cannibalizationDetection.ts:428-431`, `439-444`). That value is stored in `metrics.revenueGrowthPct` (`cannibalizationDetection.ts:488-497`).  
**Fix correctness:** Correct. Emit `null` or a bounded sentinel and update consumers to render it explicitly.

### HIGH-12 (O4-HI-01)
**Verdict:** VERIFY-WITH-CAVEAT  
**Reasoning:** The status refresh uses `await Promise.all(platformEnrollments.map(... update ...))` (`cronLive.ts:1017-1031`). A rejected update promise fails the whole step. Caveat: Supabase query failures commonly resolve as `{ error }`; this code does not inspect those results at all, so some failed updates may be silently ignored rather than dead-lettering.  
**Fix correctness:** Use `Promise.allSettled` or a `for...of` loop, but also check each Supabase result's `.error` and log it.

### HIGH-13 (O4-HI-02)
**Verdict:** VERIFY  
**Reasoning:** cron-daily is scheduled at `TZ=Asia/Jerusalem 5 0 * * *` (`cronDaily.ts:960-966`). WhatsApp EOD is scheduled at `TZ=Asia/Jerusalem 10 0 * * *` (`cronWhatsapp.ts:89-99`). If `data_daily` has no rows, `buildStoreSummary()` returns `null` (`summary.ts:131-132`) and `buildTemplateParameters()` renders the no-data totals string (`templateParams.ts:141-156`). That leaves only five minutes between the producer and the notification reader.  
**Fix correctness:** Correct. Moving EOD later is the simpler fix; invoking/synchronizing the daily job first is stronger but more coupled.

### HIGH-14 (O4-HI-03)
**Verdict:** VERIFY  
**Reasoning:** The backfill route's `isDate()` is regex-only (`backfill/route.ts:77-78`). It then relies on lexicographic comparisons for boundary and orientation (`backfill/route.ts:93-110`). `eventBackfill` parses the parts through `Date.UTC(fy, fm - 1, fd)` (`eventBackfill.ts:140-146`), which normalizes out-of-range months/days instead of rejecting them. `manual-overrides` has the same regex-only date validator (`manual-overrides/route.ts:54-70`).  
**Fix correctness:** Correct. Add a UTC round-trip validation in both routes.

## Additional bugs Opus missed
### NEW-1: KpiCards still labels COGS as fixed 25%
- **File:** `dashboard-web/src/components/KpiCards.tsx:168`
- **Severity:** MEDIUM
- **What:** The COGS card renders `labelSuffix="(25%)"` even though live rows may use per-store `${STORE}_COGS_RATE` and legacy fallback can vary by store.
- **Why it matters:** The displayed card can show a correct COGS value with a wrong formula label, undermining operator trust and making per-store calibration look ignored.
- **Recommended fix:** Remove the suffix or render a dynamic label such as "לפי חנות" / "mixed rates" when the aggregate spans stores.

### NEW-2: forecastMonthEnd "net" omits fees and fixed costs entirely
- **File:** `dashboard-web/src/lib/insights.ts:479`
- **Severity:** HIGH
- **What:** `mtdNet = mtdRev - mtdSpend - mtdCogs`, and projected net uses the same partial model (`insights.ts:501`). Elsewhere the dashboard's net profit is true net: revenue minus spend, COGS, transaction fees, and fixed costs.
- **Why it matters:** Goal/forecast surfaces can overstate take-home profit even after the COGS-rate inconsistency is fixed.
- **Recommended fix:** Either rename this as pre-fee/pre-fixed net or include transaction fees and fixed-cost proration using the same billing/fee helpers as `aggregate()`.

### NEW-3: cronDaily comments are now dangerously stale around Meta CAD writes
- **File:** `dashboard-web/src/inngest/functions/cronDaily.ts:515`
- **Severity:** MEDIUM
- **What:** The block comment says Meta `spend_cad` is null/deferred (`cronDaily.ts:515-522`), but the implementation writes `spend_cad: await cadFor(...)` and `conversion_value_cad: await cadFor(...)` (`cronDaily.ts:583-587`).
- **Why it matters:** This is not a runtime bug, but it is a high-risk maintenance trap in the same fragile FX/write path: future fixes may preserve the comment's obsolete behavior.
- **Recommended fix:** Delete or rewrite the stale paragraph so it matches the current per-row FX conversion behavior.

### NEW-4: cron-live status refresh silently ignores Supabase error results
- **File:** `dashboard-web/src/inngest/functions/cronLive.ts:1020`
- **Severity:** HIGH
- **What:** Each `.update(...)` promise result is discarded. If Supabase returns `{ error }` without rejecting, the step succeeds and no status update is logged or retried.
- **Why it matters:** The operator can see stale "active/off" chips with no dead-letter or warning, especially on RLS/schema/network-response errors that are represented as response errors.
- **Recommended fix:** Capture each result, check `result.error`, and log per-ad-set failures; combine with the `allSettled`/per-iteration fix from HIGH-12.

### NEW-5: manual override route accepts impossible dates too
- **File:** `dashboard-web/src/app/api/operator/manual-overrides/route.ts:54`
- **Severity:** HIGH
- **What:** The route accepts any `YYYY-MM-DD` string, including `2026-99-99`, for manual ad-spend overrides.
- **Why it matters:** Bad override rows can be inserted for non-calendar dates and then never match normal daily jobs, or distort operator audit/export views.
- **Recommended fix:** Apply the same UTC round-trip `isDate` validator recommended for the backfill route.

