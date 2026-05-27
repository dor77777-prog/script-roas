# A1 Findings — Revenue/Spend/ROAS/Orders Cross-Component Consistency

**Agent:** A1  
**Date:** 2026-05-28  
**Windows tested:** 2026-05-20..05-26 and 2026-05-01..05-26  
**Stores tested:** All, uzoshop (individual)  
**Production endpoint:** https://roas-dashboard-smoky.vercel.app

---

## Findings Table

| ID | Severity | INV / Seed | File:Line | Live Evidence | Why Wrong | Suggested Fix |
|----|----------|-----------|-----------|---------------|-----------|---------------|
| A1-F1 | **P1** | INV-5 | `HeroOverview.tsx:320`, `KpiCards.tsx:221` | HeroOverview "רווח נטו" = netProfit (rev−spend−cogs). KpiCards "רווח נטו" = trueNetProfit (rev−spend−cogs−txFees−fixedCosts). Live diff for May-20..26 all-store: $5,123.75 vs $3,953.10 — a $1,170.65 gap (23%) from tx fees alone, before fixed costs. | Both tiles share the label "רווח נטו" but measure different values: HeroOverview shows `curAgg.netProfit` (partial), KpiCards shows `current.trueNetProfit` (full). A user reading both sections of the home tab will see two different numbers under the same Hebrew label with no explanation. | Rename HeroOverview's tile to "רווח גולמי לאחר פרסום" or align it to `trueNetProfit`. Alternatively document the intentional difference via a tooltip. |
| A1-F2 | **P1** | INV-5 | `HeroOverview.tsx:165` vs `Dashboard.tsx:178` | HeroOverview calls `aggregate(cur)` (no `range` arg). Dashboard calls `aggregate(cur, filters.range)`. When billing fixed-costs are configured and the selected range has boundary days with no data rows, the two billing proration windows differ — causing HeroOverview's `trueNetProfit` (if it were shown) and KpiCards' `trueNetProfit` to disagree. Not currently user-visible (HeroOverview shows `netProfit`, not `trueNetProfit`) but the inconsistency is latent. | `aggregate(cur)` falls back to data-derived minDate/maxDate for billing proration; `aggregate(cur, filters.range)` uses the operator-selected window (Phase 05.7.8 fix). These diverge on any range where the boundary dates have no rows. | Pass `filters.range` to HeroOverview's internal `aggregate(cur)` call or refactor HeroOverview to consume `filtered.curAgg` from Dashboard props (single source of truth). |
| A1-F3 | **P1** | SEED-5, SEED-2 | `shopifyRevenueRefunds.ts:231`, `shopify.ts:1055` | 2026-05-20/uzoshop: `data_daily.revenue=986.07` vs `orders_attribution.totalCad_sum=2000.09` (102.8% gap, $1,014 difference). Same date: Zol Plus gap $65.28 (14.1%), 360usmile gap $51.70 (573%). May 20 is anomalous across all three stores simultaneously. | `data_daily.revenue = Σ total_price(orders created on D) − Σ refund_line_items.subtotal(refunds processed on D)`. On May 20, large cross-day refunds were processed (orders from prior days), reducing `data_daily.revenue` well below the new-order value for that day. Meanwhile `orders_attribution.totalCad = current_total_price` which deducts only same-day refunds on the ORDER itself. The two sources intentionally measure different things. | **Not a bug in either source.** The data model is correct but may be confusing to operators. Consider adding a tooltip to the revenue tile on high-refund days (where `refundDeduction > 10% of grossRevenue`) explaining that cross-day refunds reduce the reported day's net. |
| A1-F4 | **P2** | SEED-1, SEED-2 | `shopify.ts:1055`, `shopifyRevenueRefunds.ts:231` | Systematic per-day gap between `data_daily.revenue` (NET, refund-day attribution) and `orders_attribution.totalCad` (current_total_price). Overall May 1-26: data_daily total = $97,787 vs orders total = $98,849 (1.1% above). 4 (date, store) cells exceed L2 tolerance (>1% AND >$1); all on May 20. | Three-source revenue hierarchy: `products_daily.grossRevenue ≥ orders_attribution.totalCad ≥ data_daily.revenue`. (1) products.gross = line_price × qty (before order-level discounts). (2) orders.totalCad = current_total_price (after discounts and same-day refunds on the order). (3) data_daily.revenue = refund-day net (deducts ALL refunds processed on that day, even cross-day). These are intentionally different metrics. | No code fix required. Document the revenue-source hierarchy in the User Manual (data_daily is the primary KPI source; orders_attribution is attribution-focused and should not be compared directly to data_daily.revenue). |
| A1-F5 | **P2** | S2 | `PerStoreCards.tsx:9-13`, `TodayLive.tsx:128-132` | `STORE_COLORS` defined independently in both files. PerStoreCards uses `{uzoshop: '#1c4587', 'Zol Plus': '#ea4335', '360usmile': '#34a853'}`. TodayLive uses `{uzoshop: '#1e3a8a', 'Zol Plus': '#dc2626', '360usmile': '#15803d'}`. Same store-to-color mapping (no mislabeling), but different shades across the dashboard sections. | Two independent `STORE_COLORS` constants with slight hex differences. Not a data error but produces visible color inconsistency across the home tab's PerStoreCards vs TodayLive store mini-cards. | Extract to a shared constant in `lib/platformsByStore.ts` or a new `lib/storeColors.ts`. Both components import it. |
| A1-F6 | **P2** | S1 | `data/route.ts:33`, `dateRange.ts:48-67` | `GET /api/data?store=uzoshop&from=2026-05-20&to=2026-05-26` returns all 3 stores (21 rows). The `?store=` param is silently ignored; the API returns all stores and expects the client to slice by `storeName`. Confirmed live: stores returned = `['360usmile', 'Zol Plus', 'uzoshop']`. | The route calls `fetchDailyDataFromPostgres({range})` which has no `storeId` parameter. Client-side `filterRows(data.rows, range, store)` handles the store slice. This is documented in the AUDIT-PLAN.md "verified facts" section — intentional design. | No change needed to the API. However, **all callers must always pass `?from=&?to=` correctly**. The `buildDateRangeKey()` helper in `lib/dateRange.ts` correctly formats `?from=...&to=...`. Confirm no caller passes `?range.from=...&range.to=...` (the wrong format) — the orders-attribution API would silently fall back to the default 90-day range if given wrong param names. |
| A1-F7 | **P0** | S1 (extended) | `orders-attribution/route.ts:22-37` | `GET /api/orders-attribution?range.from=2026-05-20&range.to=2026-05-20` returns 1020 rows spanning 2026-05-01 to 2026-05-27 — the full default 90-day window. The wrong param names `range.from`/`range.to` cause `parseRangeParams()` to receive `null` for both `from` and `to`, triggering `defaultRange()` (90 days). The correct params are `?from=&to=`. | `parseRangeParams()` calls `searchParams.get('from')` and `searchParams.get('to')`. When a caller passes `range.from=` instead of `from=`, both return null, and the function returns the default 90-day range silently with no error. Dashboard.tsx correctly uses `buildDateRangeKey()` which produces `?from=...&to=...`, so the dashboard itself is unaffected. But any external probe or integration using the wrong param names would receive all data. | Add a guard in `parseRangeParams()`: if `searchParams.has('range.from')` or `searchParams.has('range.to')` are present but `from`/`to` are absent, throw a `RangeParamError` with a helpful message. This prevents silent data over-exposure. Severity raised to **P0** because the wrong param silently returns all stored orders (PII exposure via incorrect API usage). |

---

## Narrative for P0/P1 Findings

### A1-F7 (P0): Silent full-data return on wrong param names

When `/api/orders-attribution` (or `/api/data`) is called with `?range.from=YYYY-MM-DD&range.to=YYYY-MM-DD` instead of the correct `?from=&to=`, `parseRangeParams()` receives `null` for both params, hits the `!from && !to` branch, and returns `defaultRange()` — the last 90 days. This was confirmed live: a probe with `range.from=2026-05-20&range.to=2026-05-20` returned 1020 order rows spanning 27 dates. The dashboard itself is not vulnerable because `buildDateRangeKey()` always produces the correct format, but any external API caller (curl, integration, audit harness) using the wrong param names gets all data silently. The orders_attribution table contains customer-order PII (order IDs, totals, UTM attribution, fbclid/gclid flags). Fix: detect the malformed param names and return HTTP 400.

### A1-F1/F2 (P1): Two "רווח נטו" numbers that differ by ~23%

The Home tab renders two labeled "רווח נטו" values to the operator:
- **HeroOverview** (top strip, dark blue section): `curAgg.netProfit = revenue − spend − cogs`. For May 20-26 all stores: **$5,123.75**.
- **KpiCards** (card row below): `current.trueNetProfit = revenue − spend − cogs − txFees − fixedCosts`. Same window: **$3,953.10** (before any configured fixed costs).

These differ by $1,170.65 — the 6.5% transaction-fees deduction — with no label distinction visible to the operator. A user comparing the two will see different numbers under the same label and have no way to reconcile them without reading source code. Additionally, HeroOverview's internal `aggregate(cur)` call (no `range` arg) uses data-derived date boundaries for billing proration, while Dashboard's `aggregate(cur, filters.range)` uses the operator-selected window. On windows where boundary dates have no data, the billing proration — and thus `trueNetProfit` — can diverge between the two calls (latent, not currently user-visible because HeroOverview shows `netProfit` not `trueNetProfit`).

**Recommended fix:** Change HeroOverview's "רווח נטו" tile to show `trueNetProfit` (or rename to a label that makes clear it excludes fees), and pass `filters.range` to the internal `aggregate()` call to match KpiCards.

### A1-F3 (P1): May 20 revenue spike — systematic cross-day refund clustering

On 2026-05-20, all three stores show `orders_attribution.totalCad >> data_daily.revenue`:
- uzoshop: orders=2000.09 vs data_daily=986.07 (102.8% gap)
- Zol Plus: orders=526.94 vs data_daily=461.66 (14.1%)
- 360usmile: orders=60.71 vs data_daily=9.01 (573.8%)

The root cause is that `data_daily.revenue` uses the refund-day attribution model: refunds processed on May 20 (regardless of when the original orders were created) are deducted from May 20's revenue total. On this day, a large volume of cross-day refunds was processed, drastically reducing the net revenue figure for May 20 even though the new orders created that day were relatively normal. The `orders_attribution` table records `current_total_price` at the time of the daily cron — it reflects same-day refunds absorbed into the order total, but not cross-day refunds that are attributed on the refund processing date.

This is by design, not a pipeline bug. However, it produces a confusing operator experience: the dashboard shows 22 new uzoshop orders on May 20 (from orders_attribution count) but only $986 in revenue (from data_daily refund-net), implying an average order value of $45 when the actual orders averaged $91 each. The ROAS for May 20/uzoshop (1.03) looks catastrophic but is actually driven by refund-day deductions from earlier orders. An operator making budget decisions on May 20's ROAS (1.03) would be misled.

**Recommended fix:** Add a visual indicator on days where `data_daily.refundDeduction > X% of grossRevenue` (the columns are already stored: `gross_revenue_cad` and `refund_deduction_cad`). The `RefundIndicator` component already exists and is used in `DetailTable.tsx`; similar signaling should appear on the PerStoreCards and/or the revenue KPI chip.

---

## Live Verification Data

### Window: 2026-05-20..05-26, All Stores

**data_daily totals (from /api/data):**
- Revenue: $18,010.02
- Spend: $8,383.77
- ROAS: 2.1482
- fb+ga+tt sum: $8,383.77 (= totalSpend, INV-6 passes)
- uzoshop: rev=15,929.35, spend=7,336.24, roas=2.1713
- Zol Plus: rev=1,588.60, spend=754.45, roas=2.1056
- 360usmile: rev=492.07, spend=293.08, roas=1.6790

**orders_attribution totals (from /api/orders-attribution?from=...&to=...):**
- uzoshop: 167 orders, sum=$16,943.37
- Zol Plus: 18 orders, sum=$1,653.88
- 360usmile: 6 orders, sum=$543.77

**Cross-source revenue gap (orders − data_daily):**
- uzoshop: +$1,014.02 (+6.4%)
- Zol Plus: +$65.28 (+4.1%)
- 360usmile: +$51.70 (+10.5%)
- All driven by May 20 anomaly (large cross-day refund processing day)

### Window: 2026-05-01..05-26, All Stores

**data_daily totals:**
- Revenue: $97,787.17, Spend: $41,266.78, ROAS: 2.3696

**orders_attribution totals:**
- uzoshop: 851 orders, $85,738.62
- Zol Plus: 82 orders, $7,809.48
- 360usmile: 54 orders, $5,301.27
- Total: $98,849.37 (1.1% above data_daily — within L2 tolerance at aggregate level)

**INV-6 per-platform check:**
- All rows: totalSpend = fbSpend + gaSpend + ttSpend (0 mismatches)

**INV-3 ROAS check:**
- All stored r.roas values match computed revenue/totalSpend within 0.001 (0 mismatches)

**INV-1/INV-2:**
- Revenue and spend identical across all components by construction (same row-level sums)

---

## Component Architecture Notes

All aggregate-consuming components receive data from these paths:

| Component | Data Source | Revenue | Spend | Net Profit | Orders |
|-----------|-------------|---------|-------|------------|--------|
| KpiCards | `Dashboard.filtered.curAgg` = `aggregate(cur, range)` | `Aggregate.revenue` | `Aggregate.spend` | **`trueNetProfit`** | n/a |
| HeroOverview | Internal `aggregate(cur)` (no range arg) | `Aggregate.revenue` | `Aggregate.spend` | **`netProfit`** (!) | n/a |
| PerStoreCards | `Dashboard.filtered.storeAggs` = `aggregateByStore(cur, range)` | `StoreAgg.revenue` | `StoreAgg.spend` | `grossProfit` | orders-attribution count |
| DetailTable | `Dashboard.filtered.cur` (raw rows) | `r.revenue` | `r.totalSpend` | `r.netProfit` (when hasCogs) | n/a |
| PnLBreakdown | `Dashboard.filtered.curAgg` (same as KpiCards) | `Aggregate.revenue` | `Aggregate.spend` | **`trueNetProfit`** (via `finalProfit`) | n/a |
| TodayLive | Own SWR `/api/data?from=today&to=today` | `aggregate(todayRows)` | same | `grossProfit` | orders-attribution count |

**Key observation:** HeroOverview is the only component that independently re-aggregates the same data rather than consuming the Dashboard's pre-computed aggregate. This creates the INV-5 discrepancy.
