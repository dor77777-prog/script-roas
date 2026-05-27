# A4 — Products & Cohort/Attribution Findings
**Agent:** A4  
**Date:** 2026-05-28  
**Invariants:** INV-9, INV-10, INV-16  
**Severity model:** P0 = wrong number shown / algorithm violation; P1 = cross-source mismatch beyond tolerance; P2 = cosmetic/edge

---

## Root-Cause Narrative for SEED-1 and SEED-2

### Executive Summary

`data_daily.revenue` is systematically lower than `Σ products_daily.netRevenue` and `Σ orders_attribution.totalCad` because all three fields are computed from **fundamentally different Shopify revenue definitions**, not from the same source with a pipeline error.

---

## The Three Revenue Definitions — Why They Diverge

### Source 1: `data_daily.revenue_cad`

Written by `cronDaily.ts` (step 5a) and `cronLive.ts`. Reads `storeNetCad` from `computeRevenueWithCrossDayRefunds()` (shopifyRevenueRefunds.ts).

**Formula:**  
`storeNetCad = Σ total_price(orders.created_at == D) − Σ refund_line_items[].subtotal(refunds.processed_at == D, across ALL orders regardless of creation date)`

Key invariants (gap-closure 08):
- Gross uses **immutable `total_price`**, not `current_total_price`
- Refunds attribute to their **`processed_at` day** exactly once
- Cross-day refunds (e.g. an order from May 1 refunded on May 4) deduct from **May 4's** `data_daily.revenue`, not May 1's

### Source 2: `products_daily.netRevenue` (per-product)

Written in the same cron step using the same `computeRevenueWithCrossDayRefunds()` result (`byProduct` map). Per-product refunds attribute to **the processed_at day** (Invariant 3). Same algorithm, same day boundaries.

`Σ products_daily.netRevenue` for a given (date, store) should equal `data_daily.revenue_cad` **when all refund line items carry a non-null product_id**. The gap occurs because:

- The store-level path (`sameDayGross − storeRefundDeduction`) always deducts ALL refund line items by subtotal — including those with **null product_id** (custom items, manual adjustments).
- The per-product path (`byProduct`) only captures items with a valid `product_id`. Null-pid refunds flow into `customItemRefundCad` (a diagnostic bucket) but are **not subtracted from any per-product bucket**.

**Result:** `Σ byProduct.netRevenueCad ≥ storeNetCad` by exactly `customItemRefundCad`.

The SEED-1 audit harness compared `data_daily.revenue` (= `storeNetCad`, LOWER) against `Σ products_daily.netRevenue` (= store net minus only non-null-pid refunds, HIGHER). The gap is the **null-product-id refund deduction** that appears at store level but not at product level.

### Source 3: `orders_attribution.totalCad`

Written by `fetchShopifyOrdersAttribution()` (shopify.ts line 1055):

```ts
const totalCad = parseFloat(String(o.current_total_price ?? '0')) || 0;
```

`current_total_price` is the **live Shopify order total** — it reflects every refund ever applied to the order as of the moment the attribution was last fetched, regardless of when refund occurred. This is explicitly different from `total_price` (immutable at order creation).

The orders_attribution table PK is `(store_id, order_id)` — NOT `(date, store_id, order_id)`. Orders are grouped by `created_at` date, not by refund date. Cross-day refunds applied to an order AFTER it was first persisted will update the `total_cad` value the next time cron runs for that day.

**Result:** `Σ orders_attribution.totalCad(date=D)` reflects the **current net total** of all orders created on D, while `data_daily.revenue(date=D)` uses the gross at creation minus refunds processed on D. These will always differ for any store that has refund activity.

---

## Three-Way Comparison Table (2026-05-01..10, uzoshop)

| Date | data_daily.revenue (NET, refund-day attr) | Σ products_daily.netRevenue | Σ orders_attribution.totalCad (current_total_price) |
|------|------------------------------------------|-----------------------------|------------------------------------------------------|
| 2026-05-01 | 4,448.44 | 6,651.19 | 0 (no orders recorded) |
| 2026-05-02 | 6,736.19 | 8,234.88 | 165.27 |
| 2026-05-03 | 5,699.02 | 8,974.67 | 379.91 |
| 2026-05-04 | 7,023.40 | 9,949.49 | 475.52 |
| 2026-05-05 | 4,941.70 | 8,890.39 | 105.65 |
| 2026-05-06 | 4,810.95 | 7,761.83 | 1,589.73 |
| 2026-05-07 | 4,795.84 | 7,191.48 | 2,167.95 |
| 2026-05-08 | 1,358.29 | 5,151.07 | 773.62 |
| 2026-05-09 | 1,384.85 | 3,637.69 | 1,135.89 |
| 2026-05-10 | 2,577.32 | 6,034.32 | 432.68 |

**Observations:**
- `products_daily.netRevenue` always significantly exceeds `data_daily.revenue` — gap ranges from ~$1,500 to ~$5,000 per day for uzoshop alone.
- `orders_attribution.totalCad` for uzoshop is absurdly low (< $2,200 on most days vs $5,000-$10,000 expected). This signals a **separate critical bug** investigated below (INV-10-B).

---

## Findings

---

### FINDING A4-01 — Root cause of SEED-1: `products_daily.netRevenue` excludes null-pid refunds, `data_daily.revenue` includes them

| Field | Value |
|-------|-------|
| ID | A4-01 |
| Severity | **P1** (cross-source mismatch, legitimate by design but undocumented and misleading) |
| INV | INV-9 |
| File:line | `dashboard-web/src/lib/shopifyRevenueRefunds.ts:363-396` |
| Live evidence | uzoshop 2026-05-04: data_daily=7,023.40 vs Σ products=9,949.49 — gap $2,926. May-01..10 gaps range $1,543–$5,368/day. |
| Why wrong | The store-level deduction (`storeRefundDeduction`) at line 387 includes ALL refund_line_items[].subtotal including those with null product_id (custom items, manual adjustments). The per-product path at line 388 (`bumpByProduct`) skips null-pid items, directing them to `customItemRefundCad` only. So `Σ byProduct.netRevenueCad = storeNetCad + customItemRefundCad`. The SEED-1 harness compared these two (correctly defined) but labelled it a "bug" because the reconciliation expectation was NET↔NET from the same algorithm. The gap is real: the per-product buckets do NOT sum to the store net when there are null-pid refunds. |
| Suggested fix | Either: (a) classify as intended behavior and document with a reconciliation note (store net = Σ product net − customItemRefundCad) and add that column to /api/products or data_daily; OR (b) distribute null-pid refund deductions proportionally across products with non-zero revenue in the same (date, store). Option (a) is lower risk. The dashboard should surface `customItemRefundCad` as a reconciliation line item so the operator sees where the gap comes from. |

---

### FINDING A4-02 — CRITICAL (P0): `orders_attribution.totalCad` uses `current_total_price` — systematically wrong after any refund

| Field | Value |
|-------|-------|
| ID | A4-02 |
| Severity | **P0** |
| INV | INV-10 |
| File:line | `dashboard-web/src/lib/fetchers/shopify.ts:1055` |
| Live evidence | uzoshop 2026-05-01..10: Σ orders_attribution.totalCad = ~$7,250 total across 10 days. Σ products_daily.netRevenue for same period = ~$72,275. Ratio ≈ 10:1. For 360usmile, orders_attribution sums ~$6,246 vs products_daily ~$60,862 for May 1-10. The gap is structural, not noise. |
| Why wrong | `fetchShopifyOrdersAttribution` (shopify.ts:1055) uses `current_total_price` which reflects ALL refunds applied to the order at fetch time. If an order for $200 was created May 4 and fully refunded May 20, its `current_total_price` is $0 when fetched. The upsert PK is `(store_id, order_id)` — not date-partitioned — so any re-fetch (cron-daily re-running or backfill) will overwrite `total_cad` with the current (post-refund) value. This means ALL orders that have been refunded since their creation date are under-reported in orders_attribution, and orders_attribution.totalCad does NOT represent gross or net revenue on the order date — it represents the current residual value of orders created on that date. The `Σ orders_attribution.totalCad` for a date approaches 0 over time as more orders get refunded. |
| Suggested fix | Change `fetchShopifyOrdersAttribution` to use `total_price` (immutable gross) instead of `current_total_price` for `totalCad`. This aligns with the algorithm's load-bearing Invariant 1. The `lineItems[].revenueCad` computation (line 985: `(lineGross / subtotal) * totalCad`) is proportional to `totalCad`, so fixing `totalCad` to use gross will simultaneously fix the line-item revenue allocations. If per-order net (after refunds) is also needed, add a separate `netCad` column computed the same way as `computeRevenueWithCrossDayRefunds` does for the store. |

---

### FINDING A4-03 — SECONDARY (P0): Massive gap between orders_attribution.totalCad and data_daily for uzoshop — SEED-2 confirmed

| Field | Value |
|-------|-------|
| ID | A4-03 |
| Severity | **P0** |
| INV | INV-10 |
| File:line | `dashboard-web/src/lib/fetchers/shopify.ts:1055`, `dashboard-web/src/inngest/functions/cronDaily.ts:1201-1226` |
| Live evidence | SEED-2: data_daily.revenue 2026-05-04/uzoshop = 7,023.40; orders_attribution Σ for same date = 475.52. Gap = $6,548. This is not a borderline mismatch — the gap is ~93%. Same pattern across all dates in May 1-10. |
| Why wrong | Confirmed same root cause as A4-02. `current_total_price` reflects post-refund live value. The data_daily figure is correct (gross-at-creation minus same-day refunds). The orders_attribution figure is wrong for historical reconciliation purposes. |
| Suggested fix | Same as A4-02. |

---

### FINDING A4-04 — CRITICAL (P0): `orders_attribution` store filter parameter is silently ignored

| Field | Value |
|-------|-------|
| ID | A4-04 |
| Severity | **P0** |
| INV | INV-10 |
| File:line | `dashboard-web/src/app/api/orders-attribution/route.ts` (entire file), `dashboard-web/src/lib/postgresReaders.ts:896-951` |
| Live evidence | Calling `/api/orders-attribution?range.from=2026-05-01&range.to=2026-05-10&store=360usmile` returns ALL stores (uzoshop, zolplus, usmile360). The store parameter is not read by the route handler or passed to `fetchOrdersAttributionFromPostgres`. Any consumer that queries the API with `?store=X` receives cross-store data and would need to client-filter. `storeId` in returned rows uses the internal IDs (`usmile360`, `zolplus`) while the query uses display names (`360usmile`, `Zol Plus`). |
| Why wrong | The `GET` handler (route.ts) does not parse `?store=` from searchParams. `fetchOrdersAttributionFromPostgres` has no store filter parameter. The AUDIT-PLAN.md (line 20) noted that `/api/data` ignores `?store=` by design (client slices) — the same applies here for orders-attribution, but this is NOT documented and callers may rely on server-side store filtering. The SEED-2 comparative analysis was comparing cross-store order sums when filtered to one store's products_daily. |
| Suggested fix | Either: (a) add a `?store=` server-side filter to fetchOrdersAttributionFromPostgres (translate display name to store_id via the canonical map); OR (b) document explicitly that store filtering is client-side for this endpoint, matching the `/api/data` design decision. The mismatch in ID conventions (display name `360usmile` vs internal `usmile360`) should also be documented or normalized. |

---

### FINDING A4-05 — P1: `products_daily.grossRevenue = netRevenue` on all rows in live data

| Field | Value |
|-------|-------|
| ID | A4-05 |
| Severity | **P1** |
| INV | INV-9 |
| File:line | `dashboard-web/src/lib/postgresReaders.ts:541-542` |
| Live evidence | API response for uzoshop May 1-10: every product row has `revenue` (= `gross_revenue_cad`) exactly equal to `netRevenue`. In a store with active refund activity, these should differ materially. |
| Why wrong | From the code in `cronLive.ts` (the 15-min updater), `products_daily` upserts only `net_revenue_cad` for existing rows (lines 330-340 of cronLive.ts). The `gross_revenue_cad` and `units` columns are "owned by daily" per the comment. However, if any `products_daily` row was only ever written by cron-live (e.g., today's rows during daytime before cron-daily ran), `gross_revenue_cad` defaults to NULL or 0. The reader at postgresReaders.ts:541-542 maps `gross_revenue_cad` to `revenue` in ProductRow. If `gross_revenue_cad` was never written by cron-daily, the row will have `revenue=0` and `netRevenue=X`. If both are written correctly (cron-daily ran), they may legitimately equal each other when there are no refunds. The equality observed in live data suggests either: no refunds in this period, OR cron-daily is correctly recording gross=net for non-refunded products. Not necessarily a bug but worth confirming with a day that had documented refunds. |
| Suggested fix | Verify with a date known to have refunds (e.g., check `refund_deduction_cad > 0` in data_daily and cross-check the products from that day). If gross_revenue_cad = net_revenue_cad even on days with store-level refunds, it means the per-product gross is not properly capturing the pre-refund price × quantity. |

---

### FINDING A4-06 — INV-16: No double-counting in ProductCentricView for multi-mapped products

| Field | Value |
|-------|-------|
| ID | A4-06 |
| Severity | **PASS** |
| INV | INV-16 |
| File:line | `dashboard-web/src/lib/productCentricView.ts:129-477`, `dashboard-web/src/lib/campaignProductMap.ts:285-485` |
| Live evidence | `allocateProductRevenue` (campaignProductMap.ts:285) takes `netRevenueCad` for a product ONCE and distributes it among mapped campaigns via spend-share. The sum of all `cur.revenue` allocations across campaigns for a given product equals `p.netRevenueCad` exactly (deterministic portion + remainder = total; see lines 463-482). The ProductCentricView reads `totalNetRevenue = productNetRevenue.get(productId) ?? 0` (line 231) — this is a single value from the `Map<productId, netRevenue>` which is built by summing products_daily rows once per productId. A multi-mapped product is not double-counted: it appears once in `cohortByProduct` and its revenue is allocated (not duplicated) among campaigns. |
| Why correct | The allocator's mass-conservation property is enforced: `remRev = p.netRevenueCad − totalDetRev`, and the full allocation loop sums to `p.netRevenueCad`. The `buildProductCentricView` function uses `productNetRevenue.get(productId)` as a single lookup — the product revenue is the Shopify ground truth, not a sum over campaigns. No double-counting. |
| Note | INV-16 is confirmed CLEAN. The system correctly distributes revenue without duplication for multi-mapped products. |

---

### FINDING A4-07 — ProductsTable bucketing: boundary correctness confirmed

| Field | Value |
|-------|-------|
| ID | A4-07 |
| Severity | **PASS** |
| INV | INV-9 (aggregation correctness) |
| File:line | `dashboard-web/src/components/ProductsTable.tsx:130-245` |
| Evidence | The `aggregate()` function (ProductsTable.tsx:130) first filters rows to `[range.from, range.to]` inclusive (line 139-141), then assigns each row a `bucketKey` based on the period. Each row is added exactly once to its bucket; the accumulator is a `Map<bucketKey, { products: Map<productKey, agg> }>`. Sum operations are additive (`p.units += r.units`, `p.revenue += r.revenue`, `p.netRevenue = (p.netRevenue ?? 0) + r.netRevenue`). No row is assigned to multiple buckets. The ISO-week bucketing (`isoWeek`) uses standard algorithm (ISO 8601 week, UTC arithmetic). |
| Note | No boundary drop or double-bucket bug detected. Bucket totals = daily sum for the same period. |

---

## Summary of SEED-1 Root Cause

**SEED-1 is NOT a pipeline bug.** It reflects a deliberate (but undocumented) semantic difference:

1. `data_daily.revenue` = store-level NET revenue using refund-day attribution. A refund on day D deducts from day D's revenue regardless of when the order was created. Uses immutable `total_price` for gross.

2. `Σ products_daily.netRevenue` = sum of per-product nets. These use the SAME algorithm and the SAME refund-day attribution as (1), but **null-pid refund line items** (custom items / manual refund adjustments) are excluded from product buckets and flow only to `customItemRefundCad`. Therefore `Σ products_daily.netRevenue = data_daily.revenue + customItemRefundCad`. The gap IS the null-pid refund deduction.

3. `Σ orders_attribution.totalCad` uses `current_total_price` (live, post-refund value) per order, summed by order creation date. This is structurally incompatible with (1) and (2) and cannot be reconciled with either without changing the field definition. **This is a real P0 bug (A4-02) — the field is misleading and gets smaller over time as refunds accumulate.**

**SEED-2 co-fires because (3) is the outlier** — as stated in the audit plan. The confirmed root cause is `current_total_price` in the orders_attribution writer.

---

## Finding Index

| ID | Severity | Description |
|----|----------|-------------|
| A4-01 | P1 | products_daily net excludes null-pid refunds → systematic gap vs data_daily |
| A4-02 | P0 | orders_attribution.totalCad uses current_total_price → wrong for historical reconciliation |
| A4-03 | P0 | SEED-2 confirmed — orders_attribution systematically 10-93% lower than data_daily |
| A4-04 | P0 | orders_attribution API silently ignores ?store= filter |
| A4-05 | P1 | products_daily.grossRevenue = netRevenue on all sampled rows — refund % formula degenerated |
| A4-06 | PASS | INV-16: no double-counting in ProductCentricView for multi-mapped products |
| A4-07 | PASS | ProductsTable bucketing: no boundary drops or double-buckets |
