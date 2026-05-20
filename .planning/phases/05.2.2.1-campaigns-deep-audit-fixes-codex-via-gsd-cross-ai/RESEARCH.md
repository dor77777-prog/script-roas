---
phase: 05.2.2.1-campaigns-deep-audit-fixes
type: research
date: 2026-05-20
consumed_by: gsd-planner
inputs:
  - .planning/phases/05.2.2-campaigns-deep-audit-opus-codex-cross-ai-review/05.2.2-AUDIT.md
  - .planning/phases/05.2.2-campaigns-deep-audit-opus-codex-cross-ai-review/05.2.2-CODEX-REVIEW.md
  - .planning/phases/05.2.2-campaigns-deep-audit-opus-codex-cross-ai-review/05.2.2-SYNTHESIS.md
patterns_documented: 7
fix_categories: 6
test_targets: 8
---

# Phase 5.2.2.1 — Research: Campaigns Deep-Audit Fixes

## 1. Phase scope summary

Phase 5.2.2.1 is the **fix-execution phase** that consumes the 5.2.2 deep audit. It applies the 23 prescriptive fixes and 8 regression tests from `05.2.2-SYNTHESIS.md` across three codex-executed plans:

- **5.2.2.1-01** — FIX-01..FIX-07 (P0/P1 must-fix-before-Phase-6: organic predicate, refund-day series, drilldown namespace, AdsDrawer range, drawer budget recency, CBO/ABO normalization, `/api/ads` range param)
- **5.2.2.1-02** — FIX-08..FIX-23 (P2 secondary: `dailyMeta` index, defense-in-depth boundary guards, AdsDrawer platform filter, signed-revenue width clamp, strict `>` tie-break, active-day Pearson, productId trim, dead code removal, banner disclosure, perf cleanups, range validation)
- **5.2.2.1-03** — TEST-01..TEST-08 (regression coverage that pins every fix above)

Each plan has `cross_ai: true` frontmatter; `/gsd-execute-phase 5.2.2.1 --cross-ai` pipes each task to the codex CLI and captures the response as the SUMMARY. The goal is to leave the campaigns tab in a state where the next phase (Phase 6 — security and cloud sync) can build without any algorithm-layer cleanup looming.

This is NOT a refactor — every fix is targeted, mechanical, and accompanied by either a regression test (the TEST plan) or a pinned-behavior assertion in an extended existing test. Plans 01 and 02 deliberately do NOT include test creation; tests are isolated to Plan 03 because they must be written against the fixed behavior, not the pre-fix bugs.

## 2. Pattern inventory

The repo has well-established patterns for each fix category. Codex should mirror these byte-for-byte rather than inventing new shapes.

### 2.1 Latest-date budget aggregation — for FIX-05, FIX-06, FIX-13

**Canonical pattern:** `CampaignsTable.tsx:128-196` (the `aggregate()` function — the only place this is done correctly).

```ts
// CampaignsTable.tsx:131-134, 165-167, 176-196 (verbatim)
const latestBudgetDate = new Map<string, string>();
const latestAdSetBudgetDate = new Map<string, string>();
const latestBudgetTypeDate = new Map<string, string>();
// ...
// Seed on first map.set (line 165-167):
if (r.campaignBudgetCad != null) latestBudgetDate.set(key, r.date);
if (mode === 'adset' && r.adSetBudgetCad != null) latestAdSetBudgetDate.set(key, r.date);
if (r.budgetType) latestBudgetTypeDate.set(key, r.date);
// ...
// Inside the row loop (line 176-196):
if (r.campaignBudgetCad != null) {
  const prev = latestBudgetDate.get(key);
  if (!prev || r.date >= prev) {          // ← FIX-13 changes this to strict >
    a.campaignBudgetCad = r.campaignBudgetCad;
    latestBudgetDate.set(key, r.date);
  }
}
// Same shape for adSetBudgetCad (lines 183-189) and budgetType (lines 190-196).
```

**For FIX-05** (drawer `summary` IIFE at `CampaignDrawer.tsx:230-314`, specifically line 279 `if (r.adSetBudgetCad != null) a.adSetBudgetCad = r.adSetBudgetCad;`): mirror the table-level pattern. Add `const latestAdSetBudgetDate = new Map<string, string>();` OUTSIDE the row loop (before `for (const r of rows)`), seed it when `byAdSet.set(aKey, ...)` is called for the first time (line 257-271), and gate the overwrite inside the loop.

Concrete sketch for FIX-05:
```ts
// CampaignDrawer.tsx summary useMemo — add OUTSIDE the loop:
const latestAdSetBudgetDate = new Map<string, string>();

// Inside the existing for-of-rows loop, REPLACE line 279:
//   if (r.adSetBudgetCad != null) a.adSetBudgetCad = r.adSetBudgetCad;
// WITH:
if (r.adSetBudgetCad != null) {
  const prev = latestAdSetBudgetDate.get(aKey);
  if (!prev || r.date > prev) {           // strict > per FIX-13
    a.adSetBudgetCad = r.adSetBudgetCad;
    latestAdSetBudgetDate.set(aKey, r.date);
  }
}

// Also: when seeding `byAdSet.set(aKey, { ... adSetBudgetCad: r.adSetBudgetCad })`:
if (r.adSetBudgetCad != null) latestAdSetBudgetDate.set(aKey, r.date);
```

**For FIX-06** (CBO/ABO normalization at the END of the loop): add a SECOND pass over `map.values()` (after the existing for-loop finishes, before `return Array.from(map.values());`):

```ts
// CampaignsTable.tsx — add at the end of aggregate(), just before `return Array.from(map.values());`:
for (const a of map.values()) {
  if (a.budgetType === 'ABO') a.campaignBudgetCad = null;
  if (a.budgetType === 'CBO') a.adSetBudgetCad = null;
}
return Array.from(map.values());
```

Why this works: `a.budgetType` is already the chronologically-latest budgetType (line 190-196 already tracks `latestBudgetTypeDate`). After the loop, normalize the displayed budget shape to match. `CampaignsTableRow.tsx:172-186` already renders `null` cleanly as `—` so no UI change is needed.

**For FIX-13** (`>=` → `>`): change at three sites: `CampaignsTable.tsx:178`, `:185`, `:192`. **Pitfall:** the codex executor's habit is to write `>=` for "latest wins" patterns — explicitly call out strict `>` in the plan and add the comment from SYNTHESIS: `// strict > so duplicate-date rows don't tie-break by row-write order; first-observed budget for a given date wins.`

For FIX-05 itself, the drawer can also use strict `>` (the SYNTHESIS notes this is fine even if FIX-13 hasn't landed yet — they're independent code sites).

### 2.2 SWR with range-keyed cache — for FIX-04, FIX-07

**Canonical pattern:** `CampaignDrawer.tsx:146, 171-205` (the drawer pattern, post-WR-05 fixes).

```ts
// CampaignDrawer.tsx:146 — build the range object inside the component:
const drawerRange = { from: rangeFrom, to: rangeTo };

// CampaignDrawer.tsx:171-179 — gate on `open`, key on buildDateRangeKey:
const { data: campaignsData } = useSWR<CampaignsResponse>(
  open ? buildDateRangeKey('/api/campaigns', drawerRange) : null,
  async (url: string) => {
    const r = await fetch(url);
    if (!r.ok) return { rows: [], lastUpdated: new Date().toISOString() };
    return r.json();
  },
  { revalidateOnFocus: false, dedupingInterval: 60_000 },
);

// CampaignDrawer.tsx:196-205 — orders-attribution with the same pattern:
const ordersAttrBaseKey = open ? buildDateRangeKey('/api/orders-attribution', drawerRange) : null;
const { data: ordersAttrData } = useSWR<OrdersAttributionResponse>(
  ordersAttrBaseKey ? `${ordersAttrBaseKey}&lineItems=true` : null,   // note: drawer appends &lineItems=true
  /* same fetcher */,
  { revalidateOnFocus: false, dedupingInterval: 60_000 },
);
```

**For FIX-04** (AdsDrawer orders-attribution fetch at `AdsDrawer.tsx:86-94`): replace the bare `'/api/orders-attribution'` SWR key with the range-keyed key. AdsDrawer already has `rangeFrom`/`rangeTo` as props (lines 45-46) — build `const drawerRange = { from: rangeFrom, to: rangeTo };` near the top of the component (mirroring CampaignDrawer line 146). Then:

```ts
// AdsDrawer.tsx — replace lines 86-94:
const drawerRange = { from: rangeFrom, to: rangeTo };
const ordersAttrBaseKey = open ? buildDateRangeKey('/api/orders-attribution', drawerRange) : null;
const { data: ordersAttrData } = useSWR<OrdersAttributionResponse>(
  ordersAttrBaseKey,
  async (url: string) => {
    const r = await fetch(url);
    if (!r.ok) return { rows: [], lastUpdated: new Date().toISOString() };
    return r.json();
  },
  { revalidateOnFocus: false, dedupingInterval: 60_000 },
);
```

Note: AdsDrawer does NOT need `&lineItems=true` — it doesn't render the productChannelBreakdown. The bare range key is sufficient.

**Also required:** add `buildDateRangeKey` to the AdsDrawer imports — check if `from '@/lib/dateRange'` is already imported (it isn't; AdsDrawer currently has no import from `dateRange.ts`).

**For FIX-07** (AdsDrawer ads fetch + `/api/ads` route): two-part change.

Part A — server route: mirror `/api/campaigns/route.ts:20-32`:

```ts
// dashboard-web/src/app/api/ads/route.ts — replace the GET function:
import { parseRangeParams, RangeParamError } from '@/lib/dateRange';

export async function GET(req: Request) {
  let range;
  try {
    range = parseRangeParams(new URL(req.url).searchParams);
  } catch (e) {
    if (e instanceof RangeParamError) {
      return NextResponse.json({ error: e.message }, {
        status: 400,
        headers: { 'Cache-Control': 'no-store' },
      });
    }
    throw e;
  }
  try {
    const rows = await fetchAdsData({ range });
    /* existing rows-length warn + NextResponse.json — unchanged */
  } catch (err) {
    /* existing degrade-gracefully path */
  }
}
```

Part B — `fetchAdsData()` signature change. The function lives in `dashboard-web/src/lib/ads.ts` (not read in this research; the executor must update its signature to `fetchAdsData(opts?: { range?: DateRange }): Promise<AdRow[]>` and filter by `r.date >= range.from && r.date <= range.to` server-side, mirroring `fetchCampaignsData` at `campaigns.ts:97`).

Part C — client: in `AdsDrawer.tsx:78-82`, change the SWR key from `'/api/ads'` to `buildDateRangeKey('/api/ads', drawerRange)`. Remove the in-memory date filter at line 156 (`if (r.date < rangeFrom || r.date > rangeTo) continue;`) since the server now filters — BUT keep the `storeId`/`campaignId`/`adSetId` filters at lines 157-159.

### 2.3 Storeid+platform+campaignid namespace key — for FIX-03, FIX-10, FIX-11

**Canonical helper:** `campaignKey()` in `campaignProductMap.ts:28-30`:

```ts
export function campaignKey(storeId: string, platform: string, campaignId: string): string {
  return `${storeId}::${platform}::${campaignId}`;
}
```

**Canonical key format pattern in CampaignsTable.tsx:140-143:**
```ts
const key =
  mode === 'campaign'
    ? `${r.storeId}::${r.platform}::${r.campaignId}`
    : `${r.storeId}::${r.platform}::${r.campaignId}::${r.adSetId}`;
```

These two forms appear throughout — the helper is for the campaign-level case; the inline template literal handles the adset-level extension. There's no `adSetKey()` helper today.

**For FIX-03** (drilldown drops `storeId`): three coordinated changes.

1. `CampaignsTableRow.tsx:72-76` — extend `onDrillCampaign` signature. Current shape (line 72-75):
   ```ts
   if (mode === 'campaign' && a.campaignId) {
     onDrillCampaign(a.campaignId, a.platform);
   }
   ```
   New shape:
   ```ts
   if (mode === 'campaign' && a.campaignId) {
     onDrillCampaign(a.campaignId, a.platform, a.storeId);
   }
   ```
   Update `Props.onDrillCampaign` at line 31:
   ```ts
   onDrillCampaign: (campaignId: string, platform: string, storeId: string) => void;
   ```

2. `CampaignsTable.tsx:418-420` — add a `drillStoreId` state:
   ```ts
   const [drillCampaignId, setDrillCampaignId] = useState<string | null>(null);
   const [drillPlatform, setDrillPlatform] = useState<string | null>(null);
   const [drillStoreId, setDrillStoreId] = useState<string | null>(null);     // NEW
   ```
   Wire the setter at the row's callback site (search for where `setDrillCampaignId` is currently called as a callback to `onDrillCampaign` — must also call `setDrillStoreId(storeId)`).

3. `CampaignsTable.tsx:1266-1280` — strict storeId filter (replaces the `localStore === 'All' || r.storeName === localStore` heuristic):
   ```tsx
   {drillCampaignId && drillPlatform && drillStoreId && data && (
     <CampaignDrawer
       campaignId={drillCampaignId}
       storeId={drillStoreId}                                         // NEW prop
       open
       onClose={() => { setDrillCampaignId(null); setDrillPlatform(null); setDrillStoreId(null); }}
       rows={data.rows.filter(r =>
         r.storeId === drillStoreId &&                                // strict storeId
         r.platform === drillPlatform &&
         r.campaignId === drillCampaignId &&
         r.date >= localRange.from && r.date <= localRange.to,
       )}
       adAccounts={adAccounts}
       rangeFrom={localRange.from}
       rangeTo={localRange.to}
     />
   )}
   ```
   Note the change to **storeId-strict filtering** AND the removal of the `localStore === 'All' || r.storeName === localStore` heuristic — once `r.storeId === drillStoreId` is enforced, storeName matching is redundant.

4. `CampaignDrawer.tsx` — accept `storeId` as a direct prop. Add to `Props` (around line 35-50 — not read in this research; executor must locate the Props type). Then REPLACE line 357 (`const storeId = rows.length > 0 ? rows[0].storeId : '';`) with the prop value: just use the `storeId` from props directly. The `rows[0].storeId` derivation is removed entirely.

Note this implicitly resolves the AUDIT-P2-11 concern (empty-string storeId fallback) — once `storeId` is a required prop, the derivation path disappears.

**For FIX-10** (CPM previous-period filter at `CampaignDrawer.tsx:591-594`): replace the namespace-incomplete filter:

```ts
// CURRENT (line 593):
const rows = (campaignsDataPrev?.rows ?? []).filter(r => r.campaignId === campaignId);

// NEW:
const rows = (campaignsDataPrev?.rows ?? []).filter(r =>
  r.storeId === storeId &&
  r.platform === summary.platform &&
  r.campaignId === campaignId,
);
```

Both `storeId` and `summary.platform` are already in scope at line 593 (storeId is computed at line 357, summary at line 314-352 — but the IIFE that contains this filter is inside the CPM chart section which runs AFTER both).

**For FIX-11** (AdsDrawer platform filter): add `platform: 'Meta' | 'Google'` to `AdsDrawer` Props (lines 37-47). Pass it from `CampaignDrawer.tsx` (the only two callsites currently hardcode `platform: 'Meta'` — likely in or near `CampaignDrawer.tsx:1283-1295`; executor must locate). Then in `AdsDrawer.tsx`:

- Aggregation loop at lines 155-160: add `if (r.platform !== platform) continue;` alongside the existing store/campaign/adset checks.
- `dailyMetaByAd` filter at lines 205-226: same addition.

### 2.4 Source-exclusion predicate — for FIX-01

**`OrderSource` union** (from `ordersAttribution.ts:66-75`):

```ts
export type OrderSource =
  | 'meta-paid'        // fbclid OR utm_source=facebook + cpc
  | 'google-paid'      // gclid OR utm_source=google + cpc
  | 'meta-organic'     // referrer fb/ig, no UTM
  | 'google-organic'   // referrer google, no UTM
  | 'email'            // utm_source = email/newsletter/klaviyo
  | 'other-paid'       // UTM-tagged but unrecognised source ← MUST exclude
  | 'other-referral'   // referrer set but not classifiable
  | 'direct'           // no UTM, no referrer
  | '';                // unknown / missing ← MUST exclude
```

**Current buggy predicate** (`MetaShopifyReconciliation.tsx:224-230`):

```ts
function isOrganicSource(order: { source: OrderSource | string; fbclidPresent?: boolean; gclidPresent?: boolean }): boolean {
  if (order.fbclidPresent) return false;
  if (order.gclidPresent) return false;
  if (order.source === 'meta-paid') return false;
  if (order.source === 'google-paid') return false;
  return true;
}
```

**Fix shape:** add two explicit exclusions. Resulting predicate keeps in-organic: `meta-organic`, `google-organic`, `email`, `other-referral`, `direct`. Excludes: `meta-paid`, `google-paid`, `other-paid`, `''`, plus any fbclid/gclid present.

```ts
function isOrganicSource(order: { source: OrderSource | string; fbclidPresent?: boolean; gclidPresent?: boolean }): boolean {
  if (order.fbclidPresent) return false;
  if (order.gclidPresent) return false;
  if (order.source === 'meta-paid') return false;
  if (order.source === 'google-paid') return false;
  if (order.source === 'other-paid') return false;     // NEW — UTM-tagged paid non-Meta/non-Google (TikTok/influencer)
  if (order.source === '') return false;               // NEW — classifier failure; not safe to default to organic
  return true;
}
```

Add a comment block above explaining the explicit policy: "organic = NOT meta-paid AND NOT google-paid AND NOT other-paid AND NOT empty AND NOT fbclid/gclid present. Adding new paid OrderSource members (e.g. 'tiktok-paid') will require an explicit decision here."

### 2.5 `hitMapped` accumulator pattern — for FIX-02

**Canonical reference:** `analyzeProductChannel` already uses this exact pattern at `attributionAnalysis.ts:1060-1069`:

```ts
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
```

**Apply this verbatim to both Shopify (line 174-189) and Organic (line 236-253) accumulators in `MetaShopifyReconciliation.tsx`.** Current Shopify uses `if (mappedRevenue === 0) continue;` (line 186) — close but not quite. Current Organic uses `if (mappedRevenue <= 0) continue;` (line 250) — drops refunds. Both replaced with the `hitMapped` boolean pattern.

Concrete shape for the Shopify accumulator (replaces lines 174-189):

```ts
const shopifyByDate = new Map<string, number>();
if (ordersData?.rows) {
  for (const order of ordersData.rows) {
    if (order.storeId !== storeId) continue;
    if (!order.lineItems || order.lineItems.length === 0) continue;
    if (order.date < rangeFrom || order.date > rangeTo) continue;
    let mappedRevenue = 0;
    let hitMapped = false;
    for (const li of order.lineItems) {
      if (wantedIds.has(li.productId)) {
        hitMapped = true;
        mappedRevenue += li.revenueCad;
      }
    }
    if (!hitMapped) continue;
    shopifyByDate.set(order.date, (shopifyByDate.get(order.date) ?? 0) + mappedRevenue);
  }
}
```

Identical shape for the Organic accumulator (replaces lines 236-253), with the additional `isOrganicSource(order)` and `order.lineItems` checks already present in the current code.

**Why `hitMapped` is required (not just `=== 0`):** an order with a refund line item that exactly cancels a sale line item (e.g., +50 and -50 of the same product) has `mappedRevenue === 0` but DID hit mapped products — that order's date should still be present in the series with value 0. The `=== 0` skip would silently drop these orders from the series; `hitMapped` only skips orders with NO mapped product at all.

### 2.6 Width-clamping for proportional bars — for FIX-12

**Canonical reference:** `ProductChannelBreakdown.tsx:78-82` clamps the upper bound but not the lower:

```tsx
<div className="h-full bg-roas-blue" style={{ width: `${(fb / total) * 100}%` }} />
```

(Note: `total === 0` produces `NaN%` here too — the AUDIT-P2-06 finding — but that's gated upstream by `if (breakdown.totalOrders < 3) return null;`. Out of scope for 5.2.2.1.)

**For FIX-12** (`AttributionAnalysisPanel.tsx:81-97`): the current code is:

```tsx
<div className="h-2.5 rounded-full bg-white/40 overflow-hidden flex">
  <div
    className="h-full bg-current opacity-70"
    style={{ width: `${Math.min(100, (analysis.deterministicRevenue / value) * 100)}%` }}
  />
  <div
    className="h-full bg-current opacity-25"
    style={{ width: `${Math.min(100, (analysis.modeledRevenue / value) * 100)}%` }}
  />
</div>
```

**Fix:** clamp BOTH ends to `[0, 100]`:

```tsx
<div
  className="h-full bg-current opacity-70"
  style={{ width: `${Math.max(0, Math.min(100, (analysis.deterministicRevenue / value) * 100))}%` }}
/>
<div
  className="h-full bg-current opacity-25"
  style={{ width: `${Math.max(0, Math.min(100, (analysis.modeledRevenue / value) * 100))}%` }}
/>
```

**Plus the refund-display sub-fix from SYNTHESIS:** when `analysis.deterministicRevenue < 0`, render a small dedicated refund marker below the bar showing the absolute refund value. This is optional UX polish — the SYNTHESIS calls it out but the planner can choose to keep the simpler clamp-only fix in 5.2.2.1 and defer the refund marker to a UX phase. **Recommendation: include only the clamp; defer the refund marker.** The clamp is the correctness fix; the marker is a UX enhancement that adds complexity without correctness benefit.

### 2.7 Pearson on active days only — for FIX-14

**Current shape** (`MetaShopifyReconciliation.tsx:267-274`):

```ts
const r = pearson(series.map(s => s.meta), series.map(s => s.shopify));
const rGoogle = pearson(series.map(s => s.google), series.map(s => s.shopify));
const rOrganic = pearson(series.map(s => s.organic), series.map(s => s.shopify));
const rCombined = pearson(
  series.map(s => s.meta + s.google + s.organic),
  series.map(s => s.shopify),
);
```

`series` includes every date in `enumerateDateRange(rangeFrom, rangeTo)` (line 164-165, 257-263), filling missing channel values with zeros (line 259-262).

**Fix shape:** filter to active days BEFORE the Pearson computation, leave `series` untouched for the chart visual:

```ts
// Add immediately before the Pearson block:
const activeSeries = series.filter(s => s.meta + s.google + s.organic + s.shopify > 0);

const r = pearson(activeSeries.map(s => s.meta), activeSeries.map(s => s.shopify));
const rGoogle = pearson(activeSeries.map(s => s.google), activeSeries.map(s => s.shopify));
const rOrganic = pearson(activeSeries.map(s => s.organic), activeSeries.map(s => s.shopify));
const rCombined = pearson(
  activeSeries.map(s => s.meta + s.google + s.organic),
  activeSeries.map(s => s.shopify),
);
```

**Critical:** keep `series` as the data source for the chart (line ~514) AND for the `darkTrafficPercent` sum (line 302-307) — those should still sum over all days to give the rolled-up totals. Only the Pearson denominators change.

Update the narrative copy: SYNTHESIS recommends adding a note that Pearson is computed over active days only. Look at the surrounding `<p>` blocks (lines 590-595 already explain the dual-basis caveat for Meta/Google vs Organic/Shopify) — add a similar sentence:

```tsx
{/* After the existing dual-basis explainer at lines 590-595, append: */}
<p className="text-[10px] text-text-muted leading-relaxed text-center">
  <strong>בסיס המתאם:</strong> Pearson r מחושב על ימים פעילים בלבד (לפחות ערוץ אחד או Shopify ≠ 0). תקופות עצירה לא משפיעות על r כדי שלא יצרו "הסכמה" מלאכותית של אפס-אפס.
</p>
```

## 3. Cross-fix dependencies

Explicit order constraints to encode in plan frontmatter or note in task ordering.

### Hard dependencies (MUST land in order)

| Predecessor | Successor | Reason |
|------------|-----------|--------|
| **FIX-03** | TEST-05 | TEST-05 asserts the new `drillStoreId` shape — fails if FIX-03 hasn't landed. |
| **FIX-03** | FIX-22 (planner: FIX-22 = AUDIT-P1-09 perf cleanup in synthesis table) | FIX-22's memoized `drillRows` deps array must include `drillStoreId`, which doesn't exist before FIX-03. |
| **FIX-07** | TEST-02 | TEST-02 mocks `fetch` and asserts `/api/ads` is called with `?from=&to=`. Requires the route + caller to use range params. |
| **FIX-04** | TEST-02 | Same test pins the `/api/orders-attribution` call too — requires FIX-04. |
| **FIX-15 (regex escape in synthesis)** | TEST-04 (campaignProductMap migration) | Actually, looking at the SYNTHESIS table: FIX-15 in the synthesis is the productToCampaigns index pre-build (P2-03), NOT a regex escape. The "regex escape" reference in the user's research scope is a misread. There is no regex-escape fix in 5.2.2.1's scope — the migration is already explicit-count (WR-07) at `campaignProductMap.ts:89-92`. **Flag to planner: the user's research instructions mention "FIX-15 regex escaping" but no such fix exists in the SYNTHESIS.** TEST-04 in the synthesis is the per-day reconciliation table test (pins FIX-16), not a migration test. |

### Soft dependencies (SHOULD land together for cleaner commits)

| Group | Reason |
|-------|--------|
| **FIX-05 + FIX-13 + FIX-06** | All three touch `aggregate()` / drawer summary IIFE. SYNTHESIS recommends grouping. Also: if Plan 03 extracts `aggregate` to `lib/campaignsAggregator.ts` for TEST-03, these three should ALL be in the extracted module so tests pin them at once. |
| **FIX-04 + FIX-07** | Both AdsDrawer fetch URL changes; one verifies the other via the Network tab. |
| **FIX-03 + FIX-10** | Both fix namespace drops. FIX-03 is the drilldown state; FIX-10 is the previous-period filter inside the drawer. They are at **different code sites** but tell the same story; ship together so the reviewer sees the full namespace-locking commit. |
| **FIX-09 + FIX-03** | FIX-09 adds the defense-in-depth `o.storeId !== campaign.storeId` boundary check in `analyzeAttribution`. Together with FIX-03 (drilldown carries storeId), the attribution analyzer is now triple-guarded: caller-side filter, analyzer-side boundary, matcher-side check. SYNTHESIS recommends both in the same PR but they're code-site-independent. |

### Test-to-fix mapping (Plan 03 reads from Plans 01 + 02)

| Test | Pins | Plan dep |
|------|------|---------|
| TEST-01 | FIX-01 (organic predicate) | 01 |
| TEST-02 | FIX-04 + FIX-07 (range params) | 01 |
| TEST-03 | FIX-05 + FIX-06 + FIX-13 (aggregator extraction + tests) | 01 (FIX-05, FIX-06) + 02 (FIX-13) |
| TEST-04 | FIX-16 (per-day-table labels) | 02 |
| TEST-05 | FIX-03 (drilldown storeId) | 01 |
| TEST-06 | Chart color constants extraction | 02 (or Plan 03 alone if no caller changes) |
| TEST-07 | trustLevel type narrowing | (no fix — pure test) |
| TEST-08 | cpmRoasAnalysis N=3 + PRODUCT_MAP_CHIP_KEY | 02 |

## 4. Test patterns

### 4.1 Test runner + location

- **Runner:** vitest 2.1.0 (`dashboard-web/package.json:38`), config at `dashboard-web/vitest.config.ts`.
- **Environment:** `node` (no DOM). The config comment (lines 13-22) explicitly notes that DOM tests need a SEPARATE vitest config — adding `@testing-library/react` for a single hook test was rejected. Pure-function tests are the preferred shape.
- **Location:** ALL test files live in `dashboard-web/src/lib/__tests__/*.test.ts`. The `include` glob is `src/lib/__tests__/**/*.test.{ts,tsx}` — DO NOT co-locate next to module under test.
- **Run command:** `cd dashboard-web && npm test -- <test-name>` (vitest accepts a substring match).
- **Style:** explicit imports — `import { describe, it, expect } from 'vitest';` — globals are disabled (`globals: false` at config line 25).

### 4.2 Existing fixtures (`dashboard-web/src/lib/__tests__/fixtures.ts`)

Available factories (all use shallow merge):

| Factory | Returns | Default shape |
|---------|---------|---------------|
| `makeOrder(overrides)` | `OrderAttributionRow` | date `2026-05-15`, storeId `uzoshop`, totalCad 100, source `meta-paid`, fbclidPresent true, lineItems `[]` |
| `makeCampaign(overrides)` | analyzeAttribution input shape | Same store/date defaults, metaClaim 500, spend 200 |
| `makeAdSet(overrides)` | analyzeAttributionForAdSet input | adSetId `adset-1`, platform Meta |
| `makeAd(overrides)` | analyzeAttributionForAd input | adId `ad-1`, platform Meta |
| `makeLineItem(overrides)` | `OrderLineItem` | productId `p-1`, units 1, revenueCad 50 |
| `makeDailySeries(days, valueFn)` | `Array<{date, value}>` | N consecutive days from 2026-05-01 |
| `makeDateRange(from, to)` | `{ dateFrom, dateTo }` | shape for analyzer date args |

**The buildReconciliation test (`__tests__/buildReconciliation.test.ts:25-107`)** uses inline helpers — `makeSummary`, `makeProductRow`, `makeCampaignRow`, `makeOrderRow` — defined at the top of that file. For TEST-01 (extending buildReconciliation) and TEST-05 (campaignsTableDrilldown), reuse those local helpers from the existing file rather than adding to the central fixtures.

### 4.3 vi.mock patterns

`buildReconciliation.test.ts:3-13` shows the pattern for stubbing UI deps when importing a component module:

```ts
vi.mock('lucide-react', () => ({ TrendingUp: () => null }));
vi.mock('recharts', () => ({
  ComposedChart: () => null,
  Line: () => null,
  ResponsiveContainer: () => null,
  Tooltip: () => null,
  XAxis: () => null,
  YAxis: () => null,
}));
import { buildReconciliation } from '@/components/MetaShopifyReconciliation';
```

`campaignProductMap.test.ts:22-48` shows the pattern for stubbing `window.localStorage` + `CustomEvent` in node:

```ts
function installWindowShim() {
  const store = new Map<string, string>();
  (globalThis as any).window = {
    localStorage: { getItem, setItem, removeItem, clear },
    dispatchEvent: () => true,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  (globalThis as any).CustomEvent = class { constructor(public type: string) {} };
}
installWindowShim();
const mod = await import('@/lib/campaignProductMap');
```

### 4.4 How to test cross-store isolation WITHOUT React rendering — for TEST-05

The `useCampaignAttribution.test.ts:27-118` pattern is the canonical model. It tests the hook by **directly invoking the underlying pure function with the exact arguments the hook would forward**. This is documented at lines 12-26:

> The dashboard codebase intentionally does NOT depend on `@testing-library/react-hooks` (would balloon devDependencies for one hook test). Instead, we directly exercise `analyzeAttributionForAdSet` with the exact orchestration the hook performs — same delegation, same arguments, same contract.

**For TEST-05** (drilldown isolation), the underlying analyzer call chain is:
- `CampaignsTable.tsx` builds `drillRows` (filtered by storeId/platform/campaignId/date)
- Passes to `CampaignDrawer` as `rows` prop
- Drawer's `summary` aggregates `rows` → byDay/byAdSet
- Drawer calls `analyzeAttribution(campaign, ordersAttrData.rows, rangeFrom, rangeTo, dailyMeta)`
- Drawer calls `analyzeProductChannel(productIds, orders, storeId, dateFrom, dateTo)`

**Test shape:** Build a fixture with two stores (`uzoshop`, `zolplus`) that share a campaign ID (`camp-shared`). Build orders for BOTH stores with that campaign ID. Then EXTRACT a helper function (e.g., move the inline filter from `CampaignsTable.tsx:1271-1280` into a pure function `filterDrillRows(rows, storeId, platform, campaignId, range)`) — or assert against `analyzeAttribution(campaign={storeId:'uzoshop', ...}, allOrders, ...)` and verify `analysis.deterministicOrders` only counts uzoshop orders.

**Recommended approach (cheapest):** Extract `filterDrillRows` to a tiny helper in `CampaignsTable.tsx` (or a new `lib/drillFilter.ts`), then TEST-05 imports + asserts directly. No React rendering needed.

Alternative: don't extract — write the test to construct `drillRows` inline (mirroring the filter logic verbatim), pass to `analyzeAttribution`, assert isolation. This is what `useCampaignAttribution.test.ts` does. Lower-friction but couples test to the filter shape.

### 4.5 Test naming convention

- File: `__tests__/<feature>.test.ts` (NOT `<feature>.spec.ts` — repo uses `.test.ts`).
- `describe` block: usually the function name or feature: `describe('buildReconciliation', () => {})` / `describe('OrderSource writer↔reader contract', () => {})`.
- `it` block: behavior under test, often referencing the audit ID: `it('WR-07: migrates a legacy 2-segment key when exactly one platform matches the row data')`.

For TEST-05 specifically, recommended name: `campaignsTableDrilldown.test.ts` (or `drillFilter.test.ts` if extracting). `describe('drilldown drops cross-store rows (CODEX-NEW-P1-01)')`.

## 5. Pitfalls to flag in plans

Things that will trip up codex executors. Each plan should embed these as explicit warnings.

### 5.1 `>` vs `>=` in date comparison (FIX-13)

The codebase has used `>=` in two places (`CampaignsTable.tsx:178, 185, 192`). Codex's habit when reading existing code and being asked to "do the same thing for the drawer" (FIX-05) will be to copy `>=`. The plan must explicitly say: "use strict `>`; the FIX-13 cleanup is changing the table-level sites to `>` too; both should match." Otherwise FIX-05 ships with `>=` and silently regresses against FIX-13's intent.

### 5.2 No `as Foo` type assertions

The Opus audit found several places where `as` hides bugs. The CONVENTIONS.md and existing patterns discourage `as` casts when type narrowing would work. **Plans must explicitly forbid `as Foo` in NEW code introduced by these fixes** — particularly tempting in FIX-03 where the executor might write `r as { storeId: string; ... }` instead of relying on the existing `CampaignRow` type.

Exception: `as const satisfies readonly OrderSource[]` (used in `orderSourceContract.test.ts:31`) is the documented pattern for sweep-test arrays — that's fine.

### 5.3 Drawer `summary` IIFE is a useMemo, not a plain computation (FIX-05)

The drawer `summary` at `CampaignDrawer.tsx:230-314` is wrapped in `useMemo(() => { ... }, [rows])`. The IIFE pattern (lines 230-314) sits **inside** the useMemo body. Codex might be tempted to "simplify" by removing the IIFE wrapper or extracting the logic to a plain function call — DO NOT. The useMemo gating on `[rows]` is the perf contract (FIX-22 wants to tighten that further). Keep the IIFE inside the useMemo.

### 5.4 Recharts dual-axis ordering — for FIX-03 / FIX-10 (drawer CPM chart)

The CPM-vs-ROAS dual-axis chart at `CampaignDrawer.tsx:643-` (continuing past the section read in research) uses two YAxes. When FIX-10 changes the `prevDaily` namespace filter, the executor MUST verify (manually or via build) that the chart's `<Line dataKey="cpm" yAxisId="left">` and `<Line dataKey="roas" yAxisId="right">` axis sides remain unchanged. The fix is to a DATA filter, not an axis configuration — but a careless executor could touch the chart JSX while in the neighborhood.

### 5.5 `localStore` vs `storeId` vs `storeName` — three identifiers, three meanings

This is the single biggest source of confusion across the campaigns surface. Each filter site uses ONE of these; plans must call out which is canonical at each site:

| Identifier | Meaning | Used at |
|------------|---------|---------|
| `storeId` | Canonical short ID (e.g., `'uzoshop'`, `'zolplus'`) — primary key in all data | All analyzers, all filters that should be cross-namespace-safe |
| `storeName` | Display name (e.g., `'uzoshop'`, `'Zol Plus'`, `'360usmile'`) — for UI labels | UI display only; some legacy filters use this (the `localStore === 'All' || r.storeName === localStore` heuristic that FIX-03 removes) |
| `localStore` | The currently-selected store filter in CampaignsTable's local toolbar (set via dropdown) — value is either `'All'` or a `storeName` | Top-level toolbar filter in CampaignsTable |

**FIX-03 specifically changes the drilldown filter from `r.storeName === localStore` (storeName comparison) to `r.storeId === drillStoreId` (storeId comparison).** Codex must NOT propagate `localStore` into the new drawer prop — it's a UI-display string, not a canonical ID. Use the row's `storeId` captured at click time.

### 5.6 Removing in-memory filter when server filter is added (FIX-07)

When FIX-07 pushes the date filter into `/api/ads`, the executor must also REMOVE the redundant in-memory filter at `AdsDrawer.tsx:156` (`if (r.date < rangeFrom || r.date > rangeTo) continue;`). Leaving both filters is harmless but defeats the test (TEST-02 mocks `fetch` and asserts the URL has range params — if the executor leaves the in-memory filter, the URL might still lack range params and tests pass against the in-memory filter shadowing the bug).

### 5.7 `campaignKey` helper for the namespace (FIX-03, FIX-10)

`campaignProductMap.ts:28-30` exports `campaignKey(storeId, platform, campaignId)` returning `${storeId}::${platform}::${campaignId}`. Some sites use this helper; others use inline template literals (`CampaignsTable.tsx:140-143`). When FIX-03 introduces a drilldown state key, the executor should **use the helper** for the 3-arg case, not invent a new shape.

### 5.8 Two-pass loop for FIX-06 (CBO/ABO normalization)

FIX-06 needs to run AFTER all rows for a key have been seen. Codex might try to inline the normalization inside the for-of-rows loop (e.g., "if r.budgetType === 'ABO', clear a.campaignBudgetCad"). DON'T — that breaks when a campaign has mixed-type rows. The normalization MUST be a second pass over `map.values()` after the loop finishes.

### 5.9 Codex shortcut risk: rewriting `aggregate()` as a one-liner

When asked to make multiple changes to `aggregate()` (FIX-05's drawer mirror, FIX-06's normalization, FIX-13's strict `>`), codex sometimes "improves" by rewriting the whole function. DON'T. Surgical edits only. The 70-line function as-is is the canonical pattern; preserve all comments (lines 129-132, 175, 195) which are load-bearing context for future maintainers.

## 6. Estimated complexity per FIX

For the planner to balance the three plans' time budgets. Codex execution time scales roughly with file count × edit complexity, not LoC.

### Trivial (1-2 line change; ~5-10 min codex each)

- **FIX-12** — `Math.max(0, Math.min(100, ...))` wrap at two width sites.
- **FIX-13** — `>=` → `>` at three line sites (178, 185, 192) + comment.
- **TEST-08** — Pin existing N=3 threshold + extract one constant.
- **FIX-17** — Delete `ordersForPlatform` (~15 lines) + update docstring.

### Small (single function or single component edit; ~15-25 min codex each)

- **FIX-01** — Add 2 lines to `isOrganicSource`.
- **FIX-02** — Replace skip logic in 2 accumulator blocks (Shopify + Organic).
- **FIX-09** — Add 1 line to `analyzeAttribution` filter.
- **FIX-14** — Add `activeSeries` filter + 4 line updates + narrative copy.
- **FIX-15** — Pre-build index `useMemo` outside the loop.
- **FIX-16** — Differentiate 3 cases in the per-day-table delta.
- **FIX-18** — Add `.trim()` at `parseLineItems` in `ordersAttribution.ts:174`.
- **FIX-19** — Add fallback banner in 2 components (CampaignsTable + CampaignDrawer).
- **FIX-21** — Move Meta/null gate into the first useMemo.

### Medium (cross-component / cross-file refactor; ~30-45 min codex each)

- **FIX-03** — 3 coordinated changes (Row + Table state + Drawer prop). Highest-risk in this batch. Pair with TEST-05.
- **FIX-05** — Drawer `summary` IIFE: add `latestAdSetBudgetDate` map outside loop + gate inside.
- **FIX-06** — `aggregate()` second-pass normalization (small code, requires understanding the budget-type contract).
- **FIX-08** — Hoist `dailyMetaByCampaign` outside the per-campaign loop in `useCampaignTrueRevenue.ts`. Two-step: build index + lookup per campaign.
- **FIX-10** — `CampaignDrawer.tsx:591-594` namespace filter.
- **FIX-11** — Add `platform` prop to `AdsDrawer`, thread through both callers + 2 internal filter sites.
- **FIX-22** — Memoize `drillRows` in `CampaignsTable.tsx` (depends on FIX-03's `drillStoreId`).
- **FIX-23** — Extract `getPreviousPeriod` to `lib/dateRange.ts` + replace in 2 components.
- **FIX-20** — Centralize `parseDate` in `lib/dateRange.ts` + replace in 3 files. Requires reading 3 parsers to confirm shape parity; risk of breaking format compatibility.

### Larger (API + caller; ~45-60 min codex each)

- **FIX-04** — AdsDrawer SWR key change + `buildDateRangeKey` import. Smaller than FIX-07 because no API route change.
- **FIX-07** — `/api/ads` route + `fetchAdsData()` signature + AdsDrawer SWR key + in-memory filter removal. Requires reading `lib/ads.ts` which wasn't pre-loaded for this research — codex must locate it.

### Test items (Plan 03)

- **TEST-01** — Extend existing test file. Small (~15 min).
- **TEST-02** — NEW file, `vi.mock('fetch')` pattern not yet in repo. Medium (~30-40 min).
- **TEST-03** — Requires EXTRACTING `aggregate` to `lib/campaignsAggregator.ts` first. Refactor + tests. Larger (~45-60 min).
- **TEST-04** — NEW file, pure logic for per-day-table cases. Small-medium (~20-30 min).
- **TEST-05** — NEW file, requires understanding drilldown contract. Medium (~30-40 min). Pair with FIX-03 review.
- **TEST-06** — NEW file + NEW `lib/chartColors.ts` module + replace literals at 3 sites. Medium (~30 min).
- **TEST-07** — NEW file, type-level enforcement. Small (~15-20 min).
- **TEST-08** — Extend existing file + extract `lib/sessionKeys.ts` + replace 2 imports. Small-medium (~20-30 min).

### Plan-time totals (matching SYNTHESIS estimates)

| Plan | Items | Aggregated estimate |
|------|-------|---------------------|
| 5.2.2.1-01 | FIX-01..FIX-07 (1 trivial + 4 small + 2 medium + 2 larger) | ~75-100 min codex |
| 5.2.2.1-02 | FIX-08..FIX-23 (3 trivial + 8 small + 5 medium + 0 larger) | ~90-120 min codex |
| 5.2.2.1-03 | TEST-01..TEST-08 (2 small + 6 medium) | ~45-90 min codex |

Total: ~3.5-5 hours codex work, conservative.

## 7. Out of scope (explicitly NOT in 5.2.2.1)

The planner must NOT include these in any 5.2.2.1 plan.

### Already-done in 05.2.1.1 (don't re-do)

- `ORGANIC_SOURCES` whitelist → inverted predicate migration. **FIX-01 in 5.2.2.1 is a refinement of the inverted predicate, NOT a re-introduction of the whitelist.**
- `localRange` reference-equality contract enforcement at `useCampaignTrueRevenue.ts:157-167`. Already documented; 5.2.2.1 doesn't touch it.
- Pearson null-on-zero-variance + finite-pair filtering in `attributionAnalysis.ts:158-186`. Already correct. **FIX-08-via-AUDIT-P1-03 (the cpmRoasAnalysis `pearson_` copy) is OUT — codex downgraded to P3 and SYNTHESIS dropped it from the actionable list.** Only TEST-08 (documenting the N=3 threshold) survives.
- `migrateProductMapKeys` segment-count check (WR-07). Already in `campaignProductMap.ts:81-95` — DO NOT re-touch.
- `analyzeProductChannel` `hitMapped` pattern. ALREADY in place at `attributionAnalysis.ts:1062-1069` — FIX-02 in 5.2.2.1 brings the **reconciliation** accumulators up to the same pattern; it doesn't add the pattern to `analyzeProductChannel` (which already has it).

### Deferred to a later phase (per SYNTHESIS "What's NOT in this phase" section)

- `analyzeProductChannel` rename / semantic-clarification (cross-channel vs within-platform). Deferred to Phase 7 (UX polish).
- Date-versioned `productMap`. Deferred per roadmap.
- `forecastMonthEnd` partial-fleet days. Product decision needed.
- Apps Script (`Shopify.gs`, `MetaAds.gs`, `GoogleAds.gs`, `Config.gs`, `SheetBuilder.gs`) — outside the deep-audit charter. **FIX-18's `parseLineItems` change is in `ordersAttribution.ts` (TypeScript), NOT Shopify.gs. Don't reach into .gs files for any fix.**
- Hero KPI / Dashboard / DashboardLayout audit. Phase 5.2.3 if scheduled.
- CPM odd-length asymmetry (AUDIT-P2-04). P3 backlog.
- ROAS display overflow (AUDIT-P2-14). P3 backlog.
- `chipHidden` SSR hydration (AUDIT-P2-10). Deferred to Phase 7.

### Dropped entirely (per SYNTHESIS "Dropped" section — codex DISAGREEd with Opus)

- `analyzeProductChannel` platform filter (AUDIT-P0-05). Function is by design cross-channel.
- `cpmDaily` zero-impression spend exclusion (AUDIT-P1-07). Portfolio CPM is the correct metric.
- `CampaignDrawer` empty-string storeId fallback (AUDIT-P2-11). Unreachable today; FIX-03 incidentally removes the fallback path as a side effect.
- `mappedRevenue === 0` skip semantics (AUDIT-P2-13). FIX-02's `hitMapped` switch already addresses the underlying concern; no separate item.

## 8. Flags for the planner: SYNTHESIS items that need sharpening

### 8.1 "FIX-15 regex escaping in migrateProductMapKeys" — DOES NOT EXIST in the fix list

The user's research scope mentions "TEST-04 (campaignProductMap migration) depends on FIX-15 (regex escaping in `migrateProductMapKeys`)". This is incorrect. The actual SYNTHESIS FIX-15 is **AUDIT-P2-03** (`useCampaignTrueRevenue.ts:255-264` O(N*M*K*P) pre-built index). The `migrateProductMapKeys` regex was already replaced with an explicit segment-count check in 05.2.1.1 (committed as `WR-07` and tested at `campaignProductMap.test.ts:97-110`). There is no migration regex fix in 5.2.2.1. **Recommendation: ignore that line in the user's research scope; it's a misread of 05.2.1.1 history.**

### 8.2 "TEST-04 campaignProductMap migration" — TEST-04 in SYNTHESIS is a DIFFERENT test

The user's research scope says "TEST-04 (campaignProductMap migration)". The SYNTHESIS TEST-04 is **`reconciliationDayTable.test.ts` (NEW) — pins FIX-16 per-day-table tone/label logic**. The campaignProductMap migration test ALREADY EXISTS as `campaignProductMap.test.ts` in 05.2.1.1 (file size 5778 bytes, written 19 May). 5.2.2.1 does not need a new migration test. **Recommendation: planner should use the SYNTHESIS's TEST-04 definition (day-table labels), not the user's research-scope description.**

### 8.3 FIX-22 + FIX-23 numbering in SYNTHESIS

SYNTHESIS lists FIX-22 (parent memoizes `drillRows`) and FIX-23 (centralized `getPreviousPeriod`). These are in the SECONDARY plan (5.2.2.1-02). FIX-22 depends on FIX-03 (Plan 01) — if plans run in parallel waves, the executor of Plan 02 must wait for Plan 01's FIX-03 to land first. Encode this in plan frontmatter as `depends_on: [01]` for Plan 02 if any of its tasks touch `drillRows`.

### 8.4 FIX-05 strict-`>` vs FIX-13 strict-`>` — they're the same intent at different sites

SYNTHESIS notes that FIX-05's drawer fix can use `>` independently of FIX-13. This is correct, but the planner should add a note to Plan 01 (FIX-05) reminding the executor to use `>` (not `>=`) **because** that matches the policy FIX-13 will land in Plan 02. Otherwise the drawer ships with `>` and the table sites still have `>=` until FIX-13, creating a 1-commit window of inconsistency.

## 9. Quick-reference file map

For each fix, the exact files codex will touch.

| Fix | Files |
|-----|-------|
| FIX-01 | `dashboard-web/src/components/MetaShopifyReconciliation.tsx` (only) |
| FIX-02 | `dashboard-web/src/components/MetaShopifyReconciliation.tsx` (only) |
| FIX-03 | `dashboard-web/src/components/CampaignsTableRow.tsx` + `CampaignsTable.tsx` + `CampaignDrawer.tsx` |
| FIX-04 | `dashboard-web/src/components/AdsDrawer.tsx` (only) |
| FIX-05 | `dashboard-web/src/components/CampaignDrawer.tsx` (only) |
| FIX-06 | `dashboard-web/src/components/CampaignsTable.tsx` (only) |
| FIX-07 | `dashboard-web/src/app/api/ads/route.ts` + `dashboard-web/src/lib/ads.ts` + `dashboard-web/src/components/AdsDrawer.tsx` |
| FIX-08 | `dashboard-web/src/lib/hooks/useCampaignTrueRevenue.ts` (only) |
| FIX-09 | `dashboard-web/src/lib/attributionAnalysis.ts` (only) |
| FIX-10 | `dashboard-web/src/components/CampaignDrawer.tsx` (only) |
| FIX-11 | `dashboard-web/src/components/AdsDrawer.tsx` + `CampaignDrawer.tsx` (caller sites) |
| FIX-12 | `dashboard-web/src/components/AttributionAnalysisPanel.tsx` (only) |
| FIX-13 | `dashboard-web/src/components/CampaignsTable.tsx` (only) |
| FIX-14 | `dashboard-web/src/components/MetaShopifyReconciliation.tsx` (only) |
| FIX-15 | `dashboard-web/src/lib/hooks/useCampaignTrueRevenue.ts` (only) |
| FIX-16 | `dashboard-web/src/components/MetaShopifyReconciliation.tsx` (only) |
| FIX-17 | `dashboard-web/src/lib/attributionAnalysis.ts` (only) |
| FIX-18 | `dashboard-web/src/lib/ordersAttribution.ts` (only — single-line trim at `parseLineItems`) |
| FIX-19 | `dashboard-web/src/components/CampaignsTable.tsx` + `CampaignDrawer.tsx` |
| FIX-20 | `dashboard-web/src/lib/dateRange.ts` + `lib/campaigns.ts` + `lib/ads.ts` + `lib/ordersAttribution.ts` |
| FIX-21 | `dashboard-web/src/lib/hooks/useCampaignAttribution.ts` (only) |
| FIX-22 | `dashboard-web/src/components/CampaignsTable.tsx` (only) |
| FIX-23 | `dashboard-web/src/lib/dateRange.ts` + `components/CampaignsTable.tsx` + `CampaignDrawer.tsx` |

| Test | File(s) |
|------|---------|
| TEST-01 | EXTEND `dashboard-web/src/lib/__tests__/buildReconciliation.test.ts` |
| TEST-02 | NEW `dashboard-web/src/lib/__tests__/adsDrawer.test.ts` |
| TEST-03 | NEW `dashboard-web/src/lib/campaignsAggregator.ts` (extracted) + NEW `dashboard-web/src/lib/__tests__/campaignsAggregator.test.ts` + UPDATE `CampaignsTable.tsx` import |
| TEST-04 | NEW `dashboard-web/src/lib/__tests__/reconciliationDayTable.test.ts` |
| TEST-05 | NEW `dashboard-web/src/lib/__tests__/campaignsTableDrilldown.test.ts` (preferred: extract `filterDrillRows` to `lib/drillFilter.ts` and test pure helper) |
| TEST-06 | NEW `dashboard-web/src/lib/chartColors.ts` + NEW `dashboard-web/src/lib/__tests__/chartColors.test.ts` + REPLACE literals in `MetaShopifyReconciliation.tsx` + `CampaignDrawer.tsx` + `CampaignsTable.tsx` |
| TEST-07 | NEW `dashboard-web/src/lib/__tests__/campaignsTableRowTrustLevel.test.ts` |
| TEST-08 | EXTEND `dashboard-web/src/lib/__tests__/cpmRoasAnalysis.test.ts` + NEW `dashboard-web/src/lib/sessionKeys.ts` + REPLACE imports in `MetaShopifyReconciliation.tsx` + `ProductChannelBreakdown.tsx` |

---

**Summary:** 7 patterns documented (latest-date budget, SWR range-keyed cache, storeId+platform+campaignId namespace, source-exclusion predicate, hitMapped accumulator, width clamp, active-day Pearson). 6 fix categories cross-referenced. 8 test targets mapped to file paths and existing patterns. Cross-fix dependencies enumerated. Three SYNTHESIS-vs-research-scope discrepancies flagged for the planner (FIX-15 mislabeled, TEST-04 mislabeled, FIX-22/23 dependency ordering). Plans 01/02/03 can be authored directly from this document.
