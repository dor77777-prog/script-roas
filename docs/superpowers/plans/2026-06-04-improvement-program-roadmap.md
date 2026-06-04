# Dashboard Improvement Program — Master Roadmap

**Date:** 2026-06-04 · **Owner:** single operator · **Deploy:** `git push origin main` only (Vercel Git integration; never also `vercel deploy --prod`)

This is the program-level roadmap that ties the **7 workstream plans** together. Each workstream plan is the implementation contract (real files, real functions, failing-test-first, per-task commits). This document sequences the **39 vetted gaps** across workstreams into **execution waves** and names the single highest-leverage next move.

The 7 workstream plans:

| WS | Plan file | Theme |
|----|-----------|-------|
| WS1 | `docs/superpowers/plans/2026-06-04-improvement-ws1-profit-truth.md` | Profit Truth & Run-Rate |
| WS2 | `docs/superpowers/plans/2026-06-04-improvement-ws2-channel-truth.md` | Channel-Level Truth (NC-ROAS / net / overcount by channel) |
| WS3 | `docs/superpowers/plans/2026-06-04-improvement-ws3-alerts-digest.md` | Alerts & Action Digest (push the intelligence) |
| WS4 | `docs/superpowers/plans/2026-06-04-improvement-ws4-product-inventory.md` | Product & Inventory Profit |
| WS5 | `docs/superpowers/plans/2026-06-04-improvement-ws5-data-trust.md` | Data Trust & Freshness On-Screen |
| WS6 | `docs/superpowers/plans/2026-06-04-improvement-ws6-ux.md` | UX & Workflow |
| WS7 | `docs/superpowers/plans/2026-06-04-improvement-ws7-attribution-depth.md` | Attribution Depth (within the CAPI-safe ceiling) |

---

## 1. Overview — you are already strong; most wins surface existing math

The audit's central finding is **not** "the dashboard is missing intelligence." It is that **the intelligence is already computed and then thrown away, hidden behind a collapsed panel, or trapped in a CLI test.** The dashboard is a mature, mapping-aware, deeply-audited tool. The program's job is to *surface* and *push* what already exists, then add a small number of genuinely net-new computations.

Concrete evidence that the wins are mostly "surface existing math":

- **Run-rate:** `forecastMonthEnd()` already returns `projectedNet` / `projectedSpend` / `projectedRoas` (MTD-actual cost + 7-day extrapolation, COGS/fees/salaries included) — but `GoalTracker.tsx` reads **only** `monthToDateRevenue`. The true-net run-rate is computed and discarded (gap `profit-net-runrate-surfaced`, **S**).
- **Alerts:** `buildAllInsights` (scale/pause/zero-conv/rebalance + `forecastMonthEnd`/`computePacing`) is consumed **only** by `InsightsBoard.tsx`, which **defaults collapsed**, and the WhatsApp push carries a static KPI snapshot with **zero** recommendations. Nothing in `inngest/` or `lib/notifications/` imports the engine (gaps `push-insights-digest`, `break-even-flag-digest`, `goal-pacing-alert-push`).
- **Reconciliation:** `reconcileWindow` (INV-7/9/10 cross-source ledger checks) runs **only** via `npm run audit:reconcile`. There is no operator-facing surface (gap DQ-1).
- **Channel truth:** per-channel `source` labels (`meta-paid`/`google-paid`/`tiktok-paid`) are on **every** order row; per-store NC-ROAS already ships; per-campaign overcount already ships in the drawer. The **only** missing axis is the channel split / cross-campaign roll-up (gaps `channel-nc-roas-split`, `channel-overcount-delta`).

Of the 39 gaps, **20 are "deepen"** (surface/extend existing logic) and **19 are "net-new."** The deepen items are disproportionately high-impact-low-effort — which is why Wave 1 is almost entirely deepen work.

**The CAPI-safe ceiling is a feature, not a limitation.** The attribution depth we *can* honestly build (unknown-bucket decomposition from fields already on every row, survey rollup from `note_attributes`, organic-baseline incrementality proxy from data back to 2023) is reporting-only and double-count-safe by construction. The depth we *cannot* build (pixel/CAPI/multi-touch/Sonar/Triple-Pixel) is the explicit SKIP list in §5.

---

## 2. The 39 gaps

Legend — **Mockup?** = "produce a static HTML mockup, deliver as an `open <abs-path>` link, get operator approval BEFORE building" is the first task (operator hard rule for any non-trivial UI). **CAPI** = CAPI-safe / read-only (all 39 are — there is no exception). **Depends-on** = the gap(s) or migration that must land first.

| # | id | title (short) | WS | Impact | Effort | CAPI | Mockup? | Depends-on |
|---|----|----------------|----|--------|--------|------|---------|-----------|
| 1 | `ux-home-default-today` | Home defaults to **today** on entry (operator hard req) | WS6 | high | S | ✅ | no | none — **do FIRST** |
| 2 | `profit-net-runrate-surfaced` | True-net run-rate to month-end (surface existing) | WS1 | high | S | ✅ | yes (run-rate sub-panel) | none |
| 3 | `break-even-flag-digest` | Below break-even/target flag in digest | WS3 | high | S | ✅ | no (copy-only) | none → foundation for #25 |
| 4 | `day-over-day-deltas-digest` | What CHANGED vs trailing baseline in digest | WS3 | med | S | ✅ | no | none → feeds #25 |
| 5 | `DQ-2` | FX failure → token_failures + WhatsApp alert | WS5 | high | S | ✅ | no | none |
| 6 | `ux-csv-export` | CSV export from any rich table | WS6 | med | S | ✅ | no | none |
| 7 | `ux-table-search` | In-table free-text name search (Campaigns/Products/Ads) | WS6 | med | S | ✅ | no | none |
| 8 | `refund-return-rate-trend` | Refund/return-rate KPI time series on Trends | WS1 | med | S | ✅ | yes (rate-trend chart) | none |
| 9 | `ux-command-palette-actions` | Deep-link to row + custom-range + Payments tab | WS6 | low | S | ✅ | no | none |
| 10 | `DQ-6` | Cohort/LTV "as-of" freshness on Customers tab | WS5 | low | S | ✅ | yes (as-of badge) | cohort refresh marker |
| 11 | `channel-nc-roas-split` | **NC-ROAS / nCAC / payback BY CHANNEL** | WS2 | high | M | ✅ | yes (ChannelTruthPanel) | none — **highest leverage** |
| 12 | `channel-overcount-delta` | Platform-claim vs click-ID overcount per channel | WS2 | high | M | ✅ | shared (ChannelTruthPanel) | #11 panel |
| 13 | `per-channel-net-profit` | Per-channel net after COGS+fees | WS2 | high | M | ✅ | shared (ChannelTruthPanel) | #11 panel |
| 14 | `creative-ad-fatigue-signal` | Ad-level CTR decay + CPM creep (+freq) | WS3 | high | M | ✅ | no (becomes Insight) | `ads_daily.frequency` migration (optional leg) |
| 15 | `campaign-died-detection` | Winner went dark (was spending, now $0) | WS3 | med | M | ✅ | no | none |
| 16 | `native-prioritized-action-list` | Native ranked "do this today" top-N | WS3 | med | M | ✅ | yes (ActionListPanel) | reuses `buildAllInsights` |
| 17 | `goal-pacing-alert-push` | "Behind pace" alert pushed | WS3 | med | M | ✅ | no | #25 digest path |
| 18 | `push-insights-digest` | Push the engine to WhatsApp (daily/weekly) | WS3 | high | M | ✅ | no | #3, #4, #16; new template |
| 19 | `prod-profit-after-cogs-ads` | True per-product profit (COGS + allocated spend) | WS4 | high | M | ✅ | yes (ProductProfitTable) | none |
| 20 | `per-product-contribution-pnl` | Contribution P&L on product-centric pivot | WS4 | med | M | ✅ | shared (product surface) | #19 core |
| 21 | `inventory-stockout-vs-spend` | Flag spend on out-of-stock products | WS4 | high | M | ✅ | yes (InventoryPanel) | `product_catalog` stock cols migration |
| 22 | `product-channel-matrix-standalone` | Standalone product × channel order-source matrix | WS4 | med | M | ✅ | yes (matrix grid) | none |
| 23 | `new-product-launch-tracking` | First-sale date, ramp curve, launch ROAS | WS4 | med | M | ✅ | yes (LaunchPanel) | none |
| 24 | `DQ-1` | Surface window reconciliation to operator | WS5 | high | M | ✅ | yes (ReconcilePanel+Banner) | none |
| 25 | `DQ-3` | Flag manual overrides on Home/P&L + audit cols | WS5 | med | M | ✅ | yes (OverrideFlag) | `manual_overrides` audit cols migration |
| 26 | `DQ-4` | "live estimate vs finalized" provenance marker | WS5 | med | M | ✅ | shared (flags mockup) | none (cols exist) |
| 27 | `DQ-5` | Source-level freshness/missing-source on dashboard | WS5 | med | M | ✅ | yes (SourceHealthChip) | none |
| 28 | `DQ-7` | Live TikTok shared-account mapping-coverage | WS5 | med | M | ✅ | yes (CoveragePanel) | none |
| 29 | `discount-promo-leakage` | Discount/promo leakage P&L line + rate trend | WS1 | med | M | ✅ | reuses trend chart | `data_daily.discount_cad` migration + re-backfill |
| 30 | `per-product-contribution-pnl` (UI) | see #20 | WS4 | med | M | ✅ | — | #19 |
| 31 | `budget-pacing-marginal` | Spend-vs-budget pacing + marginal decay | WS1 | low | M | ✅ | yes (pacing chip states) | none |
| 32 | `ux-period-compare` | Explicit period-over-period baseline | WS6 | high | M | ✅ | yes (compare UI) | none |
| 33 | `ux-saved-views` | Named tab+store+range presets | WS6 | med | M | ✅ | yes (saved-views menu) | none |
| 34 | `ux-annotations-on-trends` | Annotation overlay on Trends + device-sync | WS6 | med | M | ✅ | no (overlay only) | none (already synced) |
| 35 | `ux-store-compare-grid` | 3-store side-by-side metric grid | WS6 | med | M | ✅ | yes (compare grid) | none |
| 36 | `unknown-bucket-decomposition` | Slice the unknown/direct bucket | WS7 | med | M | ✅ | yes (UnknownBucketPanel) | none |
| 37 | `survey-hdyhau-rollup` | Post-purchase "how did you hear" rollup | WS7 | med | M | ✅ | yes (SurveyTab) | `orders_attribution.survey_source` migration + backfill; **operator installs survey app** |
| 38 | `organic-baseline-incrementality-proxy` | Spend-pause organic-baseline lift proxy | WS7 | med | L | ✅ | yes (IncrementalityPanel) | none (data to 2023) |
| 39 | `product-cohort-repeat-driver` | First-product retention cohorts | WS4 | high | L | ✅ | yes (ProductCohortPanel) | `product_cohort_monthly` migration + backfill — **DEFER, data not ripe** |
| 40 | `repeat-purchase-cadence-per-product` | Days-between reorders per product | WS4 | low | L | ✅ | yes (CadencePanel) | none — **DEFER, data not ripe** |
| 41 | `channel-payback-curve` | Per-channel CAC payback / months-to-recover | WS2 | low | L | ✅ | reuses channel surface | `customer_cohort_monthly.acquiring_channel` (DEFERRED-SCHEMA) — **DEFER** |

> Row count note: gaps `per-product-contribution-pnl` appears once as the core (#20) and the table lists it under WS4 — there are exactly **39 distinct gap ids**; the extra row numbers reflect that WS4's contribution-P&L spans two surfaces (Products table + product-centric pivot) in one gap.

---

## 3. Execution waves

Waves cut **across** workstreams, sequenced by **impact × (1/effort) × dependency**. Each wave is a shippable cluster with a single deploy at the end (per the *no-drip-deploy* rule: audit all, fix all, verify every tab both themes locally, then ONE push). The **gate to the next wave** is the bar the operator must accept before the next cluster begins.

### Wave 1 — Quick wins (S/high; surface-existing-math)
**Items:** `ux-home-default-today` (#1, **operator hard requirement — home defaults to today**), `profit-net-runrate-surfaced` (#2), `break-even-flag-digest` (#3), `DQ-2` FX alert (#5), `day-over-day-deltas-digest` (#4), `ux-table-search` (#7), `ux-csv-export` (#6). Pull-in if cheap: `ux-command-palette-actions` (#9), `refund-return-rate-trend` (#8).

**Why now:** every item is **S effort** and either high-impact or operator-mandated. #1 is a hard requirement and a near-zero-risk client-state change (`DEFAULT_PRESET="today"` in `dateRange.ts`, single source of truth). #2/#3/#4 are pure "stop throwing the math away." #5 closes a *correctness blind spot* (a Frankfurter outage silently carries yesterday's FX into today's CAD with no chip/alert) for tiny effort. #6/#7 are operator-ergonomics wins with no data risk. None block each other; none need a migration; only #2 and #8 need a mockup (run-rate sub-panel; rate-trend chart).

**Gate to Wave 2:** Home opens on today and respects explicit deep-link ranges (no regression to deep-links). Run-rate sub-panel approved + live showing projected-net/spend/ROAS. FX-failure path records a `token_failures` row + fires the throttled WhatsApp alert (verified against a forced-throw test). `break-even` verdict helper (`roasVerdict`, fixed 2x/2.7x/3x bands per MEMORY — **no new CM%-derived number**) and `computeDigestDeltas` exist and are unit-green — these are the **reusable foundations Wave 2's digest consumes.**

### Wave 2 — Channel truth + alerts cluster (the leverage core)
**Items:** `channel-nc-roas-split` (#11, **highest leverage — see §4**), `channel-overcount-delta` (#12), `per-channel-net-profit` (#13) — all three render through the **one shared `ChannelTruthPanel`** (one mockup covers all three). Then the alerts cluster: `campaign-died-detection` (#15), `creative-ad-fatigue-signal` (#14), `native-prioritized-action-list` (#16), `goal-pacing-alert-push` (#17), and the capstone `push-insights-digest` (#18).

**Why now:** this is where the dashboard goes from "shows numbers" to "tells you which channel makes money and what to do today." The channel split is the single biggest analytical unlock (§4) and all three channel features share one component, so the marginal cost of #12/#13 after #11 is small. The alerts cluster is now unblocked because Wave 1 shipped `roasVerdict` (#3) and `computeDigestDeltas` (#4), which the digest (#18) reuses; #16's `prioritizeInsights` dedup/rank layer is consumed by **both** the in-app `ActionListPanel` and the WhatsApp digest, so building it once serves both. #14's CTR-decay + CPM-creep legs use existing `ads_daily` columns; only the optional frequency-climb leg needs the `ads_daily.frequency` migration.

**Gate to Wave 3:** `ChannelTruthPanel` live in the hero + store modal showing NC-ROAS·nCAC·net·overcount per Meta/Google/TikTok from **mapping-aware** aggregates only (never raw account totals). The action digest fires on its cron, rides the new `roas_action_digest` template (free-text path), and the in-app `ActionListPanel` renders the same ranked top-N above the (still-collapsed) `InsightsBoard`. Operator confirms the digest content is actionable (not noisy).

### Wave 3 — Product & inventory profit
**Items:** `prod-profit-after-cogs-ads` (#19), `per-product-contribution-pnl` (#20), `inventory-stockout-vs-spend` (#21), `product-channel-matrix-standalone` (#22), `new-product-launch-tracking` (#23). (`product-cohort-repeat-driver` #39 and `repeat-purchase-cadence-per-product` #40 are explicitly held to Wave 5 / deferred — see below.)

**Why now:** once channel-level profit truth is live (Wave 2), the next decision-grade question is **per-product** profit and **whether ad money is burning on out-of-stock SKUs**. #21 is the highest-impact net-new in this wave (no inventory data enters the pipeline today; `inventory_quantity` is fetched-then-discarded) and needs the `product_catalog` stock-columns migration. #19/#20 reuse the existing `effectiveCogsPct` + `campaignProductMap.allocateProductRevenue` — the allocation is already possible; only the contribution column is missing.

**Gate to Wave 4:** product profit (after COGS + allocated spend) renders through the `<Money>` primitive in both themes; out-of-stock-with-spend rows flag visibly; the product × channel matrix shows the Shopify-side order-source mix (not just spend share). Migrations applied via the supervised procedure (hide root `.env`, move the 2 duplicate-timestamp gap files out, `supabase db push`, restore) with re-backfill noted.

### Wave 4 — Data trust + remaining UX
**Items (data trust):** `DQ-1` reconcile surface (#24), `DQ-3` override flag + audit cols (#25), `DQ-4` provenance marker (#26), `DQ-5` source-health chip (#27), `DQ-7` TikTok coverage (#28), `DQ-6` cohort as-of (#10 if not pulled into Wave 1). **Items (UX):** `ux-period-compare` (#32), `ux-saved-views` (#33), `ux-annotations-on-trends` (#34), `ux-store-compare-grid` (#35). **Profit-truth tail:** `discount-promo-leakage` (#29, needs `data_daily.discount_cad` migration + re-backfill), `budget-pacing-marginal` (#31).

**Why now:** with the high-leverage analytics shipped (Waves 1–3), this wave hardens **trust** (the operator can now see *whether today's numbers are an estimate, overridden, FX-stale, or out of reconciliation* right where decisions happen) and rounds out **workflow** (compare baselines, saved views, store grid). These are mostly M-effort deepen items grouped so their shared flag/chip primitives (OverrideFlag, ProvenanceFlag, SourceHealthChip) land together in one design pass. `discount-promo-leakage` joins here because it needs a migration + re-backfill and is med-impact, not a Wave-1 quick win.

**Gate to Wave 5:** every Home/P&L number carries its trust state (estimate vs finalized, overridden, FX-OK, in-reconciliation) without clutter; period-compare lets the operator pick the baseline; saved views recall a tab+store+range in one click. All readability/lint guards (`local/no-physical-direction-in-components`, `local/no-native-title-tooltip`, design-color green-ratchet) pass.

### Wave 5 — Attribution depth + slow-burn (some deferred)
**Items (build):** `unknown-bucket-decomposition` (#36), `survey-hdyhau-rollup` (#37, gated on operator installing a `note_attributes` survey app), `organic-baseline-incrementality-proxy` (#38). **Items (DEFER — data not ripe until ~mid-2027):** `product-cohort-repeat-driver` (#39), `channel-payback-curve` (#41); and the low-priority `repeat-purchase-cadence-per-product` (#40) only if a replenishment question becomes pressing.

**Why now / why defer:** the unknown-bucket decomposition is pure (every field is already on `OrderAttributionRow`) and worth doing once trust is solid. The survey rollup is the **only** sanctioned net-new first-party demand signal (`note_attributes`) and is blocked on the operator actually installing a survey app. The incrementality proxy is honest and feasible from data back to 2023, but is **L** effort. **Defer** the per-channel payback curve and product-first cohorts: cohort maturity (`customer_cohort_monthly` / per-cohort nCAC) only began accumulating May-2026+, so months-to-recover and "which first product drives repeat" curves are statistically thin until enough cohorts mature (~mid-2027). Building the schema early (`acquiring_channel` column DEFERRED-SCHEMA, `product_cohort_monthly`) is fine; **rendering verdicts on thin data is misleading** — so the builds are stubbed/gated off.

**Final gate:** full sweep — `npx tsc --noEmit`, both vitest configs (node + DOM), eslint, docs-currency (User Manual bump + ARCHITECTURE), green-ratchet — then a single deploy.

---

## 4. The single highest-leverage next thing — channel NC-ROAS / nCAC split (`channel-nc-roas-split`)

**Build this first after Wave 1's quick wins.** Reasons:

1. **It's the one unlock the whole gap analysis points at.** The Triple-Whale gap memo concluded the single differentiating capability worth chasing (CAPI-safe) is *new-vs-returning customer economics*. Per-store NC-ROAS already ships; the **channel axis is the missing dimension** that turns "we're profitable" into "**Meta acquires new customers at $32 nCAC and 2.1x NC-ROAS while Google is $61 and 1.4x — shift budget**."
2. **The signal already exists on every row** — `orders_attribution.source` is already `meta-paid`/`google-paid`/`tiktok-paid` (`ordersAttribution.ts:101-111`). `computeNewCustomerMetrics` filters only by `storeName`; adding an optional `source` param + a `spendByChannel` mapping-aware accumulator is the entire data change. No migration, no backfill.
3. **It pays for the rest of Wave 2.** The same `ChannelTruthPanel` surface and the same per-channel plumbing immediately carry `channel-overcount-delta` (#12) and `per-channel-net-profit` (#13) — three high-impact gaps from one component and one mockup.
4. **CAPI-safe by construction** — it reads the Shopify-side acquiring source that's already stored, never touches a pixel.

Because per-store NC-ROAS is already wired (`storeDetail.ts:259`) and blended NC-ROAS already renders in the hero (`Dashboard.tsx:978`), this is a *deepen*, not a *net-new* — the highest impact for the lowest risk in the entire program.

---

## 5. CAPI-safe SKIP list (the do-not-build boundary)

The operator runs server-side CAPI apps in **all 3 stores**. Dashboard work is **reporting-only, forever.** Never send events to pixels/CAPI (double-count / dedup-break risk). The following are **HARD SKIP** and must not appear in any plan or task:

- **Any event emission to a pixel or CAPI endpoint** (Meta CAPI, TikTok Events API, Google Enhanced Conversions, server-side tagging). Read metrics only.
- **Triple Pixel / Triple-Whale Sonar / any third-party pixel SDK.**
- **Multi-touch attribution / first-touch attribution derived from a pixel** (first-touch via pixel is out; first-touch via *cart-attributes/beacon* is a separately-gated, Google-blind follow-up — NOT in these 39).
- **Geo / holdout / true experimental incrementality tests.** Only the lightweight **organic-baseline proxy** (#38, from naturally-occurring low/zero-spend days in `data_daily`) is in scope.
- **Sending the post-purchase survey itself.** The dashboard only **reads** survey answers the operator's survey app writes into `note_attributes` (#37). It never writes events; survey capture is `note_attributes`-only.

The **only** sanctioned net-new first-party demand signal is the post-purchase "how did you hear about us" survey via `note_attributes` (#37). Everything else in the 39 is derived from data already stored.

---

## 6. How to execute

- **Each workstream plan runs via `superpowers:subagent-driven-development`** against its own plan file (failing-test-first, per-task commits, frequent small files). The plans are self-contained and reference real files/functions/line-ranges — do not re-scan or re-brainstorm.
- **UI items are mockup-first.** For every gap marked **Mockup? = yes** in §2, the FIRST task is: produce a static **light+dark, RTL** HTML mockup, deliver it to the operator as an `open <abs-path>` command (operator dislikes pasted screenshots), and **PAUSE for approval** before building. Mockups live under `docs/superpowers/mockups/2026-06-04-*/`.
- **New UI must meet the 2026-06-01 readability standard from the start** (do not retrofit): token-driven (no raw hex/oklch/px colors), light AND dark, RTL/logical classes, WCAG-AA in both themes, all numbers through the shared `<Money>`/`<Metric>` primitive (tabular-nums, never clipped), `HelpTooltip` (native `title=` is banned), and it must pass the existing guards (`local/no-physical-direction-in-components`, `local/no-native-title-tooltip`, design-color green-ratchet — allowlist is EMPTY).
- **Mapping-aware aggregates only.** Every new per-store/per-channel number comes from `data_daily` via `agg_data_daily_for_date` + `campaignStoreMap` (and `aggregate`/`aggregateByStore`) — never raw account totals. Guard with the existing mapping test suites.
- **Migrations are supervised.** For any gap that adds a column (ADD COLUMN IF NOT EXISTS, nullable): write the migration in repo-root `supabase/migrations/`, but **apply** it only on operator "go" via the documented procedure — hide the root `.env` (dotted keys break the CLI parser), move the 2 duplicate-timestamp gap files (`20260530300000_phase_d_soak_cleanup` + `20260530310000`) out so `supabase db push` doesn't fail on duplicate keys, push, then restore. Include a re-backfill note (e.g. discount_cad, survey_source, product_cohort_monthly).
- **Per-wave: no drip-deploy.** Audit all items in the wave, build all, verify every affected tab in **both themes locally**, run the full gate (`npx tsc --noEmit -p dashboard-web/tsconfig.json`, `npm test`, `npm run test:components`, `npm run lint`, docs-currency: User Manual bump for any UI change + ARCHITECTURE for any lib/inngest/migration change), then **one** `git push origin main`.
- **Every externally-called route** (new cron for the action digest, any new webhook) must be registered in `serve()` AND added to `isDashboardAuthAllowlisted`, or the password gate silently 401s the Inngest sync.

---

### Sequencing summary

```
Wave 1  (S, surface-math)   #1 today-default ▸ #2 run-rate ▸ #3 break-even ▸ #4 deltas ▸ #5 FX ▸ #6 CSV ▸ #7 search  (+#8 #9)
   │  gate: today-default live; run-rate live; FX alert fires; roasVerdict + computeDigestDeltas green (digest foundations)
Wave 2  (leverage core)     #11 channel NC-ROAS ▸ #12 overcount ▸ #13 per-channel net  ||  #15 died ▸ #14 fatigue ▸ #16 action-list ▸ #17 pacing ▸ #18 push-digest
   │  gate: ChannelTruthPanel live (mapping-aware); action digest fires on cron; ActionListPanel in-app
Wave 3  (product/inventory) #19 product-profit ▸ #20 contribution ▸ #21 stock-out ▸ #22 prod×channel ▸ #23 launch
   │  gate: product profit + OOS-with-spend flag live; migrations applied (supervised)
Wave 4  (trust + UX)        #24 reconcile ▸ #25 override-flag ▸ #26 provenance ▸ #27 source-health ▸ #28 tt-coverage ▸ #10 cohort-asof  ||  #32 compare ▸ #33 saved-views ▸ #34 annotations ▸ #35 store-grid  ||  #29 discount ▸ #31 budget-pacing
   │  gate: every Home/P&L number carries its trust state; period-compare + saved-views live
Wave 5  (attribution + slow-burn)  #36 unknown-bucket ▸ #37 survey (operator-gated) ▸ #38 incrementality   ||   DEFER: #39 product-cohort, #41 channel-payback, (#40 cadence)
   │  final gate: full sweep + single deploy
```
