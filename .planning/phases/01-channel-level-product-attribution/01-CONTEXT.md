# Phase 1: Channel-Level Product Attribution — Context

**Gathered:** 2026-05-18
**Status:** Ready for planning
**Source:** User conversation + existing system state (post-Round 5)

<domain>
## Phase Boundary

Surface a new per-product channel-level attribution signal in the dashboard. The operator wants to know: "of the orders that contained product P in this period, what fraction came from Facebook?" — independent of whether those orders had a campaign-specific `utm_id` match.

The signal is intentionally softer than the existing per-campaign click-id matching. Where the click-id signal says "this specific order matches Campaign A via `utm_id`", the new signal says "this order contained mapped products AND came from Facebook (by `fbclidPresent` OR `source` classification)". The operator's stated use case: confidence to raise budget on Campaign X even when `utm_id` data is incomplete, because the orders of X's mapped products are still demonstrably Facebook-driven.

**In scope:**
- Capturing line items per Shopify order (productId, units, revenue_cad) in the existing `{store}-orders-attribution` pipeline
- A new analyzer that computes per-source breakdown for an arbitrary set of `productIds`
- A new section in `CampaignDrawer` that surfaces the breakdown for the campaign's mapped products
- Idempotent migration so existing tabs (rows from prior days without line items) keep working
- Backfill compatibility: the existing `backfillRange` / `runUpdateForDate` paths populate the new column without code changes once Apps Script is updated

**Out of scope:**
- Replacing the existing click-id trust chip — both signals coexist
- New attribution data sources (no Shopify Conversion API, no Meta CAPI deep-link, no GA4 ingestion)
- Per-order line items shown in the UI directly (we aggregate to campaign-level only)
- Channel-level attribution at ad-set / ad level (campaign level only for this phase — ad-set/ad levels remain click-id only)
- Historical data fix-up beyond what `backfillRange` already supports

</domain>

<decisions>
## Implementation Decisions

### Data shape — line items in orders-attribution

- **Storage:** Append a new column `N` ("Line Items (JSON)") to `{store}-orders-attribution` tabs. Value is a JSON string `[{"p":"<productId>","u":<units>,"r":<revenueCad>}]`. Compact key names (`p/u/r`) to stay within Sheets cell limits even for high-line-item orders.
- **CAD computation:** Per-line-item CAD is computed proportionally — `(price × quantity / sum_of_all_lineitems_subtotal) × order.totalCad`. This keeps the line items summing to the order total even when tax/shipping/discounts shift things.
- **Source:** Pull from Shopify Orders API by adding `line_items` to the existing `fields` query in `getShopifyOrdersAttribution`. The endpoint already supports it (`getShopifyProductSalesForDay` uses the same pattern).
- **Migration:** Reuse the idempotent pattern from Round 5's L+M column addition. When `ensureOrdersAttributionTab_` sees a tab with `lastCol < 14`, it adds the N header. Existing rows keep their values; new writes populate N for new rows.

### Match criteria — what counts as "Facebook"

For the channel-level breakdown:
- **"Facebook" (broad)** = `source === 'meta-paid' OR source === 'meta-organic' OR fbclidPresent === true`
- The broader-than-`meta-paid` definition is intentional: even an organic Facebook share that converts is still Facebook-driven traffic. `fbclidPresent` catches any click from a Facebook surface, paid or organic.
- The breakdown also surfaces `bySource` so the operator can see the exact split per OrderSource value, not just a binary "Facebook vs not"

### Analyzer placement

- New entry point in `lib/attributionAnalysis.ts` (NOT a separate file). Phase 0 established the pattern of co-locating attribution functions there. Adding `analyzeProductChannel` keeps the surface area together and reuses imports.
- The analyzer takes `productIds: string[]` (from the campaign's mapped products), the orders array, store ID, and date range. It does NOT take a campaign ID — it's pure per-product, the caller (CampaignDrawer) supplies the mapping.

### UI placement — CampaignDrawer

- New section sits between the existing `AttributionAnalysisPanel` and the ad-sets table.
- Heading: "מכירות לפי ערוץ של המוצרים המשויכים".
- Renders:
  - Summary line: "N הזמנות של מוצרים משויכים · CAD X סה"כ"
  - Per-source breakdown bar (visual): Facebook / Google / Direct / Other with percentages
  - Recommendation chip when `facebookShare ≥ 60%`: "💡 X% מהמכירות הגיעו מפייסבוק → ביטחון להעלאת תקציב הקמפיין"
  - Recommendation chip when `facebookShare < 30%`: "⚠️ רק X% מהמכירות הגיעו מפייסבוק → ייתכן שהקמפיין לא הוא המניע — בדוק לפני העלאת תקציב"
- The section only renders when:
  - Platform is Meta (Google PMax not mapped per-product anyway)
  - The campaign has mapped products
  - There are ≥3 orders containing mapped products in the period (below that the signal is too noisy)

### Coexistence with existing trust chip

- The existing trust chip in `CampaignsTable.tsx` continues to use `analyzeAttribution` (click-id per-campaign) with product-mapping fallback. **Unchanged.**
- The new section adds a third signal — channel-level — that the operator sees only when they open the drawer. This avoids cluttering the table.
- Tooltip on the new section explains the relationship: "סיגנל זה משלים את ה-trust chip. הוא מודד 'מאיפה הגיעו הקונים של המוצרים המשויכים' גם כש-utm_id חסר."

### Migration risk

- Apps Script writes will fail on the existing tab if column N already has data but the writer doesn't expect it. **Solved by** the idempotent migration pattern: `ensureOrdersAttributionTab_` always normalizes headers before write, and `writeOrdersAttributionForDay` always writes all 14 columns regardless of what was there before.
- Dashboard parsers will fail if they expect column N but the row has only A-M. **Solved by** defaulting `lineItems = []` when the cell is empty/null in `ordersAttribution.ts`.

### Performance

- `analyzeProductChannel` walks the full `orders` array per campaign per render. Already mitigated for the existing analyzer via the IN5-01 memoization pattern (Map<campaignKey, analysis> in a useMemo). Apply the same pattern for the new analyzer.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Apps Script — orders attribution pipeline
- `Shopify.gs` — `getShopifyOrdersAttribution` (lines ~516+), `classifyOrderAttribution_` (lines ~590+), `safeDecode_`. This is where line_items extraction must be added.
- `Shopify.gs` — `getShopifyProductSalesForDay` (line ~142) as a reference for how Shopify orders endpoint exposes `line_items.product_id` / `quantity` / `price`.
- `SheetBuilder.gs` — `ORDERS_ATTRIBUTION_HEADERS` (line ~1459), `ensureOrdersAttributionTab_` (line ~1473), `writeOrdersAttributionForDay` (line ~1532). Pattern: idempotent migration that adds new columns to existing tabs without losing data.
- `Config.gs` — `ordersAttributionTabName_` helper.
- `DailyUpdate.gs` — `updateStoreForDate_` (line ~74), specifically the orders-attribution block at lines ~153-163. This is the daily-run integration point.

### Dashboard — attribution layer (Phase 0 patterns to follow/reuse)
- `dashboard-web/src/lib/ordersAttribution.ts` — current 13-column parser; column N parsing must be added here. Includes `OrderAttributionRow` type and `parseSource` function (updated in Round 5 to be permissive).
- `dashboard-web/src/lib/attributionAnalysis.ts` — co-location target for the new `analyzeProductChannel`. Existing pattern: `analyzeAttribution`, `analyzeAttributionForAdSet`, `analyzeAttributionForAd` + shared `buildAnalysis` engine. New analyzer is *additive* and does NOT replace any of them.
- `dashboard-web/src/components/CampaignDrawer.tsx` — drawer that mounts the existing `AttributionAnalysisPanel` (around line ~700+). New section sits between that panel and the ad-sets table (~line 1000+). Uses `attributionByAdSet` useMemo pattern for memoization (IN5-01).
- `dashboard-web/src/components/CampaignsTable.tsx` — existing trust chip rendering (lines ~1300-1357). Reference only — NO changes here for this phase.
- `dashboard-web/src/app/api/orders-attribution/route.ts` — API route, no changes needed (cells flow through as strings, parser handles JSON).

### Cloud sync (no changes for this phase)
- `dashboard-web/src/lib/cloudSync.ts` — `STATE_KEYS` does NOT need a new entry; channel-level analysis is read-only.

### Round 5 review reference (idempotent migration + memoization patterns)
- `.planning/reviews/REVIEW-5.md` — see WR5-02 (preserve unparseable-date rows) and IN5-01 (memoize per-row attribution). These two patterns apply directly to the new analyzer + the new migration.

### System overview
- `SYSTEM_OVERVIEW.md` — current architecture diagrams, especially the "שכבת ה-Attribution" section. New phase extends this layer without changing existing flows.

</canonical_refs>

<specifics>
## Phase Specifics

### Files expected to change

**Apps Script (must be manually uploaded to script.google.com after commit):**
- `Shopify.gs` — extend `getShopifyOrdersAttribution` to include line items in fetched orders + return them on each `OrderAttributionRow`-equivalent JS object
- `SheetBuilder.gs` — extend `ORDERS_ATTRIBUTION_HEADERS` + `ensureOrdersAttributionTab_` (migration) + `writeOrdersAttributionForDay` (serialize line items as JSON column N)

**Dashboard:**
- `dashboard-web/src/lib/ordersAttribution.ts` — read column N (range A2:N100000), parse JSON to `OrderLineItem[]`, add `lineItems` field to `OrderAttributionRow`
- `dashboard-web/src/lib/attributionAnalysis.ts` — add `analyzeProductChannel(productIds, orders, storeId, dateFrom, dateTo) → ProductChannelBreakdown | null`. Include the new types `OrderSource`-keyed `bySource` map. Mark exports.
- `dashboard-web/src/components/CampaignDrawer.tsx` — import the new analyzer, memoize the result (Map<campaignKey, breakdown> or single value since CampaignDrawer is one campaign at a time), render the new section between AttributionAnalysisPanel and ad-sets table.

**Documentation (must update after implementation):**
- `SYSTEM_OVERVIEW.md` — add the new section to the Attribution layer + update the orders-attribution tab description to show 14 columns (col N)
- `dashboard-web/README.md` — add `analyzeProductChannel` to the lib list + mention the new drawer section

### Non-goals (explicitly NOT in this phase)

- Migrating historical orders pre-May 2026 to populate line items. They simply won't have the data; the analyzer treats them as orders-without-line-items and excludes them from breakdown counts.
- Surfacing line items per order in any UI table.
- Adding line items to `products-daily` (orthogonal — products-daily already aggregates per-product per-day; what we're adding is per-order line items which is a different shape).
- Cross-store breakdown.
- Time-series breakdown (this phase is period totals only — the operator picks a date range, sees the breakdown for that range).

### Acceptance for the planner

The planner should produce atomic tasks that:
1. Start with the data-layer (Apps Script + Sheet schema migration) so the dashboard parser has data to test against
2. Continue with the dashboard parser changes
3. Then the analyzer
4. Then the UI integration
5. End with documentation updates

Each task should be testable in isolation (e.g., the analyzer should be implementable+verifiable before the UI exists). The planner should call out where the operator's manual Apps Script upload + backfill is required between phases of the work.

</specifics>
