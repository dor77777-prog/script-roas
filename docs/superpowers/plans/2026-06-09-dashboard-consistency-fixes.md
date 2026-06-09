# Dashboard Consistency / Truth Fixes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task ends with the full test suites (`npx tsc --noEmit`, `npx vitest run`, `npm run test:components`) green before commit. **Do NOT push** — the operator deploys via `git push origin main` only when asked.

**Goal:** Close the 12 confirmed cross-surface / live-vs-DB truth-divergences found in the 2026-06-09 dashboard consistency audit, so every tab, card, chart, drawer, table, and the AI report agree with each other and with the database — without breaking anything that is correct-by-design.

**Architecture:** Source-of-truth unification. Each fix either (a) routes two surfaces through one shared helper/aggregate, (b) makes a write-path respect the operator's authoritative value, or (c) corrects a label/color/empty-state to match the number it sits on. No metric *semantics* change except where a formula is provably wrong.

**Tech Stack:** Next.js + React (client components), TypeScript, Vitest (node + jsdom projects), Supabase Postgres + RPCs, Inngest crons.

---

## ⚠️ DECISION POINTS — operator must choose before execution

| # | Decision | Options | Recommendation |
|---|---|---|---|
| **D1** | TikTok override protection (Task 1) | (a) add override guard *inside* `agg_data_daily_for_date` RPC so all 3 callers inherit it; (b) gate the unified-RPC call in `cronLive`/`tiktokWorker` | **(a) in-RPC guard** — one place, all callers safe |
| **D2** | RoasTargetChart "previous period" (Task 3) | (a) compute a chart-range-specific previous aggregate; (b) relabel the footer to say it's the page-filter's prior window | **(a) chart-range prev** — a coherent same-window comparison is the real fix |
| **D3** | ROAS = 3.0 band boundary (Task 11) | 3.0 → green ("at target") everywhere, or 3.0 → blue ("above") everywhere | **3.0 = green (at target)** — matches the operator-locked 3× = target memory; change `useRoasBandGradient` `>=3.0`→`>3.0` |
| **D4** | RoasTargetChart KPI tile band basis (Task 7/9) | band/tint from the *displayed* spend-weighted number, or from the daily-mean anchor | **From the displayed number** — color must match the number on the tile |
| **D5** | ProductsTable net-revenue color (Task 8) | neutral net value (let margin column carry the discount signal), or invert so green = small haircut | **Neutral net value** — least surprising; margin already signals |

If you accept all recommendations as-is, reply "accept defaults" and execution proceeds with them.

---

## 🚫 DO NOT TOUCH — false-alarms (correct-by-design)

These were checked and are intentional; changing them would BREAK correct behavior:

- Operating profit (`rev−spend−cogs`, hero "רווח תפעולי") vs true net profit (`−fees−fixed−salaries`, P&L "רווח נטו אמיתי") — two labeled profit levels.
- "MER" vs "ROAS" labels — same blended `revenue/spend`; MER == ad-ROAS because there is no non-ad marketing spend.
- The **three** campaign ROAS columns (platform / Shopify-allocated / Shopify-deterministic) — distinct labeled metrics, not one metric thrice.
- Ad-set/ad-grain "ROAS Shopify" (deterministic only) vs campaign-grain (tiered + mapping) — mapping is campaign-level by design.
- GoalTracker business-wide scope (ignores `filters.store`) — locked.
- Customers-tab stable-window nCAC vs Home range-scoped nCAC; LTV:nCAC mature-cohort ratio; repeat-rate vs new/returning-orders — different windows/units, all labeled.
- Payments revenue (refund-net `orders_attribution`) vs P&L gross (`data_daily.gross_revenue`) — two intentional revenue bases.
- `data_daily.net_profit_cad` static-COGS vs UI editable-COGS override (`applyCogsToRows`) — locked client-side recompute.
- AI report Health Score ≠ table Health Score (omits cohort ±15) — disclosed in-report.
- AdsDrawer totals (`ads_daily`) not exactly reconciling to campaign row (`campaigns_daily`) — Meta attribution-window dedup across two pipelines.
- Per-store gross-based AOV (so the $50/$70 band doesn't false-flip) — locked.

A CI guard task (Task 13) adds an assertion list so these stay protected.

---

## File map (what each task touches)

| Task | Primary files | Risk |
|---|---|---|
| 1 TikTok override | `supabase/migrations/<new>.sql` (RPC guard) OR `src/inngest/functions/cronLive.ts`, `tiktokWorker.ts` | **load-bearing** |
| 2 AdsDrawer error | `src/components/AdsDrawer.tsx`, `src/app/api/ads/route.ts` (type), new `.dom.test.tsx` | safe |
| 3 Chart prev-period | `src/components/Dashboard.tsx` (chart wiring), `src/components/home/RoasTargetChart.tsx` | moderate |
| 4 AOV in AI report | `src/lib/aiReport.ts` | safe |
| 5 ProductCentricView allocator parity | `src/components/ProductCentricView.tsx`, `src/lib/productCentricView.ts` | moderate |
| 6 ProductCentricView null-net | `src/lib/productCentricView.ts` | safe |
| 7 Ads/ad-set pending ladder | `src/components/AdSetTable.tsx`, `AdsDrawer.tsx`, `campaign-drawer/CampaignDrawerAds.tsx` | safe |
| 8 ProductsTable net color | `src/components/ProductsTable.tsx` | safe |
| 9 Chart anchor vs tile basis | `src/components/home/RoasTargetChart.tsx`, `src/lib/synthesis/roasChart.ts` | safe |
| 10 Chart band vocabulary | `src/components/home/RoasTargetChart.tsx` | safe |
| 11 ROAS=3.0 boundary | `src/lib/useRoasBandGradient.ts` (or `analytics.ts roasLabel`) | safe |
| 12 Stale prose | `src/components/Dashboard.tsx` (P&L intro), `src/components/AnalysisTrendsTab.tsx` | safe |
| 13 Polish + guards | chart CPM, AI-report copy, payment chips + a false-alarm CI guard | safe |

Pre-step for all tasks: **re-run the failed `campaign-drawer` sub-tab auditor** (read-only) to confirm no additional drawer-internal conflicts before locking scope.

---

## Task 1 — TikTok manual-override clobber (HIGH · live-vs-DB · load-bearing)

**Problem:** The operator's typed TikTok spend override on `data_daily.tt_spend_cad` is protected only in `cronDaily` (it skips `agg_tiktok_spend_per_store_for_date` when `merged.overridesApplied.tiktok`). The **unified** `agg_data_daily_for_date(d)` RPC (migration `20260530310000:36-66`, Pass 1) unconditionally zeroes + re-sets `tt_spend_cad` and is called by `cronLive.ts:445` + `tiktokWorker` → the override is overwritten within ~10 min.

**Files:**
- Per D1(a): Create `supabase/migrations/<ts>_agg_rpc_tiktok_override_guard.sql` — modify `agg_data_daily_for_date` so the `tt_spend_cad` zero+set skips `(date, store_id)` pairs that have an active TikTok row in `manual_overrides`.
- Verify callers: `src/inngest/functions/cronLive.ts:445`, `tiktokWorker.ts`.
- Doc: `docs/ARCHITECTURE.md` (override invariant), `docs/cost`/reconcile note.

- [ ] Step 1: Read the current `agg_data_daily_for_date` body (latest migration that defines it) + `agg_tiktok_spend_per_store_for_date` (the guarded sibling) + how `manual_overrides` is keyed (platform='tiktok', date, store).
- [ ] Step 2: Extend the reconcile harness (`npm run audit:reconcile`, INV-7) so it FAILS when a `data_daily.tt_spend_cad` value diverges from the active override (write the failing invariant first).
- [ ] Step 3: Write the migration adding a `NOT EXISTS (SELECT 1 FROM manual_overrides mo WHERE mo.platform='tiktok' AND mo.store_id=... AND mo.date=d AND mo.active)` guard around the `tt_spend_cad` mutation in `agg_data_daily_for_date`.
- [ ] Step 4: Apply via the documented Supabase procedure (hide root `.env`, park the 2 duplicate-timestamp gap files, `supabase db push --linked`, restore).
- [ ] Step 5: Re-run reconcile → INV-7 passes; manually verify a uzoshop TikTok override survives a `cron-live` tick in prod.
- [ ] Step 6: Commit.

**Risk:** load-bearing (RPC + write path). **Mitigation:** in-RPC guard is the smallest blast radius; reconcile invariant locks it.

---

## Task 2 — AdsDrawer masks a real /api/ads failure as "no ads" (HIGH · empty-state · safe)

**Problem:** `api/ads/route.ts:53-65` returns `{ rows: [], error }` with **HTTP 200** on a DB failure. The AdsDrawer fetcher (`AdsDrawer.tsx:73-77`) throws only on `!r.ok`, so a 200-with-error resolves as success → `rows:[]` → the "אין נתוני מודעות לטווח הזה" empty state masks a real failure.

**Files:** `src/app/api/ads/route.ts` (add `error?: string` to `AdsResponse`), `src/components/AdsDrawer.tsx:73-77`, new `src/components/__tests__/adsDrawerErrorState.dom.test.tsx`.

- [ ] Step 1: Write a failing DOM test: render AdsDrawer with a fetch returning a 200 body `{ rows: [], dataLastWriteAt: null, error: 'boom' }`; assert an **error alert** renders (not the "no ads" empty state).
- [ ] Step 2: Run it → fails (currently shows the empty state).
- [ ] Step 3: In the AdsDrawer fetcher: `const j = await r.json(); if (j && j.error) throw new Error(j.error); return j;`. Add `error?: string` to the `AdsResponse` type.
- [ ] Step 4: Render an error state when the SWR `error` is set (reuse the existing error-alert primitive used elsewhere).
- [ ] Step 5: Run the test → passes. Run `npm run test:components`.
- [ ] Step 6: Commit.

**Risk:** safe — restores the already-intended P0-9 guarantee; no formula touched.

---

## Task 3 — RoasTargetChart "previous period" range coherence (HIGH · range-coherence · moderate)

**Problem:** The chart's KPIs/line use `chartScope.agg` over `chartFromTo` (its own picker, default 30d; `Dashboard.tsx:1397`), but `toChartData` is handed `prevAggFromPrevData` built over `previousRange(filters.range)` — the **page filter's** previous window (`Dashboard.tsx:1080-1094`, `1418`). The footer (`RoasTargetChart.tsx:991-1013`) presents that as the chart's prior period → wrong comparison on first load (page='today', chart='30d').

**Files:** `src/components/Dashboard.tsx` (chart wiring ~1397-1418), `src/components/home/RoasTargetChart.tsx:991-1013`.

- [ ] Step 1: Read `chartScope`/`chartFromTo`/`prevAggFromPrevData` derivation; identify the `chartDataResp` SWR window.
- [ ] Step 2: Per D2(a): derive an equal-length **prior slice of the chart's own window** (`previousRange(chartFromTo)`), aggregate it from the chart data already in hand (no new fetch if the SWR window covers it; else add a range-keyed fetch), and pass THAT as `prevAgg` into `toChartData`.
- [ ] Step 3: Add a Dashboard-level unit/DOM test (or a pure-fn test on the derivation) asserting the chart footer's "previous period" ROAS equals the aggregate over `previousRange(chartFromTo)`, NOT `previousRange(filters.range)`.
- [ ] Step 4: Verify both suites green.
- [ ] Step 5: Commit.

**Risk:** moderate — touches Dashboard chart wiring. If a clean chart-range prev aggregate proves non-trivial, fall back to D2(b) (relabel) and flag.

---

## Task 4 — AOV definition unification in the AI report (HIGH · metric-def · safe)

**Problem:** `aiReport.ts:355` computes `aov = revenue / totalOrders` where `revenue` is NET (`:300`) and `totalOrders` is Σ`products_daily.orders` (`:320-328`) — product-summed (double-counts multi-product orders). Every dashboard surface uses **gross ÷ distinct orders**.

**Files:** `src/lib/aiReport.ts` (~355).

- [ ] Step 1: Write a failing test (extend `aiReportTruePnlMer` or new): a fixture with 1 order containing 2 products (so product-summed orders = 2, distinct = 1) and gross≠net; assert the report's summary AOV = `grossRevenue / distinctOrders`.
- [ ] Step 2: Run → fails.
- [ ] Step 3: Use the in-function values already present: numerator `grossRevenue` (`:301`), denominator the true distinct order count (`orders.length` / `grandOrders` `:786`). Keep the product-summed count only where it's explicitly labeled "by product".
- [ ] Step 4: Run → passes.
- [ ] Step 5: Commit.

**Risk:** safe — report-only; no UI depends on this number.

---

## Task 5 — ProductCentricView allocator parity with the drawer (HIGH · metric-def · moderate)

**Problem:** Per-(product,campaign) allocated Shopify revenue differs between `ProductCentricView` (Products tab) and `CampaignDrawer`. The drawer threads `orders` → deterministic-first allocator (click-id credited, remainder spend-split); `ProductCentricView.tsx:313-319` calls `buildProductCentricView` **without** orders → simplified spend-split only.

**Files:** `src/components/ProductCentricView.tsx`, `src/lib/productCentricView.ts:313-319`.

- [ ] Step 1: Read `allocateProductRevenue`'s `orders` contract + how the drawer maps rows to `{storeId, source, fbclidPresent, gclidPresent, lineItems}`.
- [ ] Step 2: In ProductCentricView add a range-keyed SWR fetch of the same `/api/orders-attribution` endpoint the drawer reads; map rows to the allocator's order shape; thread `orders` (and `productUnits` from `products_daily`) into `buildProductCentricView`.
- [ ] Step 3: The existing allocator parity test suite locks the deterministic-first path — extend/point a test asserting ProductCentricView and the drawer produce the SAME allocated revenue for a fixture (product mapped to 2 campaigns, 1 click-id order + 1 unattributed).
- [ ] Step 4: Both suites green.
- [ ] Step 5: Commit (do together with Task 6 — same file).

**Risk:** moderate — adds a fetch; the parity test guards it.

---

## Task 6 — ProductCentricView null-net fallback (MEDIUM · metric-def · safe)

**Problem:** `productCentricView.ts:269` sums `(r.netRevenue ?? 0)` → a legacy null-net row contributes 0; the drawer (`campaign-drawer/index.tsx:501`) uses `(p.netRevenue ?? p.revenue)` → gross. Same rows, two totals.

**Files:** `src/lib/productCentricView.ts:269`.

- [ ] Step 1: Failing test: a product row with `netRevenue: null, revenue: 100`; assert the view's net total uses 100 (drawer basis), not 0.
- [ ] Step 2: Run → fails.
- [ ] Step 3: Change `(r.netRevenue ?? 0)` → `(r.netRevenue ?? r.revenue)`.
- [ ] Step 4: Run → passes.
- [ ] Step 5: Commit (folded with Task 5).

**Risk:** safe.

---

## Task 7 — Ads / ad-set pending-state ladder (MEDIUM · empty-state · safe)

**Problem:** The campaigns table shows `מתעדכן…/ממתין…` for today spend=0 rows; the drill-downs still show a bare `—`: `AdSetTable.tsx:200`, `AdsDrawer.tsx:527` (totals) + `:638` (per-ad), `CampaignDrawerAds`.

**Files:** `src/components/AdSetTable.tsx`, `AdsDrawer.tsx`, `campaign-drawer/CampaignDrawerAds.tsx`. Reuse `src/lib/campaignPendingState.ts`.

- [ ] Step 1: Confirm each component's available range signal (AdsDrawer already has `rangeFrom/rangeTo`; thread `rangeIncludesToday = rangeTo >= todayInIsrael()` into AdSetTable + CampaignDrawerAds).
- [ ] Step 2: Failing DOM test: an ad row with spend=0, value>0, range includes today → renders "מתעדכן…", not "—".
- [ ] Step 3: Replace each `roas > 0 ? formatNumber(...) : '—'` with the `campaignPendingState({spend, conversionValue: value, conversions, impressions}, rangeIncludesToday)` ladder (muted text + tooltip), mirroring `CampaignsTableRow`.
- [ ] Step 4: Both suites green.
- [ ] Step 5: Commit.

**Risk:** safe — reuses the existing pure helper.

---

## Task 8 — ProductsTable green-on-discount color (MEDIUM · color-valence · safe)

**Problem:** `ProductsTable.tsx:630-631` colors the Net cell green when `netRevenue < revenue` (true for ANY haircut), while the adjacent Margin cell (`:659-662`) is green only when `margin>=0.95`. A heavily-discounted product shows green net + red margin.

**Files:** `src/components/ProductsTable.tsx:630-631`, `:777` (SummaryCard accent).

- [ ] Step 1: Failing DOM test: a product with a large haircut (net=60, gross=100) → the Net cell is NOT green (neutral ink), the Margin cell is red/orange.
- [ ] Step 2: Per D5: make the Net value neutral ink (`text-ink`), remove the `netRevenue < revenue → green` rule; same at the SummaryCard accent.
- [ ] Step 3: Both suites green.
- [ ] Step 4: Commit.

**Risk:** safe — color-only.

---

## Task 9 — RoasTargetChart TL;DR vs KPI tile ROAS basis (MEDIUM · ROAS-basis · safe)

**Problem:** TL;DR anchors on the unweighted daily-ROAS mean (`roasChart.ts:144,155`); the KPI tile shows the spend-weighted blend `agg.roas` (`RoasTargetChart.tsx:542`); the tile band keys off the mean (`accentBand=synthesis.band`).

**Files:** `src/components/home/RoasTargetChart.tsx`, `src/lib/synthesis/roasChart.ts`.

- [ ] Step 1: Per D4: derive `accentBand` from `useRoasBandGradient(kpis.roas)` (the displayed number) so color always matches the tile number.
- [ ] Step 2: Relabel the TL;DR sentence to disclose it is the **daily-average** ROAS (keep it; it is the trend anchor), so the two "ROAS" numbers are clearly different things.
- [ ] Step 3: Test asserting the tile band == band(displayed kpis.roas).
- [ ] Step 4: Suites green. Commit.

**Risk:** safe — presentation-only.

---

## Task 10 — RoasTargetChart band vocabulary unification (MEDIUM · label · safe)

**Problem:** Chart band chip uses a local `bandLabelHe` ("מתחת ליעד/דורש מעקב/סביב היעד/מעל יעד", `RoasTargetChart.tsx:159-164`) while per-store cards use `BAND_TAG_LABEL` ("דורש בחינה/סביר/טוב/מעולה"). Same band, two vocabularies on one tab.

**Files:** `src/components/home/RoasTargetChart.tsx`.

- [ ] Step 1: Replace `bandLabelHe()` with the canonical `BAND_TAG_LABEL`/`roasLabel()` wording (one source of truth).
- [ ] Step 2: Test asserting the chip label == the per-store tag label for the same band.
- [ ] Step 3: Suites green. Commit.

**Risk:** safe — copy-only. (If you prefer the "מול היעד" framing, we apply it to the per-store tags too — pick ONE.)

---

## Task 11 — ROAS = 3.0 band boundary alignment (LOW edge · safe)

**Problem:** `useRoasBandGradient.ts:57-58` maps `>=3.0 → blue`; `roasLabel` (`analytics.ts:451-452`) maps `<=3 → green`. At exactly 3.00 a `StoreDetailModal` badge (roasLabel) is green while the gradient card is blue.

**Files:** `src/lib/useRoasBandGradient.ts` (or `analytics.ts`).

- [ ] Step 1: Per D3 + the locked 3×=target memory: 3.0 = "at target" = **green**. Change `useRoasBandGradient` `roas >= 3.0 → blue` to `roas > 3.0 → blue` (3.00 → green), matching `roasLabel`.
- [ ] Step 2: Test asserting both helpers return the same band at 2.99 / 3.00 / 3.01.
- [ ] Step 3: Verify no band-snapshot/contrast guard regresses. Suites green. Commit.

**Risk:** safe but verify against the operator-locked band thresholds.

---

## Task 12 — Stale prose (MEDIUM/LOW · label · safe)

**Problem:** (a) P&L `SectionIntro` (`Dashboard.tsx:1608`) hardcodes "COGS (25%) … משכורות (7%)" while both are operator-editable and the P&L line shows the effective rate. (b) `AnalysisTrendsTab.tsx:48` claims "17-month monthly tables" that actually live in the Archive tab.

**Files:** `src/components/Dashboard.tsx:1608`, `src/components/AnalysisTrendsTab.tsx:48`.

- [ ] Step 1: (a) Make the COGS/salaries figures dynamic from `filtered.curAgg` (`effectiveCogs% = curAgg.cogs/curAgg.revenue`, `salaries% = curAgg.salaries/curAgg.revenue`), OR drop the parenthetical percentages. Extend the existing P0-1 prose guard to assert the Dashboard intro no longer hardcodes "25%".
- [ ] Step 2: (b) Rewrite the Trends intro to describe only the ROAS chart + annotations (point to Archive for the 17-month tables).
- [ ] Step 3: Suites green. Commit.

**Risk:** safe — copy-only.

---

## Task 13 — Low-priority polish + false-alarm CI guard (LOW · safe)

**Files:** `src/components/home/RoasTargetChart.tsx` (CPM tile), `src/lib/aiReport.ts` (today-row copy + order-count label), `src/components/.../PaymentMethodsTab.tsx`, new `src/lib/__tests__/consistencyFalseAlarms.guard.test.ts`.

- [ ] Step 1: Chart CPM KPI tile: render "—" when CPM is missing/loading (match the hero), not "0.00" (`toChartKpis` guard).
- [ ] Step 2: AI report: a today row with spend>0/revenue=0 labels "מתעדכן" not "0 (FAILED)" (`aiReport.ts:571`); relabel "הזמנות (Shopify בפועל)" / funnel CR to clarify product-summed vs distinct.
- [ ] Step 3: Payment %-chips: round with a largest-remainder (Hamilton) pass so the category chips sum to 100%.
- [ ] Step 4: Add a guard test enumerating the false-alarm invariants (e.g. hero label = "רווח תפעולי", P&L = "רווח נטו", the 3 ROAS columns exist, GoalTracker ignores store) so a future "consistency fix" can't accidentally collapse a correct-by-design distinction.
- [ ] Step 5: Suites green. Commit.

**Risk:** safe.

---

## Self-review notes
- **Spec coverage:** Tasks 1–13 cover all 12 confirmed findings + the 4 low-polish items + a protective guard. Gap: the `campaign-drawer` sub-tab auditor failed (rate-limit) — re-run it (pre-step) before locking; any new finding becomes Task 14.
- **Decision points** D1–D5 are surfaced up top; nothing is implemented until the operator chooses (or accepts defaults).
- **Sequencing:** fix order = HIGH first (1–4), then the safe metric/label/color cluster (5–12), polish last (13). Tasks 5+6 and the chart tasks (3,9,10) share files — batch them.
