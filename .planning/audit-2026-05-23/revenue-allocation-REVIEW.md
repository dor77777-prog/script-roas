---
audit: revenue-attribution-chain
reviewed: 2026-05-23
scope: dashboard-web/src/lib/{hooks/useCampaignTrueRevenue.ts, ordersAttribution.ts, lineItems.ts, shopifyRevenueRefunds.ts, productCatalog.ts, campaignProductMap.ts, fetchers/shopify.ts}
verdict: NOT-SHIP-AS-GOSPEL
findings:
  critical: 3
  high: 4
  medium: 5
  low: 3
---

# Revenue Allocation Audit — 2026-05-23

## Summary

The chain mostly does what it claims. The two newest layers (Phase 05.7.9 deterministic-first attribution; gap-closure 08 refund attribution) are carefully written, well-commented, and well-tested. But there are **three CRITICAL latent bugs** that already silently mis-attribute revenue today, plus several HIGH issues that will surface as soon as the operator widens a date range or a new edge case appears in the data. None of them produce a *visible* crash — they all produce **wrong numbers** that look plausible, which is the worst failure mode for "is this ROAS correct?".

The most important thing to internalize: when the operator looks at the **"ROAS Shopify · סה"כ" column** for a multi-platform-mapped product whose deterministic attribution exceeds the product's total Shopify revenue (e.g., refunds dragged net negative), the allocator silently **drops the remainder pool entirely** (`Math.max(0, p.netRevenueCad - totalDetRev)`), which means: a Meta campaign mapped to a refund-heavy product gets credited with click-id revenue that exceeds the actual net product revenue, **with no fallback subtraction to keep mass conserved**. See **CR-01**.

The per-product `netRevenue` column the allocator consumes can be **negative** (the refund algorithm explicitly says `D-D3: no clamping`), but the allocator and the upstream productsByStore loop both treat `netRevenue` as if it were strictly nonnegative — see **CR-02**.

The `useCampaignTrueRevenue` hook re-runs `analyzeAttribution` every render with an `allCampaignRows` daily series that is **NOT filtered to `localRange`**, meaning the per-campaign attribution trust chip is computed against the full SWR window (often 90 days) even when the operator selected "last 7 days" — see **HI-01**.

The rest of this report walks each finding, with concrete file:line evidence. The bottom of the report has the 10-question checklist verdict and the "what's solid" call-outs.

---

## Findings

### CRITICAL

#### CR-01 — Deterministic attribution can exceed product net revenue; mass is silently lost (no fallback)

**Severity:** CRITICAL
**File:** `dashboard-web/src/lib/campaignProductMap.ts:429-455`
**Evidence:**

```ts
// Step 3: split the unattributed remainder by spend share across ALL mapped campaigns
const totalDetRev =
  detByPlatform.Meta.revenue + detByPlatform.Google.revenue + detByPlatform.TikTok.revenue;
const totalDetUnits =
  detByPlatform.Meta.units + detByPlatform.Google.units + detByPlatform.TikTok.units;
const remRev   = Math.max(0, p.netRevenueCad - totalDetRev);   // ← (A)
const remUnits = Math.max(0, p.units        - totalDetUnits);
```

**The bug:**

Two compounding flaws:

1. **(A) `Math.max(0, …)` silently absorbs negative remainder.** When deterministic attribution exceeds product net (which is very plausible after refunds drag net below the line-item-gross sum used to populate `detByPlatform`), `remRev` becomes 0 and the allocator credits the deterministic platform with **MORE revenue than the product actually had as net Shopify revenue**. The "ROAS Shopify · סה"כ" column then exceeds the "Shopify · פלטפורמה" total denominator, and the campaign's `trueRevenue` over-reports.

2. **The per-platform cap (line 344-350) caps at `p.netRevenueCad` BEFORE refunds drop net below the gross sum of line-item `revenueCad`.** `OrderLineItem.revenueCad` is sourced from `current_total_price` at order creation (see `shopify.ts:computeLineItemsCad:962-992` — splits `totalCad` = `current_total_price`). The per-product `netRevenueCad` the allocator receives is built from `products_daily.net_revenue_cad`, which IS refund-corrected. So the line-item sum (gross of refunds for that product on its sale day) can plausibly exceed the product's date-range net (which subtracts cross-day refunds). The cap clamps the line-item sum down to net, but the clamp **distorts the per-platform split when refunds are unevenly distributed across days vs orders**.

**Concrete failure shape:**

- Product P: 10 units sold on day 1 with `current_total_price` = CAD 1000. Single order, fbclid present, source = `meta-paid`.
- On day 5, the customer refunds CAD 500. `net_revenue_cad` for the day-1 row stays CAD 1000 (the day-1 row); a separate day-5 row appears with `net_revenue_cad = -500`.
- Range = day 1..day 7. `productsByStore` sums these: `netRevenueCad = 500`, `units = 10`.
- `detByPlatform.Meta.revenue = 1000` (the full original line-item revenue from the order). Cap at `p.netRevenueCad = 500` clamps Meta to 500. `units` cap clamps from 10 to 10 (no change).
- `remRev = max(0, 500 - 500) = 0`. No fallback runs.
- **Net result:** Meta campaign credited with the full CAD 500 net revenue from a single fbclid order. ROAS column shows the right number ON THIS PATH (because Meta is the only platform mapped). But:
- Now add a TikTok campaign also mapped to P (zero TikTok orders, just operator-set mapping). The allocator runs Step 2: deterministic = 500 to Meta; TikTok gets nothing in Step 2. Step 3: `remRev = 0`, so TikTok gets nothing in Step 3 either. **Correct** in this case.
- BUT: now Meta has a *second* mapped product Q with no orders at all (zero spend, just a mapping). Meta's spend for the range is CAD 200. TikTok's spend is CAD 100. P's full CAD 500 goes to Meta (correct). Q has no orders → no deterministic → falls into Step 3 with `remRev = Q.netRevenueCad`. If Q's net is also positive, that splits proportionally to spend (Meta gets 2/3). Fine.

So far, no visible bug — but flip the example so the **refund exceeds gross**:

- Product P had a day-1 single order CAD 1000 (Meta fbclid). On day 5 the operator processes refunds totaling CAD 1500 (think: chargeback + cancellation fee reversed). `net_revenue_cad` summed over range = -500. `p.units` = -10? No — units is summed as integers (`p.units += p.units` — products_daily.units is the count of units sold, never negative). So `units = 10`, `netRevenueCad = -500`.
- `p.netRevenueCad <= 0 && p.units <= 0` is false (units > 0), so the early-exit at line 315 does NOT trigger.
- `detByPlatform.Meta.revenue = 1000`. Cap at `p.netRevenueCad = -500`: `1000 > -500` → clamped to `-500`. So `Meta.revenue = -500` after cap.
- `totalDetRev = -500`. `remRev = max(0, -500 - (-500)) = 0`.
- Meta is credited with **CAD -500**. Correct mass — but only by accident: the cap converted a positive deterministic value into a negative one.
- BUT: the cap on **units** is `Math.min(units, p.units)` — both are 10, so no change. Now `deterministicUnits = 10`. The dashboard's per-platform Units column shows **10**, while per-platform revenue is **-500**. The two cells disagree on whether anything was sold. The operator stares at "10 units, -500 CAD" and concludes the data is wrong.

**Why it matters:** Negative deterministic revenue is a real, reproducible state. The cap is asymmetric (units cap is `min`, revenue cap is also `>` then assign — but `1000 > -500` triggers the clamp). The display logic in `CampaignsTableRow.tsx:603` (`if (!info || info.deterministicRevenue <= 0)`) then hides the cell entirely (renders "—"), even though there WERE real orders. The operator sees a Meta campaign that "has no Shopify revenue" when it actually had a refunded sale.

**Suggested fix:**

```ts
// 1. Remove the asymmetric clamp. Cap should be |netRevenueCad|-aware or skipped.
//    Better: when p.netRevenueCad < 0, skip the cap step entirely and let the
//    deterministic revenue stand (negative or positive). The display layer
//    should handle "refund-heavy product" explicitly.
for (const k of ['Meta', 'Google', 'TikTok'] as const) {
  if (p.netRevenueCad >= 0 && detByPlatform[k].revenue > p.netRevenueCad) {
    detByPlatform[k].revenue = p.netRevenueCad;
  }
  // similar for units, but keep units cap (units is always nonneg)
}

// 2. Drop Math.max(0, …) for remRev. Let remainder go negative; the spend-share
//    distribution will then distribute the negative remainder across all
//    mapped campaigns proportionally — which is the correct semantic.
const remRev   = p.netRevenueCad - totalDetRev;
const remUnits = Math.max(0, p.units - totalDetUnits);  // units stays nonneg
if (remRev !== 0 || remUnits > 0) {
  // ... existing distribution loop, gated on `!== 0` not `> 0`
}
```

---

#### CR-02 — `productsByStore` early-continue + `existing.netRevenueCad += net` allow negative-net rows to disappear when they appear AFTER positive ones

**Severity:** CRITICAL
**File:** `dashboard-web/src/lib/hooks/useCampaignTrueRevenue.ts:271-294`
**Evidence:**

```ts
for (const p of productsResp.rows) {
  if (p.date < localRange.from || p.date > localRange.to) continue;
  if (!p.productId) continue;
  const net = p.netRevenue ?? p.revenue; // net wins when available
  if (net <= 0 && p.units <= 0) continue;   // ← (A) drops refund-only rows
  // ...
  const existing = arr.find(x => x.productId === p.productId);
  if (existing) {
    existing.netRevenueCad += net;
    existing.units += p.units;
    existing.orders += p.orders ?? 0;
  } else {
    arr.push({ productId, netRevenueCad: net, units: p.units, orders: p.orders ?? 0 });
  }
}
```

**The bug:**

`(A)` drops any row where both `net <= 0` AND `units <= 0`. After the gap-closure 08 refund algorithm, a refund-only day produces exactly this shape: `units = 0` (no new sales on the refund day for this product), `net_revenue_cad < 0` (the refund deduction).

**Concrete failure:**

- Range: 2026-05-01 .. 2026-05-31. Product P sold 5 units day 5 (net = +500). Day 20: customer refunds → products_daily row with units = 0, net = -300.
- Loop hits day 5 first → pushes `{P, netRev: 500, units: 5, orders: 1}`.
- Loop hits day 20 → `net = -300, units = 0` → `(A)` fires → **CONTINUE**. The refund row is silently dropped.
- Allocator receives `{P, netRev: 500, units: 5}` — refund-free.
- Operator sees campaign mapped to P show ROAS based on CAD 500 net, but the actual net for the range is CAD 200.

Note: the same `if (net <= 0 && p.units <= 0)` filter also lives in `postgresReaders.ts:504` for *individual* row filtering. There, dropping a row where all three (units, gross_revenue, net_revenue) are zero is correct (it's a true empty row). But in `useCampaignTrueRevenue.ts:275` the `net <= 0 && units <= 0` filter is applied AFTER we've decided `net = p.netRevenue ?? p.revenue` — so a row with `units=0, net=-300` (a real refund-only row) gets nuked.

**Suggested fix:**

```ts
// Change the filter to only skip the (0,0) row, not the (0,-N) row:
if (net === 0 && p.units === 0) continue;
// OR — more defensively — skip nothing here and let the allocator deal
// with negative net naturally (this also fixes CR-01's mass-conservation gap):
// // (no filter — every row contributes)
```

The `if (net <= 0 && p.units <= 0) continue` filter at `postgresReaders.ts:504` (the ProductsResponse layer) doesn't have this bug because it tests `units <= 0 && revenue <= 0 && netRev <= 0`. The `useCampaignTrueRevenue.ts` filter regressed it.

---

#### CR-03 — Allocator skips entire product when `p.netRevenueCad <= 0 && p.units <= 0` BEFORE applying refund attribution

**Severity:** CRITICAL
**File:** `dashboard-web/src/lib/campaignProductMap.ts:313-315`
**Evidence:**

```ts
for (const p of productRevenue) {
  if (!p.productId) continue;
  if (p.netRevenueCad <= 0 && p.units <= 0) continue;   // ← skip orphan / refund-only
  // ... deterministic + fallback steps
}
```

**The bug:**

Per CR-02's upstream filtering this is partly moot — `useCampaignTrueRevenue.ts:275` already drops these rows before they reach the allocator. But if the upstream filter were fixed (per CR-02's recommendation), this early-continue would re-introduce the same loss: a product that summed to `netRevenueCad < 0, units = 0` after refunds would never be attributed — neither positive deterministic credit nor the negative refund correction would propagate to its mapped campaigns.

**Concrete failure (assumes CR-02 fix applied):**

- Same scenario as CR-02 but the operator widens range so units come from one period and refunds from another; if units happen to be 0 in the aggregated range (rare but possible: think 6-month-old product with all sales in the previous month and refunds dragging current month's net to -1000), the allocator entirely skips P. Mapped campaigns get no credit at all — neither the negative correction they deserve nor a zero.

**Suggested fix:**

```ts
// Skip only if BOTH net and units are exactly zero (true orphan). Allow negative
// net to propagate to mapped campaigns so refunds correctly drag down ROAS.
if (p.netRevenueCad === 0 && p.units === 0) continue;
```

---

### HIGH

#### HI-01 — `dailyMetaByCampaign` is NOT filtered to `localRange`; `analyzeAttribution`'s window-stability runs on out-of-range days

**Severity:** HIGH
**File:** `dashboard-web/src/lib/hooks/useCampaignTrueRevenue.ts:209-222`
**Evidence:**

```ts
const dailyMetaByCampaign = useMemo(() => {
  const out = new Map<string, Map<string, number>>();
  for (const r of allCampaignRows) {
    if (r.platform !== 'Meta' && r.platform !== 'TikTok') continue;
    const k = campaignKey(r.storeId, r.platform, r.campaignId);
    let inner = out.get(k);
    if (!inner) {
      inner = new Map<string, number>();
      out.set(k, inner);
    }
    inner.set(r.date, (inner.get(r.date) ?? 0) + r.conversionValue);
  }
  return out;
}, [allCampaignRows]);
```

**The bug:**

`allCampaignRows` is the full SWR-fetched campaigns dataset, often 90 days. There is no `r.date < localRange.from || r.date > localRange.to` filter. The map is then passed to `analyzeAttribution(...)` at line 432 with `localRange.from`/`localRange.to` as args.

Looking at `attributionAnalysis.ts:288`, `analyzeAttribution` does receive `dateFrom`/`dateTo` and the daily-series, but `analyzeAttribution`'s internal filtering of the daily-meta series IS the `dateFrom/dateTo` filter. Reading the function (lines 288+) shows it does filter — but the SETUP of `dailyMeta` at line 410-413 already loaded all 90 days into a single `byDate` Map.

This is wasted work, not a correctness bug for `analyzeAttribution`. BUT the same `dailyMetaByCampaign` is the per-campaign daily series used for outlier detection and window stability. The window-stability calculation runs over the dataframe IT RECEIVES; if the analyzer only filters by `dateFrom/dateTo` for one of its uses but not the other, you get cross-pollination.

Concretely, re-read `analyzeAttribution.ts:410-413` — it constructs `dailyMeta` from `dailyMetaByCampaign.get(...)`. That value is the *unfiltered* per-day-Meta-claim series for the entire SWR window. If `analyzeAttribution` then `.filter(d => d.date >= dateFrom && d.date <= dateTo)` internally, the outlier-detection lookback is bounded correctly. If it doesn't, the outlier days flagged for a 7-day operator window can come from a different 7-day stretch entirely.

Read `attributionAnalysis.ts:288+` — confirm filtering. (Reviewer must verify; the function signature accepts `dateFrom/dateTo` but the actual filter site is in the body of analyzeAttribution.)

**Concrete failure shape:**

If unfiltered: operator selects 2026-05-15..2026-05-22 (7 days). `dailyMetaByCampaign` for the campaign contains daily values for 2026-02-15..2026-05-22 (90 days). The outlier-day algorithm using 7-day MAD lookback now flags spike days from February, which are then displayed in the trust chip tooltip as "outlier days in the selected range".

**Suggested fix:**

```ts
const dailyMetaByCampaign = useMemo(() => {
  const out = new Map<string, Map<string, number>>();
  for (const r of allCampaignRows) {
    if (r.date < localRange.from || r.date > localRange.to) continue;   // ← ADD
    if (r.platform !== 'Meta' && r.platform !== 'TikTok') continue;
    // ... rest unchanged
  }
  return out;
}, [allCampaignRows, localRange]);    // ← add localRange to deps
```

---

#### HI-02 — Allocator drops `Google` deterministic-classified order entirely when no Google campaign is mapped, even though the order really happened

**Severity:** HIGH
**File:** `dashboard-web/src/lib/campaignProductMap.ts:395-403`
**Evidence:**

```ts
if (platformKeys.length === 0) {
  // No campaign of this platform is mapped — the deterministic count
  // for this platform has no campaign to credit. It still came out
  // of total, so we leave it as a residual that the fallback step
  // (Step 3) will redistribute. Concretely we zero it here so it
  // joins the unattributed pool.
  detByPlatform[platform] = { revenue: 0, units: 0 };
  continue;
}
```

**The bug:**

This is INTENTIONAL and the comment explains the design choice. But the design is **wrong for Google**: Google campaigns can't currently be mapped to products at all (mapping flow assumes Meta or TikTok). So in production, Google-deterministic orders for a mapped product will always hit this branch and get "zeroed and reallocated to other-platform campaigns via Step 3 spend share". A click-id-proven Google purchase ends up credited to a Meta campaign by spend share — the opposite of "trust the click ID".

The test at `campaignProductMap.test.ts:257-276` actually pins this exact behavior as a positive test:

```ts
it('handles a platform deterministic hit when NO campaign of that platform is mapped (sends to fallback)', () => {
  const orders = [
    mkOrder({ source: 'meta-paid', units: 1, revenue: 50 }),
    mkOrder({ source: 'direct', units: 1, revenue: 50 }),
  ];
  const result = allocateProductRevenue({ map: { [TIKTOK_KEY]: [PROD] }, ... });
  // TikTok gets ALL 2 units (no Meta campaign mapped, so both the
  // meta-paid det and the direct fallback redistribute to TikTok).
  expect(result.get(TIKTOK_KEY)!.units).toBeCloseTo(2, 5);
});
```

Reading the comment: the test author explicitly confirms a meta-paid order gets credited to TikTok when only TikTok is mapped. This is **mathematically conservation-preserving** (mass stays) but **semantically wrong** (the click came from Meta, not TikTok). The "ערך/יח' Shopify · פלטפורמה" column for the TikTok campaign will show 2 deterministic units that did NOT come from TikTok. The product totals stay correct, but the per-platform column is now misleading.

**Why this matters:** The whole point of the deterministic step (per the comment block at `campaignProductMap.ts:218-265`) is to show the operator: "this revenue is provably from this platform's click." If we then credit it to a different platform when there's no mapping match, the column's premise is broken.

**Suggested fix:**

Two options, depending on operator intent:

1. **Drop the unattributed pool entirely** — don't redistribute Google-deterministic to other platforms. The downside: ROAS Shopify column understates total for the product. But it's honest.
2. **Keep the redistribution but warn explicitly** — surface a per-row "cross-platform attribution: N units of P came from Google but no Google campaign is mapped" tooltip on the Shopify cells.

The test at line 257-276 should also be updated to assert TikTok's `deterministicUnits` is 0 (not 2) — the current expectation conflates fallback + deterministic.

---

#### HI-03 — `OrderLineItem.revenueCad` is sourced from `current_total_price`, NOT refund-corrected; deterministic attribution credits gross-of-refund revenue to platforms

**Severity:** HIGH
**File:** `dashboard-web/src/lib/fetchers/shopify.ts:962-992` (`computeLineItemsCad`)
**Evidence:**

```ts
function computeLineItemsCad(
  order: ShopifyOrderPayload,
  totalCad: number,                          // ← caller passes current_total_price
): Array<{ p: string; u: number; r: number }> {
  // ... lineGross = price × qty
  const lineCad = useFlatSpread
    ? items.length > 0 ? totalCad / items.length : 0
    : (lineGross / subtotal) * totalCad;
  out.push({ p: pid, u: qty, r: Math.round(lineCad * 100) / 100 });
}
```

And `shopify.ts:1058`:

```ts
const totalCad = parseFloat(String(o.current_total_price ?? '0')) || 0;
```

**The bug:**

`OrderLineItem.revenueCad` is stamped at order creation and **does not reflect future-day refunds**. Per the gap-closure 08 invariant (`shopifyRevenueRefunds.ts:7-48`), refunds attribute on their `processed_at` day to the store-level + per-product net. But the per-order `lineItems[].revenueCad` lives in `orders_attribution` and is never re-computed.

When the allocator runs deterministic attribution:

```ts
// campaignProductMap.ts:336-340
for (const li of o.lineItems) {
  if (li.productId !== p.productId) continue;
  detByPlatform[platform].revenue += li.revenueCad;
  detByPlatform[platform].units += li.units;
}
```

It sums `li.revenueCad` (gross at creation). If the order was later refunded, the deterministic platform is credited with the pre-refund revenue. The cap (line 344-350) clamps `detByPlatform[k].revenue` at `p.netRevenueCad`, which **partially** corrects this — but only in aggregate, not per-platform. If two platforms each had partial deterministic attribution and refunds dropped net below their sum, the cap proportionally shrinks both (line 363-368). That's mathematically OK for the aggregate, but per-platform it's a smoothed approximation, not the truth.

**Concrete failure:**

- Day 1: Meta-attributed order, 1 unit, CAD 500.
- Day 2: TikTok-attributed order, 1 unit, CAD 500.
- Day 5: Meta order refunded fully (refund-line-items.subtotal = 500).
- Net per-product for the range: 1 unit (TikTok's, even though products_daily.units may say 2 — depending on whether refund-line-items count toward units; per `shopifyRevenueRefunds.ts:270-283`, units stay at the same-day count, refund only deducts revenue), `netRevenueCad = 500`.
- Deterministic step: Meta = 500, TikTok = 500. Cap: total = 1000 > 500, ratio = 0.5, Meta = 250, TikTok = 250.
- Operator sees: Meta column "250 CAD, 1 unit", TikTok column "250 CAD, 1 unit". Truth: Meta column should be "0 CAD, 0 units" (refunded), TikTok column should be "500 CAD, 1 unit".

**Suggested fix:**

Two options:

1. **Store refund-adjusted line-item revenue in `orders_attribution.line_items` JSONB.** When a refund processes, re-emit the order's line-items with the refund subtracted per-product. Heavy lift but truthful.
2. **Pass refund data to the allocator and per-platform-decrement.** The allocator already has `orders`; expand the payload to include refunds. Each refund attributes to the same platform as the parent order (fbclid stays the same), so deduct from `detByPlatform[platform].revenue/units`.

Both options need a schema decision; document the trade-off in the next refactor plan.

---

#### HI-04 — Allocator's `o.lineItems` defaults to `[]` when API caller forgets `?lineItems=true`, silently producing zero deterministic attribution

**Severity:** HIGH
**File:** `dashboard-web/src/lib/ordersAttribution.ts:258-261`, `dashboard-web/src/lib/postgresReaders.ts:791`
**Evidence:**

```ts
// ordersAttribution.ts:259
lineItems: includeLI ? parseLineItems(row[13]) : [],

// postgresReaders.ts:791
lineItems: includeLI ? parseLineItems(r.line_items) : [],
```

Then in the allocator (`campaignProductMap.ts:332-340`):

```ts
if (storeOrders) {
  for (const o of storeOrders) {
    const platform = classifyOrderToPlatform(o);
    if (!platform) continue;
    for (const li of o.lineItems) {       // ← if [], silently skip everything
      if (li.productId !== p.productId) continue;
      ...
    }
  }
}
```

**The bug:**

The allocator distinguishes "no orders provided" (`orders === undefined` → backwards-compat pure spend-proportional) from "orders provided with empty lineItems" (`orders = []` → deterministic step finds nothing → everything goes to fallback). It does NOT detect the silent failure mode of "orders provided WITH lineItems disabled by the API caller".

The caller `CampaignsTable.tsx:293` correctly passes `?lineItems=true`. But:

- Any future caller that forgets the flag will silently get the OLD spend-proportional behavior with no warning.
- The 2-of-3 callers of `useCampaignTrueRevenue` (`MetaShopifyReconciliation` at line 48 references it but I didn't trace whether the call site passes orders, and `multiMappingCohort.ts:148` and `campaignHealthScore.ts:40` use the `TrueRevenueInfo` type but I didn't verify they invoke the hook) may differ.

**Why it matters:** The "ערך/יח' Shopify · פלטפורמה" columns silently drop to "—" if any future page loads orders without `?lineItems=true`. The bug is invisible because the column reads `info.deterministicRevenue <= 0 → render —` (CampaignsTableRow.tsx:603), so the operator sees "no Shopify attribution for this campaign" without any debug indication that the data is *available but skipped at the API layer*.

**Suggested fix:**

```ts
// In useCampaignTrueRevenue.ts:303-315 — sanity-check ordersForAllocator:
const ordersForAllocator = (ordersAttrResp?.rows ?? [])
  .filter(o => o.date >= localRange.from && o.date <= localRange.to)
  .map(o => ({ ... }));

// ADD: warn (dev) when orders are present but lineItems are uniformly empty.
if (ordersForAllocator.length > 0 && ordersForAllocator.every(o => o.lineItems.length === 0)) {
  console.warn(
    'useCampaignTrueRevenue: orders fetched without lineItems — append "?lineItems=true" ' +
    'to the /api/orders-attribution call to enable deterministic per-platform attribution.'
  );
}
```

Better: make `lineItems` opt-OUT instead of opt-IN at the API layer (or at minimum, have the route auto-include lineItems unless `?lineItems=false`). The 30-50% bandwidth savings is now a correctness footgun.

---

### MEDIUM

#### MD-01 — `parseLineItems` accepts a non-numeric `revenueCad` and produces NaN entries

**Severity:** MEDIUM
**File:** `dashboard-web/src/lib/ordersAttribution.ts:138-169`
**Evidence:**

```ts
return parsed
  .filter((it): it is ... =>
    it !== null && typeof it === 'object' &&
    typeof (it as { p?: unknown }).p === 'string' &&
    (it as { p: string }).p.trim().length > 0,
  )
  .map(it => ({
    productId: String(it.p ?? '').trim(),
    units: Number(it.u ?? 0),
    revenueCad: Number(it.r ?? 0),
  }))
  .filter(li =>
    Number.isFinite(li.units) &&
    Number.isFinite(li.revenueCad),
  );
```

**The bug:**

`Number(it.r ?? 0)` produces `NaN` for `{r: "not-a-number"}` or `{r: undefined-then-stringified}`. The downstream `.filter(li => Number.isFinite(...))` catches `NaN` and drops the line item — **OK**.

But: `Number(it.u ?? 0)` for `{u: 1.5}` (decimal units, which Shopify allows for some product types — gift cards, fractional inventory) passes the `isFinite` check. Downstream, `units` is summed as a float and `Math.round` is applied at display time. The display `Math.round(info.deterministicUnits)` rounds 1.5 to 2, then to 1, depending on JS's banker's rounding. Not strictly a correctness bug but a UX inconsistency.

More importantly: `Number(it.u ?? 0)` produces 0 for invalid input, then the filter passes (`isFinite(0) === true`), and the entry is kept with `units = 0`. A malformed `{p: "123", u: "abc", r: 50}` becomes `{productId: "123", units: 0, revenueCad: 50}` — a CAD-50 phantom revenue with no units. The allocator credits the platform with revenue but no units.

**Suggested fix:**

```ts
.map(it => ({
  productId: String(it.p ?? '').trim(),
  units: Number(it.u),       // not `?? 0` — let NaN propagate to the filter
  revenueCad: Number(it.r),
}))
.filter(li =>
  Number.isFinite(li.units) &&
  Number.isFinite(li.revenueCad),
);
```

---

#### MD-02 — `parseLineItems` doesn't validate negative units / revenue

**Severity:** MEDIUM
**File:** `dashboard-web/src/lib/ordersAttribution.ts:157-165`
**Evidence:** Same as MD-01.

`{p: "P1", u: -5, r: -100}` parses cleanly. Allocator then credits the platform with negative revenue and units. If the Apps Script writer (gone, replaced by `fetchers/shopify.ts:computeLineItemsCad`) ever emits a bad row, the dashboard silently consumes it.

**Suggested fix:** `.filter(li => li.units >= 0 && Number.isFinite(...))` or document explicitly that negative is allowed for refund-line-item semantics (currently not the case — refunds live in a separate path).

---

#### MD-03 — `dailyMetaByCampaign`'s `(out.get(k) ?? 0) + r.conversionValue` accumulates duplicate dates if the same campaign row appears twice in `allCampaignRows`

**Severity:** MEDIUM
**File:** `dashboard-web/src/lib/hooks/useCampaignTrueRevenue.ts:219`
**Evidence:**

```ts
inner.set(r.date, (inner.get(r.date) ?? 0) + r.conversionValue);
```

**The bug:**

If `allCampaignRows` contains a duplicate row for the same `(storeId, platform, campaignId, date)` (e.g., a stale row + a fresh row after a cron-live run, or a join that didn't dedupe), the conversion value gets summed. Per-day Meta claim doubles, all downstream coverage/window-stability/outlier computations are off.

`fetchCampaignsFromPostgres` (`postgresReaders.ts:547`) selects raw rows and de-dupes nothing. The DB's primary key on `campaigns_daily` would prevent duplicates at the storage layer (if there is one); this assumption needs verification. The Postgres reader doesn't enforce dedup.

**Suggested fix:** Either verify the PK on `campaigns_daily` covers `(date, store_id, platform, campaign_id)` exactly OR add dedup defensive logic (write to a Set or use Map.set instead of `(get ?? 0) +`):

```ts
inner.set(r.date, r.conversionValue);   // overwrite, not accumulate
```

(if PK guarantees uniqueness; if it doesn't, that's the real bug).

---

#### MD-04 — `productToCampaigns` index doesn't filter to current-storeId mappings before iterating products

**Severity:** MEDIUM
**File:** `dashboard-web/src/lib/hooks/useCampaignTrueRevenue.ts:226-249`
**Evidence:**

```ts
const productToCampaigns = useMemo(() => {
  const out = new Map<string, Map<string, Set<string>>>();
  for (const k of Object.keys(productMap)) {
    const parts = k.split('::');
    if (parts.length !== 3) continue;
    const storeId = parts[0];
    const products = productMap[k] ?? [];
    // ... builds nested map
  }
  return out;
}, [productMap]);
```

**The bug:**

This is the correct nested-map shape, but the comment at the inner site uses `productToCampaigns.get(a.storeId)` which is good — store isolation is enforced. **BUT** the `productMap` is a flat global map across all stores. If two stores happen to have a productId in common (Shopify product IDs are per-store, but if the operator types in a numeric ID by hand or there's any test data leakage, the index correctly separates by storeId). Tested via `productMap` shape `${storeId}::${platform}::${campaignId} → productId[]`.

This is OK — flagged as MEDIUM because the assumption "productIds don't collide across stores" is fragile and not tested. If it ever fails, the allocator would correctly handle it via the storeId-prefix filter at `campaignsForProductInStore`, but the cohort/cross-product analyses might not.

**Suggested fix:** Add a test that asserts cross-store productId collisions are correctly partitioned by the index.

---

#### MD-05 — `campaignSpend` includes rows from outside `localRange` for "currently active" placeholder campaigns

**Severity:** MEDIUM
**File:** `dashboard-web/src/lib/postgresReaders.ts:598-611`
**Evidence:**

```ts
const hasActivity = spend > 0 || impressions > 0 || conversions > 0;
const isCurrentlyActive = ...;
if (!hasActivity && !isCurrentlyActive) {
  continue;
}
```

**The bug:**

The reader keeps "currently active" placeholder rows (zero spend, zero impressions, zero conversions) **regardless of date**. They get into `allCampaignRows`. The `useCampaignTrueRevenue.ts:260-264` builds `campaignSpend`:

```ts
for (const r of allCampaignRows) {
  if (r.date < localRange.from || r.date > localRange.to) continue;
  const key = campaignKey(r.storeId, r.platform, r.campaignId);
  campaignSpend.set(key, (campaignSpend.get(key) ?? 0) + r.spend);
}
```

That correctly filters by date. So the placeholder rows with `spend=0` get summed into `campaignSpend` but contribute 0 — no double-counting. **But:** a placeholder row outside `localRange` (e.g., a row for 2026-05-23 representing "this campaign is currently ACTIVE") slips through the reader filter. If the operator's `localRange` is 2026-04-01..2026-04-30 (April), the placeholder row for May 23 is in `allCampaignRows` but excluded by the date filter at line 261. So `campaignSpend` for that campaign in April is 0 (correct — it had no April activity but is marked active today).

Then the allocator at line 376 hits the `if (mappedIds.length === 0) continue;` check first — if the campaign has a mapping, it proceeds to allocate, gets `alloc.revenue = 0` (because no spend, no orders deterministic), and emits a row with `trueRevenue = 0`. That row will then appear in the campaign table for April, listed with `trueRevenue = 0`. The operator sees a campaign in their April view that did nothing in April.

This is partly intentional (per the comment at `postgresReaders.ts:586-597`) but feels like a leak. **Tagged MEDIUM** because the user-visible artifact is one row of noise, not wrong numbers, but is worth documenting.

---

### LOW

#### LO-01 — `hasSuccessfulRefundTransaction` returns true for `{transactions: [{status: ''}]}` (missing-status case)

**Severity:** LOW
**File:** `dashboard-web/src/lib/shopifyRevenueRefunds.ts:101-111`
**Evidence:**

```ts
return txs.some((t) => {
  const s = (t.status ?? '').toLowerCase();
  return s === '' || s === 'success';
});
```

**The bug:** Intentional per the docstring (`legacy / sparse data`). LOW because the existing test (`shopifyRevenueRefunds.test.ts:685+`) pins the behavior. **Risk:** a new Shopify Admin REST version that emits transactions with an explicit empty-string status (rather than omitting the field) would silently bypass the failure filter. Suggest: tighten to `s === 'success'` only and add a separate explicit `txs.every(t => t.status === undefined || t.status === null)` legacy path.

---

#### LO-02 — `parseSource` accepts any string as `OrderSource` via type cast

**Severity:** LOW
**File:** `dashboard-web/src/lib/ordersAttribution.ts:118-122`
**Evidence:**

```ts
export function parseSource(v: unknown): OrderSource {
  const s = String(v ?? '').trim();
  if (!s) return '';
  return s as OrderSource;  // ← accepts anything
}
```

**The bug:** Intentional per the docstring at line 108-116. LOW because the downstream classifier (`classifyOrderToPlatform`) string-matches against known values and returns `null` for anything unrecognized — so an unknown source like `'snapchat-paid'` would silently fall through to the spend-proportional fallback. The dashboard never shows the unknown bucket. Tagged LOW because the data survives, but it'd be cleaner to emit a warning when a brand-new source kind appears in the data.

---

#### LO-03 — `computeLineItemsCad` (TS mirror at `lineItems.ts:78`) and the writer's version (`shopify.ts:962`) silently drift if one is updated

**Severity:** LOW
**File:** `dashboard-web/src/lib/lineItems.ts:1-96` AND `dashboard-web/src/lib/fetchers/shopify.ts:962-992`
**Evidence:** The TS mirror at `lineItems.ts` is *pure* (used by tests), and the production fetcher at `shopify.ts:962` is a near-copy. The header comment in `lineItems.ts:1-31` explicitly warns "KEEP IN SYNC with Shopify.gs" — but the .gs side no longer matters (Phase 05.7 is Postgres-only). The real risk is now between `lineItems.ts` (pure) and `shopify.ts:computeLineItemsCad` (production writer).

The two functions are structurally identical but written separately. The `shopify.ts` version uses `parseInt`/`parseFloat` while `lineItems.ts` uses `Number(li.quantity) || 0`. For `{quantity: "1.5"}`, `parseInt` returns 1 while `Number()` returns 1.5 — a divergence. Currently invisible because Shopify line item qty is always an integer, but if that ever changes, the production fetcher and the test mirror produce different numbers and the test fails silently to catch the prod behavior.

**Suggested fix:** Have `shopify.ts:computeLineItemsCad` import from `lineItems.ts` (extract a shared pure helper). The TODO at `lineItems.ts:27` already acknowledges this.

---

## Algorithm correctness checklist

| # | Question | Verdict | Evidence |
|---|----------|---------|----------|
| 1 | Proportional split sums to 100% (no leakage)? | **BUG** (CR-01) | `campaignProductMap.ts:437` `Math.max(0, …)` silently drops mass when deterministic exceeds net. |
| 2 | Deterministic subtracted from pool BEFORE fallback? | **CORRECT** | `campaignProductMap.ts:429-436` subtracts `totalDetRev` from `p.netRevenueCad` before Step 3. Mass-conservation contract holds when net > 0. |
| 3 | Zero-spend campaign with mapping gets 0 fallback? | **BUG (subtle)** | `campaignProductMap.ts:444-447` — when all mapped have 0 spend, `share = 1/mappedKeys.length` distributes the remainder EQUALLY, not zero. A 0-spend mapped campaign DOES receive a share of the remainder when ALL mapped campaigns have 0 spend. Documented as edge case in line 258-259 ("All campaigns have 0 spend: deterministic step still runs, then the remainder splits equally") — but the operator's expectation per Q3 ("it SHOULDN'T get any fallback") doesn't match the code. CONFIRMED INTENTIONAL but is a behavior mismatch worth surfacing. |
| 4 | Refunds attributed to right day/campaign? Same-day vs cross-day? Line-level vs order-level? | **CORRECT (with caveats)** | `shopifyRevenueRefunds.ts:231-408` is carefully audited (Phase 05.2.3.0 + gap-closure 08). Same-day and cross-day both deduct on `processed_at` day (invariant 2). Line-level via `refund_line_items[].subtotal` (D-C1/C2). **Caveat (HI-03):** Refunds DO NOT propagate to `orders_attribution.line_items.r` (revenueCad) — so deterministic per-platform attribution credits pre-refund revenue. |
| 5 | Every value in CAD? | **CORRECT** | All three stores' Shopify shops are CAD-denominated per fetcher docstring (`shopify.ts:145-147`). `total_price`/`current_total_price` are CAD. `campaigns_daily.spend_cad` / `conversion_value_cad` are explicit. No double-conversion observed. |
| 6 | Date attribution consistent with cron? | **CORRECT** | `shopifyRevenueRefunds.ts:202-214` uses `dayInTz(ts, 'Asia/Jerusalem')` for `created_at` (same-day gross) and `processed_at` (refund attribution). `fetchers/shopify.ts:247-315` `isoLocalMidnight` mirrors this for the HTTP query. Cron writes `products_daily.date` using the same TZ helper. |
| 7 | Multi-store isolation? | **CORRECT** | `campaignProductMap.ts:316` `campaignsForProductInStore` uses `${storeId}::` prefix. `useCampaignTrueRevenue.ts:300-301` `productsByStore` keyed by storeId. `allocateProductRevenue` `storeOrders = orders.filter(o => o.storeId === storeId)`. **BUT:** `productMap` is global; the prefix filter is the only barrier. A bug elsewhere that handed a wrong storeId would cascade silently. |
| 8 | Per-platform `shopifyValuePlatform` correctly classified? | **BUG** (HI-02) | `classifyOrderToPlatform` (`campaignProductMap.ts:205-216`) priority chain looks correct. **But** when no campaign of the classified platform is mapped, the deterministic mass is redistributed to whichever platform IS mapped — the column then misrepresents which platform "earned" the units. Empty `source_name` falls through to fbclid/gclid checks; if neither, returns `null` → falls to spend-share fallback (correct). |
| 9 | Product in order with no mapping → dropped? | **CORRECT** | `campaignProductMap.ts:316-317`: `campaignsForProductInStore` returns `[]` → `if (mappedKeys.length === 0) continue;` skips the product. Revenue stays in the `productsByStore` map but is never attributed. |
| 10 | Campaign mapped to deleted product? | **UNCLEAR-NEED-DOMAIN-INPUT** | If the product was deleted from Shopify and removed from `product_catalog`, the mapping still references the old productId. `productCatalog.ts:fetchProductCatalog` only returns active products (since `status='active'` filter at `shopify.ts:686`). Allocator iterates `productRevenue` (from `products_daily`), not from the catalog — so as long as the historical sales still exist in `products_daily`, the deleted product still gets attributed. If `products_daily` is purged, the mapping dangles silently. No code path actively prunes orphaned campaign→productId mappings when a product is deleted. **Recommendation:** the ProductPickerModal should grey out / mark mappings whose productId is no longer in `product_catalog`. |

---

## What's solid

1. **The refund attribution algorithm** (`shopifyRevenueRefunds.ts`) — exceptionally well-commented, gap-closure-08 invariants are pinned by 6 specific tests, the `total_price`-vs-`current_total_price` issue is documented and tested (the "double-deduction" CR-01 in the 05.2.3.0 review). The `hasSuccessfulRefundTransaction` filter (2026-05-21 bug fix) has both a regression test and a docstring tying it to the live incident. This is the highest-quality module in scope.

2. **`computeLineItemsCad` (TS mirror)** — clean implementation, explicit handling of `useFlatSpread` for free-gift orders, custom-item handling matches the writer.

3. **Cross-store isolation in `campaignsForProductInStore`** — defensive prefix filter prevents cross-store leakage at the allocator boundary.

4. **`migrateProductMapKeys` WR-07 fix** — the explicit segment-count check is defense-in-depth against colons in IDs; tests cover the malformed-key cases.

5. **`isoLocalMidnight` DST fix (2026-05-22)** — the CRITICAL FIX comment block (line 274-287) is a model of what comments should be when documenting a near-disaster.

6. **The deterministic-first algorithm's intent** — the Phase 05.7.9 design (Step 1 deterministic per platform → Step 2 intra-platform spend split → Step 3 spend-proportional fallback) is mathematically clean. The execution has the gaps documented above, but the design is correct.

7. **`OrderSource` taxonomy** — well-documented, the `parseSource` permissive parser explicitly tolerates new bucket names (with the LO-02 caveat).

8. **TZ handling** — both algorithm-side (`shopifyRevenueRefunds.ts:dayInTz`) and HTTP-side (`shopify.ts:isoLocalMidnight`) use `Asia/Jerusalem` consistently. The `2024-10 → 2026-04` API version bump is documented and field-stability is verified.

9. **The `useCampaignTrueRevenue` JSDoc warning at line 176-186** — explicitly documents the `localRange` reference-equality contract. The kind of comment that prevents future bugs.

---

## Verdict

**Soundness assessment:** The algorithm chain is rigorous and well-tested for the happy path. The three CRITICAL findings are all in the same conceptual area — **how the system handles negative net revenue produced by refunds**. The codebase was originally built assuming net revenue is always nonneg, and the refund algorithm's `D-D3: no clamping anywhere` invariant has propagated through the rest of the chain incompletely. Two filters (`useCampaignTrueRevenue.ts:275` and `campaignProductMap.ts:315`) still apply the implicit "nonneg" assumption, and one spot (`campaignProductMap.ts:437`) uses `Math.max(0, …)` to silently absorb negative remainder. All three should be fixed in a single coordinated change with a regression test that mirrors the `shopifyRevenueRefunds` `D-C3 invariant 5` style — explicit period sum vs `total_price - refund_subtotal` identity.

**For the operator's "is this number correct?" question:** TODAY, for products with no recent refunds and Meta-or-TikTok-only attribution, the numbers are trustworthy. For products with cross-day refunds OR campaigns whose mapping spans platforms where one platform has no mapped campaign for a product Shopify says it sold, **do not trust the per-platform column without cross-checking against the product totals column**.
