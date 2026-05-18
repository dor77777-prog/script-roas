# Phase 1: Channel-Level Product Attribution — Pattern Map

**Mapped:** 2026-05-18
**Files analyzed:** 5 new/modified surfaces (2 Apps Script extensions, 1 dashboard type extension, 1 new analyzer, 1 new drawer section)
**Analogs found:** 5 / 5 (exact-match for every surface)

---

## File Classification

| New / Modified Surface | Role | Data Flow | Closest Analog | Match Quality |
|------------------------|------|-----------|----------------|---------------|
| `Shopify.gs` :: `getShopifyOrdersAttribution` — add `line_items` to fields query + per-order line-item array on each row | service (data fetcher) | request-response (Shopify REST → array of rows) | `Shopify.gs` :: `getShopifyProductSalesForDay` (line 142) | exact — same endpoint, same field, same iteration |
| `SheetBuilder.gs` :: `ORDERS_ATTRIBUTION_HEADERS` + `ensureOrdersAttributionTab_` (migration) + `writeOrdersAttributionForDay` (col N serializer) | model (sheet schema) | batch transform → write | `SheetBuilder.gs` :: same trio after Round 5's L+M migration (lines 1466-1525, 1533-1586) | exact — identical migration shape |
| `dashboard-web/src/lib/ordersAttribution.ts` :: `OrderLineItem` type + `lineItems` field on `OrderAttributionRow` + col-N JSON parser | model (type) + utility (parser) | sheets-API batchGet → typed rows | `ordersAttribution.ts` :: Round 5's `utmId` / `utmTerm` extension (range A2:M100000 → was A2:K, added cols 11+12) | exact — same pattern, same file |
| `dashboard-web/src/lib/attributionAnalysis.ts` :: new `analyzeProductChannel(productIds, orders, storeId, dateFrom, dateTo) → ProductChannelBreakdown \| null` | service (analyzer) | pure transform (orders → breakdown) | `attributionAnalysis.ts` :: `analyzeAttributionForAdSet` (line 524) + `analyzeAttributionForAd` (line 573) | exact — same signature shape, same null-on-unusable guard |
| `dashboard-web/src/components/CampaignDrawer.tsx` :: new section "מכירות לפי ערוץ של המוצרים המשויכים" + memoized analyzer call | component (drawer section) | useMemo + JSX render | `CampaignDrawer.tsx` :: existing inline-IIFE attribution panel (lines 650-794) + `attributionByAdSet` useMemo (lines 288-314) | exact — same memoization, same section structure, same recommendation chip |

---

## Pattern Assignments

### 1. `Shopify.gs` :: extend `getShopifyOrdersAttribution` to fetch + return line items

**Analog:** `Shopify.gs` :: `getShopifyProductSalesForDay` (lines 142-259)

**Why this analog:** Same endpoint (`/admin/api/.../orders.json`), same Shopify-side schema (`line_items[].product_id` / `quantity` / `price`), same pagination + 401-auto-bootstrap pattern. The product-sales fetcher is the canonical example of how this codebase reads line items out of Shopify orders.

#### Pattern 1a — extend the `fields` query string (lines 150-154 in analog)

```javascript
// ANALOG (Shopify.gs line 150-154):
let url = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/orders.json` +
          `?status=any&financial_status=any&limit=250` +
          `&created_at_min=${encodeURIComponent(dayStart)}` +
          `&created_at_max=${encodeURIComponent(dayEnd)}` +
          `&fields=id,financial_status,test,line_items,refunds`;
```

```javascript
// CURRENT in getShopifyOrdersAttribution (Shopify.gs line 524-528):
let url = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/orders.json` +
          `?status=any&financial_status=any&limit=250` +
          `&created_at_min=${encodeURIComponent(dayStart)}` +
          `&created_at_max=${encodeURIComponent(dayEnd)}` +
          `&fields=id,current_total_price,financial_status,test,landing_site,referring_site,note_attributes,source_name`;
```

**Lift:** append `,line_items` to the existing `fields=` clause. Do NOT add `refunds` — we're not computing per-line net here, only proportional CAD allocation from gross total.

#### Pattern 1b — per-line-item iteration + CAD computation (lines 197-228 in analog)

```javascript
// ANALOG (Shopify.gs line 197-228) — the gross/qty/price loop:
const items = o.line_items || [];
for (const li of items) {
  const pid = String(li.product_id || ''); // could be empty for custom items
  const key = pid || `custom:${li.title || 'Unknown'}`;
  const title = li.title || li.name || 'Unknown';
  const qty = parseInt(li.quantity || 0, 10);
  const price = parseFloat(li.price || 0);
  const gross = qty * price;
  // ...
}
```

**Lift for Phase 1 (per CONTEXT.md decision):** the new code does NOT aggregate across orders — it builds a per-order `lineItems: [{p, u, r}]` array where `r` is the **proportional CAD share of the order's `current_total_price`** (NOT raw price × qty). Formula:

```javascript
// NEW pattern (Phase 1 — proportional allocation):
const items = o.line_items || [];
const grossSubtotal = items.reduce((s, li) =>
  s + (parseFloat(li.price || 0) * parseInt(li.quantity || 0, 10)), 0);
const orderTotal = parseFloat(o.current_total_price || 0);
const lineItems = items.map(li => {
  const pid = String(li.product_id || '');
  const qty = parseInt(li.quantity || 0, 10);
  const price = parseFloat(li.price || 0);
  const gross = qty * price;
  // Proportional: line's share of subtotal × order total. Falls back
  // to raw gross when subtotal is 0 (defensive — shouldn't happen in
  // practice but a divide-by-zero would NaN the cell).
  const r = grossSubtotal > 0 ? (gross / grossSubtotal) * orderTotal : gross;
  return { p: pid, u: qty, r: Math.round(r * 100) / 100 };
});
```

**Where to embed:** inside the `for (const o of orders)` loop that already exists at line 550. Add `lineItems` to the object pushed at line 554-571 (alongside `referringSite`).

---

### 2. `SheetBuilder.gs` :: column-N migration mirroring the Round 5 L+M migration

**Analog:** `SheetBuilder.gs` :: lines 1466-1525 (the Round 5 commit `82beeb7` + follow-up `8f3a89e` that added cols L+M = UTM ID + UTM Term)

**Why this analog:** This is literally the previous migration on the *same* sheet, against the *same* writer. The shape "extend `ORDERS_ATTRIBUTION_HEADERS` + extend `ensureOrdersAttributionTab_` idempotent-migration block + extend `writeOrdersAttributionForDay` row builder" is what we mirror.

#### Pattern 2a — extend the headers array (line 1466-1471 in analog)

```javascript
// CURRENT (SheetBuilder.gs line 1466-1471):
const ORDERS_ATTRIBUTION_HEADERS = [
  'תאריך', 'מזהה הזמנה', 'סכום (CAD)', 'מקור',
  'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Content',
  'fbclid', 'gclid', 'Referrer',
  'UTM ID', 'UTM Term'
];
```

**Lift:** append `'Line Items (JSON)'` as the 14th element. Update the leading comment (lines 1462-1465) to mention col 14 = line items added in Phase 1.

#### Pattern 2b — first-time header creation block (lines 1482-1501 in analog)

```javascript
// ANALOG (SheetBuilder.gs line 1482-1501) — fresh-tab branch:
if (sh.getLastRow() === 0) {
  sh.getRange(1, 1, 1, ORDERS_ATTRIBUTION_HEADERS.length)
    .setValues([ORDERS_ATTRIBUTION_HEADERS])
    .setFontWeight('bold')
    .setBackground('#d9d9d9')
    .setHorizontalAlignment('center');
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 95);   // Date
  // ... cols 2-11 widths ...
  sh.setColumnWidth(12, 150); // UTM ID
  sh.setColumnWidth(13, 150); // UTM Term
}
```

**Lift:** add `sh.setColumnWidth(14, 300);` for Line Items JSON. (Wider because JSON strings are long — 300px keeps the cell visible at a glance.)

#### Pattern 2c — idempotent migration block (lines 1502-1521 in analog) — **the critical pattern**

```javascript
// ANALOG (SheetBuilder.gs line 1502-1521) — exact migration pattern:
} else {
  // Idempotent migration: existing tabs created before the utm_id /
  // utm_term columns get the new headers added without losing data.
  const lastCol = sh.getLastColumn();
  if (lastCol < 13) {
    const labels = ['UTM ID', 'UTM Term'];
    for (let i = 0; i < 2; i++) {
      const col = 12 + i;
      const cell = sh.getRange(1, col);
      if (!cell.getValue()) {
        cell.setValue(labels[i])
          .setFontWeight('bold')
          .setBackground('#d9d9d9')
          .setHorizontalAlignment('center');
      }
    }
    sh.setColumnWidth(12, 150);
    sh.setColumnWidth(13, 150);
  }
}
```

**Lift for Phase 1:** add a second migration check (do NOT replace the existing `lastCol < 13` block — both must coexist so a tab that's been completely untouched gets BOTH migrations applied):

```javascript
// NEW pattern (Phase 1 — append after the existing lastCol < 13 block):
if (lastCol < 14) {
  const cell = sh.getRange(1, 14);
  if (!cell.getValue()) {
    cell.setValue('Line Items (JSON)')
      .setFontWeight('bold')
      .setBackground('#d9d9d9')
      .setHorizontalAlignment('center');
  }
  sh.setColumnWidth(14, 300);
}
```

**Critical:** `lastCol < 14` (not `lastCol === 13`) — same defensive shape as the analog. If a future column 15 ever exists, this stays harmless.

#### Pattern 2d — row builder in `writeOrdersAttributionForDay` (lines 1553-1567 in analog)

```javascript
// ANALOG (SheetBuilder.gs line 1553-1567):
const newRowsArr = (rows || []).map(r => [
  parseYMD_(dateStr),
  r.orderId,
  round2_(r.totalCad || 0),
  r.source || '',
  r.utmSource || '',
  r.utmMedium || '',
  r.utmCampaign || '',
  r.utmContent || '',
  r.fbclidPresent ? 'TRUE' : '',
  r.gclidPresent ? 'TRUE' : '',
  r.referringSite || '',
  r.utmId || '',
  r.utmTerm || '',
]);
```

**Lift:** append one entry to the array literal: `r.lineItems ? JSON.stringify(r.lineItems) : ''`. The `: ''` is critical — see the column-B / L / M `setNumberFormat('@')` pattern (line 1579-1580) which forces text format. JSON strings should also be text-formatted to defend against Sheets auto-coercion:

```javascript
// NEW pattern (Phase 1 — after the existing setNumberFormat calls at line 1579-1580):
sh.getRange(2, 14, combined.length, 1).setNumberFormat('@');  // Line Items JSON
```

---

### 3. `dashboard-web/src/lib/ordersAttribution.ts` :: type + parser extension

**Analog:** `ordersAttribution.ts` :: the Round 5 `utmId` / `utmTerm` extension, fully visible in the current file at lines 32-39 (type), 128 (range), 169-170 (parse).

**Why this analog:** Identical surface — Round 5 extended the parser from cols A:K to A:M and added two fields to `OrderAttributionRow`. Phase 1 extends to col N and adds one field. Same file, same function, same shape.

#### Pattern 3a — extend the type (lines 18-39 in analog)

```typescript
// CURRENT (ordersAttribution.ts line 18-39):
export type OrderAttributionRow = {
  date: string;
  storeId: string;
  storeName: string;
  orderId: string;
  totalCad: number;
  source: OrderSource;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
  fbclidPresent: boolean;
  gclidPresent: boolean;
  referringSite: string;
  /** Platform campaign ID from utm_id={{campaign.id}} in Meta's URL
   *  Parameters. When present, used as the PRIMARY match key — beats
   *  utm_campaign-by-name because IDs are immutable. */
  utmId: string;
  /** Platform ad-set ID from utm_term={{adset.id}}. Enables per-adset
   *  matching when the URL Parameters are configured. */
  utmTerm: string;
};
```

**Lift for Phase 1:** add `lineItems: OrderLineItem[]` and define the helper type alongside `OrderSource`:

```typescript
// NEW pattern (Phase 1):
export type OrderLineItem = {
  /** Shopify product_id (numeric string). Empty when the line is a custom item. */
  productId: string;
  /** Units sold for this line. */
  units: number;
  /** Proportional CAD share of the order's total
   *  ( = (price × qty / order_subtotal) × current_total_price ). */
  revenueCad: number;
};

export type OrderAttributionRow = {
  // ... existing fields ...
  utmTerm: string;
  /** Per-line-item breakdown from Shopify's `line_items` (added Phase 1).
   *  Empty array on rows from days before the migration — downstream
   *  analyzers must treat `[]` as "no signal", not "zero sales". */
  lineItems: OrderLineItem[];
};
```

#### Pattern 3b — extend the batchGet range (line 128 in analog)

```typescript
// CURRENT (ordersAttribution.ts line 125-128):
// Range extended A:M to include the new utm_id + utm_term columns.
// Older tabs without cols 12-13 return undefined for those positions,
// which the parser coerces to '' so nothing breaks.
const ranges = STORE_TAB_CONFIG.map(s => `${s.id}-orders-attribution!A2:M100000`);
```

**Lift:** change `A2:M100000` to `A2:N100000` and update the comment to mention line items.

#### Pattern 3c — extend the row → object mapping (lines 155-171 in analog)

```typescript
// CURRENT (ordersAttribution.ts line 155-171):
out.push({
  date,
  storeId: store.id,
  storeName: store.name,
  orderId,
  totalCad: parseNumber(row[2]),
  source: parseSource(row[3]),
  utmSource: String(row[4] ?? '').trim(),
  utmMedium: String(row[5] ?? '').trim(),
  utmCampaign: String(row[6] ?? '').trim(),
  utmContent: String(row[7] ?? '').trim(),
  fbclidPresent: row[8] === true || String(row[8] ?? '').toUpperCase() === 'TRUE',
  gclidPresent: row[9] === true || String(row[9] ?? '').toUpperCase() === 'TRUE',
  referringSite: String(row[10] ?? '').trim(),
  utmId: String(row[11] ?? '').trim(),
  utmTerm: String(row[12] ?? '').trim(),
});
```

**Lift:** add `lineItems: parseLineItems(row[13])` plus a helper at the top of the file (mirroring `parseSource` at line 109):

```typescript
// NEW pattern (Phase 1) — parser helper near parseSource:
function parseLineItems(v: unknown): OrderLineItem[] {
  if (v === null || v === undefined || v === '') return [];
  const s = String(v).trim();
  if (!s) return [];
  try {
    const parsed = JSON.parse(s) as Array<{ p?: string; u?: number; r?: number }>;
    if (!Array.isArray(parsed)) return [];
    return parsed.map(li => ({
      productId: String(li.p ?? ''),
      units: typeof li.u === 'number' ? li.u : parseFloat(String(li.u ?? '0')) || 0,
      revenueCad: typeof li.r === 'number' ? li.r : parseFloat(String(li.r ?? '0')) || 0,
    }));
  } catch {
    // Mirror parseSource's "be permissive" stance (line 109 comment): a
    // malformed JSON on one row shouldn't blank-out the whole tab. Return
    // empty array — the row's other fields stay usable.
    return [];
  }
}
```

**Critical:** mirror the **defensive `parseSource` pattern** (line 109-113 in the analog) — never let one bad cell take down the parser. Empty array on any failure mode.

---

### 4. `dashboard-web/src/lib/attributionAnalysis.ts` :: new `analyzeProductChannel`

**Analog:** `attributionAnalysis.ts` :: `analyzeAttributionForAdSet` (lines 524-566) + `analyzeAttributionForAd` (lines 573-615).

**Why this analog:** Phase 1's new analyzer is a *third sibling* alongside the existing `analyzeAttributionForAdSet` / `analyzeAttributionForAd`. Same module, same signature shape (typed params object + orders array + date range → result-or-null), same "return null when input is unusable" guard. Phase 1's analyzer does NOT use `buildAnalysis` because it does NOT compute coverage/trust/Bayesian — those are click-id-only concepts. But the signature + guard shape mirror.

#### Pattern 4a — function signature (line 524-537 in analog)

```typescript
// ANALOG (attributionAnalysis.ts line 524-537):
export function analyzeAttributionForAdSet(
  adSet: {
    adSetId: string;
    adSetName: string;
    storeId: string;
    platform: string;
    metaClaim: number;       // CAD — Meta's conversion_value for this ad-set
    spend: number;
  },
  orders: OrderAttributionRow[],
  dateFrom: string,
  dateTo: string,
  dailyMeta?: Array<{ date: string; value: number }>,
): AttributionAnalysis | null {
  if (adSet.platform !== 'Meta') return null;
  if (!orders || orders.length === 0) return null;
  if (!adSet.adSetId) return null;
  // ...
}
```

**Lift for Phase 1:**

```typescript
// NEW pattern (Phase 1):
export type ProductChannelBreakdown = {
  /** Orders containing any of the mapped products in the period. */
  totalOrders: number;
  /** Sum of those orders' line-item CAD restricted to mapped products. */
  totalRevenue: number;
  /** Per-OrderSource breakdown. Keys are the OrderSource union; values
   *  are zero when no orders fell in that bucket. Operator reads this to
   *  see exact split, not just a binary "Facebook vs not". */
  bySource: Record<OrderSource, { orders: number; revenue: number; units: number }>;
  /** Orders whose source qualifies as "Facebook" by the broad rule:
   *  source ∈ {meta-paid, meta-organic} OR fbclidPresent. */
  facebookOrders: number;
  facebookRevenue: number;
  /** facebookOrders / totalOrders. 0 when totalOrders == 0. */
  facebookShare: number;
};

/**
 * Per-product channel breakdown. For a given set of productIds (the
 * campaign's mapped products), compute which orders contained any of
 * them and group those orders by source. Independent of utm_id matching
 * — uses Shopify's deterministic source classification (fbclid, UTM,
 * referrer) from the orders-attribution tab.
 *
 * Returns null when input is unusable:
 *   - empty productIds (no mapping to analyze)
 *   - empty orders array
 *   - fewer than 3 orders contain any mapped product in the period
 *     (signal too noisy to surface — caller hides the section)
 */
export function analyzeProductChannel(
  productIds: string[],
  orders: OrderAttributionRow[],
  storeId: string,
  dateFrom: string,
  dateTo: string,
): ProductChannelBreakdown | null {
  if (!productIds || productIds.length === 0) return null;
  if (!orders || orders.length === 0) return null;

  const wanted = new Set(productIds);
  // ... filter orders, aggregate per source ...
}
```

#### Pattern 4b — date + store filter pattern (line 542-546 in analog)

```typescript
// ANALOG (attributionAnalysis.ts line 542-546):
const matchedOrders = orders.filter(o => {
  if (o.date < dateFrom || o.date > dateTo) return false;
  if (o.storeId !== adSet.storeId) return false;
  return o.utmTerm && o.utmTerm.trim() === adSet.adSetId.trim();
});
```

**Lift:** mirror the date+store filter, then check `lineItems` intersection with `wanted`:

```typescript
// NEW pattern (Phase 1):
const matchedOrders = orders.filter(o => {
  if (o.date < dateFrom || o.date > dateTo) return false;
  if (o.storeId !== storeId) return false;
  return (o.lineItems || []).some(li => wanted.has(li.productId));
});

if (matchedOrders.length < 3) return null; // signal too noisy below 3
```

#### Pattern 4c — "Facebook" classification (per CONTEXT.md decisions section)

The "Facebook" rule is the same broad rule documented in CONTEXT.md:

```typescript
// NEW pattern (Phase 1) — Facebook predicate:
function isFacebook(o: OrderAttributionRow): boolean {
  return o.source === 'meta-paid'
      || o.source === 'meta-organic'
      || o.fbclidPresent;
}
```

This is intentionally **broader** than `ordersForPlatform` (line 145 in analog) which uses `o.fbclidPresent || o.source === 'meta-paid'` for platform-level paid-attribution. The Phase-1 signal explicitly counts organic Facebook too (operator wants to know "did they come from a Facebook surface at all").

#### Pattern 4d — return shape: NO buildAnalysis call

Unlike the ad-set/ad analyzers, **do NOT call `buildAnalysis`**. `buildAnalysis` (line 622) computes coverage/trust/Bayesian against `metaClaim` — those concepts don't apply here. The Phase-1 analyzer is purely a *grouping* of orders by source. The return is the `ProductChannelBreakdown` shape defined in 4a.

**Crucially:** the analyzer is *additive* — `analyzeAttribution` / `analyzeAttributionForAdSet` / `analyzeAttributionForAd` are unchanged. Per CONTEXT.md: "Adding `analyzeProductChannel` keeps the surface area together and reuses imports."

---

### 5. `dashboard-web/src/components/CampaignDrawer.tsx` :: new section between AttributionAnalysisPanel and ad-sets table

**Analog A (placement):** `CampaignDrawer.tsx` :: the inline-IIFE attribution panel at lines 650-794 (`<section>` rendering `analysis = analyzeAttribution(...)` output).

**Analog B (memoization):** `CampaignDrawer.tsx` :: `attributionByAdSet = useMemo(...)` at lines 288-314.

**Analog C (recommendation chip):** `CampaignDrawer.tsx` :: the recommendation callout at lines 767-772 (`<strong>💡 המלצה:</strong> {analysis.recommendation}`).

#### Pattern 5a — memoize the analyzer call (lines 288-314 in analog B)

```typescript
// ANALOG B (CampaignDrawer.tsx line 288-314) — the IN5-01 memoization:
const attributionByAdSet = useMemo(() => {
  const out = new Map<string, ReturnType<typeof analyzeAttributionForAdSet>>();
  if (!summary || summary.platform !== 'Meta') return out;
  const ordersRows = ordersAttrData?.rows ?? [];
  if (ordersRows.length === 0 || rows.length === 0) return out;
  const first = rows[0];
  const dateFrom = rows.reduce((min, r) => (r.date < min ? r.date : min), first.date);
  const dateTo = rows.reduce((max, r) => (r.date > max ? r.date : max), first.date);
  for (const a of summary.adSets) {
    const key = a.id || a.name || '(אחר)';
    out.set(key, analyzeAttributionForAdSet(
      { adSetId: a.id, adSetName: a.name, storeId: a.storeId, platform: a.platform,
        metaClaim: a.value, spend: a.spend },
      ordersRows,
      dateFrom,
      dateTo,
      dailyMetaByAdSet.get(key) ?? [],
    ));
  }
  return out;
}, [summary, ordersAttrData, rows, dailyMetaByAdSet]);
```

**Lift for Phase 1:** the new analyzer is per-campaign (not per-ad-set), so it's a single value, NOT a Map. Place this useMemo immediately after `attributionByAdSet` (line 314) so the deps `summary`, `ordersAttrData`, `rows`, `productMap`, `campaignId` are already declared above:

```typescript
// NEW pattern (Phase 1) — place after attributionByAdSet at line 314:
const productChannelBreakdown = useMemo(() => {
  if (!summary || summary.platform !== 'Meta') return null;
  const storeIdForCampaign = rows[0]?.storeId ?? '';
  if (!storeIdForCampaign) return null;
  const mappedIds = productMap[campaignKey(storeIdForCampaign, campaignId)] ?? [];
  if (mappedIds.length === 0) return null;
  const ordersRows = ordersAttrData?.rows ?? [];
  if (ordersRows.length === 0 || rows.length === 0) return null;
  const first = rows[0];
  const dateFrom = rows.reduce((min, r) => (r.date < min ? r.date : min), first.date);
  const dateTo = rows.reduce((max, r) => (r.date > max ? r.date : max), first.date);
  return analyzeProductChannel(mappedIds, ordersRows, storeIdForCampaign, dateFrom, dateTo);
}, [summary, ordersAttrData, rows, productMap, campaignId]);
```

**Critical deps list match:** include `productMap` and `campaignId` (analog uses neither, but Phase 1 reads both inside the memo). Forgetting `productMap` means the section won't refresh when the user picks new mapped products in the ProductPickerModal.

#### Pattern 5b — section placement + structure (lines 650-794 in analog A)

```typescript
// ANALOG A (CampaignDrawer.tsx line 650-794) — the existing attribution panel:
{(() => {
  const storeIdForCampaign = rows[0]?.storeId ?? '';
  // ... compute analysis ...
  if (!analysis) return null;

  const trustBg = analysis.trust.level === 'high' ? 'bg-roas-greenBg/50 ...' : ...;

  return (
    <section>
      <h3 className="text-sm font-semibold text-text-primary inline-flex items-center gap-1.5 mb-2">
        <TrendingUp size={14} className="text-text-secondary" />
        ניתוח attribution
      </h3>
      <div className={cn('rounded-xl border p-3 space-y-3', trustBg)}>
        {/* ... trust score header ... */}
        {/* ... breakdown bar ... */}
        {/* ... reasons list ... */}
        {/* ... recommendation callout ... */}
      </div>
    </section>
  );
})()}
```

**Lift for Phase 1:** Phase 1's section sits **between** the attribution panel (line 794) and the reconciliation panel (line 802). Use the memoized value (no IIFE-internal call). Structure mirrors:

```typescript
// NEW pattern (Phase 1) — insert at line 795 (between </section> of attribution panel and the reconciliation comment):
{productChannelBreakdown && (
  <section>
    <h3 className="text-sm font-semibold text-text-primary inline-flex items-center gap-1.5 mb-2">
      <Package size={14} className="text-text-secondary" />
      מכירות לפי ערוץ של המוצרים המשויכים
    </h3>
    <div className="rounded-xl border border-borderSubtle bg-surfaceMuted/30 p-3 space-y-3">
      {/* Summary line — mirrors the "N הזמנות תויגו" reasons-list line at analog line 322 */}
      <div className="text-[12px] text-text-secondary tabular-nums">
        {productChannelBreakdown.totalOrders} הזמנות של מוצרים משויכים · CAD {productChannelBreakdown.totalRevenue.toFixed(0)} סה"כ
      </div>

      {/* Per-source bar — mirrors the breakdown bar at analog line 736-753 */}
      {/* ... see Pattern 5d below ... */}

      {/* Recommendation chip — mirrors analog lines 767-772 */}
      {/* ... see Pattern 5c below ... */}
    </div>
  </section>
)}
```

**Placement note:** put it **after** the attribution panel `})()` closing (line 794) and **before** `{reconciliation && (` (line 802). The order in the rendered drawer becomes: KPI row → daily chart → mapped products section → attribution panel → **NEW Phase-1 section** → reconciliation → ad-sets table.

#### Pattern 5c — recommendation chip (lines 767-772 in analog C)

```typescript
// ANALOG C (CampaignDrawer.tsx line 767-772):
{analysis.recommendation && (
  <div className="rounded-md bg-white/40 border border-current/20 px-2.5 py-2 text-[11px] leading-relaxed">
    <strong>💡 המלצה:</strong> {analysis.recommendation}
  </div>
)}
```

**Lift for Phase 1:** two variants of the chip per CONTEXT.md (`facebookShare ≥ 60%` and `facebookShare < 30%`). The colour tone mirrors the existing trust-level palette:

```typescript
// NEW pattern (Phase 1) — recommendation chip variants:
{productChannelBreakdown.facebookShare >= 0.6 && (
  <div className="rounded-md bg-roas-greenBg/50 border border-roas-green/30 text-roas-green px-2.5 py-2 text-[11px] leading-relaxed">
    <strong>💡 </strong>
    {Math.round(productChannelBreakdown.facebookShare * 100)}% מהמכירות הגיעו מפייסבוק
    {' → '}
    ביטחון להעלאת תקציב הקמפיין
  </div>
)}
{productChannelBreakdown.facebookShare < 0.3 && productChannelBreakdown.totalOrders >= 5 && (
  <div className="rounded-md bg-amber-50 border border-amber-300 text-amber-800 px-2.5 py-2 text-[11px] leading-relaxed">
    <strong>⚠️ </strong>
    רק {Math.round(productChannelBreakdown.facebookShare * 100)}% מהמכירות הגיעו מפייסבוק
    {' → '}
    ייתכן שהקמפיין לא הוא המניע — בדוק לפני העלאת תקציב
  </div>
)}
```

**Tone-tree mirror:** green = `bg-roas-greenBg/50 border-roas-green/30 text-roas-green` (analog line 679), amber = `bg-amber-50 border-amber-300 text-amber-800` (analog line 680). Lifting these exact strings keeps the visual language consistent with the existing trust panel.

#### Pattern 5d — per-source breakdown bar (lines 736-753 in analog A)

```typescript
// ANALOG A (CampaignDrawer.tsx line 736-753) — the deterministic-vs-modeled bar:
{summary.value > 0 && (
  <div className="space-y-1">
    <div className="flex justify-between text-[11px]">
      <span className="opacity-80">click-id מתויג: {analysis.deterministicOrders} הזמנות (CAD {analysis.deterministicRevenue.toFixed(0)})</span>
      <span className="opacity-80">modeled: CAD {analysis.modeledRevenue.toFixed(0)}</span>
    </div>
    <div className="h-2.5 rounded-full bg-white/40 overflow-hidden flex">
      <div
        className="h-full bg-current opacity-70"
        style={{ width: `${Math.min(100, (analysis.deterministicRevenue / summary.value) * 100)}%` }}
      />
      <div
        className="h-full bg-current opacity-25"
        style={{ width: `${Math.min(100, (analysis.modeledRevenue / summary.value) * 100)}%` }}
      />
    </div>
  </div>
)}
```

**Lift for Phase 1:** a 4-segment bar — Facebook / Google / Direct / Other. Same outer wrapper (`h-2.5 rounded-full bg-white/40 overflow-hidden flex`), four inner segments with widths from `bySource` percentages, distinct colour classes:

```typescript
// NEW pattern (Phase 1) — 4-segment source bar:
{productChannelBreakdown.totalOrders > 0 && (() => {
  const total = productChannelBreakdown.totalOrders;
  const fb = productChannelBreakdown.facebookOrders;
  const google = (productChannelBreakdown.bySource['google-paid']?.orders ?? 0)
              + (productChannelBreakdown.bySource['google-organic']?.orders ?? 0);
  const direct = productChannelBreakdown.bySource['direct']?.orders ?? 0;
  const other = total - fb - google - direct;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[11px] text-text-secondary">
        <span>פייסבוק: {fb} · גוגל: {google} · ישיר: {direct} · אחר: {other}</span>
      </div>
      <div className="h-2.5 rounded-full bg-surfaceMuted overflow-hidden flex">
        <div className="h-full bg-roas-blue"   style={{ width: `${(fb / total) * 100}%` }} />
        <div className="h-full bg-amber-500"   style={{ width: `${(google / total) * 100}%` }} />
        <div className="h-full bg-text-muted"  style={{ width: `${(direct / total) * 100}%` }} />
        <div className="h-full bg-text-subtle" style={{ width: `${(other / total) * 100}%` }} />
      </div>
    </div>
  );
})()}
```

#### Pattern 5e — gating predicate (per CONTEXT.md decisions)

The section only renders when:
- Platform is Meta — `summary.platform === 'Meta'` (already guarded inside the memo)
- Campaign has mapped products — `mappedIds.length > 0` (already guarded inside the memo)
- ≥3 orders contain mapped products — `matchedOrders.length >= 3` (guarded in the analyzer, line "if (matchedOrders.length < 3) return null;")

All three gates funnel into `productChannelBreakdown === null` → the entire `<section>` is wrapped in `{productChannelBreakdown && (...)}`. **Mirror of line 802** (`{reconciliation && (...)}` in analog A): one truthy check, whole section toggles.

---

## Shared Patterns

### Idempotent sheet migration (used twice — once in Apps Script, once in dashboard parser)

**Source:** `SheetBuilder.gs` lines 1502-1521 + `ordersAttribution.ts` lines 125-171
**Apply to:** Apps Script col-N migration + dashboard col-N parser

**Pattern:**
1. Apps Script: header writer uses `lastCol < N` check (never `=== N`); the writer always normalises headers before write.
2. Dashboard: row parser uses `String(row[N] ?? '').trim()` (or in our case the `parseLineItems` helper) so an undefined cell from an unmigrated row coerces to `[]` cleanly.
3. **No coordination required** between the two sides — they're independently idempotent. A backfilled tab populates col N; an unmigrated tab leaves it blank; the dashboard treats blank as `[]`.

Echo of `parseSource` comment at `ordersAttribution.ts` line 105-113: be permissive on the parser side so a single bad row doesn't blank the tab.

### Memoization for per-row analyzer walks (IN5-01)

**Source:** `CampaignDrawer.tsx` lines 288-314 (`attributionByAdSet`)
**Apply to:** the new `productChannelBreakdown` useMemo (Pattern 5a)

**Pattern:** the analyzer walks the entire orders array (Phase 1 walks once across `lineItems[]` per order). Inside a render, this is `O(orders × lineItems)` per render. Wrapping in `useMemo` with deps `[summary, ordersAttrData, rows, productMap, campaignId]` caps it at one walk per data change. The IN5-01 commit fixed this for the ad-set analyzer; we apply the same fix preemptively to the new analyzer.

### Null-on-unusable analyzer guard

**Source:** `attributionAnalysis.ts` lines 538-540 (`analyzeAttributionForAdSet`) + line 167 docstring of `analyzeAttribution`
**Apply to:** `analyzeProductChannel` (Pattern 4b)

**Pattern:** every public analyzer returns `Result | null`. The caller checks `if (!result) return null;` (drawer) or `if (!analysis) return null;` (existing attribution panel at line 676) and renders nothing. Never throw. Never return a "zero" object that the UI has to special-case — `null` is the signal.

---

## No Analog Found

None — every Phase-1 surface has a direct, recent analog in the same file or module.

---

## Metadata

**Analog search scope:** `Shopify.gs`, `SheetBuilder.gs`, `dashboard-web/src/lib/ordersAttribution.ts`, `dashboard-web/src/lib/attributionAnalysis.ts`, `dashboard-web/src/components/CampaignDrawer.tsx`
**Files scanned:** 5 (all canonical refs from CONTEXT.md fully read in this pass)
**Pattern extraction date:** 2026-05-18
