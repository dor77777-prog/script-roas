---
phase: round-5-attribution-pipeline
reviewed: 2026-05-18T00:00:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - Config.gs
  - DailyUpdate.gs
  - SheetBuilder.gs
  - Shopify.gs
  - dashboard-web/src/app/api/orders-attribution/route.ts
  - dashboard-web/src/components/AdsDrawer.tsx
  - dashboard-web/src/components/CampaignDrawer.tsx
  - dashboard-web/src/components/CampaignsTable.tsx
  - dashboard-web/src/components/ProductPickerModal.tsx
  - dashboard-web/src/lib/attributionAnalysis.ts
  - dashboard-web/src/lib/ordersAttribution.ts
findings:
  critical: 2
  warning: 5
  info: 6
  total: 13
status: issues_found
---

# Round 5: Code Review Report — Attribution Pipeline

**Reviewed:** 2026-05-18
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

The round-5 attribution pipeline adds a major new capability: per-order
deterministic source classification (fbclid / gclid / utm_*) on the
Apps Script side, surfaced as a 4-level trust chip across three dashboard
tables (campaigns, ad-sets, ads). The architecture is sound — the explicit
`metaClaim===0 && deterministicOrders===0` short-circuit added in 262f06c
correctly differentiates "no conversions to analyse" from "Meta claimed
conversions but no click-IDs match", and the ladder ordering in
`analyzeAttribution`/`buildAnalysis` does NOT block legitimate downgrades
for the `spend>0, metaClaim>0, det=0` case (it correctly hits the "לא
ניתן לקבוע" branch at attributionAnalysis.ts:277/651).

Two real BLOCKERs surfaced, both in `attributionAnalysis.ts` and
`Shopify.gs`:

1. **`orderMatchesCampaign` falls through on utm_id mismatch.** When an
   order carries a utm_id pointing to campaign A and we're analysing
   campaign B, the function falls through to a name-match — silently
   misattributing the order to a different campaign if both happen to
   share the same name. The utm_id was specifically introduced because
   IDs are stricter than names; the fall-through inverts that property.
2. **`classifyOrderAttribution_` calls `decodeURIComponent` without
   try/catch.** A single malformed escape sequence in a landing URL
   (bot traffic / scraper / mis-encoded affiliate link) throws URIError
   and aborts the entire day's classification — the day's
   orders-attribution write never happens.

Five WARNINGs concern data-loss risk in the idempotent-write filter
pattern (malformed dates dropped on every overwrite), missing throttle
in the partial-store backfill helper, missing `dailyMeta` propagation
in two of three analyzer entry points (so outlier/stability never fires
for ad-sets/ads), a regression risk in `OrdersAttributionResponse`
typing, and a Bayesian-CI degenerate case that displays
misleadingly-precise intervals when all matched orders have the same
AOV.

The remaining six items are Info-level: rendering performance hot
paths (analyzeAttribution called inside `.map(...)` per render in three
components), small lexicographic edge cases, and a doc gap on the
windowing math.

## Critical Issues

### CR5-01: `orderMatchesCampaign` falls through from utm_id mismatch to name match

**File:** `dashboard-web/src/lib/attributionAnalysis.ts:104-121`

**Issue:** The matcher's documented strategy is "Tier 1 — ID match
(strongest, immune to renames + special chars). Tier 2 — name match
(fallback)." The current implementation only treats utm_id as a
fallback path:

```ts
// Tier 1
if (campaign.campaignId && order.utmId) {
  if (order.utmId.trim() === campaign.campaignId.trim()) return true;
  // BUG: falls through to Tier 2 when utm_id is present but does NOT match
}

// Tier 2
if (order.utmCampaign) {
  const a = order.utmCampaign.trim().toLowerCase();
  const b = campaign.campaignName.trim().toLowerCase();
  if (a === b) return true;
}
```

Concrete scenario: an order carries `utm_id="123"` (campaign with id=123,
name "Summer Sale 2024") and `utm_campaign="Summer Sale"`. We analyse
campaign id=456 with name "Summer Sale" (a renamed-copy or near-duplicate
in another store). utm_id mismatches (123 ≠ 456), falls through, name
matches (case-insensitive trim), order is falsely attributed to campaign
456. The whole point of utm_id was to be strictly stronger than name
matching — the fall-through reverses that. With operators frequently
duplicating campaigns ("Summer Sale" → "Summer Sale - Retargeting"),
this is not hypothetical.

**Fix:** When utm_id is present, it is the authoritative signal — either
match it or reject. Only fall back to name when utm_id is absent:

```ts
if (campaign.platform !== 'Meta') return false;
if (order.storeId !== campaign.storeId) return false;

// Tier 1 — utm_id is authoritative when present on the order.
if (order.utmId) {
  // If campaignId is configured AND the IDs match, accept.
  // If campaignId mismatches or campaign.campaignId is undefined,
  // DO NOT fall through — utm_id is the trusted signal on this order,
  // and falling back to name would mis-attribute to namesake campaigns.
  return !!campaign.campaignId
    && order.utmId.trim() === campaign.campaignId.trim();
}

// Tier 2 — utm_id absent → fall back to utm_campaign name match.
if (order.utmCampaign) {
  return order.utmCampaign.trim().toLowerCase()
       === campaign.campaignName.trim().toLowerCase();
}
return false;
```

### CR5-02: `classifyOrderAttribution_` propagates URIError from a single malformed landing URL

**File:** `Shopify.gs:601-610`

**Issue:** The classifier decodes UTM params from `landing_site` without
protecting against malformed percent-escape sequences:

```js
for (const pair of qs.split('&')) {
  const eq = pair.indexOf('=');
  if (eq < 0) continue;
  const k = decodeURIComponent(pair.slice(0, eq)).toLowerCase();  // throws on bad escape
  const v = decodeURIComponent(pair.slice(eq + 1));               // throws on bad escape
  params[k] = v;
}
```

`decodeURIComponent` throws `URIError: malformed URI sequence` on inputs
like `%E0`, `%FF%FE`, `%`, or any other invalid UTF-8 escape. Bot
traffic, scrapers, and mis-built affiliate links routinely produce
these. The throw propagates up through
`classifyOrderAttribution_` → `getShopifyOrdersAttribution` → the
try/catch in `runUpdateForDate` (DailyUpdate.gs:158-163), which logs
"Orders attribution X failed (non-fatal)" and aborts the entire day —
not just the one bad order. So one bot-generated bad order kills the
whole store's daily attribution write.

**Fix:** Decode per-pair with a try/catch so one bad value drops only
that param, never the whole order:

```js
function safeDecode_(s) {
  try { return decodeURIComponent(s); }
  catch (_) { return s; } // fall back to raw — usually still usable
}
const params = {};
const qIdx = landing.indexOf('?');
if (qIdx >= 0) {
  const qs = landing.slice(qIdx + 1);
  for (const pair of qs.split('&')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const k = safeDecode_(pair.slice(0, eq)).toLowerCase();
    const v = safeDecode_(pair.slice(eq + 1));
    params[k] = v;
  }
}
```

## Warnings

### WR5-01: `runUpdateForDateForStores_` lacks the inter-store throttle that `runUpdateForDate` introduced

**File:** `DailyUpdate.gs:392-414`

**Issue:** `runUpdateForDate` added `Utilities.sleep(1500)` between stores
at line 42 because store 2+3 were timing out from quota saturation
("breathe between stores so the Sheets API short-window quota has time
to recover"). The partial-store helper `runUpdateForDateForStores_`
(invoked by `backfillRangeForStores` for multi-store backfills) was not
updated with the same sleep:

```js
function runUpdateForDateForStores_(dateStr, stores) {
  const ss = ensureSpreadsheet();
  ...
  for (const store of stores) {            // <- no inter-store sleep
    try {
      updateStoreForDate_(ss, store, dateStr, year, month, day, ilsToCad);
    } catch (e) {
      ...
    }
  }
  ...
}
```

The user-facing convenience function `backfillZolUsmileMay1to14()`
(line 417) calls `backfillRangeForStores` for 2 stores × 14 days = 28
store-day runs. Without the throttle, the same quota cascade the daily
run was fixing will reappear on the next time someone runs a
multi-store backfill.

**Fix:** Mirror `runUpdateForDate`'s pattern:

```js
for (let i = 0; i < stores.length; i++) {
  const store = stores[i];
  if (i > 0) Utilities.sleep(1500);
  try {
    updateStoreForDate_(ss, store, dateStr, year, month, day, ilsToCad);
  } catch (e) {
    Logger.log(`ERROR ${store.name} ${dateStr}: ${e && e.stack ? e.stack : e}`);
  }
}
```

### WR5-02: `writeOrdersAttributionForDay` drops rows with malformed dates on every overwrite

**File:** `SheetBuilder.gs:1532-1541` (also `writeCampaignRowsForDay`
line 740-749 and `writeAdsRowsForDay` line 1210-1219 — same pattern)

**Issue:** The idempotent-write filter keeps rows where the date parses
AND is not the current date being written. Rows where the date column
is unparseable (`key === null`) are silently DROPPED:

```js
keptRows = allExisting.filter(r => {
  const v = r[0];
  let key = null;
  if (v instanceof Date && !isNaN(v.getTime())) {
    key = Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  } else if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
    key = v;
  }
  return key !== dateStr && key !== null;  // drops null-key rows
});
```

Scenario: a previous batch was written but the next write crashed mid-
formatting (e.g., quota timeout right after `setValues` but before
`setNumberFormat`). The next successful daily run, writing day X, reads
the malformed rows back, gets `key === null` for them, and removes them
permanently from the sheet. The user has no way to know data was
silently deleted.

**Fix:** Preserve unparseable rows — they may be valid data that just
hasn't been formatted yet:

```js
return key !== dateStr;
// (drop the `key !== null` — rows with bad dates are preserved
// rather than silently destroyed. Operator can manually fix.)
```

Or, more conservatively, also preserve a row when the date column is
non-empty but unparseable — only drop rows that are entirely blank.

### WR5-03: `analyzeAttributionForAdSet` / `analyzeAttributionForAd` callers never pass `dailyMeta`

**File:**
- `dashboard-web/src/components/CampaignDrawer.tsx:1012-1024`
  (`analyzeAttributionForAdSet`)
- `dashboard-web/src/components/AdsDrawer.tsx:378-390`
  (`analyzeAttributionForAd`)

**Issue:** Both `analyzeAttributionForAdSet` and `analyzeAttributionForAd`
accept an optional `dailyMeta?: Array<{date; value}>` argument. The
campaign-level call site (CampaignsTable.tsx:638-668) builds and passes
this series. The ad-set and ad call sites do NOT — they omit it:

```tsx
// CampaignDrawer.tsx:1012-1024 — ad-set call
const adsetAttr = analyzeAttributionForAdSet(
  { adSetId: a.id, ..., metaClaim: a.value, spend: a.spend },
  ordersAttrData?.rows ?? [],
  rows.reduce((min, r) => ..., rows[0]?.date ?? ''),
  rows.reduce((max, r) => ..., rows[0]?.date ?? ''),
  // <- no 5th arg
);
```

Consequence: inside `buildAnalysis`, `computeWindowStability` receives
empty `dailyMeta`, so its `for (const p of dailyMetaSeries)` adds
nothing to the buckets, every bucket has `meta=0`, the
`filter(b => b.meta > 0)` removes them all, and the function returns
null. `detectOutlierDays` likewise receives an empty array and returns
[]. So the "volatile → downgrade trust" path (buildAnalysis.ts:680-685)
never fires for ad-sets or ads. The advertised multi-window stability
analysis is silently inert at those two levels.

**Fix:** Build the daily Meta series per ad-set / ad just like
CampaignsTable does for campaigns, and pass it through:

```tsx
// In CampaignDrawer's ad-set table render:
const adsetDailyMeta = useMemo(() => {
  const m = new Map<string, number>();
  for (const r of rows) {
    if (r.adSetId !== a.id) continue;
    m.set(r.date, (m.get(r.date) ?? 0) + r.conversionValue);
  }
  return Array.from(m, ([date, value]) => ({ date, value }));
}, [rows, a.id]);
// Then pass adsetDailyMeta as the 5th arg.
```

(Note: this also pulls the math out of the per-render inline IIFE — see
IN5-03 below.)

### WR5-04: Bayesian CI renders misleadingly-precise interval when all matched orders have identical AOV

**File:** `dashboard-web/src/lib/attributionAnalysis.ts:209-225` (also
mirrored at `buildAnalysis` line 617-630)

**Issue:** When `deterministicOrders >= 3` and all matched orders have
identical `totalCad` (e.g., a single-SKU subscription store where every
order is $29.99), variance = 0, stdDev = 0, stderrAov = 0, and the
interval collapses to a degenerate point:

```ts
const variance = aovs.reduce((s, x) => s + (x - meanAov) ** 2, 0) / aovs.length;
const stdDev = Math.sqrt(variance); // 0
const stderrAov = stdDev / Math.sqrt(aovs.length); // 0
const revLow = Math.max(0, (meanAov - 1.96 * stderrAov) * aovs.length);
// revLow === revHigh === meanAov * N
roasInterval = { low: ..., mid: ..., high: ... }; // all three identical
```

Rendered as "טווח 95%: 2.30 – 2.30", which falsely implies the CI is
infinitely precise when in reality the underlying sample has zero
observed variance (more samples could still introduce dispersion). The
operator gets a misleading "high precision" signal from a tiny sample.

**Fix:** Either skip emitting the interval when variance is zero (treat
as "not enough info"), or apply a small finite-sample correction (e.g.,
clamp stderr to `meanAov / sqrt(N) × small constant` to acknowledge
sampling uncertainty even with observed variance = 0):

```ts
if (variance === 0) {
  // Don't pretend we have a precise interval on a homogeneous sample.
  roasInterval = null;
} else {
  ...existing code...
}
```

### WR5-05: `OrdersAttributionResponse` type-vs-runtime drift on the error path

**File:** `dashboard-web/src/app/api/orders-attribution/route.ts:8-30`

**Issue:** The declared response type promises both `rows` and
`lastUpdated`:

```ts
export type OrdersAttributionResponse = {
  rows: OrderAttributionRow[];
  lastUpdated: string;
};
```

But the catch path at line 29 returns a different shape:

```ts
return NextResponse.json({ rows: [], error: message }, { status: 200 });
```

That object satisfies `{ rows: [] }` but is missing the required
`lastUpdated`. Today's consumers (CampaignsTable, CampaignDrawer,
AdsDrawer) only read `.rows`, so this is silent. But the next consumer
who legitimately reads `data?.lastUpdated` to render "synced N minutes
ago" will get `undefined` (and the corresponding `formatDate(undefined)`
or `new Date(undefined)` runtime error) only when the upstream Sheets
call fails — a hard-to-reproduce edge case.

**Fix:** Make the error path satisfy the type:

```ts
return NextResponse.json(
  { rows: [], lastUpdated: new Date().toISOString(), error: message } satisfies OrdersAttributionResponse & { error: string },
  { status: 200 },
);
```

Add `error?: string` to `OrdersAttributionResponse` if you want it
typed. Either way: the response shape and the declared type need to
agree.

## Info

### IN5-01: `analyzeAttribution` called inside `.map(...)` in JSX on every render

**File:**
- `dashboard-web/src/components/CampaignsTable.tsx:656-669` (inside
  useMemo so cheap; OK)
- `dashboard-web/src/components/CampaignDrawer.tsx:1011-1024` (inside
  render-time IIFE per ad-set row)
- `dashboard-web/src/components/AdsDrawer.tsx:378-390` (inside
  render-time IIFE per ad row)

**Issue:** The campaign-level call is inside `trueRevenueByKey =
useMemo(...)` and so only re-runs when deps change. But the ad-set and
ad calls live inside `<td>{(() => { ... analyzeAttributionForAdSet ...
})()}</td>` — they execute on every render of the drawer, for every
row, even when only an unrelated state (e.g., sort dir) changes. For a
campaign with 20 ad-sets and the orders-attribution table holding
~2000 rows, each render walks the full orders array 20× × O(N) filter.

This is a performance concern flagged as Info per v1 scope; calling out
because the analyzer has Bayesian-CI computation, window stability
bucketing, and outlier z-score loops — not free.

**Fix (later):** Compute `Map<adSetId, AttributionAnalysis>` in a
single `useMemo` over the drawer's rows, then look up per cell in the
table render. Same pattern as `trueRevenueByKey` in CampaignsTable.

### IN5-02: `detectOutlierDays` never fires for ranges of 14 days or fewer

**File:** `dashboard-web/src/lib/attributionAnalysis.ts:445-466`

**Issue:** The loop starts at `i = LOOKBACK` (= 14) and runs while
`i < sorted.length`. With a 14-day range (typical "last 14 days"
default), `sorted.length === 14` → `14 < 14` is false → loop doesn't
run → empty array always. The dashboard's outlier-detection capability
is effectively gated on the user manually picking a 15+ day range.

The behaviour is technically correct — you need at least 14 trailing
days for a meaningful baseline. But the docstring and tooltip don't
mention the gating, so users see "0 ימי spike" and infer "no outliers
exist" rather than "the algorithm needs more data". Worth either
documenting clearly in the UI when the range is too short, or relaxing
the requirement to (e.g.) `LOOKBACK = 7` for short ranges with weaker
guarantees.

**Fix:** At minimum, surface the "insufficient data" state in the UI
instead of silently rendering zero outliers. Optionally, support a
sliding `LOOKBACK = Math.min(14, Math.floor(series.length / 2))`.

### IN5-03: `computeWindowStability` discards the tail when `totalDays % 7 !== 0`

**File:** `dashboard-web/src/lib/attributionAnalysis.ts:394-409`

**Issue:** The function buckets into exactly `Math.floor(totalDays /
7)` 7-day windows. A 20-day range becomes 2 buckets (14 days), days
15-20 are discarded. A 28-day range becomes 4 buckets fully — no loss.
The comment "Bucket the range into consecutive 7-day windows" doesn't
hint at the truncation.

Days are dropped silently from `coverages`, which can flip a stable-but-
nearly-fully-covered range into a noisier-looking one if the dropped
tail happened to be quiet. Low impact in practice but worth
acknowledging or fixing.

**Fix:** Either include a partial-window bucket (with its own length-
based weight in the σ computation) or document that ranges should
align to multiples of 7.

### IN5-04: `outlierDays` and `windowStability` silently swallow NaN values

**File:** `dashboard-web/src/lib/attributionAnalysis.ts:414-417` and
`445-465`

**Issue:** A NaN `value` in `dailyMetaSeries` is silently filtered by
later `> 0` / `> 2.5` checks rather than rejected explicitly:

```ts
for (const p of dailyMetaSeries) {
  const i = bucketIdx(p.date);
  if (i >= 0) buckets[i].meta += p.value;  // NaN propagates here
}
// ...later: coverages = buckets.filter(b => b.meta > 0)  // NaN > 0 === false
```

Currently `coverages` excludes NaN buckets — so a bug upstream where
`conversionValue` ends up NaN (e.g., divide-by-zero in a custom metric)
silently invalidates that whole window's stability signal. Defensive
but fragile.

**Fix:** Validate `p.value` is a finite number when consuming the
series; skip non-finite entries explicitly:

```ts
for (const p of dailyMetaSeries) {
  if (!Number.isFinite(p.value)) continue;
  const i = bucketIdx(p.date);
  if (i >= 0) buckets[i].meta += p.value;
}
```

### IN5-05: `params[name]` lookup may collide with Object.prototype keys

**File:** `Shopify.gs:611-616`

**Issue:** The `params` object is `const params = {}` — a plain object
with `Object.prototype` in its chain. The note-attributes loop does
`if (!params[name]) params[name] = ...`. If a Shopify order has a
`note_attribute` whose `name` lowercases to `"hasownproperty"`,
`"tostring"`, etc., `params[name]` returns the inherited function and
`!params[name]` is false → the attribute is silently ignored.

The reverse (prototype pollution) is mitigated by the value coercion
to `String(...)` — assigning a string to `__proto__` is a no-op in
V8. So no security exposure. But the defensive cost is small:

**Fix (defensive):** Use a null-prototype object so only own-properties
are checked:

```js
const params = Object.create(null);
```

This also slightly improves the `params[k] = v` write path (no
prototype walk).

### IN5-06: `parseSource` rejects non-canonical strings (including future additions)

**File:** `dashboard-web/src/lib/ordersAttribution.ts:99-106`

**Issue:** The whitelist of accepted source strings is hardcoded:

```ts
const valid: OrderSource[] = [
  'meta-paid', 'google-paid', 'meta-organic', 'google-organic',
  'email', 'other-paid', 'other-referral', 'direct',
];
```

If Apps Script's `classifyOrderAttribution_` adds a new bucket (e.g.,
'tiktok-paid' as the prompt hints is planned), the parser silently
coerces it to `''` (empty string). The downstream consumers
(`ordersForPlatform`, `orderMatchesCampaign`) don't iterate sources by
name, so this likely doesn't BREAK anything — but it does mean the
dashboard becomes blind to whatever new category Apps Script adds
until the type union is updated in lockstep.

**Fix:** Document the contract (e.g., as a `SOURCE_KINDS` constant
exported from one module and imported by the other) so changes ripple
cleanly. Or relax `parseSource` to accept any non-empty string and
type the field as a wider union.

---

_Reviewed: 2026-05-18_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
