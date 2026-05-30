# Codex Cross-Verify Input — v3 Audit Findings

You (Codex) are the independent cross-verifier for a code audit performed by Opus 4.7 on the script-roas dashboard.

## Repo
`/Users/dorperetz/script-roas` (Next.js 15 + React 19 + Supabase + Inngest crons + Hebrew RTL dashboard for a single operator managing 3 Shopify stores).

## Your job
For each finding below: read the cited file (open file_path:line), independently judge whether the claim is correct, and return one of:
- **VERIFY** — the bug is real as described; recommended fix is correct
- **VERIFY-WITH-CAVEAT** — bug is real but the recommended fix needs adjustment (describe)
- **REJECT** — claim is wrong (explain why; cite code)
- **UNCERTAIN** — not enough context to decide; what would settle it

Also: after going through the list, **spot up to 5 ADDITIONAL bugs** in those same files that Opus missed. Severity-rank them yourself.

## Operator constraints (do NOT flag as bugs)
1. GoalTracker is GLOBAL — ignores `filters.store` + `filters.range` intentionally
2. TodayLive is always LIVE — own SWR fetch regardless of operator's date range
3. WhatsApp token alerts ONLY to +972524809540 — single-recipient intentional
4. Single-operator URL-obscurity trust model — no auth on inner routes expected
5. Hebrew RTL UI — `start/end` properties are correct, not `left/right`
6. Per-store COGS via `${STORE_UPPERCASE}_COGS_RATE` env var
7. Asia/Jerusalem TZ canonical
8. v2 audit shipped 56 fixes (`48a377e..274ba3b`) including FX null fallback for cron-LIVE, sendDailySummary throws on any failure, throttle clock advances on send failure, useDashboardRefresh cache-bust per-iter + abort on unmount, useDrawerEsc once-per-open. Do not flag these as bugs.

---

# CRITICAL — 5 findings

## CRIT-1 (O3-CR-01): `aggregateByStore` defeats the d/CR-01 "All"-row fair-share split
- **Files:** `dashboard-web/src/lib/analytics.ts` (function `aggregateByStore`), `dashboard-web/src/lib/billing.ts` (function `billingForRange`)
- **Claim:** v2 d/CR-01 added a fair-share split inside `billingForRange` that when `r.store === 'All'` adds the amount once and splits `byStore` evenly. But `aggregateByStore` in `analytics.ts` calls `aggregate(list, range)` per-store with only that store's rows in `list` — so the All-store rows never reach the splitter, and per-store cards inflate 2-3× over the global card. Sum of per-store True-Net-Profit cards no longer reconciles to the global card.
- **Recommended fix:** pass the full in-scope store list into `aggregate` (or pre-split All-rows before the per-store loop).

## CRIT-2 (O2-CR-01): ProductChannelBreakdown double-counts orders + loses email/affiliate residual
- **File:** `dashboard-web/src/components/ProductChannelBreakdown.tsx:41-49, 96-100`
- **Cross-file:** `dashboard-web/src/lib/attributionAnalysis.ts:1102-1109`
- **Claim:** `facebookOrders` uses OR `(source === 'meta-*' OR fbclidPresent === true)`. The same order with `source='google-paid'` + stale `fbclidPresent=true` increments BOTH `facebookOrders` AND `bySource['google-paid']`. Render subtracts both → segment widths sum to 100% but represent >100% of unique orders. The `other` residual is clamped to 0 → email/affiliate orders that also had `fbclidPresent=true` are lost from "other" entirely.
- **Recommended fix (Option B preferred):** renderer subtracts `bySource` buckets directly: `metaOrders = bySource['meta-paid'].orders + bySource['meta-organic'].orders`, etc. No OR-with-fbclid.

## CRIT-3 (O2-CR-02): RoasChart categorical X-axis aliases multi-day gaps as 1-day adjacency
- **File:** `dashboard-web/src/components/RoasChart.tsx:50-54, 87-94`
- **Cross-file:** `dashboard-web/src/lib/analytics.ts:232-257` (`dailySeries`)
- **Claim:** `dailySeries` only emits rows for dates that exist in `cur`; missing days (zero spend, outage, paused) are silently dropped. RoasChart's XAxis is categorical (string `dateLabel`) so Recharts spaces points evenly. A 30-day range with a 5-day mid-range gap renders as 25 points evenly distributed → line shape between gap-spanning points looks identical to 1-day slope. Same class of bug v2 fixed for HeroOverview (c/CR-03) but missed for the PRIMARY RoasChart.
- **Recommended fix:** thread `range` into `dailySeries`, fill missing days with `null` per-store; let chart `connectNulls={false}` show real gaps.

## CRIT-4 (O2-CR-03): KpiCards Net Profit sparkline math ≠ displayed `trueNetProfit`
- **File:** `dashboard-web/src/components/KpiCards.tsx:109-113, 179-189`
- **Claim:** `sparkData.netProfit = revenue - spend - cogs` (uses global `COGS_RATE_OF_REVENUE = 0.25`). The card displays `current.trueNetProfit = Revenue − Spend − COGS − Fees − Fixed`. Sparkline shape disagrees with the big number above and with `METRIC_HELP.netProfit` description.
- **Recommended fix:** derive `sparkData.netProfit` from the same `trueNetProfit` source as the big number (sum daily true-net-profit), OR remove the sparkline if the data isn't available daily.

## CRIT-5 (O4-CR-01): cron-daily `cadFor()` throws on FX failure → partial-state DB writes
- **File:** `dashboard-web/src/inngest/functions/cronDaily.ts:441-451` (closure), called at `:583, :587, :594-600, :690, :695, :731, :735, :816, :820`, plus inline TikTok at `:396-409`
- **Cross-file:** `dashboard-web/src/lib/fetchers/fx.ts:45-72` (`getFxRate` throws on `!res.ok`)
- **Claim:** v2 a/WARN-3 fixed FX-throws for cron-LIVE but not mirrored to cron-DAILY. Inside `step.run('persist-batch', ...)`: data_daily upsert lands first → products_daily lands → then `campaigns_daily(meta)` builds payloads via `Promise.all(map(async => await cadFor(...)))`. One Frankfurter outage → entire step throws → google/ads/tiktok/orders/catalog never persist. Inngest dead-letters after 4 retries → permanent partial state for that day.
- **Recommended fix:** wrap `cadFor` in try/catch; on FX failure, throw a sentinel that the upsert builder catches and OMITS `spend_cad` from the payload → ON CONFLICT preserves prior value (mirror cron-live a/WARN-3 pattern).

---

# HIGH — 14 findings

## HIGH-1 (O1-H-1): TodayLive pins `today` at mount → after midnight IL shows yesterday silently
- **File:** `dashboard-web/src/components/TodayLive.tsx:184-227`
- **Claim:** `const today = todayInIsrael()` runs once on mount; pinned into SWR key `/api/data?from=${today}&to=${today}`. After 00:00 IL, the URL still references yesterday. `setNow` ticker at line 184 advances every 30s, so header shows "עודכן 00:23" on stale data.
- **Recommended fix:** advance `today` in the same `setInterval` (or gate by date-change check). When midnight rolls, SWR key swaps → next fetch hits new day.

## HIGH-2 (O1-H-2): ProductPickerModal search icon `right-2.5` in RTL doc — overlaps cursor
- **File:** `dashboard-web/src/components/ProductPickerModal.tsx:279-289`
- **Claim:** Icon anchored `right-2.5` (Tailwind LTR utility) inside `dir="rtl"` modal. Input reserves padding via `pe-9` (logical). In RTL: icon sits on the right (start), padding reserved on left (end). Icon overlaps text cursor.
- **Recommended fix:** Replace `right-2.5` with `end-2.5`.

## HIGH-3 (O1-H-3): Filters custom-range inputs no validation, no max=today, no swap-on-invert
- **File:** `dashboard-web/src/components/Filters.tsx:148-165`
- **Cross-ref:** `dashboard-web/src/components/CampaignsTable.tsx:1083-1130` (has all guards)
- **Claim:** Filters is rendered on every tab; bad keystroke propagates into 6+ SWR keys downstream.
- **Recommended fix:** lift CampaignsTable's `clampRangeFrom/clampRangeTo` into shared helper; add `max={today}`.

## HIGH-4 (O2-HI-01): toggleCampaignsColumnHidden + restoreAllCampaignsColumns drop saved `order`
- **File:** `dashboard-web/src/lib/campaignsColumnPrefs.ts:223-241`
- **Claim:** Neither function spreads `...cur`. New object has only `hidden`; `order` silently undefined-ed → write to localStorage + cloud. Operator's careful reorder wiped by one checkbox click. No undo.
- **Recommended fix:** spread `...cur` into both functions so `order` survives.

## HIGH-5 (O2-HI-02): MetricHelp popover snaps closed during 8px cursor transit; unreadable on hover
- **File:** `dashboard-web/src/components/MetricHelp.tsx:45-77`
- **Claim:** Popover sits 8px below button (`top-full mt-2`). `onMouseLeave` fires the instant cursor exits 16×16 button. Popover's own onMouseEnter/Leave are dead code (popover unmounts before cursor reaches it). Same root cause as v2's RefundIndicator d/CR-08 fix but on a different unfixed component.
- **Recommended fix:** apply RefundIndicator's 200ms grace timer pattern, OR remove the `mt-2` gap.

## HIGH-6 (O2-HI-03): CohortComparisonPanel composite sort key flips primary rank for micro-spend
- **File:** `dashboard-web/src/components/CohortComparisonPanel.tsx:261-265`
- **Claim:** `roasShopify * 1e6 + roasShopifyPlatform * 1e3 + spend`. When `roasShopifyPlatform ≥ 1000` (CAD 0.10 spend, CAD 100 platform revenue → 1000), the secondary term contributes ≥ 1e6 → equivalent to +1 in primary `roasShopify`. Micro-spend cohort with platform-attributed revenue outranks higher-Shopify-ROAS competitor → wrong 🥇 medal.
- **Recommended fix:** use a proper lexicographic compare (chained `if (a !== b) return ...`), not a composite key.

## HIGH-7 (O2-HI-04): KpiCards COGS sparkline ignores per-store `${STORE}_COGS_RATE` env (uses fixed 0.25)
- **File:** `dashboard-web/src/components/KpiCards.tsx:112`
- **Claim:** `cogs = dailyTotals(series, r => r.revenue * COGS_RATE_OF_REVENUE)` uses the legacy global. Doesn't use the per-store rate the v2 a/HI-02 fix introduced.
- **Recommended fix:** use `r.cogs` from the row (already per-store-aware via cron writers), not recompute via global rate.

## HIGH-8 (O2-HI-05): RoasChart renders "store had no data on day N" as ROAS=0 (looks like crash)
- **File:** `dashboard-web/src/components/RoasChart.tsx:95-101`
- **Cross-file:** `dashboard-web/src/lib/analytics.ts:252-254`
- **Claim:** Missing per-store entries default to 0 → chart line drops to zero on outage days. Should be null (gap), not 0 (crash).
- **Recommended fix:** in `dailySeries`, missing per-store entries should remain `null`; pair with chart `connectNulls={false}`.

## HIGH-9 (O3-HI-01): forecastMonthEnd MTD uses per-store COGS but projection uses global 0.25
- **File:** `dashboard-web/src/lib/insights.ts` (`forecastMonthEnd` function around line 448+)
- **Claim:** MTD sum uses `r.cogs` (per-store after v2 fix); projection uses `projectedRev * COGS_RATE_OF_REVENUE` (legacy global 0.25). Two halves of the same forecast use inconsistent COGS models.
- **Recommended fix:** derive projection rate from observed `last7Cogs / last7Rev`.

## HIGH-10 (O3-HI-02): forecastMonthEnd 7-day baseline INCLUDES today (incomplete day)
- **File:** `dashboard-web/src/lib/insights.ts` `forecastMonthEnd` function
- **Claim:** The 7-day window for `dailyAvgRevenue` includes today. Today is incomplete (partial-day revenue). Average is systematically depressed every morning → GoalTracker "on-pace" verdict reads "behind" all morning until late evening.
- **Recommended fix:** window the baseline to `[today-7, today-1]` (exclude today).

## HIGH-11 (O3-HI-03): Cannibalization detector emits literal `Infinity` for revenueGrowthPct
- **File:** `dashboard-web/src/lib/cannibalizationDetection.ts` (revenueGrowthPct calculation)
- **Claim:** When earlyRevenue is 0 and lateRevenue > 0, `(late - early) / early = Infinity`. UI's `fmtPct` guards display, but `JSON.stringify(Infinity) === 'null'` — silent landmine for cloudSync, telemetry, AI report.
- **Recommended fix:** clamp result with `Number.isFinite` guard; emit a sentinel like `null` or a max sentinel value.

## HIGH-12 (O4-HI-01): cron-live `refresh-effective-status` Promise.all over UPDATE batch fails entire batch on one error
- **File:** `dashboard-web/src/inngest/functions/cronLive.ts:1017-1032`
- **Claim:** Per-ad-set UPDATE inside `Promise.all`. One transient 5xx → entire step throws → Inngest dead-letters after 4 retries even though 99% of updates would have succeeded. Compare to UPSERT loop at 985-999 which does log-and-continue.
- **Recommended fix:** replace with `for...of await` + per-iteration try/catch, OR `Promise.allSettled` with rejection log.

## HIGH-13 (O4-HI-02): whatsapp-eod at 00:10 IL leaves only 5min for cronDaily's 7.5min retry budget
- **Files:** `dashboard-web/src/inngest/functions/cronWhatsapp.ts:89-102` + `cronDaily.ts:966` + `lib/notifications/summary.ts:131-132`
- **Claim:** cron-daily at 00:05 with default 4-retry exp backoff = 7.5min. EOD at 00:10 = only 5min budget. If cronDaily retrying, WhatsApp reads empty `data_daily` → operator gets "אין נתונים זמינים".
- **Recommended fix:** move EOD trigger to 00:30, OR have whatsapp-eod `step.invoke` eventSyncNow for yesterday first.

## HIGH-14 (O4-HI-03): backfill route `isDate` regex accepts `2026-99-99`; downstream Date.UTC normalises silently
- **File:** `dashboard-web/src/app/api/operator/backfill/route.ts:77-79`
- **Cross-file:** `dashboard-web/src/inngest/functions/eventBackfill.ts:140-148` (`dateRange`)
- **Claim:** `/^\d{4}-\d{2}-\d{2}$/` accepts wild values. `Date.UTC(2026, 98, 99)` overflows ~8 years into future. Loop iterates thousands of dates, wasting Inngest exec budget. HISTORY_BOUNDARY check is lex string compare so wild values pass.
- **Recommended fix:** add Date.UTC round-trip in `isDate`: `dt.getUTCFullYear() === y && dt.getUTCMonth() === m-1 && dt.getUTCDate() === d`. Same fix in `manual-overrides/route.ts:54-56`.

---

# Output format

Write your verification as `/Users/dorperetz/script-roas/.planning/audit-2026-05-23-v3/REVIEW-CODEX-VERIFICATION.md`:

```markdown
# Codex Cross-Verification of v3 Opus Findings
Date: 2026-05-23 · Cross-verifier: codex-cli / GPT-5

## Verdict summary
| Finding | Verdict | Note (1 line) |
|---|---|---|
| CRIT-1 (O3-CR-01) | VERIFY / VERIFY-WITH-CAVEAT / REJECT / UNCERTAIN | … |
... (continue for all 19)

## Detailed verdicts
### CRIT-1 (O3-CR-01)
**Verdict:** ...
**Reasoning:** quote the actual code you found, explain why the claim is correct/incorrect/needs adjustment.
**Fix correctness:** is the recommended fix correct, or does it need adjustment?

... (one section per finding)

## Additional bugs Opus missed
### NEW-1: <title>
- **File:** path:line
- **Severity:** CRITICAL / HIGH / MEDIUM
- **What:** ...
- **Why it matters:** ...
- **Recommended fix:** ...
```

Be terse but accurate. The operator reads this to decide what to fix next; do not pad.
