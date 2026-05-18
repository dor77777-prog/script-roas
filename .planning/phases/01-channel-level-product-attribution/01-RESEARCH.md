---
phase: 01
phase_name: Channel-Level Product Attribution
researched: 2026-05-18
status: complete
---

# Phase 1: Channel-Level Product Attribution — Research

**Researched:** 2026-05-18
**Domain:** Shopify line-items capture + per-channel attribution aggregation in a Google-Sheets-backed Next.js dashboard
**Confidence:** HIGH (codebase is self-evident — all decisions traceable to existing functions; the only external API surface, Shopify Orders REST, is already used in the codebase for `getShopifyProductSalesForDay`)

## Summary

המחקר הזה ממפה את 10 שאלות ה-research מ-CONTEXT.md לתשובות מעוגנות בקוד הקיים, בלי לפתוח מחדש החלטות שננעלו ב-discuss. המבנה כולו — line_items JSON בעמודה N, יחס Facebook גנרי, אנליזה ב-`attributionAnalysis.ts`, memoization ב-CampaignDrawer — נשען על תבניות שכבר קיימות מ-Round 5. אין שום אזור שבו צריך להמציא משהו חדש.

ה-Shopify Orders REST API ב-v2024-10 מחזיר `line_items` כמערך אובייקטים שכבר נצרך במערכת ב-`getShopifyProductSalesForDay` (Shopify.gs:142+). השדות הקריטיים — `product_id`, `quantity`, `price`, `total_discount` — מוגדרים בתיעוד אבל `product_id` יכול להיות `null` ולכן צריך null-safety בקוד הסידור. המחיר הוא string מעוצב כמטבע — הקוד הקיים כבר משתמש ב-`parseFloat(li.price || 0)` שמטפל בזה.

לגבי המרה ל-CAD: כל שלוש החנויות (uzoshop, Zol Plus, 360usmile) מוגדרות בחנות Shopify עם CAD כמטבע הראשי — Shopify.gs:472 מתעד את זה במפורש (`Shopify returns prices in the shop's currency (CAD here)`). זה אומר שאין שום המרת FX לבצע ב-line items — הם כבר ב-CAD ברגע שהם יוצאים מה-API. הגישה הפרופורציונלית מ-CONTEXT היא בכל זאת הבחירה הנכונה כדי לשמור על קונסיסטנטיות עם `order.totalCad` (שמבוסס על `current_total_price` אחרי הנחות/החזרים).

**Primary recommendation:** התקדם כפי שתוכנן ב-CONTEXT.md. אין shocks. ראיתי 3 דקויות שדורשות תשומת לב בתכנון: (1) `product_id` יכול להיות `null` עבור custom items, צריך לסנן אותם; (2) המרת הגישה הפרופורציונלית צריכה fallback ל-flat `qty × price` אם sum_of_subtotal == 0 (הזמנה של 100% הנחה); (3) חישוב `facebookShare` חייב להגן מפני חלוקה ב-0 כשאין הזמנות בכלל.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Data shape — line items in orders-attribution:**
- Append a new column `N` ("Line Items (JSON)") to `{store}-orders-attribution` tabs
- Value is a JSON string `[{"p":"<productId>","u":<units>,"r":<revenueCad>}]`
- Compact key names (`p/u/r`) to stay within Sheets cell limits
- Per-line-item CAD computed proportionally — `(price × quantity / sum_of_all_lineitems_subtotal) × order.totalCad`
- Source: pull from Shopify Orders API by adding `line_items` to the existing `fields` query in `getShopifyOrdersAttribution`
- Migration: reuse the idempotent pattern from Round 5's L+M column addition. When `ensureOrdersAttributionTab_` sees a tab with `lastCol < 14`, add the N header. Existing rows keep their values; new writes populate N for new rows

**Match criteria — what counts as "Facebook":**
- **"Facebook" (broad)** = `source === 'meta-paid' OR source === 'meta-organic' OR fbclidPresent === true`
- The broader-than-`meta-paid` definition is intentional: even an organic Facebook share that converts is still Facebook-driven traffic
- The breakdown also surfaces `bySource` so the operator can see the exact split per OrderSource value, not just a binary "Facebook vs not"

**Analyzer placement:**
- New entry point in `lib/attributionAnalysis.ts` (NOT a separate file)
- The analyzer takes `productIds: string[]`, the orders array, store ID, and date range — does NOT take a campaign ID

**UI placement — CampaignDrawer:**
- New section sits between the existing `AttributionAnalysisPanel` and the ad-sets table
- Heading: "מכירות לפי ערוץ של המוצרים המשויכים"
- Summary line: "N הזמנות של מוצרים משויכים · CAD X סה"כ"
- Per-source breakdown bar (visual): Facebook / Google / Direct / Other with percentages
- Recommendation chip when `facebookShare ≥ 60%`: "💡 X% מהמכירות הגיעו מפייסבוק → ביטחון להעלאת תקציב הקמפיין"
- Recommendation chip when `facebookShare < 30%`: "⚠️ רק X% מהמכירות הגיעו מפייסבוק → ייתכן שהקמפיין לא הוא המניע — בדוק לפני העלאת תקציב"
- Section only renders when: Platform is Meta, the campaign has mapped products, ≥3 orders contain mapped products in the period

**Coexistence with existing trust chip:**
- The existing trust chip in `CampaignsTable.tsx` continues to use `analyzeAttribution`. **Unchanged.**
- New section adds a third signal — channel-level — visible only when drawer is open

### Claude's Discretion

- Exact ordering of `bySource` keys for visual breakdown bar (e.g., Facebook first, then Google, then Direct, then Other)
- Tooltip text wording on the new section
- Whether `lineItems` field in `OrderAttributionRow` defaults to `[]` or `null` when col N is missing (research recommends `[]` for easier consumer code)
- The exact memoization key shape for `analyzeProductChannel` result inside CampaignDrawer
- Whether to skip orders with 0 line items in the analyzer or count them as "no mapped products" (research recommends: skip — they cannot match any productId)

### Deferred Ideas (OUT OF SCOPE)

- Replacing the existing click-id trust chip — both signals coexist
- New attribution data sources (no Shopify Conversion API, no Meta CAPI deep-link, no GA4 ingestion)
- Per-order line items shown in the UI directly (aggregate to campaign-level only)
- Channel-level attribution at ad-set / ad level (campaign level only)
- Historical data fix-up beyond what `backfillRange` already supports
- Migrating historical orders pre-May 2026 to populate line items
- Surfacing line items per order in any UI table
- Adding line items to `products-daily`
- Cross-store breakdown
- Time-series breakdown (period totals only)

</user_constraints>

<phase_requirements>
## Phase Requirements

מ-ROADMAP.md Phase 1 Success Criteria — כל הקריטריונים האלה תופסים את ההיקף של ה-phase:

| ID | Description | Research Support |
|----|-------------|------------------|
| REQ-01 | `{store}-orders-attribution` תאב תכיל עמודה `Line Items (JSON)` עם `[{p, u, r}]` per row, populated by `runDailyUpdate` for new days and backfilled for May 2026 range via `backfillRange` | §1 — Shopify line_items shape; §2 — proportional CAD computation; §3 — JSON encoding fits cell limit; §4 — idempotent migration pattern; §5 — writeOrdersAttributionForDay fits naturally with 14th column |
| REQ-02 | Idempotent migration: existing rows in the tab get the new column populated when re-written by backfill; tabs from earlier days that haven't been backfilled simply have empty cells without breaking the dashboard parser | §4 — pattern matches L+M Round 5 precedent exactly; §6 — single parser hardcode at ordersAttribution.ts:128 is the only place to update |
| REQ-03 | Dashboard parses line items from the orders-attribution rows and exposes them on `OrderAttributionRow` | §6 — extend OrderAttributionRow type with `lineItems: OrderLineItem[]`, parse row[13] as JSON with try/catch fallback to [] |
| REQ-04 | A new analyzer (`analyzeProductChannel`) returns per-source breakdown for any set of `productIds` | §7 — memoization deps + signature; §8 — Facebook match criteria edge cases validated |
| REQ-05 | `CampaignDrawer` surfaces a "מכירות לפי ערוץ של המוצרים המשויכים" section | §7 — memoization pattern; §9 — UI threshold validation (60/30 vs industry norms) |
| REQ-06 | The new signal coexists with the existing per-campaign trust chip | Verified: §0 inspection of CampaignsTable.tsx:1290-1369 — chip rendering is self-contained and won't touch CampaignDrawer's new section |
| REQ-07 | Dashboard build (`npm run build`) passes cleanly with no new TypeScript errors or lint warnings | §10 — verification plan |
| REQ-08 | No regressions in existing attribution chip flow | §10 — verification plan + §6 confirms no shared mutations |

</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Pull line_items from Shopify | Apps Script (collection) | — | Same tier that already pulls everything else for daily/backfill flow |
| Serialize line_items as JSON to Sheets | Apps Script (collection) | — | Compact `{p,u,r}` encoding generated where the source data lives |
| Idempotent column-N migration | Apps Script (SheetBuilder.gs) | — | Tab schema lives entirely in Apps Script; dashboard is read-only |
| Parse JSON line items into typed objects | Dashboard data layer (ordersAttribution.ts) | — | Existing parser already lives here; same try/catch fallback pattern (parseSource) |
| `analyzeProductChannel(productIds, orders, ...)` pure function | Dashboard analyzer (attributionAnalysis.ts) | — | Co-location target per CONTEXT — keeps surface area together with `analyzeAttribution{,ForAdSet,ForAd}` |
| Render breakdown bar + recommendation chips | Dashboard UI (CampaignDrawer.tsx) | — | New section between AttributionAnalysisPanel and ad-sets table |
| Memoize per-render breakdown | Dashboard UI (CampaignDrawer.tsx) | — | Same `useMemo` pattern as `attributionByAdSet` (IN5-01) |
| Cache HTTP responses | API route (`/api/orders-attribution`) | — | No change — existing `s-maxage=300` still appropriate; new col flows through as part of `OrderAttributionRow` |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js | ^15.5.0 | Dashboard framework | Already in use; no version change needed |
| React | ^19.0.0 | UI rendering + useMemo for analyzer memoization | Already in use |
| googleapis | ^144.0.0 | Sheets read via spreadsheets.values.batchGet | Already in use; same call signature as existing `fetchOrdersAttribution` |
| recharts | ^2.15.0 | (Optional) breakdown bar — but plain CSS/Tailwind divs are simpler for a single bar | Already in use, but for this section a CSS bar is more lightweight (see §9) |

### Supporting (none new)
No new libraries are needed. The entire phase is implementable with the existing dependency set.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline JSON in column N | Two separate columns (productIds CSV + units CSV) | Slightly easier to read in Sheets UI; but two columns to keep in sync vs one — JSON is industry standard and `parseSource` shows we already tolerate string-with-fallback patterns. **Decision: stick with JSON per CONTEXT.** |
| Compact `{p,u,r}` keys | Full `{productId, units, revenueCad}` keys | More readable in raw cells; but each verbose key adds ~30 chars/item × 5 items = 150 bytes/row × 1000 rows = wasted 150KB of cell content. **Decision: stick with compact per CONTEXT.** |
| Recharts BarChart for breakdown | CSS-only stacked div | Recharts is overkill for a single stacked bar; current `roasInterval` UI in CampaignDrawer uses pure Tailwind divs (lines 742-752). **Decision: CSS-only.** |

**Installation:** No new dependencies required.

**Version verification:** Skipped — no new packages.

## Architecture Patterns

### System Architecture Diagram

```
┌────────────────────────────────────────────────────────────────────────┐
│ Apps Script (data collection — daily 00:05 + on-demand backfill)       │
│                                                                         │
│   getShopifyOrdersAttribution(storeId, dateStr)                        │
│   │                                                                     │
│   ├──[NEW]── add `line_items` to &fields query                          │
│   │         └─ Shopify Admin REST /admin/api/2024-10/orders.json       │
│   │                                                                     │
│   ├── classifyOrderAttribution_(order) → source + utm flags             │
│   │                                                                     │
│   └──[NEW]── computeLineItemsCad_(order) → [{p, u, r}]                 │
│              proportional: (li.price × li.qty / sumSubtotal) × totalCad │
│                                                                         │
│   ↓ writeOrdersAttributionForDay(ss, storeId, dateStr, rows)            │
│     [NEW] append col N = JSON.stringify(lineItems)                      │
│                                                                         │
│   ↓ ensureOrdersAttributionTab_(ss, storeId)                            │
│     [NEW] if lastCol < 14: add 'Line Items (JSON)' header               │
└────────────────────────────────────────────────────────────────────────┘
                              ↓ writes to
┌────────────────────────────────────────────────────────────────────────┐
│ Google Sheets — {store}-orders-attribution tab                          │
│   cols A-M (existing)  +  col N: [{"p":"123","u":2,"r":15.00}, ...]    │
└────────────────────────────────────────────────────────────────────────┘
                              ↓ batchGet
┌────────────────────────────────────────────────────────────────────────┐
│ /api/orders-attribution (Next.js route, s-maxage=300)                   │
│                                                                         │
│   fetchOrdersAttribution()                                              │
│     range: 'A2:N100000' (was A2:M100000)                                │
│   ↓                                                                     │
│   parse row[13] as JSON with try/catch → OrderLineItem[]                │
│   ↓                                                                     │
│   OrderAttributionRow { ..., lineItems: OrderLineItem[] }               │
└────────────────────────────────────────────────────────────────────────┘
                              ↓ SWR fetch (lazy on drawer open)
┌────────────────────────────────────────────────────────────────────────┐
│ CampaignDrawer (rendered for selected campaign)                         │
│                                                                         │
│   mappedProductIds (from productMap[campaignKey])                       │
│   ordersAttrData.rows                                                   │
│   ↓                                                                     │
│   productChannelBreakdown = useMemo(() => analyzeProductChannel(...))   │
│     deps: [mappedProductIds, ordersAttrData?.rows, dateFrom, dateTo,    │
│            storeId]                                                     │
│   ↓                                                                     │
│   Renders if (platform === 'Meta' && mappedIds.length > 0               │
│              && breakdown.totalOrders >= 3):                            │
│     - Summary line                                                      │
│     - Per-source breakdown bar (Facebook/Google/Direct/Other)           │
│     - Recommendation chip if facebookShare ≥ 60% or < 30%               │
└────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure (no new files)
```
Apps Script side:
  Shopify.gs         — extend getShopifyOrdersAttribution to fetch+compute line_items
  SheetBuilder.gs    — extend ORDERS_ATTRIBUTION_HEADERS + ensureOrdersAttributionTab_ + writeOrdersAttributionForDay

Dashboard side:
  dashboard-web/src/lib/
    ordersAttribution.ts      — extend OrderAttributionRow + add OrderLineItem type + parse row[13]
    attributionAnalysis.ts    — add analyzeProductChannel + ProductChannelBreakdown type
  dashboard-web/src/components/
    CampaignDrawer.tsx        — import analyzer, add useMemo, render section
```

### Pattern 1: Idempotent column addition (canonical pattern from Round 5)
**What:** When `ensureOrdersAttributionTab_` sees an existing tab with `lastCol < N`, append the new column header without disturbing existing data.
**When to use:** Every time we widen the schema. The dashboard parser must tolerate `undefined` for the new column on old rows.
**Example:**
```javascript
// Source: SheetBuilder.gs:1502-1521 (existing pattern for L+M columns)
} else {
  const lastCol = sh.getLastColumn();
  if (lastCol < 14) {
    const cell = sh.getRange(1, 14);
    if (!cell.getValue()) {
      cell.setValue('Line Items (JSON)')
        .setFontWeight('bold')
        .setBackground('#d9d9d9')
        .setHorizontalAlignment('center');
    }
    sh.setColumnWidth(14, 320); // JSON cells can be long
  }
}
```

### Pattern 2: Permissive JSON parsing in the dashboard layer
**What:** Parse with try/catch and fallback to `[]`. Mirrors the `parseSource` pattern (ordersAttribution.ts:109-113) which deliberately accepts unknown values rather than coercing.
**When to use:** Whenever Apps Script writes structured data the dashboard must read.
**Example:**
```typescript
// New pattern, but mirrors parseSource's permissive design
function parseLineItems(v: unknown): OrderLineItem[] {
  if (v == null || v === '') return [];
  const raw = typeof v === 'string' ? v : String(v);
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(it => it && typeof it === 'object')
      .map(it => ({
        productId: String((it as Record<string, unknown>).p ?? ''),
        units: Number((it as Record<string, unknown>).u ?? 0),
        revenueCad: Number((it as Record<string, unknown>).r ?? 0),
      }))
      .filter(li => li.productId && Number.isFinite(li.units) && Number.isFinite(li.revenueCad));
  } catch {
    return [];
  }
}
```

### Pattern 3: useMemo with stable dependency array (IN5-01)
**What:** Memoize the analyzer result against the inputs that actually drive it. CampaignDrawer is one campaign at a time, so the result is a single object (not a Map<key, breakdown>).
**When to use:** Whenever an analyzer walks the full orders array per render — avoids re-walking on every state tick (sort change, optimization toggle, etc.).
**Example:**
```typescript
// Mirrors attributionByAdSet pattern (CampaignDrawer.tsx:288-314)
const productChannel = useMemo(() => {
  if (!summary || summary.platform !== 'Meta') return null;
  const ordersRows = ordersAttrData?.rows ?? [];
  if (ordersRows.length === 0 || rows.length === 0) return null;
  if (mappedIds.length === 0) return null;
  const first = rows[0];
  const dateFrom = rows.reduce((min, r) => (r.date < min ? r.date : min), first.date);
  const dateTo = rows.reduce((max, r) => (r.date > max ? r.date : max), first.date);
  return analyzeProductChannel({
    productIds: mappedIds,
    orders: ordersRows,
    storeId,
    dateFrom,
    dateTo,
  });
}, [summary, ordersAttrData, rows, mappedIds, storeId]);
```

### Anti-Patterns to Avoid
- **Walking the full orders array inside JSX render:** Always memoize. The current CampaignDrawer already has 4+ memoized values (summary, dailyMetaByAdSet, attributionByAdSet, reconciliation) — follow that pattern, don't introduce an unmemoized analyzer.
- **Storing line_items as a stringified array of full Shopify objects:** Hits the 50K char limit on outlier orders, wastes Sheets bandwidth on round-trip. **Use the compact `{p,u,r}` shape per CONTEXT.**
- **Hand-rolling a CSV-of-CSVs format:** "123:2:15.00,456:1:30.00" is harder to parse safely than JSON. JSON.parse already handles escaping, types, and is supported natively in both V8 (Apps Script) and Node.js.
- **Falling back to "any utm_id starting with fb_" as a Facebook signal:** This is fragile — the CONTEXT-defined criteria (`source === 'meta-paid' OR 'meta-organic' OR fbclidPresent === true`) is the source of truth. Don't extend it without re-opening the discuss phase.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Line-item revenue serialization | Custom CSV format | `JSON.stringify([{p,u,r}, ...])` | JSON handles types, escaping, and round-trips through Apps Script V8 / Node natively |
| Parsing the JSON in dashboard | Manual regex | `JSON.parse` with try/catch | Same robustness pattern Round 5's `parseSource` established |
| Date-range filtering | Custom Date objects | String comparison on `o.date >= dateFrom && o.date <= dateTo` | The codebase uses YYYY-MM-DD strings throughout (e.g., `analyzeAttribution`:189-191) — string compare is correct and avoids timezone bugs |
| Facebook classification | New heuristic | Use existing `source` + `fbclidPresent` boolean from `classifyOrderAttribution_` | The Apps Script side already does the URL-parsing + UTM-normalization work; the dashboard just consumes it |
| Currency conversion for line items | Per-item FX call | Proportional split of `order.totalCad` | All 3 stores are CAD already (Shopify.gs:472), so prices are CAD natively — no FX needed for line items; proportional just keeps line-item-sum == order-total. See §2 below. |

**Key insight:** Round 5 already did the hard work — `OrderAttributionRow` has all the source classification we need. Phase 1 is a pure *additive* extension: capture `productId` per order so we can ask "of the orders containing P, what fraction are meta-paid/meta-organic/fbclid?". No new classification logic.

## Common Pitfalls

### Pitfall 1: Treating `line_items` as if `product_id` is always present
**What goes wrong:** Custom-priced line items, deleted products, and some app-injected fulfillment items have `product_id === null`. If you push these into the JSON, the dashboard analyzer will match them as `productId === ''`, which is never in any campaign's mapped products → silently dropped.
**Why it happens:** Shopify REST docs explicitly state product_id "can be `null` if the original product associated with the order is deleted at a later date" — and the existing `getShopifyProductSalesForDay` (Shopify.gs:199-200) already handles this with `key = pid || \`custom:${li.title || 'Unknown'}\`` for the products-daily tab.
**How to avoid:** In the line-items serializer, **skip** items where `product_id` is null/empty. The Phase-1 use case is "did orders containing the *mapped* products come from Facebook?" — if there's no productId, it can't be in any mapping. Don't synthesize a `custom:foo` key like products-daily does, because nobody can map a campaign to a custom item anyway.
**Warning signs:** A test order with a custom "Donation" line item → its row in orders-attribution has `lineItems: []` (or fewer items than the order's actual cart). Confirmed by reading Shopify.gs:199 and matching the pattern.

### Pitfall 2: Proportional CAD breaks when subtotal is 0
**What goes wrong:** An order with 100% discount (free shipping promo, comped order, store credit redemption) has `sum(price × qty) > 0` but `order.totalCad === 0`. The proportional formula `(price × qty / subtotal) × totalCad` gives 0 for every line item — that's the right answer. **But** if `sum(price × qty)` is also 0 (e.g., gift order at $0 each), the formula divides by zero → `NaN`.
**Why it happens:** Real-world orders include $0-priced products (free gifts, store credit). Shopify's `price` field returns "0.00" for these.
**How to avoid:** Guard the proportional formula:
```javascript
const subtotal = items.reduce((s, li) => s + parseFloat(li.price || 0) * parseInt(li.quantity || 0, 10), 0);
const totalCad = parseFloat(o.current_total_price || 0);
for (const li of items) {
  const pid = String(li.product_id || '');
  if (!pid) continue; // Pitfall 1
  const qty = parseInt(li.quantity || 0, 10);
  const lineGross = parseFloat(li.price || 0) * qty;
  let lineCad;
  if (subtotal > 0) {
    lineCad = (lineGross / subtotal) * totalCad;
  } else {
    // Degenerate case: all items priced at 0. Spread totalCad equally across
    // line items so the JSON parser doesn't choke on NaN.
    lineCad = totalCad / items.length;
  }
  out.push({ p: pid, u: qty, r: round2_(lineCad) });
}
```
**Warning signs:** A row in orders-attribution where the JSON line items have `"r": null` or the cell displays `NaN` — Sheets serializes `NaN` as `#NUM!` which the dashboard's `JSON.parse` will reject.

### Pitfall 3: facebookShare division by zero
**What goes wrong:** `analyzeProductChannel` returns `facebookShare = facebookOrders / totalOrders`. When `totalOrders === 0` (the campaign has mapped products but none of them appear in any order in the period), the division returns `NaN`. The UI then renders `NaN%`.
**Why it happens:** The CONTEXT-locked behavior is "only render the section when ≥3 orders contain mapped products" — but the analyzer itself must still return a sane value, because (a) the gating logic needs to read `totalOrders` from the result to decide whether to render, and (b) the type-checker can't enforce "don't render when totalOrders<3".
**How to avoid:** Return `{ totalOrders: 0, totalRevenue: 0, facebookOrders: 0, facebookRevenue: 0, facebookShare: 0, bySource: {} }` when there are no matching orders — explicit zero, not NaN. The renderer then checks `if (breakdown.totalOrders < 3) return null;`.
**Warning signs:** Console error "NaN cannot be cast" on first drawer open, or a chip showing "💡 NaN% מהמכירות הגיעו מפייסבוק".

### Pitfall 4: Empty cell in col N for old (pre-migration) rows
**What goes wrong:** A row written before the migration only has 13 columns; `row[13]` is `undefined` in the parser. If you do `JSON.parse(row[13])` it throws `SyntaxError: Unexpected token u in JSON at position 0`.
**Why it happens:** Sheets `batchGet` returns sparse arrays — trailing empty cells are simply absent.
**How to avoid:** The `parseLineItems` helper (Pattern 2 above) checks `v == null || v === ''` and returns `[]` before attempting JSON.parse. Mirrors the `parseSource`/`parseNumber` pattern.
**Warning signs:** The dashboard 500s on old orders-attribution data after the parser change is deployed. Test by opening a campaign drawer for May 1-3 (pre-backfill) and confirming the section just hides (because mapped-products-in-orders=0), not crashes.

### Pitfall 5: Backfill that re-writes column N drops existing rows
**What goes wrong:** `writeOrdersAttributionForDay` uses filter-kept + concat + clear + setValues. If the **new write array has fewer columns than `ORDERS_ATTRIBUTION_HEADERS.length`**, the `setValues` call throws `"The number of columns in the data does not match the number of columns in the range."`
**Why it happens:** Apps Script's `setValues` is strict about rectangular shape.
**How to avoid:** Always write all 14 columns. The new `r.lineItemsJson || ''` value at index 13 ensures the row has the right width even when the line items computation returned `[]`. **Empty array → `'[]'` string (or `''` — both decode to `[]` in the parser, but `'[]'` is more explicit and self-documenting).**
**Warning signs:** A backfill run logs `setValues failed: The number of columns in the data does not match` and the daily run silently fails.

## Code Examples

Verified patterns from official sources and existing codebase:

### Apps Script — extending getShopifyOrdersAttribution to capture line items
```javascript
// Source: pattern from Shopify.gs:142-258 (getShopifyProductSalesForDay) +
//         Shopify.gs:516-583 (getShopifyOrdersAttribution)
function getShopifyOrdersAttribution(storeId, dateStr) {
  // ... existing setup unchanged ...

  let url = `https://${domain}/admin/api/${SHOPIFY_API_VERSION}/orders.json` +
            `?status=any&financial_status=any&limit=250` +
            `&created_at_min=${encodeURIComponent(dayStart)}` +
            `&created_at_max=${encodeURIComponent(dayEnd)}` +
            // ADD `line_items` to the fields query. Shopify accepts a comma-
            // separated allowlist; adding line_items returns the full LineItem
            // sub-object (product_id, variant_id, quantity, price, title, etc).
            `&fields=id,current_total_price,financial_status,test,landing_site,referring_site,note_attributes,source_name,line_items`;

  // ... pagination loop unchanged ...
  for (const o of orders) {
    if (o.test) continue;
    if (o.financial_status === 'voided') continue;
    const classified = classifyOrderAttribution_(o);
    const totalCad = parseFloat(o.current_total_price || 0);
    const lineItems = computeLineItemsCad_(o, totalCad);
    out.push({
      // ... existing fields ...
      totalCad,
      lineItems, // [{p, u, r}, ...]
    });
  }
}

// NEW: per-line-item CAD via proportional split.
// All 3 stores' Shopify shops are CAD-native (Shopify.gs:472 explicit), so
// li.price is already in CAD — no FX call needed. The proportional split is
// purely to allocate order-level adjustments (tax, shipping, discount) back
// down to line items so the lineItems[i].r sums to totalCad.
function computeLineItemsCad_(order, totalCad) {
  const items = order.line_items || [];
  if (items.length === 0) return [];
  const subtotal = items.reduce(
    (s, li) => s + parseFloat(li.price || 0) * parseInt(li.quantity || 0, 10),
    0,
  );
  const out = [];
  for (const li of items) {
    const pid = String(li.product_id || '');
    // Skip custom/no-product items — they can never match a campaign's mapped
    // products, so storing them just wastes Sheets cell space.
    if (!pid) continue;
    const qty = parseInt(li.quantity || 0, 10);
    const lineGross = parseFloat(li.price || 0) * qty;
    let lineCad;
    if (subtotal > 0) {
      lineCad = (lineGross / subtotal) * totalCad;
    } else {
      // Degenerate: 0-priced order (free gift, full discount). Spread totalCad
      // equally to avoid NaN — usually totalCad is also 0 here, in which case
      // every line is 0.00 which is fine.
      lineCad = totalCad / items.length;
    }
    out.push({ p: pid, u: qty, r: round2_(lineCad) });
  }
  return out;
}
```

### Apps Script — extending writeOrdersAttributionForDay
```javascript
// Source: SheetBuilder.gs:1533-1586 (existing pattern)
// Only changes: HEADERS extended, header migration adds col 14, row array adds col 14.

const ORDERS_ATTRIBUTION_HEADERS = [
  'תאריך', 'מזהה הזמנה', 'סכום (CAD)', 'מקור',
  'UTM Source', 'UTM Medium', 'UTM Campaign', 'UTM Content',
  'fbclid', 'gclid', 'Referrer',
  'UTM ID', 'UTM Term',
  'Line Items (JSON)', // NEW col N
];

function ensureOrdersAttributionTab_(ss, storeId) {
  // ... existing creation block, but extend to set col 14 width on new tabs ...
  if (sh.getLastRow() === 0) {
    // ... existing headers + widths ...
    sh.setColumnWidth(14, 320); // wide enough to skim a few items in raw view
  } else {
    const lastCol = sh.getLastColumn();
    if (lastCol < 13) {
      // existing L+M migration (unchanged)
      // ...
    }
    // NEW migration block: col 14
    if (lastCol < 14) {
      const cell = sh.getRange(1, 14);
      if (!cell.getValue()) {
        cell.setValue('Line Items (JSON)')
          .setFontWeight('bold')
          .setBackground('#d9d9d9')
          .setHorizontalAlignment('center');
      }
      sh.setColumnWidth(14, 320);
    }
  }
  // ...
}

function writeOrdersAttributionForDay(ss, storeId, dateStr, rows) {
  // ... existing filter-kept logic unchanged ...

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
    // NEW col N. JSON.stringify on empty array is '[]' (2 chars) — minimal
    // overhead, max self-documentation.
    JSON.stringify(r.lineItems || []),
  ]);

  // ... existing concat / clear / setValues unchanged (the loop covers cols 1..14
  //     because ORDERS_ATTRIBUTION_HEADERS.length is now 14) ...
}
```

### Dashboard — extending ordersAttribution.ts
```typescript
// Source: pattern from ordersAttribution.ts:18-50 (existing types) +
//         ordersAttribution.ts:109-113 (parseSource permissive pattern)

export type OrderLineItem = {
  /** Shopify product ID. Custom items (where Apps Script saw `product_id ===
   *  null`) are excluded at write time, so this is guaranteed non-empty here. */
  productId: string;
  units: number;
  /** Proportional share of the order's totalCad. Sums to ~order.totalCad
   *  across all items in the same order. */
  revenueCad: number;
};

export type OrderAttributionRow = {
  // ... existing fields ...
  /** Captured per-order line items. Empty array for orders written before the
   *  col-N migration was deployed (pre-2026-05-{deploy-date}). Old rows
   *  simply contribute zero "mapped product order" matches. */
  lineItems: OrderLineItem[];
};

function parseLineItems(v: unknown): OrderLineItem[] {
  if (v == null || v === '') return [];
  const raw = typeof v === 'string' ? v : String(v);
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((it): it is Record<string, unknown> => it !== null && typeof it === 'object')
      .map(it => ({
        productId: String(it.p ?? ''),
        units: Number(it.u ?? 0),
        revenueCad: Number(it.r ?? 0),
      }))
      .filter(li =>
        li.productId &&
        Number.isFinite(li.units) &&
        Number.isFinite(li.revenueCad),
      );
  } catch {
    return [];
  }
}

export async function fetchOrdersAttribution(): Promise<OrderAttributionRow[]> {
  // ...
  // Range extended A:N to include the new line-items JSON column.
  const ranges = STORE_TAB_CONFIG.map(s => `${s.id}-orders-attribution!A2:N100000`);
  // ...
  for (const row of values) {
    // ... existing parsing ...
    out.push({
      // ... existing fields ...
      utmTerm: String(row[12] ?? '').trim(),
      lineItems: parseLineItems(row[13]),
    });
  }
}
```

### Dashboard — analyzeProductChannel
```typescript
// Source: pattern from attributionAnalysis.ts:135-148 (ordersForPlatform —
//         the simplest existing analyzer that pre-filters orders by criteria)

export type ProductChannelBreakdown = {
  totalOrders: number;
  totalRevenue: number;
  bySource: Partial<Record<OrderSource, { orders: number; revenue: number; units: number }>>;
  facebookOrders: number;
  facebookRevenue: number;
  /** facebookOrders / totalOrders. 0 when totalOrders === 0 (no division
   *  by zero — renderer must still gate on totalOrders >= 3 per CONTEXT). */
  facebookShare: number;
};

export function analyzeProductChannel(opts: {
  productIds: string[];
  orders: OrderAttributionRow[];
  storeId: string;
  dateFrom: string;
  dateTo: string;
}): ProductChannelBreakdown {
  const { productIds, orders, storeId, dateFrom, dateTo } = opts;
  const empty: ProductChannelBreakdown = {
    totalOrders: 0, totalRevenue: 0, bySource: {},
    facebookOrders: 0, facebookRevenue: 0, facebookShare: 0,
  };
  if (productIds.length === 0) return empty;
  if (orders.length === 0) return empty;

  const wantedIds = new Set(productIds);
  // For each order in scope, decide whether any of its line items hit a
  // mapped product, and if so, count the order ONCE (not per-item). Revenue
  // is the SUM of mapped lineItem.revenueCad in that order — so an order with
  // two mapped products gets both their proportional shares counted.
  let totalOrders = 0;
  let totalRevenue = 0;
  let facebookOrders = 0;
  let facebookRevenue = 0;
  const bySource: ProductChannelBreakdown['bySource'] = {};

  for (const o of orders) {
    if (o.storeId !== storeId) continue;
    if (o.date < dateFrom || o.date > dateTo) continue;
    if (!o.lineItems || o.lineItems.length === 0) continue;

    let orderMappedRevenue = 0;
    let orderMappedUnits = 0;
    let hitMapped = false;
    for (const li of o.lineItems) {
      if (!wantedIds.has(li.productId)) continue;
      hitMapped = true;
      orderMappedRevenue += li.revenueCad;
      orderMappedUnits += li.units;
    }
    if (!hitMapped) continue;

    totalOrders++;
    totalRevenue += orderMappedRevenue;

    // Per-source bucket (use raw source label, including '' for unknown).
    const sourceKey = o.source || 'direct';
    const bucket = bySource[sourceKey] ?? { orders: 0, revenue: 0, units: 0 };
    bucket.orders++;
    bucket.revenue += orderMappedRevenue;
    bucket.units += orderMappedUnits;
    bySource[sourceKey] = bucket;

    // Facebook (broad) per CONTEXT — locked criteria.
    const isFacebook =
      o.source === 'meta-paid' ||
      o.source === 'meta-organic' ||
      o.fbclidPresent === true;
    if (isFacebook) {
      facebookOrders++;
      facebookRevenue += orderMappedRevenue;
    }
  }

  return {
    totalOrders, totalRevenue,
    bySource,
    facebookOrders, facebookRevenue,
    facebookShare: totalOrders > 0 ? facebookOrders / totalOrders : 0,
  };
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Orders-attribution row had 11 cols | 13 cols (added utm_id + utm_term) | Round 5 (May 2026) | Phase 1 extends to 14 cols using the exact same migration pattern |
| Per-order line items only accessible via products-daily aggregate | Per-order line items captured in orders-attribution | Phase 1 (this) | Enables "which channel brought sales of product P" queries that products-daily can't answer (because it's pre-aggregated) |
| Trust chip = single signal (click-id with mapping fallback) | Trust chip + channel-level signal coexist | Phase 1 (this) | Operator triangulates between two independent signals |

**Deprecated/outdated:** None for this phase — pure additive extension.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | All 3 stores' Shopify shops are CAD-native — no FX conversion needed for line_item prices | §2, Code Examples | [VERIFIED: Shopify.gs:472 explicit comment "Shopify returns prices in the shop's currency (CAD here)" + uzoshop is the CAD-explicit store, the other two were set up the same way per SYSTEM_OVERVIEW.md] |
| A2 | `product_id` can be `null` for custom items | §1, Pitfall 1 | [CITED: shopify.dev/docs/api/admin-rest/latest/resources/order — "Can be `null` if the original product associated with the order is deleted at a later date"] + [VERIFIED: Shopify.gs:199-200 already handles this case for products-daily, proving it occurs in production] |
| A3 | Sheets cell character limit is 50,000 | §3 | [CITED: support.google.com/docs threads + ablebits.com] — independently verified across multiple sources |
| A4 | A typical multi-item order is under 5 line items, so a 50KB cell limit is never hit for realistic orders | §3 | [ASSUMED] — based on small DTC store norms; if a B2B order ever has 200+ items it could approach the limit at ~6KB. Mitigated by Pitfall 5 (write-time validation could truncate or skip). Recommend logging a warning in Apps Script if the JSON for a single order exceeds 40,000 chars. |
| A5 | The 60/30 thresholds are reasonable | §9 | [ASSUMED] — no industry benchmark I can cite definitively. Suggested validation: see §9 below; recommend keeping CONTEXT's 60/30 and revisiting after operator feedback on Phase 1 |
| A6 | `npm run build` is the only verification gate (no test suite) | §10 | [VERIFIED: dashboard-web/package.json:scripts shows only `dev`, `build`, `start`, `lint` — no `test` script] |
| A7 | Sheets `batchGet` returns sparse arrays where trailing empty cells are simply absent (not `undefined`/`null`) | §6, Pitfall 4 | [VERIFIED: ordersAttribution.ts:166-170 already uses `row[11] ?? ''` and `row[12] ?? ''` defensively, proving the pattern is needed AND works in the existing code] |
| A8 | An order's totalCad equals sum of its line_items.revenueCad after proportional split (within rounding) | §2 | [VERIFIED: That's the mathematical guarantee of `(price × qty / subtotal) × total` when applied to each item — sum across all items = total × (subtotal/subtotal) = total. Rounding to 2dp introduces ≤ N×0.005 CAD drift, acceptable.] |
| A9 | Recharts is overkill for a single stacked bar; CSS divs are simpler | §Standard Stack Alternatives | [VERIFIED: CampaignDrawer.tsx:742-752 already uses Tailwind div-with-width-percent for the click-id vs modeled breakdown bar — same pattern works for source breakdown] |

## Open Questions

1. **Should `bySource['']` (unknown source) be lumped into "Other" or shown separately in the breakdown bar?**
   - What we know: `parseSource` returns `''` for unknown values (ordersAttribution.ts:111). Some real orders will have empty source if Apps Script writes blank, OR an order was written before the Round 5 source classification was deployed.
   - What's unclear: Operator preference — is "unknown" useful to surface, or noise?
   - Recommendation: Lump `''` into the "Other" bucket in the breakdown bar UI. Keep it visible in the raw `bySource` map so the operator can drill in via hovertip if needed.

2. **Should the section render when ≥3 orders but 0 mapped-product orders are Facebook?**
   - What we know: CONTEXT says render when ≥3 orders. CONTEXT also says "💡 chip when ≥60%" and "⚠️ chip when <30%". An all-direct campaign would show 0% Facebook → falls under "<30%" → warning chip.
   - What's unclear: Is that the desired UX? The operator opens a Meta campaign drawer and sees "⚠️ רק 0% מהמכירות הגיעו מפייסבוק"? Useful information (the campaign isn't doing what they think) but could be alarming for a brand-awareness campaign.
   - Recommendation: Render the warning as-is — operator can act on it (re-examine UTM config, pause campaign, dig into reconciliation panel below). The whole point of the new signal is to surface this case.

3. **Migration order: data layer first, or dashboard parser first?**
   - What we know: The existing parser (ordersAttribution.ts:128) reads `A2:M100000`. Extending to `A2:N100000` is backwards-compatible (col N just returns `undefined` for old rows). Apps Script writing a 14th column to a tab the dashboard reads as 13 is also fine (extra columns are simply not read).
   - What's unclear: Is there a brief window where the build is broken if one side ships before the other?
   - Recommendation: **Dashboard-first deployment is safer.** Ship the dashboard parser update (with `parseLineItems` returning `[]` for missing col) → verify nothing breaks on existing data → then upload the Apps Script changes → then run backfill. Apps Script alone-without-dashboard ships fine too because the dashboard simply won't read col N until its own update lands. Either order works, but dashboard-first means zero risk of crash on production.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Dashboard build | ✓ (assumed — codebase already builds via Vercel + local) | — | — |
| npm | Build/lint | ✓ | — | — |
| Shopify Admin API v2024-10 | line_items fetch | ✓ — already used by `getShopifyProductSalesForDay` | 2024-10 | — |
| Google Sheets API | Read/write | ✓ — already used | googleapis ^144.0.0 | — |
| Apps Script editor (manual upload of .gs files) | Deploying Apps Script changes | ✓ — operator has access | — | — |
| Google Sheets cell capacity (50K chars) | JSON line_items storage | ✓ | — | Warn at 40K chars per cell |

**Missing dependencies with no fallback:** None.

**Missing dependencies with fallback:** None.

## Validation Architecture

> Note: `.planning/config.json` does not exist. Following the "treat as enabled when key absent" convention, this section is included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | None — no test suite in this repo (verified via package.json scripts: `dev`, `build`, `start`, `lint` only) |
| Config file | None |
| Quick run command | `cd dashboard-web && npm run lint` (TypeScript + ESLint) |
| Full suite command | `cd dashboard-web && npm run build` (full Next.js production build incl. TypeScript) |
| Manual verification | Backfill 1 day → open CampaignDrawer for a known-campaign in a known-product mapping → eyeball the breakdown |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| REQ-01 | line_items captured in orders-attribution tab | manual-only | Inspect raw sheet after `runUpdateForDate` or `backfillRange` | n/a |
| REQ-02 | Idempotent migration: old tab → wide; old rows → empty col N | manual-only | Run `ensureOrdersAttributionTab_` on tab with 13 cols, confirm col 14 added; verify rows 2+ unchanged | n/a |
| REQ-03 | Dashboard parses col N | smoke (build + dev preview) | `cd dashboard-web && npm run build` — TypeScript catches type drift on OrderAttributionRow | ❌ Wave 0 — no smoke tests today |
| REQ-04 | `analyzeProductChannel` returns expected breakdown | manual-only (no test framework) | Open dashboard with known mapping → drawer renders chip with expected % | ❌ |
| REQ-05 | CampaignDrawer shows new section | manual-only | Visual check on `localhost:3000` after data lands | ❌ |
| REQ-06 | Coexistence with trust chip | manual-only | Open same campaign in CampaignsTable + drawer → both chips render correctly | ❌ |
| REQ-07 | Build passes | automated | `cd dashboard-web && npm run build && npm run lint` | ✓ (existing scripts) |
| REQ-08 | No regression in existing chip flow | manual-only | Open 3-5 known campaigns pre-deploy and post-deploy, compare trust chip outputs | ❌ |

### Sampling Rate

- **Per task commit:** `cd dashboard-web && npm run lint` (TypeScript via tsc-via-next-lint)
- **Per wave merge:** `cd dashboard-web && npm run build` (full production build — catches type errors that lint misses)
- **Phase gate:** `npm run build` green + manual smoke of CampaignDrawer with at least one campaign that has mapped products and ≥3 orders in the period.

### Wave 0 Gaps

No automated test infrastructure exists. The phase explicitly accepts this — the operator's verification is `npm run build` + manual visual smoke. **Do not add a test framework as part of this phase** — that's a separate scope decision not in CONTEXT.

Gaps to acknowledge for plan-checker visibility:
- [ ] No `dashboard-web/__tests__/` or `dashboard-web/test/` directory exists
- [ ] No `jest.config.*` or `vitest.config.*` exists
- [ ] Apps Script changes have no test harness — verified only via manual `runUpdateForDate('2026-05-{some-day}')` + sheet inspection

*(If we did want to add test scaffolding, Vitest + @testing-library/react would be the standard for a Next.js 15 + React 19 + TypeScript project. But that's deferred per CONTEXT.)*

## Security Domain

> ASVS categories below are evaluated against this phase's specific changes (line_items capture + new analyzer + drawer section).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | This phase has no new auth surface. Apps Script writes use the existing Script Properties token; dashboard reads use the existing service-account |
| V3 Session Management | no | No session state added; dashboard reads are stateless |
| V4 Access Control | no | No new endpoints; `/api/orders-attribution` already has cache + read-only ACL |
| V5 Input Validation | yes | JSON.parse on user-controllable data (column N values written by Apps Script) — see threat patterns below |
| V6 Cryptography | no | No crypto operations in this phase |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed JSON in col N crashes dashboard parser | Denial of Service | `parseLineItems` uses try/catch + returns `[]` (same pattern as `parseSource`). Single-row corruption never crashes the page. |
| Prototype pollution via JSON.parse | Tampering | The `parseLineItems` function explicitly enumerates the fields it reads (`p`, `u`, `r`) and constructs a fresh object — no `Object.assign(o, parsed)` or `__proto__` writes. Safe. |
| Sheet ID disclosure via error | Information Disclosure | Existing `userFacingError()` (lib/sheets.ts) already wraps Sheets errors — Phase 1 changes don't introduce new error paths that bypass it |
| Excessive cell size DoS | Denial of Service | A pathological order with 1000+ line items could approach the 50K cell limit. Mitigated by: (a) skipping product_id-null items at write time (most "fake" items lack product_id), (b) recommended Apps Script warning at 40K chars (Pitfall 5 / A4). Real risk is low — operator's stores don't sell hundreds of items per order. |
| product_id IDOR in line items | Information Disclosure | No — productId is just an opaque Shopify ID, and the dashboard already exposes it via products-daily and the product picker. No new disclosure surface. |

## Detailed Research Findings (Per Question)

### §1. Shopify Orders API line_items shape (HIGH confidence)

The Shopify Admin REST API `orders.json` endpoint at version 2024-10 returns `line_items` as a JSON array. Each item has the following fields relevant to this phase:

| Field | Type | Notes |
|-------|------|-------|
| `id` | integer | Line item ID. Used by `getShopifyProductSalesForDay` to map refunds back. Not needed for Phase 1 capture. |
| `product_id` | integer or `null` | The product. **Can be null** for custom items, deleted products, or app-injected items (per Shopify docs + Shopify.gs:199 handling). |
| `variant_id` | integer | Not needed for Phase 1. |
| `quantity` | integer | Always present and finite. |
| `price` | string (price format) | "X.XX" decimal string. **Already in shop currency (CAD).** Already used by getShopifyProductSalesForDay via `parseFloat(li.price || 0)`. |
| `title` | string | Product title. Not needed for Phase 1 (dashboard already has product titles from products-daily and the catalog). |
| `name` | string | Variant name. Not needed. |
| `total_discount` | string | Line-level discount. Not needed because we use the proportional CAD method against `current_total_price`. |

**The proven existing pattern** (Shopify.gs:142-258 — `getShopifyProductSalesForDay`) uses `&fields=...,line_items,refunds` in the orders endpoint query. Adding `line_items` to the Phase 1 query (Shopify.gs:528) follows that exact same pattern.

**Confidence:** HIGH — the field shape is verified against both official docs (CITED) and the existing in-repo handler (VERIFIED).

### §2. Per-line-item CAD computation strategy (HIGH confidence)

**Recommendation: proportional, per CONTEXT.**

Why proportional vs per-item FX:
- All 3 stores are CAD-native (Shopify.gs:472 + each Shopify shop's settings) — so `li.price` is **already in CAD**. Per-item FX would be a no-op multiplication by 1.
- The order's `totalCad` (from `current_total_price`) already accounts for shipping, tax, discounts, refunds at the order level. Per-item FX would NOT include these adjustments, so line-item sum would diverge from order total.
- The proportional method (`(price × qty / subtotal) × totalCad`) preserves the invariant `Σ lineItems[i].r ≈ order.totalCad` (up to N × 0.005 CAD rounding drift).

Edge case: subtotal == 0. Handled by spreading totalCad equally — see Pitfall 2 + the Code Examples block.

Tradeoff documented (per CONTEXT request): the proportional approach attributes order-level shipping/tax exactly proportional to gross line price. For a real-world DTC store where shipping is flat-fee and a $50 + $500 cart pays the same shipping, this slightly over-allocates shipping cost to the expensive item. The error is bounded by `shipping_cost / order_total`, typically <10%. Acceptable for the use case ("did Facebook orders buy this product?") — we don't need precise per-item profitability here.

**Confidence:** HIGH — the math is provably correct and matches CONTEXT's decision.

### §3. Sheets cell size limit for JSON line items (HIGH confidence)

Confirmed: 50,000 chars per cell. Independently verified across multiple sources (Google Docs help thread, Quora, Bricks, ablebits).

Realistic worst case: a B2B store with 100 line items per order at ~30 chars/item (`{"p":"1234567890123","u":99,"r":1234.56}`) = ~3,000 chars/cell. Even a 1000-item order would only be 30,000 chars, still safely under 50K.

The 3 stores in scope are small DTC shops (uzoshop, Zol Plus, 360usmile) — average order is 1-3 items. No realistic risk of hitting the limit. Per A4 in the Assumptions Log, recommend a warning log at 40K chars as defense-in-depth.

**Confidence:** HIGH — limit is documented; usage projection is grounded in known store sizes.

### §4. Idempotent migration pattern (HIGH confidence)

The Round 5 pattern at SheetBuilder.gs:1502-1521 is the precedent:

```javascript
} else {
  const lastCol = sh.getLastColumn();
  if (lastCol < 13) {
    // add cols 12+13 (utm_id + utm_term)
  }
}
```

Extending this to 14 columns follows the exact same shape:

```javascript
} else {
  const lastCol = sh.getLastColumn();
  if (lastCol < 13) {
    // existing block — unchanged
  }
  if (lastCol < 14) {
    // new: add col 14
    const cell = sh.getRange(1, 14);
    if (!cell.getValue()) {
      cell.setValue('Line Items (JSON)')
        .setFontWeight('bold')
        .setBackground('#d9d9d9')
        .setHorizontalAlignment('center');
    }
    sh.setColumnWidth(14, 320);
  }
}
```

**Note:** The two `if` blocks are **not** mutually exclusive when `lastCol < 13` — both fire, which is fine because each block does its own `getValue()` defensive check before writing.

**Confidence:** HIGH — pattern is in active production use (Round 5 ship).

### §5. `writeOrdersAttributionForDay` idempotent filter fits the new 14-column write (HIGH confidence)

The Round 5 WR5-02 fix (SheetBuilder.gs:1546-1550) preserves rows where the date is unparseable. The fix is **column-agnostic** — it operates on `r[0]` only, which is the date column.

Adding column 14 to the row arrays (Code Examples block above) is a purely mechanical extension. The `ORDERS_ATTRIBUTION_HEADERS.length` constant is the single source of truth for column count (SheetBuilder.gs:1538, 1572, 1582 all reference it) — bumping it from 13 to 14 propagates automatically.

No new logic needed.

**Confidence:** HIGH — verified by inspection of the existing code.

### §6. Dashboard parser range extension (HIGH confidence)

Only one place hardcodes the range:

```
dashboard-web/src/lib/ordersAttribution.ts:128:
  const ranges = STORE_TAB_CONFIG.map(s => `${s.id}-orders-attribution!A2:M100000`);
```

Grep results confirm this is the ONLY hardcode (verified via `grep -rn "orders-attribution!" dashboard-web/src`).

The change is trivial: `A2:M100000` → `A2:N100000`. The parser already uses `row[N]` indexing with `?? ''` fallback (line 169-170 already do this for `utmId`/`utmTerm`), so adding `row[13]` for line items follows the exact same pattern.

No other places in the dashboard hardcode column counts or letters for orders-attribution.

**Confidence:** HIGH — verified via repository-wide grep.

### §7. Memoization pattern for the new analyzer (HIGH confidence)

CampaignDrawer is per-campaign — one drawer instance shows one campaign at a time. So unlike `attributionByAdSet` (which is a Map keyed by ad-set within the drawer's campaign), `analyzeProductChannel` for the drawer's campaign is **a single value**.

Memoization deps, per CONTEXT request: `mappedProductIds`, `ordersAttrData?.rows`, `dateFrom`, `dateTo`, `storeId`.

The complete pattern is in the Code Examples block. Specifically:

```typescript
const productChannel = useMemo(() => {
  if (!summary || summary.platform !== 'Meta') return null;
  const ordersRows = ordersAttrData?.rows ?? [];
  if (ordersRows.length === 0 || rows.length === 0) return null;
  if (mappedIds.length === 0) return null;
  // ... date range from rows ...
  return analyzeProductChannel({ productIds: mappedIds, orders: ordersRows, storeId, dateFrom, dateTo });
}, [summary, ordersAttrData, rows, mappedIds, storeId]);
```

Note: `dateFrom` / `dateTo` are derived from `rows` (per the existing `attributionByAdSet` pattern at CampaignDrawer.tsx:293-295). So `rows` covers them in the deps array; no need to add them separately.

`mappedIds` is `productMap[campaignKey(storeId, campaignId)] ?? []` — already computed inline at line 349. **Caveat:** because `mappedIds` is a fresh array reference every render (`productMap[...] ?? []`), the `useMemo` will currently re-run every render. The fix is one of:
1. Wrap `mappedIds` itself in a `useMemo(() => productMap[...] ?? [], [productMap, storeId, campaignId])` so the array reference is stable across renders.
2. Pass `productMap` + the key into `useMemo` deps and recompute `mappedIds` inside the memo.

Option 1 is cleaner and matches the existing `reconciliation` derivation at line 350. The planner should specify this in the implementation task.

**Confidence:** HIGH — verified against existing patterns (`attributionByAdSet`, `reconciliation`).

### §8. What constitutes "Facebook" for the channel breakdown (HIGH confidence)

CONTEXT-locked criteria (validated):
```
isFacebook = order.source === 'meta-paid'
          || order.source === 'meta-organic'
          || order.fbclidPresent === true
```

Edge case validation per the question:

**(a) `source: 'meta-paid'` AND `fbclidPresent: false`** — manual UTM-tagged email link that mimics Facebook (e.g., the operator put `utm_source=facebook&utm_medium=cpc` in a Klaviyo email):
- Per `classifyOrderAttribution_` (Shopify.gs:660-663), the classifier produces `source = 'meta-paid'` if `utm_medium ∈ {cpc, paid, paidsocial, social}` AND `utm_source ∈ {facebook, fb, meta, instagram, ig}`. So this is essentially "operator manually labeled this as Facebook traffic."
- **Should count as Facebook**: YES. The operator's manual UTM is an intentional act — they're saying "treat this as Facebook." The classifier respects that.

**(b) `source: 'direct'` BUT `fbclidPresent: true`** — Facebook click that lost UTM (e.g., user clicked an organic post that doesn't have URL Parameters configured; fbclid was added by Facebook's automatic redirect, but no utm_*):
- Per Shopify.gs:657-658, the classifier's priority ladder fires `source = 'meta-paid'` when `fbclid` is present, regardless of utm. So this case shouldn't actually occur — if `fbclidPresent === true`, `source` should already be `'meta-paid'` (the classifier would have caught it).
- **But:** older orders (pre-Round-5) might have been written by an earlier classifier that didn't check fbclid in this way. Defensive: the OR-clause `o.fbclidPresent === true` captures these.
- **Should count as Facebook**: YES — fbclid alone is proof.

**(c) `source: 'meta-organic'`** — Instagram share, no click, no fbclid (e.g., user took a screenshot of an IG post and typed in the URL, but `referring_site = instagram.com`):
- Per Shopify.gs:669-670, this fires when `ref` matches facebook/instagram and there's no UTM.
- **Should count as Facebook**: YES — the operator's question is "where did this customer come from?", and meta-organic is still a Facebook surface (the customer was browsing IG when they got the impulse).
- This expands the count beyond strict click attribution, which matches CONTEXT's stated intent ("broader-than-meta-paid definition is intentional").

All three edge cases align with the CONTEXT-locked criteria. **No changes needed to the formula.**

**Confidence:** HIGH — verified by walking the `classifyOrderAttribution_` logic against each case.

### §9. UI threshold recommendations (MEDIUM confidence)

CONTEXT-locked: ≥60% → 💡 raise-budget; <30% → ⚠️ caution; in between → no chip.

Validation against existing thresholds in `analyzeAttribution`:

| Existing analyzer threshold | What it gates |
|----------------------------|---------------|
| coverage ≥ 0.8 (80%) | "high" trust — strong evidence Meta is right |
| coverage ≥ 0.4 (40%) | "medium" trust — sizeable modeled portion |
| coverage < 0.4 (40%) | "low" trust — Meta likely inflating |

Comparison: the existing analyzer is stricter than the new one (80% for "good" vs 60% for "raise budget"). Why the difference makes sense:

- **The trust chip is about Meta-reporting reliability.** 80% coverage means 80% of Meta's claim has a click-id — high bar because the chip is the operator's signal that "Meta's number IS the number."
- **The channel signal is about traffic-source confidence.** 60% Facebook is a different question: "is Facebook the primary driver?" Lower bar is appropriate because the operator already knows the campaign IS on Facebook — they just want corroboration that the orders are also from Facebook.

Industry norms (per attribution-software vendors like Northbeam / TripleWhal — no formal academic threshold here):
- Most marketing-mix analysis treats 50-70% channel share as "strong"
- 30-50% is "contributory but not dominant"
- <30% is "minor channel"

CONTEXT's 60/30 fits comfortably in this range. Some teams use 70/40 for a more conservative chip (only flag the very clear cases), but the cost of false negatives (operator misses an actual budget opportunity) is higher than false positives (operator sees a 60% chip and double-checks before acting).

**Recommendation: keep 60/30 per CONTEXT.** The plan should NOT change these without revisiting the discuss phase.

**Confidence:** MEDIUM — the thresholds are defensible but not absolutely-objective. Industry norms support the range; operator feedback after Phase 1 will calibrate whether 60% is the right number for this specific business.

### §10. Build/test strategy (HIGH confidence)

No formal test suite. Verification is:

**Per task / per commit (fast):**
```bash
cd dashboard-web && npm run lint
```
ESLint via `eslint-config-next` (package.json) — catches TS errors, lint warnings.

**Per wave / per merge (full):**
```bash
cd dashboard-web && npm run build
```
Full Next.js production build — type-checks every file, exercises the full module graph. Catches type drift on `OrderAttributionRow` and incompatibilities between `analyzeProductChannel` and its callers.

**Per phase gate (manual smoke):**
1. Apps Script: in the editor, run `runUpdateForDate('2026-05-{recent-day}')` for one store. Inspect `{store}-orders-attribution` tab — confirm col N populated with valid JSON.
2. Idempotent migration: open an existing tab in another sheet via the same Apps Script project that has only 13 cols. Run the same function. Confirm col 14 header was added and existing rows kept their data.
3. Backfill: run `backfillRange('2026-05-01', '2026-05-{today-1}')`. Confirm all rows in range get col N populated.
4. Dashboard: open the dashboard locally (`npm run dev`), pick a date range covering the backfilled days, open a Meta campaign with mapped products. Confirm:
   - The new section renders between AttributionAnalysisPanel and ad-sets table
   - Summary line shows N orders + total CAD
   - Per-source breakdown bar shows percentages
   - Recommendation chip fires correctly based on facebookShare value
   - For campaigns with <3 mapped-product orders, the section is hidden
   - For Google PMax campaigns, the section is hidden
5. Coexistence: pick the same campaign in CampaignsTable. Confirm the trust chip in the table is unchanged from pre-deploy.
6. No regressions: open 3-5 other known campaigns. Confirm trust chips render the same numbers as before the deploy.

**What `gsd-verifier` should check at phase end:**
- `cd dashboard-web && npm run build` exits 0
- `cd dashboard-web && npm run lint` exits 0
- All files in CONTEXT's "Files expected to change" list have been touched (or explicitly not — e.g., `dashboard-web/src/app/api/orders-attribution/route.ts` per CONTEXT)
- `SYSTEM_OVERVIEW.md` and `dashboard-web/README.md` have been updated per CONTEXT
- A backfill run was attempted by the operator (the verifier can't run Apps Script directly, but should confirm operator log / commit messages reference this)

The verifier should **NOT** run automated tests (none exist), and should **NOT** open the dashboard locally (that's the operator's manual step).

**Confidence:** HIGH — verified by inspection of package.json + project history of "manual smoke" mode of operation.

## Sources

### Primary (HIGH confidence)
- `/Users/dorperetz/script-roas/Shopify.gs` — existing line_items handling at `getShopifyProductSalesForDay` (lines 142-258); existing `getShopifyOrdersAttribution` (lines 516-583); `classifyOrderAttribution_` (lines 603-694); CAD-native comment (line 472)
- `/Users/dorperetz/script-roas/SheetBuilder.gs` — `ORDERS_ATTRIBUTION_HEADERS` + `ensureOrdersAttributionTab_` + `writeOrdersAttributionForDay` (lines 1466-1586); idempotent migration pattern (lines 1502-1521)
- `/Users/dorperetz/script-roas/dashboard-web/src/lib/ordersAttribution.ts` — existing parser pattern; `parseSource` permissive design (lines 109-113); single hardcoded range (line 128)
- `/Users/dorperetz/script-roas/dashboard-web/src/lib/attributionAnalysis.ts` — `analyzeAttribution`, `analyzeAttributionForAdSet`, `buildAnalysis` patterns; co-location target
- `/Users/dorperetz/script-roas/dashboard-web/src/components/CampaignDrawer.tsx` — `attributionByAdSet` useMemo (lines 288-314); `reconciliation` derivation (line 350); section structure (lines 700-957)
- `https://shopify.dev/docs/api/admin-rest/latest/resources/order` — official documentation for line_item fields (product_id nullability confirmed)

### Secondary (MEDIUM confidence)
- `https://support.google.com/docs/thread/226061812/how-can-i-limit-the-characters-in-the-cells-of-a-specific-column?hl=en` — Sheets 50K cell limit (independently verified)
- `https://www.ablebits.com/office-addins-blog/google-sheets-limits/` — comprehensive Sheets limits reference
- `https://www.quora.com/A-cell-can-have-no-more-than-50-000-characters-in-Google-sheets-How-can-I-exceed-the-limit-to-say-100-000-characters-at-least` — cross-verification of cell limit

### Tertiary (LOW confidence)
- Industry attribution-vendor thresholds for "strong channel" (60-70%) — generally accepted but no single authoritative source for the exact 60% threshold; CONTEXT decision retained

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new dependencies; everything verified in package.json
- Architecture: HIGH — extension patterns are direct copies of existing Round 5 patterns
- Pitfalls: HIGH for #1-4 (verified in code); MEDIUM for #5 (defensive but speculative — depends on operator's order shape)
- Validation: HIGH — verification plan is grounded in the actual scripts in package.json
- Security: HIGH — no new auth/crypto/access surface; JSON.parse use is sandboxed by enumerated field reads

**Research date:** 2026-05-18
**Valid until:** 2026-06-15 (~30 days) — line_item field shape is stable in Shopify v2024-10; codebase patterns are unlikely to drift in 30 days. Re-research if Shopify announces v2025-01 deprecation of v2024-10 or if Round 6 lands and changes the `OrderAttributionRow` schema.
