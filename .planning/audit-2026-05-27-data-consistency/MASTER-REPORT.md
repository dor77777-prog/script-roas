# Data-Consistency & Algorithm-Correctness Audit — Master Report

**Date:** 2026-05-28
**Method:** Live reconciliation harness (`npm run audit:reconcile`, AUDIT_LIVE-gated, hits prod) + 10 parallel domain agents (A1–A10), each verifying code AND live production numbers.
**Production:** `https://roas-dashboard-smoky.vercel.app`
**Branch:** `audit/data-consistency-2026-05-27`
**Trust model:** internal tool, single-user-at-a-time, URL-obscurity. Severities calibrated to that model.

## Executive summary

- **The headline finding is a cross-surface "net profit" conflict.** The string "רווח נטו" (net profit) renders **three different numbers** for the same period: KpiCards uses `trueNetProfit` (rev − spend − COGS − fees − fixed), while **HeroOverview** and the **AI executive briefing** use `netProfit` (rev − spend − COGS, omitting fees + fixed). Live May 20–26: $3,953 vs $5,124 (+23%); AI report May 1–28: 32,924 vs True Net 26,367 (+24.9% / +6,557 CAD). This is exactly the "same thing shown in two places must agree" violation the audit was commissioned to find. **→ P0.**
- **One real revenue-correctness bug:** `orders_attribution.totalCad` is fetched from Shopify `current_total_price` (a live, mutates-on-refund value) instead of the immutable `total_price`. Historical attribution totals shrink over time as refunds post — early-May uzoshop sums to ~$7,250 vs ~$72,275 expected (≈10:1). **→ P0.**
- **A campaigns/ads pipeline gap that the two algorithm agents disagree on:** `campaigns_daily` is missing/severely understated for Meta on uzoshop (12.7× below `data_daily` for late May) and entirely empty for Zol Plus, and `ads_daily` Σ ≠ `campaigns_daily` Σ (66% gap). A3 calls it a live cron bug; A7 attributes early-May to decommissioned Apps Script and late-May to cadence. **Severity pending root-cause** — could be P0 (campaign-level views materially wrong) or partly expected. First fix-phase action is to resolve this disagreement.
- **Two API-contract sharp edges:** `/api/orders-attribution` (and `/api/data`) silently ignore `?store=` and silently fall back to a default 90-day window when given misnamed params (no 400). The SPA is safe (it always emits correct params), so impact is on direct/automation consumers. **→ P1.**
- **Algorithm-correctness:** ROAS color banding has two conflicting definitions (2.6 → orange in tables, green on hero); cannibalization `revenueGrowthPct` still divides by `|earlyRev|` (misreports negative-both-halves); window-stability coverage clamp is upper-side-only (false "volatile" on refund weeks). The 2026-05-24 percent-of-revenue projection P0-B re-verified **fixed**; Health Score monotonicity/bounds/weights re-verified **sound**.
- **Operator console:** token-failure surfaces render false-green when the DB read fails, and `resolveTokenFailure` swallows Supabase errors — the operator can be blind to expired tokens. **→ P1** (relevant given the token-failure-alerts work is live).
- **Lots verified correct (no findings):** INV-1/2/3/4/6 cross-component sums, FX applied exactly once, Asia/Jerusalem timezone uniform, all divisions guarded against NaN/Infinity, INV-16 cohort no-double-count, URL round-trip identity, manual-overrides do merge, ResetData properly gated.

## P0 — Fix before full production release

| # | Finding | Agents | File:line | Live evidence | Fix |
|---|---------|--------|-----------|---------------|-----|
| **P0-1** | "רווח נטו" means 3 different formulas across KpiCards / HeroOverview / AI report. Same label, conflicting numbers. | A1-F1, A10-04 | `HeroOverview.tsx` (uses `netProfit`), `KpiCards.tsx` (`trueNetProfit`), `aiReport.ts` | May 20–26 $3,953 vs $5,124; AI 32,924 vs 26,367 | Pick ONE definition of net profit (trueNetProfit is the dashboard's authoritative one) and use it everywhere the label "רווח נטו" appears; or relabel the looser figure (e.g. "רווח תפעולי"). Lock with a test asserting the three surfaces agree. |
| **P0-2** | `orders_attribution.totalCad` uses Shopify `current_total_price` (post-refund, mutates) instead of immutable `total_price`. Historical totals shrink over time. | A4-02, A4-03 | `dashboard-web/src/lib/fetchers/shopify.ts:1055` | uzoshop May 1–10 orders ≈ $7,250 vs products ≈ $72,275 | Use `total_price` (matches the fetcher's stated Invariant 1). Backfill affected rows. Test locks the field choice. **FIXED** in commit `68a8c31`; test `shopifyOrdersAttributionTotalPrice.test.ts` locks the field choice. Historical `orders_attribution` rows hold the old (shrunken) values — operator must re-run cron-daily / backfill for the affected date range to correct stored `totalCad`. |
| **P0-3?** | `campaigns_daily` missing/understated for Meta (uzoshop 12.7× gap late May; Zol Plus empty) and `ads_daily` Σ ≠ `campaigns_daily` Σ (66%). **Partly EXPLAINED, remainder pending root-cause.** | A3-01/02/03 vs A7-F3; **+ operator** | cron Meta campaign writer; `fetchCampaignsFromPostgres` zero-activity filter; `manual_overrides` merge | uzoshop Meta campaigns ~$267 vs data_daily $3,400 (May 25–27); Zol Plus 0 rows | **EXPLAINED — May 1–8 uzoshop Meta+Google:** operator entered **manual overrides** during a Meta/Google account outage; overrides write data_daily aggregate but have no campaign breakdown, so campaigns_daily is correctly empty for those dates. **NOT a bug.** Remaining real questions: (a) late-May (May 25–27) uzoshop Meta 12.7× gap — outside the override window; (b) Zol Plus has zero Meta campaigns ever; (c) ads_daily↔campaigns_daily 66% desync. Investigate (a)(b)(c) only. |

## P1 — Significant

| # | Finding | Agents | File:line | Fix sketch |
|---|---------|--------|-----------|-----------|
| P1-1 | ROAS banding conflict: `roasLabel` (orange 2.0–2.7 / green 2.7–3.0) vs `TodayLive` (orange 2.0–2.5 / green 2.5–3.0). ROAS 2.6 = orange in tables, green on hero. | A9-05 | `analytics.ts` roasLabel, `TodayLive.tsx` | Single source of truth for bands; delete TodayLive's local copy; fix User Manual. |
| P1-2 | `/api/orders-attribution` & `/api/data` silently ignore `?store=` and silently default to 90-day window on misnamed params (no 400). | A4-04, A1-F7, A5-F5-01 | orders-attribution route, `dateRange.ts parseRangeParams` | Either honor `?store=` server-side or return 400 on unknown/missing required params; document the contract. |
| P1-3 | SEED-1: null-product-id refund line items deducted from store net but not from any product bucket → `Σ products.netRevenue` > `data_daily.revenue` by `customItemRefundCad` ($1.5k–$5.4k/day uzoshop). Undocumented; not surfaced. | A4-01 | `shopifyRevenueRefunds.ts:363-396` | Surface a reconciliation line, or attribute custom-item refunds; document the semantic. |
| P1-4 | Cannibalization `revenueGrowthPct` divides by `Math.abs(earlyRev)` → negative-both-halves reports false positive growth ("no cannibalization" while losing money). (2026-05-24 flag, still live.) | A9-02 | `cannibalizationDetection.ts` | Signed denominator; return `null` when `earlyRev ≤ 0`. |
| P1-5 | Window stability coverage clamp is upper-side only (`min(2, matched/meta)`); refund weeks with negative coverage flow unbounded into σ → false "volatile". (2026-05-24 flag, still live.) | A9-03 | `insights.ts computeWindowStability` | Clamp `matched` to `≥ 0` before σ; add refund-week test. |
| P1-6 | Percent-of-revenue "All" fixed-cost rows: per-store view uses even split (amount/N) while single-store filter charges that store's actual %. Per-store attribution inconsistent (uzoshop off $1,043.96 in May). Global Σ holds; not currently user-visible. | A2-06, A2-09, A10-01 | `billing.ts:251`, `analytics.ts:231-237`, `insights.ts:599-607` | Revenue-weighted split in `billingForRange` for percent "All" rows; thread `revenueByStore` into forecast. |
| P1-7 | `cron-live-heavy` combines fetch+persist in one `step.run` → Inngest retry re-fetches fresher data and overwrites the prior attempt. | A7-F2 | `cronLiveHeavy.ts:200` | Split into separate `fetch` and `persist` steps (mirror cron-live's memoized pattern). |
| P1-8 | Operator token-failure surfaces render false-green when the DB read fails (client coerces `!ok`→`{rows:[]}`, never checks `data.error`); `resolveTokenFailure` swallows Supabase error. | A8-F1, A8-F2 | TokenFailuresTable.tsx, token-failures route, resolveTokenFailure helper | Check `data.error`; surface read/update failures distinctly from "all green". |
| P1-9 | `products_daily.grossRevenue == netRevenue` on all sampled rows (refund % renders 0% despite known refunds) — gross column may not be populated. | A4-05 | products writer / `postgresReaders.ts` products reader | Confirm `gross_revenue_cad` is written on refund days; fix if always equal to net. |

## P2 — Cleanup / lower priority

- **STORE_COLORS triple-defined with conflicting hex:** `PerStoreCards.tsx` & `TodayLive.tsx` (red/green for Zol Plus/360usmile) vs `RoasChart.tsx` (amber/teal). Same store, different color identity across views. Centralize into `lib/storeColors.ts`. (A1-F5, A6-S2)
- **MonthlyTables ignores the global store filter** (has its own dropdown init'd to alphabetical first store) — confusing when a global store is selected. Undocumented. (A5-F5-02)
- **Health Score JSDoc says profitability 45%; actual 0.40** (stale comment). (A9-01)
- **AI report & PnLBreakdown hardcode "25% COGS" copy** — will mislead if any store's rate is recalibrated. (A2-08, A10-05)
- **Insights "dead day" fires CRITICAL on the still-loading current day** (spend>50, revenue==0) with no completeness guard. (A9-04)
- **Leader/risk badge:** uses `withRoas[0]` not an explicit max (latent if upstream sort changes); on all-below-2.0, trophy shown on a red-zone leader and risk warning suppressed. (A9-06, A9-07)
- **Latent ÷0:** `campaignHealthScore.ts:256` `(pivot-1.0)` would be Infinity if a platform pivot were 1.0 (current values safe). (A6 latent)
- **Dead code:** `costs.ts buildPnLBreakdown` has no callers; hardcodes 6.5%. (A2-07)
- **`TabKey` declared in both `urlState.ts` and `Dashboard.tsx`** (drift risk). (A5-F5-03)
- **Freshness chip** scopes `updated_at` to selected range → false-red on historical ranges though cron is healthy. (A7-F1)
- **No TikTok manual-override path** (CHECK constraint meta|google); operator can't correct TikTok spend. (A8-F4)
- **Operator store buttons show internal IDs** (`zolplus`/`usmile360`) not display names. (A8-F3)

## Cross-track convergence (independent corroboration = high confidence)

| Issue | Agents | Why it matters |
|-------|--------|----------------|
| Net-profit definition inconsistency | A1 + A10 | Two independent agents found the same label rendering different formulas on different surfaces. The core consistency defect. |
| `data_daily.revenue` is the low anchor (INV-9 + INV-10 co-fire) | A1 + A4 + harness | Three signals agree the gap is on the data_daily side; A4 pinned two distinct causes (cross-day refunds + current_total_price bug). |
| Banding / color identity conflicts | A6 + A9 | Two agents found the same cross-component "same store/metric shown differently" class. |
| 2026-05-24 algorithm flags still live | A9 (cannibalization, stability) | Confirms the prior audit's MED findings were never fixed. |

## Verified correct (no action)

INV-1/2/3/4/6 cross-component sums exact; FX once; Asia/Jerusalem uniform; all divisions guarded (no NaN/∞ reaches UI); INV-16 cohort sum-conservation exact; URL round-trip identity; previousRange/getPreviousPeriod equivalent & correct; manual overrides merge into data_daily; JobsTable soft-fail; ResetData gated; GoalTracker global scope; forecast ≥ MTD & ==MTD on last day; 2026-05-24 P0-A/P0-B percent-billing fixes hold; Health Score monotonic/bounded/weighted/NaN-safe; cohort once-guard; ROAS `roasLabel` itself a clean total partition.

## Recommended fix order (dependency-ordered)

1. **P0-1 net-profit unification** — smallest blast radius, highest "consistency" value. Pick trueNetProfit everywhere or relabel. Test locks 3 surfaces. (~1-2 hrs)
2. **P0-2 orders_attribution `total_price`** — one-line fetcher fix + backfill + test. (~1 hr + backfill)
3. **P0-3 root-cause campaigns/ads gap** — investigate A3 vs A7; fix writer if real, else document. (timeboxed investigation first)
4. **P1 batch A (cross-component):** P1-1 banding SSOT, P1-2 API param contract, P1-8 token-failure surfacing. (~half day)
5. **P1 batch B (algorithms):** P1-4 cannibalization denom, P1-5 stability clamp, P1-6 percent-split. (~half day)
6. **P1 batch C (pipeline/data):** P1-3 custom-item refund reconciliation, P1-7 cron-live-heavy step split, P1-9 gross column. (~half day)
7. **P2 polish:** STORE_COLORS centralization + the rest, bundled. (~half day)

## Stats

- Agents: 10 (8 sonnet, 2 opus). Wall-clock ~9 min parallel. ~1.2M agent tokens.
- Findings: **3 P0 (one pending root-cause) + 9 P1 + ~12 P2.**
- Live verification: harness ~70 raw violations triaged to root causes; agents pulled prod numbers for every confirmed finding.
- Prior-audit regressions confirmed unfixed: 2× (cannibalization denom, stability clamp). Prior P0-A/P0-B confirmed fixed.

## Post-fix verification (2026-05-28)

All P0 + P1 + P2 fixed (or explicitly downgraded). Final state: **`npm test` 1216 passed / 1 skipped, `tsc --noEmit` clean.** Branch `audit/data-consistency-2026-05-27`, 26 commits.

**Live harness (`npm run audit:reconcile`) after fixes — every remaining violation is in an EXPECTED/EXPLAINED category; zero new or unexplained:**
- **No same-source violations** (INV-3 ROAS, INV-6 platform-sum) — the invariants that MUST be exact all pass.
- **No NaN/Infinity** (INV-14) anywhere.
- INV-7 Meta/Google May 1–8 uzoshop (`campaigns_daily 0`) → manual-override window (account outage); expected.
- INV-9 product>data on most cells → custom-item (null-product-id) refund gap; documented ARCHITECTURE.md §14.7; harness now annotates these inline.
- INV-7/9/10 May 27–28 `data_daily 0` → today/yesterday before the nightly cron-daily; cadence artifact, expected.
- INV-9/10 May 20 → refund-spike day (A1-F3); expected.
- INV-7 TikTok small (~$10/day) gaps May 21–24 → FX-timing artifact, **fixed for future writes** (P1-7 FX-date); historical needs backfill.

**Harness self-correction (post-deploy):** Verifying the deploy revealed the live harness had been sending `range.from`/`range.to` to /api/campaigns,/products,/orders-attribution — all four routes actually parse `from`/`to`, so those calls had silently defaulted to a 90-day window (mismatched-window comparison that inflated/distorted the raw violation list). The P1-2 fix (400 on missing `from`/`to`) surfaced this; the harness now uses correct params for all four endpoints (commit `67aaade`). All findings above stand because the A1–A10 agents did their own independent live curls; only the harness's raw count was affected.

**NEW residual surfaced by the corrected harness (needs follow-up): INV-7 Meta per-day, recent settled days.** With matched windows, `data_daily` vs `campaigns_daily` Meta spend diverge per (date,store) on recent days outside the override window and outside today — e.g. 2026-05-26/uzoshop `data_daily 1156.81 vs campaigns_daily 895.77` (29%, ~$261); 05-26/360usmile `87.74 vs 177.08` (2×); 05-24/uzoshop `1133.61 vs 1067.77` (6%). Too large for FX timing (FX moves <1%/day). P0-3's "matched" verdict was on the 3-DAY SUM; per-day the two tables disagree. Hypothesis: `cron-daily` (nightly source-of-truth) and `cron-live-heavy` (intraday) write per-day Meta spend that doesn't fully reconcile after settling. **Same-source consistency is unaffected** (each component a user sees is internally consistent); this is a `data_daily`↔`campaigns_daily` cross-source divergence. Recommend: re-run `npm run audit:reconcile` after the next nightly `cron-daily` settles 05-26/27; if the per-day gap persists on settled days, open a focused follow-up on the cron-daily vs cron-live-heavy Meta per-day write path. INV-10 residual is now just 05-20 (refund-day, explained) + 05-02 ($69, ~1%, borderline).

**INV-7 Meta per-day residual — DIAGNOSED 2026-05-28, NOT a structural bug.** Pulled raw Meta insights (campaign-level, daily) for 05-24..26 via the Meta API and compared to both tables:

| date/store | raw Meta (ILS) | data_daily (CAD) | implied FX | campaigns_daily settled (CAD) |
|---|---|---|---|---|
| 05-24 uzoshop | 2377.09 | 1133.61 | 0.477 | 1122.81 |
| 05-26 uzoshop | 2392.97 | 1156.81 | 0.483 | 1167.34 |
| 05-26 360usmile | 181.50 | 87.74 | 0.483 | 88.54 |

`data_daily.fbSpend` = raw Meta ILS × FX(~0.477–0.483) — **matches Meta ground truth exactly**. `campaigns_daily` (re-snapshotted minutes after the harness run) ALSO matches raw×FX within ~1%. The harness's earlier 29% gap (campaigns 895.77 for 05-26/uzoshop) was a **transient unsettled `campaigns_daily`** value — `cron-live-heavy` was mid-refresh (partial campaign set) at the snapshot instant; it settled to the correct ~1167 within minutes. The residual ~1% is FX-timing between the two writes (addressed forward by the P1-7 per-date FX fix). **Conclusion: no cron-daily↔cron-live-heavy structural mismatch; transient settling artifact. No focused bug opened.** (Post-backfill harness re-run confirms.)

## Post-backfill final verification (2026-05-28)

Ran the operator backfill (cron-daily, 2026-05-01..27 × 3 stores) on the deployed fixed code, then verified with cache-busted live reads:

- **Meta fully reconciled.** `data_daily.fbSpend` ≡ Σ `campaigns_daily` Meta **to the cent** for every real date 05-08..26 across all three stores (uzoshop / Zol Plus / 360usmile). The earlier per-day "29% gap" was confirmed to be **stale Next.js ISR cache** on the wide-window `/api/campaigns` URL, not a data bug — cache-busted reads return identical values. The INV-7 Meta residuals that remain are ONLY the 05-01..07 manual-override window (campaigns_daily=0, expected).
- **orders_attribution (P0-2) fixed by backfill.** INV-10 dropped to just 05-20 (the refund-spike day, expected — `data_daily.revenue` is net, `orders_attribution.totalCad` is now the immutable gross `total_price`).
- **same-source (INV-3/INV-6) = 0 and NaN (INV-14) = 0** throughout.

**Harness hardened:** added a cache-buster (`_cb` + `cache:'no-store'`) to the live harness — without it, the harness reports stale-cache false-positives for a few minutes after any backfill (the ISR routes cache per-URL for 60s). Commit on this branch.

**TikTok INV-7 residual — FIXED (root cause corrected 2026-05-28).** The real mechanism is NOT the FX-omit guard described in the struck-through paragraph below. The TikTok fetcher returns TWO independent figures: an **account-level total** (→ `data_daily.tt_spend_cad`) and a **per-campaign breakdown** (→ `campaigns_daily`). TikTok systematically under-reports the per-campaign breakdown vs the account total — e.g. 2026-05-21 uzoshop: account-level **23.46** but only ONE campaign (משאף ארומוטרפי, status DISABLE) showing **11.10** in the breakdown; the other ~12 was spent on deleted/unattributed campaigns that land in the account total only. **`data_daily.tt_spend` (account-level) is the authoritative, correct total** that drives ROAS/profit — it must NOT be changed to the campaign-sum (that would undercount real spend and inflate ROAS). The fix is to the reconciliation invariant: **INV-7 for TikTok is now one-sided** — `Σcampaigns ≤ data_daily` is expected (incomplete breakdown, no flag); only `campaigns > data_daily` flags (over-report/double-count). Committed with tests (`reconcile.ts` + 2 new cases). Meta/Google stay two-sided (their per-campaign breakdown is complete, reconciles to the cent). Post-fix the spurious TikTok under-report flags are gone; 2 minor `campaigns > account` cases remain (05-23, 05-26 — campaigns 30–57% above account total), likely a TikTok per-campaign attribution-window artifact or cache (campaigns values were observed bouncing between reads); does NOT affect data_daily/ROAS/profit. Deferred TikTok-fetcher follow-up: investigate why per-campaign can exceed account total on some days.

~~**One genuine minor residual — TikTok 05-21..23 uzoshop (P2, root-caused; a targeted re-backfill did NOT fix it):**~~ *(superseded — the FX-omit theory below was wrong; see the corrected root cause above.)* cache-busted reads show `data_daily.ttSpend` > `campaigns_daily` TikTok by $5–12/day on those three days (05-21 23.46 vs 11.10; 05-22 36.72 vs 27.77; 05-23 74.94 vs 70.04); 05-24..26 are clean ($0.00). **Root cause:** `cronDaily.ts:511-546` — on a TikTok FX (or fetch) failure, cron-daily sets `ttSpendCad = null` and OMITS `tt_spend_cad` from the `data_daily` upsert, so `ON CONFLICT` **preserves the prior value**. For these historical dates the TikTok FX lookup fails on every backfill, so `data_daily.tt_spend` is never corrected — it stays at the stale (pre-P1-7-fix, FX-inflated) value — while `campaigns_daily` TikTok IS rewritten with the correct value (11.10 etc.). A re-backfill of 05-21..23 (2026-05-28) left `data_daily.ttSpend` unchanged, confirming the omit-preserve path. **This is a real (if tiny: ~$27 total, smallest platform, 3 days) structural quirk: the FX-omit guard, meant for transient failures, permanently strands a wrong `data_daily.tt_spend` that no backfill can correct.** Does NOT affect same-source consistency. **Follow-up (deferred):** either (a) when TikTok FX fails on a backfill, write `tt_spend_cad` using a fallback FX (e.g. the day's data_daily-stored implied rate or the nearest available rate) instead of omitting; or (b) investigate why the historical ILS→CAD rate lookup fails for 05-21..23 specifically; or (c) accept the $27 discrepancy. `campaigns_daily` already holds the correct figure.

**Operator backfill recommended (DONE 2026-05-28 for May; see above)** (fixes apply to future cron writes only): re-run cron-daily / backfill for the affected May date range to correct historical (a) `orders_attribution.totalCad` (P0-2) and (b) TikTok FX-timing rows.

**UI-label fixes** (P0-1 relabel, P1-1 banding, STORE_COLORS) are verified by the test suite; final visual confirmation happens after this branch is merged + deployed to prod (the fixes are not yet live, so a browser pass against prod would still show the old labels).

## Operator context (resolves part of P0-3)

**May 1–8, 2026 — uzoshop Google + Facebook spend was entered as MANUAL OVERRIDES** because the ad accounts were down / not connected to the dashboard during that window. Consequence for the audit: for those dates, `data_daily` carries the override spend but `campaigns_daily`/`ads_daily` have no campaign-level rows (a manual override has no per-campaign breakdown). So the INV-7/INV-8 gaps for uzoshop May 1–8 are **expected and correct**, not pipeline bugs. Any future re-audit should exclude the manual-override window from cross-source campaign reconciliation, or reconcile only the override total against data_daily.
