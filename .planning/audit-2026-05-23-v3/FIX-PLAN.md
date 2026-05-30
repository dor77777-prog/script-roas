---
plan: Wave 3 — remediation of 21 validated CRIT+HIGH findings from v3 audit
created: 2026-05-23
strategy: 4 agents in 2 waves of 2, ownership-matrix conflict prevention
test discipline: production-shaped fixtures, regression tests for every CRIT, strict edge cases
baseline: 274ba3b, 741 tests pass, tsc clean
target: ship all 21 validated CRIT+HIGH (+ 2 paired Codex MEDIUMs) atomically; 0 regressions
---

# Wave 3 Fix Plan — v3 Audit Remediation

## Conflict prevention (REQUIRED — applies to ALL Wave 3 agents)

The v1 git-add race burned us once. The Wave 3 rules:

1. **NEVER use `git add -A` or `git add .`** — only `git add <explicit-paths>` for owned files.
2. **Combine `git add` + `git commit` in a SINGLE Bash invocation** chained with `&&`.
3. **Before each commit** run `git status --short` and confirm ONLY your owned files appear staged.
4. **If unexpected files appear** in staging: `git restore --staged <file>` and re-stage explicitly.
5. **Use `git commit --only <paths>`** as defense-in-depth.

Sample shape:
```bash
cd /Users/dorperetz/script-roas && git status --short && \
  git add dashboard-web/src/lib/X.ts dashboard-web/src/lib/__tests__/X.test.ts && \
  git commit -m "$(cat <<'EOF'
fix(scope): summary (audit-id)
...
EOF
)"
```

## Test discipline (REQUIRED — applies to ALL Wave 3 agents)

Every CRITICAL fix gets a regression test that:
- Uses production-shaped fixtures (real Supabase row shapes, real fetcher payloads)
- Asserts the pre-fix behavior would have failed
- Covers at least 3 edge cases: empty / single / multi
- Tests cross-store / cross-platform invariants where applicable
- Mocks FX/network failures explicitly when relevant

Every HIGH fix gets at least 1 test pinning the new behavior.

Every commit must end with:
- `cd dashboard-web && npx tsc --noEmit` (clean)
- `cd dashboard-web && npx vitest run` (all pass, no skipped from your changes)

If a test fails after your change, FIX before continuing — do not commit a known-failing state.

## Operator constraints (DO NOT regress)

1. **GoalTracker is GLOBAL** — ignores `filters.store` + `filters.range`. Do not re-introduce per-store scoping.
2. **TodayLive is always LIVE** — `today` recomputed every render; SWR key rolls at midnight via existing 30s setInterval.
3. **WhatsApp token alerts ONLY to +972524809540** — single-recipient intentional.
4. **Per-store COGS via `${STORE_UPPERCASE}_COGS_RATE`** env var.
5. **Asia/Jerusalem TZ canonical** via `Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem' })`.
6. **Hebrew RTL** — `start/end` properties, not `left/right`.

---

## Wave structure

### Wave 3.α — 2 parallel agents, ZERO file overlap

#### Agent G — Algorithm + Financial Correctness

**Owned files (exclusive):**
- `dashboard-web/src/lib/analytics.ts` (sections: `aggregate`, `aggregateByStore`; do NOT touch `dailySeries`)
- `dashboard-web/src/lib/billing.ts`
- `dashboard-web/src/lib/insights.ts` (`forecastMonthEnd` + related)
- `dashboard-web/src/lib/cannibalizationDetection.ts`
- `dashboard-web/src/components/KpiCards.tsx`
- All matching `__tests__/*.test.ts` files

**Findings to fix (in suggested commit order):**

1. **CRIT-1 (O3-CR-01)** — `aggregateByStore` defeats v2 d/CR-01 All-row fair-share split.
   - **File:** `lib/analytics.ts:aggregateByStore` + `lib/billing.ts:billingForRange`
   - **Fix:** `aggregateByStore` calls `aggregate(list, range)` with a SINGLETON store list, so `billingForRange` charges the full `All` amount per store (because `storeNames.length === 1` inside that singleton). Pre-split All-scoped recurring + one-time fixed costs across the full in-scope store list BEFORE the per-store loop. Pass the FULL store list as a third arg so billingForRange splits correctly.
   - **Tests (production-shaped):**
     - 3 stores with 3 store-specific recurring rows + 1 All-scoped row: sum of per-store True-Net-Profit cards MUST equal the global card to the cent.
     - 1 store with only an All-scoped row: per-store gets full amount; global gets full amount (no double-count).
     - 0 All-scoped rows: behavior unchanged from current.
   - **Commit:** `fix(analytics): per-store aggregate pre-splits All-scoped costs (CRIT-1)`

2. **CRIT-4 (O2-CR-03)** — KpiCards Net Profit sparkline math ≠ displayed `trueNetProfit`.
   - **File:** `components/KpiCards.tsx:109-189`
   - **Fix:** Codex's preferred option — REMOVE the netProfit sparkline rather than fake a true-net daily allocation we can't justify. (Daily fees + fixed-cost allocation would require billing.ts proration per-day, out of scope.) Remove `sparkData.netProfit`; remove `spark={{ values: sparkData.netProfit }}` from the KpiCard prop; leave the big-number `current.trueNetProfit` intact.
   - **Tests:** snapshot/DOM test that the netProfit card renders WITHOUT a sparkline; trueNetProfit value still appears.
   - **Commit:** `fix(kpi-cards): drop misleading net-profit sparkline that didn't match trueNetProfit (CRIT-4)`

3. **HIGH-7 (O2-HI-04)** — KpiCards COGS sparkline uses global 0.25 instead of per-store `r.cogs`.
   - **File:** `components/KpiCards.tsx:112`
   - **Fix:** Change `cogs = dailyTotals(series, r => r.revenue * COGS_RATE_OF_REVENUE)` to `cogs = dailyTotals(series, r => r.cogs)`. Match `aggregate()`'s `hasCogs` fallback policy for legacy rows: `r => (r.hasCogs ? r.cogs : r.revenue * COGS_RATE_OF_REVENUE)`.
   - **Tests:** rows mixed of `hasCogs: true` + `hasCogs: false` produce expected per-day totals; pure-legacy rows still work.
   - **Commit:** `fix(kpi-cards): COGS sparkline uses per-store rate via row.cogs (HIGH-7)`

4. **Codex-NEW-1 (MEDIUM)** — KpiCards COGS card hardcodes "(25%)" label.
   - **File:** `components/KpiCards.tsx:168`
   - **Fix:** Remove `labelSuffix="(25%)"`; if the aggregate spans stores with different rates, show dynamic label e.g. "לפי חנות" using a helper that detects if all rows share a uniform per-store rate. Simplest: just drop the suffix entirely.
   - **Tests:** no `(25%)` text in DOM after render.
   - **Commit:** `fix(kpi-cards): drop misleading hardcoded 25% COGS label suffix (Codex-NEW-1)`

5. **HIGH-9 (O3-HI-01)** — `forecastMonthEnd` MTD uses per-store COGS but projection uses global 0.25.
   - **File:** `lib/insights.ts:497-501`
   - **Fix:** Derive projection COGS rate from observed `last7Cogs / last7Rev` (matching the existing 7-day window). Fall back to `COGS_RATE_OF_REVENUE` only if last7Rev === 0.
   - **Tests:** rows with `r.cogs` reflecting 18% effective rate → projected COGS in forecast uses ~18%, not 25%.
   - **Commit:** `fix(insights): forecastMonthEnd projection COGS derived from observed 7-day rate (HIGH-9)`

6. **HIGH-10 (O3-HI-02)** — `forecastMonthEnd` 7-day baseline INCLUDES today.
   - **File:** `lib/insights.ts:481-491` (the `sevenDaysAgo` window)
   - **Fix:** Window the baseline to `[today-7, today-1]` (exclude today). Update `last7DaysCount` accordingly.
   - **Tests:** with today's row showing 50% of normal revenue (e.g., 11am snapshot), the 7-day avg matches the prior-day-only baseline (not depressed by today).
   - **Commit:** `fix(insights): forecastMonthEnd 7-day baseline excludes today (HIGH-10)`

7. **HIGH-NEW-2 (Codex)** — `forecastMonthEnd` "net" omits fees AND fixed costs.
   - **File:** `lib/insights.ts:479, 497-501`
   - **Fix:** Use the same `aggregate()` helpers (transactionFees + fixedCosts proration) so `mtdNet` and `projectedNet` match the true-net definition used everywhere else. If proration is non-trivial, alternative is to rename `mtdNet` → `mtdGrossNet` (revenue − spend − COGS) and document; ship the rename as a stop-gap and add a TODO for full allocation.
   - **Tests:** with rows that have a recurring fixed cost in scope, `forecastMonthEnd.mtdNet` matches `aggregate(...).trueNetProfit` for the same time window.
   - **Commit:** `fix(insights): forecastMonthEnd net includes fees + fixed costs (HIGH-NEW-2)`

8. **HIGH-11 (O3-HI-03)** — Cannibalization emits literal `Infinity` for `revenueGrowthPct`.
   - **File:** `lib/cannibalizationDetection.ts:428-431, 439-444, 488-497`
   - **Fix:** Clamp result with `Number.isFinite` guard. Emit `null` when both early and late revenue are present but early is 0; OR a sentinel that JSON.stringify renders as the explicit value. Update consumers (UI + cloudSync + aiReport) to render `null` as "n/a" or similar.
   - **Tests:** early=0, late=1000 → `revenueGrowthPct === null`; `JSON.stringify(detection)` round-trips without losing the field.
   - **Commit:** `fix(cannibalization): null sentinel for revenueGrowthPct instead of Infinity (HIGH-11)`

**Estimated effort:** 8 commits, 2-3 hours of careful work + tests.

---

#### Agent I — Pipeline + Crons + API

**Owned files (exclusive — NO overlap with G):**
- `dashboard-web/src/inngest/functions/cronDaily.ts`
- `dashboard-web/src/inngest/functions/cronLive.ts` (ONLY: `refresh-effective-status` step at lines 826-1033 — the per-platform UPDATE loop. Do NOT touch `isActiveForPlatform` at lines 955-967 — Agent J owns that.)
- `dashboard-web/src/inngest/functions/cronWhatsapp.ts`
- `dashboard-web/src/app/api/operator/backfill/route.ts`
- `dashboard-web/src/app/api/operator/manual-overrides/route.ts`
- `dashboard-web/src/lib/notifications/summary.ts` (only if HIGH-13 fix requires it)
- All matching `__tests__/*.test.ts` files

**Findings to fix:**

1. **CRIT-5 (O4-CR-01)** — cronDaily `cadFor()` + inline TikTok FX throw → partial-state writes.
   - **Files:** `inngest/functions/cronDaily.ts:441-451` (cadFor), `:396-409` (inline TikTok), call sites at `:583, :587, :594-600, :690, :695, :731, :735, :816, :820`
   - **Fix:** Mirror v2 cron-LIVE a/WARN-3 pattern:
     - Wrap `cadFor` in try/catch; on FX failure, return a sentinel like `null` or throw a sentinel error `FX_SKIP`.
     - Per-row payload builders: if cadFor returned null/threw FX_SKIP, OMIT `spend_cad` and `conversion_value_cad` from the row → ON CONFLICT preserves prior value (Supabase upsert only updates payload keys present).
     - Apply same to inline TikTok exchange at `:396-409` BEFORE the data_daily upsert. If TikTok FX fails, omit `tt_spend_cad` from `dataDailyPayload`.
   - **Tests (production-sim):**
     - Mock `getFxRate` to throw on first call, succeed on second. Assert: data_daily upsert succeeds with `tt_spend_cad` omitted; campaigns/ads/orders upserts STILL run; on the second-cron tick, prior values preserved.
     - Mock all FX calls to throw. Assert: NO step throws; each platform's spend_cad column omitted; existing rows preserved.
     - 1 platform throws, other 2 succeed. Assert: 2 platforms' rows have fresh CAD; failed platform omitted.
   - **Commit:** `fix(cron-daily): FX failure preserves prior CAD via per-row omit (CRIT-5)`

2. **Codex-NEW-3 (MEDIUM)** — cronDaily stale comment around Meta CAD writes.
   - **File:** `inngest/functions/cronDaily.ts:515-522`
   - **Fix:** Comment says spend_cad is null/deferred; code at :583-587 writes the CAD value. Delete the stale paragraph; replace with a comment accurately describing the current FX-with-omit-on-failure behavior.
   - **Tests:** N/A (documentation only).
   - **Commit:** `docs(cron-daily): correct stale Meta CAD-writes comment (Codex-NEW-3)`

3. **HIGH-12 + HIGH-NEW-4** — cron-live `refresh-effective-status` Promise.all fails whole batch + ignores Supabase `{error}` responses.
   - **File:** `inngest/functions/cronLive.ts:1017-1031`
   - **Fix:** Replace `await Promise.all(...)` with `for...of await` + per-iteration try/catch + check `result.error` from Supabase. Log per-ad-set failure with `console.warn(...)`. Continue iterating.
   - **Tests:** mock 3 ad-set updates where #2 throws and #3 returns `{error: ...}` — assert: step completes, both errors logged, #1's update lands.
   - **Commit:** `fix(cron-live): per-ad-set try/catch + Supabase error check in status refresh (HIGH-12 + HIGH-NEW-4)`

4. **HIGH-13 (O4-HI-02)** — whatsapp-eod at 00:10 IL leaves only 5min for cronDaily's 7.5min retry budget.
   - **File:** `inngest/functions/cronWhatsapp.ts:89-99`
   - **Fix:** Change cron expression from `TZ=Asia/Jerusalem 10 0 * * *` to `TZ=Asia/Jerusalem 30 0 * * *` (00:30 IL). Add a comment explaining the relationship to cronDaily's 7.5-min retry budget.
   - **Tests:** Unit test the cron expression string (snapshot or simple string compare). Could also test that `buildStoreSummary` reads non-empty data when invoked at 00:30 vs 00:10 (mock current time).
   - **Commit:** `fix(cron-whatsapp): move EOD trigger to 00:30 IL to clear cron-daily retry budget (HIGH-13)`

5. **HIGH-14 + Codex-NEW-5** — backfill + manual-overrides `isDate` regex accepts `2026-99-99`.
   - **Files:** `app/api/operator/backfill/route.ts:77-78`, `app/api/operator/manual-overrides/route.ts:54-70`
   - **Fix:** Add UTC round-trip in `isDate`:
     ```ts
     function isDate(s: unknown): s is string {
       if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
       const [y, m, d] = s.split('-').map(Number);
       const dt = new Date(Date.UTC(y, m - 1, d));
       return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
     }
     ```
   - Apply to BOTH routes.
   - **Tests:** assert reject for `2026-99-99`, `2026-13-01`, `2026-02-30`, `0000-01-01`; accept for `2026-05-23`, `2024-02-29` (leap), `2025-12-31`.
   - **Commit:** `fix(api): reject impossible dates in backfill + manual-overrides routes (HIGH-14 + Codex-NEW-5)`

**Estimated effort:** 5 commits, 2-3 hours.

---

### Wave 3.β — 2 parallel agents, starts AFTER Wave 3.α lands

Wave 3.β must wait for Wave 3.α because:
- Agent H touches `lib/analytics.ts` which Agent G also touched.
- Agent J touches `inngest/functions/cronLive.ts` which Agent I also touched.

#### Agent H — Charts (Visualizations)

**Owned files (exclusive within Wave 3.β):**
- `dashboard-web/src/lib/analytics.ts` (ONLY: `dailySeries` — Agent G already shipped `aggregate` + `aggregateByStore`)
- `dashboard-web/src/components/RoasChart.tsx`
- `dashboard-web/src/components/ProductChannelBreakdown.tsx`
- `dashboard-web/src/lib/attributionAnalysis.ts`
- All matching `__tests__/*.test.ts` files

**Findings to fix:**

1. **CRIT-3 + HIGH-8** — RoasChart categorical X-axis aliases gap days + missing store-days render as ROAS=0.
   - **Files:** `lib/analytics.ts:dailySeries`, `components/RoasChart.tsx:50-54, 87-94, 153-164`
   - **Fix:**
     - `dailySeries` signature: add `range?: DateRange` parameter. When `range` is provided, walk the full date range and emit a row for EVERY day. Missing per-store entries default to `null` (not 0).
     - `RoasChart`: pass `range` to `dailySeries`. Set `<Line connectNulls={false}>` on all per-store lines.
   - **Tests (production-shaped):**
     - 30-day range with 5-day mid-range outage: result has 30 rows; outage days have `null` per-store values.
     - All stores with full coverage: behavior matches pre-fix output (no regression).
     - Single store with sparse data: chart renders gaps as breaks, not zero-dips.
   - **Commit:** `fix(charts): dailySeries fills full range + RoasChart shows null gaps (CRIT-3 + HIGH-8)`

2. **CRIT-2** — ProductChannelBreakdown double-count + chip logic.
   - **Files:** `components/ProductChannelBreakdown.tsx:41-49, 96-100, 104-118` (chip logic), `lib/attributionAnalysis.ts:1102-1109`
   - **Fix (Codex caveat: fix BOTH segments AND chips):**
     - In renderer: compute segments from `bySource` buckets only (no OR-with-fbclid). `metaOrders = bySource['meta-paid'].orders + bySource['meta-organic'].orders`, etc. `other = total - knownExplicit` (no clamp needed — exclusive math sums to total).
     - In chip-recommendation block: derive `facebookShare` from the same exclusive count, not from `breakdown.facebookOrders` (which is OR-counted).
     - Optionally surface `fbclidPresent`-only orders as a separate "ייתכן Facebook" sub-indicator if the operator wants the signal — but as a NOTE, not in the main bar.
   - **Tests:**
     - 100 orders: 40 meta-paid pure + 10 google-paid with fbclidPresent=true + 20 google-paid pure + 5 tiktok + 25 direct.
     - Pre-fix: segments would inflate (fb=50, google=30, sums to 110 of 100 orders, "other" lost the email residuals).
     - Post-fix: meta=40, google=30, tiktok=5, direct=25, other=0 (clean 100 sum).
     - Edge: all-source-unknown orders go to "other"; fbclid-only-no-source orders go to "other".
   - **Commit:** `fix(product-channel-breakdown): exclusive source attribution in segments AND chips (CRIT-2)`

**Estimated effort:** 2 commits, ~2 hours.

---

#### Agent J — UI + State + TikTok status

**Owned files (exclusive within Wave 3.β):**
- `dashboard-web/src/components/CampaignsTableRow.tsx` (OPERATOR-1)
- `dashboard-web/src/inngest/functions/cronLive.ts` (ONLY: `isActiveForPlatform` at lines 955-967 — Agent I already shipped the rest. Do NOT touch the refresh-effective-status step itself.)
- `dashboard-web/src/components/ProductPickerModal.tsx`
- `dashboard-web/src/components/Filters.tsx`
- `dashboard-web/src/lib/campaignsColumnPrefs.ts`
- `dashboard-web/src/components/MetricHelp.tsx`
- `dashboard-web/src/components/CohortComparisonPanel.tsx`
- All matching `__tests__/*.test.ts` files

**Findings to fix:**

1. **OPERATOR-1** — TikTok `isCampaignOff` + `isActiveForPlatform` treat any non-DELIVERY_OK as off.
   - **Files:** `components/CampaignsTableRow.tsx:178`, `inngest/functions/cronLive.ts:955-967`
   - **Fix:**
     - `isCampaignOff` TikTok branch: maintain a `TIKTOK_OFF_STATUSES = new Set(['ADGROUP_STATUS_DISABLE', 'ADGROUP_STATUS_TIMEDOUT', 'ADGROUP_STATUS_FROZEN', 'ADGROUP_STATUS_ARCHIVED', 'ADGROUP_STATUS_DELETE'])`. Return `TIKTOK_OFF_STATUSES.has(norm)`.
     - `isActiveForPlatform` TikTok branch: maintain a `TIKTOK_ACTIVE_ENOUGH = new Set(['ADGROUP_STATUS_DELIVERY_OK', 'ADGROUP_STATUS_BUDGET_EXCEED', 'ADGROUP_STATUS_AUDIT', 'ADGROUP_STATUS_REVIEWING', 'ADGROUP_STATUS_NOT_START'])`. Return `TIKTOK_ACTIVE_ENOUGH.has(norm)`.
     - Add JSDoc to both blocks linking to the TikTok status taxonomy and explaining why these specific sets.
   - **Tests (strict — all 8+ TikTok statuses):**
     - `isCampaignOff('tiktok', 'ADGROUP_STATUS_DELIVERY_OK', ...) === false`
     - `isCampaignOff('tiktok', 'ADGROUP_STATUS_BUDGET_EXCEED', ...) === false`
     - `isCampaignOff('tiktok', 'ADGROUP_STATUS_AUDIT', ...) === false`
     - `isCampaignOff('tiktok', 'ADGROUP_STATUS_REVIEWING', ...) === false`
     - `isCampaignOff('tiktok', 'ADGROUP_STATUS_NOT_START', ...) === false`
     - `isCampaignOff('tiktok', 'ADGROUP_STATUS_DISABLE', ...) === true`
     - `isCampaignOff('tiktok', 'ADGROUP_STATUS_TIMEDOUT', ...) === true`
     - `isCampaignOff('tiktok', 'ADGROUP_STATUS_FROZEN', ...) === true`
     - `isCampaignOff('tiktok', 'ADGROUP_STATUS_ARCHIVED', ...) === true`
     - `isCampaignOff('tiktok', 'ADGROUP_STATUS_DELETE', ...) === true`
     - Mirror for `isActiveForPlatform` (note opposite direction).
     - Null/empty status → fallback to lastActiveDate heuristic (existing behavior).
   - **Commit:** `fix(tiktok-status): true-off vs delivering-enough sets instead of strict DELIVERY_OK (OPERATOR-1)`

2. **HIGH-2** — ProductPickerModal `right-2.5` in RTL doc.
   - **File:** `components/ProductPickerModal.tsx:279-289`
   - **Fix:** Replace `right-2.5` with `end-2.5`.
   - **Tests:** unit-render the modal in `dir="rtl"` container; assert icon's computed style uses `inset-inline-end` (or class `end-2.5` presence in DOM).
   - **Commit:** `fix(product-picker): search icon uses logical end-2.5 for RTL (HIGH-2)`

3. **HIGH-3** — Filters custom-range no validation.
   - **File:** `components/Filters.tsx:148-165`
   - **Fix:** Extract the clamp helpers from CampaignsTable.tsx:1083-1130 into a shared module (e.g., `lib/rangeClamp.ts`); use in BOTH Filters and CampaignsTable. Add `max={todayInIsrael()}` to inputs. Add empty-string guard. Add swap-on-invert.
   - **Tests:**
     - empty 'from' input: range unchanged.
     - future date: clamped to today.
     - from > to: swap.
     - 6 SWR keys downstream still receive valid YYYY-MM-DD.
   - **Commit:** `fix(filters): shared range clamp helper used in global Filters + CampaignsTable (HIGH-3)`

4. **HIGH-4** — `toggleCampaignsColumnHidden` + `restoreAllCampaignsColumns` drop `order`.
   - **File:** `lib/campaignsColumnPrefs.ts:223-241`
   - **Fix:** Spread `...cur` into both. New objects: `{ ...cur, hidden: Array.from(set).sort() }` and `{ ...cur, hidden: [] }`.
   - **Tests:**
     - Toggle a column hidden → reorder → toggle hidden again → assert order preserved.
     - Restore all → assert hidden cleared AND order preserved.
   - **Commit:** `fix(column-prefs): preserve user's column order on hide/restore (HIGH-4)`

5. **HIGH-5** — MetricHelp popover snaps closed during cursor transit.
   - **File:** `components/MetricHelp.tsx:45-77`
   - **Fix:** Apply the RefundIndicator 200ms grace-timer pattern (the v2 d/CR-08 implementation). Use `useRef<ReturnType<typeof setTimeout> | null>` for the hide timer; `cancelHide` on mouseEnter to both button + popover; `scheduleHide` on mouseLeave from both. useEffect cleanup clears the timer.
   - **Tests:** simulate hover → mouseLeave → mouseEnter on popover within 100ms → assert popover still open after 250ms (grace allowed transit).
   - **Commit:** `fix(metric-help): 200ms grace timer for hover transit (HIGH-5)`

6. **HIGH-6** — CohortComparisonPanel composite sort key flips primary rank.
   - **File:** `components/CohortComparisonPanel.tsx:261-265`
   - **Fix:** Replace composite key with explicit lexicographic compare:
     ```ts
     intraSection.sort((a, b) => {
       const am = a.metrics, bm = b.metrics;
       if (!am && !bm) return 0;
       if (!am) return 1;
       if (!bm) return -1;
       if (am.roasShopify !== bm.roasShopify) return bm.roasShopify - am.roasShopify;
       if (am.roasShopifyPlatform !== bm.roasShopifyPlatform) return bm.roasShopifyPlatform - am.roasShopifyPlatform;
       return bm.spend - am.spend;
     });
     ```
   - **Tests:** the micro-spend scenario from the audit (roasShopify=2, roasShopifyPlatform=5000 vs roasShopify=3, roasShopifyPlatform=4) — assert the roasShopify=3 cohort ranks FIRST. Plus standard tie-break paths.
   - **Commit:** `fix(cohort-comparison): explicit lexicographic sort instead of composite key (HIGH-6)`

**Estimated effort:** 6 commits, ~2-3 hours.

---

## Conflict matrix summary

| File | α owner | β owner | Notes |
|---|---|---|---|
| `lib/analytics.ts` | Agent G (`aggregate`, `aggregateByStore`) | Agent H (`dailySeries`) | Different functions; β starts after α |
| `inngest/functions/cronLive.ts` | Agent I (refresh-effective-status step) | Agent J (`isActiveForPlatform` only) | Different sections; β starts after α |
| All other files | single-owner | single-owner | No overlap |

## Final regression sweep

After both waves complete:
1. `cd dashboard-web && npx tsc --noEmit` — clean
2. `cd dashboard-web && npx vitest run` — all pass
3. `git log --oneline 274ba3b..HEAD` — confirm 21 commits (15 from α + ~8 from β)
4. `git push origin main`

## Total expected output

- α: ~13 atomic commits (Agent G: 8, Agent I: 5)
- β: ~8 atomic commits (Agent H: 2, Agent J: 6)
- Total: ~21 commits ≈ 21 findings remediated
- New tests: ~25-35 added (1+ per CRIT, ≥1 per HIGH)
- Final test count: ~770-780 passing
