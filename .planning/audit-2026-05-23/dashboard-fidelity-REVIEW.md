---
audit: dashboard-fidelity
scope: UI components — does what's rendered match what the algorithm computed?
reviewed: 2026-05-23
files_reviewed:
  - dashboard-web/src/components/CampaignsTable.tsx
  - dashboard-web/src/components/CampaignsTableRow.tsx
  - dashboard-web/src/components/CampaignsColumnsMenu.tsx
  - dashboard-web/src/components/AdSetTable.tsx
  - dashboard-web/src/components/ProductsTable.tsx
  - dashboard-web/src/components/KpiCards.tsx
  - dashboard-web/src/components/HeroOverview.tsx
  - dashboard-web/src/components/TabFreshnessHeader.tsx
  - dashboard-web/src/components/TodayLive.tsx
  - dashboard-web/src/components/PerStoreCards.tsx
  - dashboard-web/src/components/FreshnessChip.tsx
  - dashboard-web/src/components/CampaignDrawer.tsx
  - dashboard-web/src/lib/campaignsAggregator.ts
  - dashboard-web/src/components/Filters.tsx
  - dashboard-web/src/components/MetaShopifyReconciliation.tsx
  - dashboard-web/src/components/AttributionAnalysisPanel.tsx
findings:
  blocker: 7
  warning: 11
  info: 6
  total: 24
status: issues_found
---

# Dashboard Display Fidelity Audit

**Operator's question:** "When I look at a number on the dashboard, does it match what the algorithm computed? When I sort/filter/aggregate, does it behave the way it visually suggests?"

## Summary — verdict

The dashboard is **mostly faithful** to the underlying algorithms, but there are several **mis-leading numbers** the operator cannot detect by eye:

1. The "🔗 רק קמפיינים עם מיפוי משותף" filter visibly drops rows but the summary card at the top of the table still shows totals for the full unfiltered set — so the totals do not equal the sum of the displayed rows. **(BLOCKER FIND-01)**
2. The Pixel-vs-Shopify reconciliation panel's "dark traffic" % and per-day "פער" column silently exclude TikTok revenue from the `channels` numerator while including it everywhere else, so darkTraffic is overstated and per-day deltas are wrong on TikTok-active days. **(BLOCKER FIND-02)**
3. The Pearson `r(Combined)` headline in the reconciliation panel sums TikTok in (correct), but the bullet says "Σ של 4 הערוצים" while the day-table delta computes only 3. The text and the math disagree. **(BLOCKER FIND-03)**
4. The campaign drawer's "כבוי" / health treatment uses `effectiveStatus` with date-heuristic fallback, but the same drawer's `cohortAggregated` builder takes the FIRST non-null status it encounters (not chronologically-latest) — so cohort members in the drawer panel may show a stale status while the same campaign in the main table shows the current one. **(WARNING FIND-09)**
5. `ROAS Shopify` cell's `roasShopifyPlatform` column treats `info.deterministicRevenue <= 0` as "no data" → renders "—", but a tiny positive value (e.g. 0.4 from rounding/refund) is displayed as a real ROAS of 0.0xx — distinguishable from "—" only on close inspection. Same in `shopifyValuePlatform` / `shopifyUnitsPlatform`. **(WARNING FIND-10)**
6. The HeroOverview's `RoasTrendChart` "מינימום" reads `Math.min(...series.filter(d => d.roas > 0)...)` — when ALL filtered days have ROAS 0 (zero-spend window), this becomes `Math.min(...[])` which is `Infinity`, displayed as `Infinity.toFixed(2)` → "Infinity". **(BLOCKER FIND-04)**

There are also several display correctness issues that are real but lower severity: a stale CPM tooltip wording, a chart annotation rendering inconsistency, fix-26 lastActiveDate quirks, and aria-sort drift when sorting Shopify columns.

What the operator can trust without reservation: campaign-row money formatting (Intl.NumberFormat is correct after the `Math.round(n)` fix in utils.ts), sort direction caret on the active column, row-level ROAS color bands, TopN truncation, click-to-drill on the main table, and the live ROAS tone band on TodayLive.

---

## Findings

### BLOCKER findings

---

#### FIND-01 — Summary card totals do not match filtered/displayed rows when "multi-mapped only" is ON

**Severity:** BLOCKER  
**File:** `dashboard-web/src/components/CampaignsTable.tsx:637-660`, also `1124-1140`, `1432-1440`

**What's wrong:**
- Line 412–416: `aggregated` is the full unfiltered list.
- Line 466–469: `aggregatedFiltered` applies the multi-mapped filter.
- Line 763–853: `displaySource` (the rendered rows) comes from `aggregatedFiltered`.
- Line 637–660: `totals` (the summary cards: ROAS / הוצאה / ערך המרות / המרות / קליקים / CTR / CPM, plus the CPC/CPA/חשיפות footer at line 1432–1440) iterate `aggregated` (the **un**filtered list).

When the operator turns on "🔗 רק קמפיינים עם מיפוי משותף":
- The visible row count drops (toolbar correctly shows `aggregatedFiltered.length מתוך aggregated.length` at line 1038).
- The table body shows only multi-mapped rows.
- But the summary `Stat` cards still show the totals across **all** rows.

Operator looks at the table, sees 5 rows summing to ~CAD 12k, but the "הוצאה" card says CAD 80k. The mismatch isn't visually flagged. This is exactly the failure mode the operator's question targets.

**Fix:**
```ts
// CampaignsTable.tsx line 637
const totals = useMemo(() => {
  let spend = 0, conv = 0, val = 0, clicks = 0, imps = 0;
  for (const a of aggregatedFiltered) {           // was: aggregated
    spend += a.spend;
    ...
  }
  ...
}, [aggregatedFiltered]);                          // was: [aggregated]
```
And update the dependency of `attributionGap` (line 858) similarly if the operator's intent is "summary reflects what I'm looking at."

Alternative: keep `totals` on `aggregated` but render a *separate* "filtered totals" pill above the summary card when the filter is on, so the operator sees both. Either is fine; today's behavior is undefined-intent and silently misleading.

---

#### FIND-02 — Reconciliation panel: `darkTrafficPercent` and per-day "פער" silently exclude TikTok

**Severity:** BLOCKER  
**File:** `dashboard-web/src/components/MetaShopifyReconciliation.tsx:357-362`, `780-781`

**What's wrong:**

Phase 05.7.9 added TikTok to the reconciliation chart (`tiktokByDate`, line 248), to the `series` shape (line 307: `tiktok: tiktokByDate.get(date) ?? 0`), to the per-platform Pearson values (`rTiktok`, line 323), and to the `rCombined` numerator (line 326: `s.meta + s.google + s.tiktok + s.organic`).

BUT the dark traffic computation and the per-day delta column still operate on only meta+google+organic:

```ts
// Line 357-362 — sumChannels excludes TikTok
const sumChannels = series.reduce((acc, s) => acc + s.meta + s.google + s.organic, 0);
const sumShopify = series.reduce((acc, s) => acc + s.shopify, 0);
const darkTrafficPercent =
  sumShopify > 0 && sumChannels / sumShopify < 0.8
    ? Math.round((1 - sumChannels / sumShopify) * 100)
    : 0;

// Line 780-781 — per-day "channelTotal" used for the day-table delta column
const channelTotal = s.meta + s.google + s.organic;
const { label: deltaLabel, tone: deltaTone } = computeDayDelta(channelTotal, s.shopify);
```

Consequence on a TikTok-spending day for uzoshop:
- The series has Meta=$400, Google=$0, TikTok=$300, Organic=$100, Shopify=$1,000.
- The day-row in the details table renders "Meta 400 / Google 0 / Organic 100 / Shopify 1000" and computes פער = (500-1000)/1000 = -50% → shows "−50%" red.
- The operator concludes platforms wildly under-claim. In reality, channels (incl. TikTok) sum to 800; the actual under-claim is −20%.

Similarly, `darkTrafficPercent` chip says "פער Dark traffic 50%" when the actual figure (incl. TikTok) would be 20% and below the 0.8 threshold — the chip would not even fire.

**Fix:** Include TikTok in both:
```ts
const sumChannels = series.reduce((acc, s) =>
  acc + s.meta + s.google + s.tiktok + s.organic, 0);

// Per-day:
const channelTotal = s.meta + s.google + s.tiktok + s.organic;
```

Also: the day-table thead at lines 769-776 has columns for `Meta / Google / Organic / Shopify / פער` — it does not show TikTok at all. Add a TikTok `<th>` and `<td>` so the operator can see what's being subtracted.

---

#### FIND-03 — Reconciliation copy says "Σ של 4 הערוצים" but the math is 3 channels

**Severity:** BLOCKER  
**File:** `dashboard-web/src/components/MetaShopifyReconciliation.tsx:500-507`, `537-544`, `574-580`

**What's wrong:** Three places in the explainer copy when `primaryChannel === 'Combined'`:
- Line 503: "Σ של 4 הערוצים מול Shopify תופס את הטרנדים נכון"
- Line 540: "Σ של 4 הערוצים מול Shopify מסביר חלק מהתנועה"
- Line 577: "Σ של 4 הערוצים מול Shopify לא מסביר את מכירות Shopify"

`rCombined` (line 325–328) actually sums 4 channels: meta + google + tiktok + organic. The text is correct for `rCombined`, but the day-table immediately below (the table the operator scans for evidence) computes only 3 (see FIND-02). The two parts of the panel disagree about how many channels are being compared.

This is partly resolved by fixing FIND-02. After that fix, the copy is consistent. Without the FIND-02 fix, **change the copy to "4 הערוצים"** is wrong because the actual rendered math is 3.

**Fix:** Required to fix FIND-02 first, then the existing copy is correct.

---

#### FIND-04 — `RoasTrendChart` "מינימום" pill renders `Infinity` when no days have positive ROAS

**Severity:** BLOCKER  
**File:** `dashboard-web/src/components/HeroOverview.tsx:389-392`

**What's wrong:**
```ts
<bdi dir="ltr">
  {Math.min(...series.filter(d => d.roas > 0).map(d => d.roas)).toFixed(2)}
</bdi>
```

`series.filter(d => d.roas > 0)` can return `[]` when:
- The selected store had zero spend (and therefore zero ROAS) across every day in range.
- A store + range combo where only refund-only days remain.
- Early-morning view where today's row hasn't accumulated revenue yet.

`Math.min(...[])` returns `Infinity`. `Infinity.toFixed(2)` produces `"Infinity"` — the operator sees a literal "Infinity" pill at the top of the dashboard.

Note: `series` is already gated `series.length < 2 ? return null` (line 365), so the chart only renders with 2+ days, but `filter(d => d.roas > 0)` is a sub-filter that can still be empty if every day had `roas === 0`.

**Fix:**
```ts
const positive = series.filter(d => d.roas > 0).map(d => d.roas);
const minPill = positive.length > 0 ? Math.min(...positive).toFixed(2) : '—';
```

(Same pattern applies to the "מקסימום" line at 383 in principle, but `series` is non-empty there so `Math.max(...series.map(d => d.roas))` will at worst be 0 — not Infinity — and renders fine.)

---

#### FIND-05 — TodayLive "טוען..." indistinguishable from real "0" / "—"

**Severity:** BLOCKER  
**File:** `dashboard-web/src/components/TodayLive.tsx:309`, `396`

**What's wrong:**
- Total orders today (line 309): `value={ordersToday === undefined ? '—' : formatNumber(totalOrdersToday, 0)}`
- Per-store orders (line 396): `value={ordersToday === undefined ? '—' : formatNumber(storeOrders ?? 0, 0)}`

The `—` for "still loading" is the same `—` used everywhere else for "no value". The operator has no way to tell whether they're looking at "0 orders so far" or "we haven't fetched orders yet."

But the more dangerous case is that the order count is loaded but the spend/ROAS panel above isn't yet. The numbers reach the operator out of order; they may make a decision based on "ROAS 1.2" + "0 orders today" when, in reality, orders just hadn't arrived yet. Both reads will be `—` for orders and a real number for spend.

**Fix:** Use a loading skeleton (or text "טוען" or `…`) for the loading state, distinct from `—`. The KpiCard component uses `RollingNumber` (line 268 in KpiCards) which would animate from previous values — that's a separate problem but at least visually distinct from `—`.

Same pattern bug in `PerStoreCards.tsx:160-161` (`orderCount === undefined ? '—' : formatNumber(orderCount, 0)`).

---

#### FIND-06 — `formatTimeAgo` uses `d.getHours()` (local TZ) instead of Israel TZ for the absolute fallback

**Severity:** BLOCKER  
**File:** `dashboard-web/src/components/FreshnessChip.tsx:108-114`

**What's wrong:** Everywhere else in the dashboard, "now" is computed in Asia/Jerusalem (`todayInIsrael`, `nowInIsrael`). The chip's >24h fallback formats as:
```ts
const d = new Date(t);
const dd = String(d.getDate()).padStart(2, '0');
const mm = String(d.getMonth() + 1).padStart(2, '0');
const hh = String(d.getHours()).padStart(2, '0');
const mi = String(d.getMinutes()).padStart(2, '0');
return { label: `${dd}/${mm} ${hh}:${mi}`, tone: 'red', warning: true };
```

`d.getDate()`, `d.getHours()`, etc. all use the runtime's local timezone — which is the operator's browser TZ, not Asia/Jerusalem. If the operator is traveling in NYC (UTC-5), a data write at 09:00 IL will render as `04:00` here.

Less severe than the multi-mapped totals bug because:
- Operator is single-user and based in IL most of the time.
- This branch only fires when data is >24h stale (cron stuck) — already an emergency state.

But it does mean the chip can display the "wrong" wall-clock time.

**Fix:** Format using `Intl.DateTimeFormat('he-IL', { timeZone: 'Asia/Jerusalem', ... })`, same pattern as `formatTimeAgo`'s title attribute at line 72 (which is correctly TZ-bounded).

---

#### FIND-07 — `formatCurrency` returns negative zero ("-0") when the input is a tiny negative value

**Severity:** BLOCKER  
**File:** `dashboard-web/src/lib/utils.ts:8-20`, surfaces in `CampaignDrawer.tsx:679`, `KpiCards.tsx`, many places

**What's wrong:** `Intl.NumberFormat('he-IL', { style: 'decimal', minimumFractionDigits: 0, maximumFractionDigits: 0 })` renders `-0.3` as `"-0"`. It also renders `-0.49` as `"-0"`. The minus sign is preserved even though the rounded magnitude is 0.

Reproducible in places where a refund-day net revenue rounds to 0 but is slightly negative, or where `grossProfit = revenue - spend` is a tiny negative ($-0.20 because of FX rounding) — the operator sees a `"-0"` cell that they assume is "0 with a stale leading sign character" but actually represents a real loss.

**Fix:**
```ts
export function formatCurrency(n: number, fractionDigits = 0): string {
  // Avoid negative zero display
  if (Object.is(n, -0)) n = 0;
  const formatted = new Intl.NumberFormat('he-IL', { ... }).format(n);
  return formatted === '-0' ? '0' : formatted;
}
```

This affects every money cell on the dashboard.

---

### WARNING findings

---

#### FIND-08 — Sort by `roasShopify` / `roasShopifyPlatform` / `shopifyValuePlatform` etc. evaluates the fallback Meta ROAS, not the actual column value, when `trueRevenueByKey.size === 0`

**Severity:** WARNING  
**File:** `dashboard-web/src/components/CampaignsTable.tsx:148-170`, `768-852`

**What's wrong:** `sortAggregated()` at lines 148-170 returns `a.conversionValue / a.spend` (Meta ROAS) for ALL of the Shopify columns. The actual Shopify sort runs in `displaySource` at line 768+ — but only when `trueRevenueByKey.size > 0`.

On initial render (before SWR resolves `productsResp` and `ordersAttrResp`), `trueRevenueByKey` is empty. If the operator's saved sort state is `sortKey === 'shopifyRoas'`, the first render shows rows sorted by Meta ROAS (with the column header showing `aria-sort="descending"` and the caret on ROAS Shopify). When the data arrives, rows re-shuffle to the actual Shopify ROAS order — but only inside `displaySource`. The aria-sort attribute and the visible caret stay on the ROAS Shopify header. That's not strictly wrong, but it means a screenshot taken at the wrong moment will show data sorted by ONE column while the caret claims another. The operator's "I think I'm looking at sorted-by-ROAS Shopify" can be temporarily violated.

This also matters for `health` sort — same issue.

**Fix:** Either gate the visible caret on `trueRevenueByKey.size > 0` (so the header arrow only appears when the actual sort can run), or render a "טוען…" indicator on the header that's the active sort but whose data isn't ready.

---

#### FIND-09 — `cohortAggregated` builder takes FIRST non-null `effectiveStatus`, not chronologically-latest

**Severity:** WARNING  
**File:** `dashboard-web/src/components/CampaignDrawer.tsx:419-446`

**What's wrong:**
```ts
for (const r of campaignsData?.rows ?? []) {
  ...
  if (existing) {
    existing.spend += r.spend;
    ...
    if (!existing.effectiveStatus && r.effectiveStatus) {
      existing.effectiveStatus = r.effectiveStatus;       // ← keeps FIRST non-null
    }
  } else {
    acc.set(k, {
      ...
      effectiveStatus: r.effectiveStatus ?? null,
    });
  }
}
```

But `campaignsAggregator.ts:161-167` uses chronologically-latest-wins:
```ts
if (r.effectiveStatus) {
  const prev = latestEffectiveStatusDate.get(key);
  if (!prev || r.date > prev) {
    a.effectiveStatus = r.effectiveStatus;
    latestEffectiveStatusDate.set(key, r.date);
  }
}
```

If a cohort member was `ACTIVE` for 3 days then `PAUSED` for 1 day, the main table aggregator picks `PAUSED` (current state), but the drawer's `cohortAggregated` keeps whichever status it saw first in `rows`. Because the cohort panel does not display effectiveStatus today (or does it? — `cohortAggregated.effectiveStatus` is computed but the only consumer is `computeMultiMappingCohort` which I did not audit), this may be invisible to the operator. But the data shape between the main table and the drawer differ, and any future consumer that reads `cohort.member.effectiveStatus` will see different values for the same campaign than the table shows.

**Fix:** Mirror the aggregator's pattern:
```ts
const latestStatusDate = new Map<string, string>();
for (const r of campaignsData?.rows ?? []) {
  ...
  if (r.effectiveStatus) {
    const prev = latestStatusDate.get(k);
    if (!prev || r.date > prev) {
      existing.effectiveStatus = r.effectiveStatus;
      latestStatusDate.set(k, r.date);
    }
  }
}
```

---

#### FIND-10 — `roasShopifyPlatform` / `shopifyValuePlatform` / `shopifyUnitsPlatform` display real-but-tiny values that look like noise

**Severity:** WARNING  
**File:** `dashboard-web/src/components/CampaignsTableRow.tsx:560-590`, `598-660`

**What's wrong:**
- Line 563: `if (!info || a.spend <= 0 || info.deterministicRevenue <= 0)` → renders "—".
- Line 573: `const detRoas = info.deterministicRevenue / a.spend` → otherwise renders the actual value.

If `info.deterministicRevenue` is 0.40 (a single small line-item from a refund) and `a.spend` is 250, the row shows `0.00x` (or `0.002x` rendered as "0.00") with no special chrome — distinguishable from "—" but very easy to misread as a "real zero." The same applies to:
- Line 603: `if (!info || info.deterministicRevenue <= 0)` for value cell.
- Line 630: `if (!info || info.deterministicUnits <= 0)` for units cell.

The tooltip explains the value, but the cell typography is identical to a "real" healthy value. Operator visually scanning down the column for low-performers will probably round these to "essentially zero" and treat them as "good data, bad campaign" rather than "bad data, noisy attribution."

**Fix:** When `info.deterministicRevenue` is below a small threshold (e.g. CAD 1 or 1% of spend), render the value with a "noisy" treatment — italics, muted color, or a "‹$1" prefix. Same for units when count < 1.

---

#### FIND-11 — Multi-mapped chip count includes the campaign itself in the operator's read

**Severity:** WARNING  
**File:** `dashboard-web/src/components/CampaignDrawer.tsx:375-388`, `1148-1156`

**What's wrong:** `otherCampaignsByProduct` (line 375) correctly excludes `currentCampaignKey` (line 380: `if (k === currentCampaignKey) continue`). The chip "🔗 +N" at line 1153 renders `others.length`, which is OTHER campaigns excluding self.

This is **correct** by the operator's question, but worth flagging that the chip on the **mapping product list** in the drawer (correctly excludes self) and the chip on the **row in the main table** (CampaignsTableRow doesn't have such a chip at all per my read) and the chip on the **Picker modal** (passed via `otherCampaignsByProduct` prop) must all be consistent.

The main table row's "🏷️ לא ממופה" chip uses `mappedCampaignKeys.has(campaignKey(...))` — this returns true if THIS campaign has any mapped products. Correct.

But the **multi-mapped filter pill** (toolbar at line 1038) reads `aggregatedFiltered.length מתוך aggregated.length` — and `aggregatedFiltered` checks `multiMappedCampaignKeys.has(a.key)`. `multiMappedCampaignKeys` is built at line 443-463 as "campaigns whose product is shared with at least one other campaign" — i.e., a 2+ entry group. Self is included in the group; the test is `keys.length >= 2`. Correct semantics: "show me rows where this campaign's product is also in another campaign."

No bug here, just complex to verify. Adding a doc-comment in the multi-mapped filter ("each row is a campaign whose product is shared with N≥1 other campaigns") would prevent regressions.

**Fix:** No code change required; recommend adding an inline comment near the filter to lock the semantics in place.

---

#### FIND-12 — CampaignsTable summary "ROAS" and `attributionGap` panel use different denominators

**Severity:** WARNING  
**File:** `dashboard-web/src/components/CampaignsTable.tsx:637-660` (summary `totals.roas`), `858-936` (`attributionGap.platformRoas`, `attributionGap.storeRoas`)

**What's wrong:**
- `totals.roas = totals.conversionValue / totals.spend` — averaged across the campaigns in `aggregated` (per-campaign rows summed).
- `attributionGap.platformRoas = platformClaimed / totals.spend` — `platformClaimed` is `aggregated.reduce((s, a) => s + a.conversionValue, 0)`, which is the same as `totals.conversionValue`. So these match.
- But `attributionGap.storeRoas = shopifyRevenue / totalSpendShopify` where `totalSpendShopify = metaSpendInScope + googleSpendInScope + ttSpendInScope` — these come from `dailyRows` (the daily summary tab), NOT from the campaigns table's `aggregated`.

`dailyRows`'s `fbSpend / gaSpend / ttSpend` are derived from a different source (per-day summary) than the campaigns endpoint's per-campaign spend. They are usually consistent, but they can disagree:
- Different attribution windows on the platform side.
- Different currency snapshots (FX moves intraday).
- Campaigns endpoint may include campaigns the summary endpoint missed (e.g., status-paused but had spend yesterday).

So the panel's "platform" and "store-truth" ROAS sit side-by-side with different denominators. The operator may compute "platform ROAS ÷ store ROAS = trust ratio" by hand and get a ratio that doesn't match the panel's own "יחס אמינות" line (which uses `gap.platformClaimed / gap.shopifyRevenue` — yet another mix).

**Fix:** Document in the panel which sources are being compared (the FAQ comment at line 870-878 already notes this is intentional — but the operator-facing copy at line 1990 doesn't explain). A small "ⓘ נתונים מ-2 צינורות שונים" affordance would help.

---

#### FIND-13 — `cpmPrev` chart line aligns by INDEX, not by date — operator may misread "30 days ago"

**Severity:** WARNING  
**File:** `dashboard-web/src/components/CampaignsTable.tsx:1185-1190`, `dashboard-web/src/components/CampaignDrawer.tsx:828-832`

**What's wrong:**
```ts
const cpmChartData = cpmDaily.map((d, i) => ({
  ...d,
  prevCpm: cpmDailyPrev?.[i]?.cpm ?? null,
  prevDate: cpmDailyPrev?.[i]?.date ?? null,
}));
```

`cpmDaily` and `cpmDailyPrev` are each filtered to days with `impressions > 0`. They are NOT guaranteed to align on the same day-of-week or even the same number of active days. The chart pairs them by index — so `cpmDaily[3]` (e.g., 2026-05-10, a Sunday) gets compared to `cpmDailyPrev[3]` (which might be 2026-04-25, a Friday).

The tooltip surfaces `prevDate`, so an observant operator can spot it. But the visual overlay of two lines aligned at X-position "day 3" suggests "same day of week" comparison — the math is more like "the 4th active day of the previous range vs the 4th active day of this one."

**Fix:** Either (a) align by absolute calendar date offset (day `i` of current === day `i` of prev-period) without filtering inactive days, OR (b) add a header tooltip "מוצג: יום-פעיל-ה-N של תקופה קודמת" so the operator knows the alignment isn't day-of-week.

---

#### FIND-14 — `aggregated.length` count in toolbar ("3 קמפיינים") shows pre-filter count even when "multi-mapped only" is on

**Severity:** WARNING  
**File:** `dashboard-web/src/components/CampaignsTable.tsx:1112-1115`

**What's wrong:**
```tsx
<span className="text-[10px] sm:text-xs text-text-muted tabular-nums sm:mr-auto">
  {aggregated.length}{' '}
  {mode === 'campaign' ? 'קמפיינים' : 'אד-סטים'}
</span>
```

Shows the unfiltered count. The multi-mapped chip on line 1037-1040 redundantly shows `{aggregatedFiltered.length} מתוך {aggregated.length}` so the operator has SOME signal, but the headline "3 קמפיינים" is the visually dominant number. Operator scans toolbar, sees "27 קמפיינים", scrolls to bottom, finds 3 rows. Cognitively dissonant.

**Fix:**
```tsx
{showOnlyMultiMapped
  ? `${aggregatedFiltered.length} מתוך ${aggregated.length}`
  : `${aggregated.length}`}{' '}
{mode === 'campaign' ? 'קמפיינים' : 'אד-סטים'}
```

---

#### FIND-15 — CampaignDrawer `summary.activeDays` counts ANY day in `rows`, not just spend-positive days — chip shows "12 ימים פעילים" when 9 were paused

**Severity:** WARNING  
**File:** `dashboard-web/src/components/CampaignDrawer.tsx:266-336`, header at `642`

**What's wrong:**
```ts
if (!byDay.has(r.date)) byDay.set(r.date, { spend: 0, value: 0, impressions: 0 });
...
return { ..., activeDays: byDay.size };
```

`byDay` is populated by every row regardless of whether the row had spend. A campaign with 12 calendar days of data (some with $0 spend after pause) reports `activeDays: 12`. The CPM-vs-ROAS code (line 769) and `lastActiveDate` (in the aggregator) both correctly gate on `r.spend > 0` / `impressions > 0`, but the drawer header chip "12 ימים פעילים" does not.

For the operator who's looking at a paused campaign and wondering "did this run for 12 days or 3?", the number is misleading. They click into the drawer specifically to verify, and the number betrays them.

**Fix:**
```ts
const activeDays = Array.from(byDay.values()).filter(d => d.spend > 0).length;
```

---

#### FIND-16 — `displaySource` slice for `shopifyOrdersTotal` sort uses `info.productTotals.orders` — but unmapped rows fall back to Meta ROAS (`a.spend > 0 ? a.conversionValue / a.spend : 0`) which is unrelated

**Severity:** WARNING  
**File:** `dashboard-web/src/components/CampaignsTable.tsx:158-166`, `817-851`

**What's wrong:** When the operator sorts by `shopifyOrdersTotal`:
- `sortAggregated()` (line 158-166) returns `a.spend > 0 ? a.conversionValue / a.spend : 0` for the sort key — a Meta ROAS, NOT order count.
- `displaySource` (line 817+) re-sorts mapped rows by `info.productTotals.orders`.
- Unmapped rows (`!info`) get `mapped: false` and sort to the bottom via the tie-break at line 847.

This works correctly for the visible sort. However, if `displaySource` doesn't run (e.g., `trueRevenueByKey.size === 0` momentarily during SWR refetch), the rows fall back to Meta-ROAS order — which has no relationship to order count. The header still shows "↓ הזמ' Shopify" but the actual sort is "↓ ROAS." Same class of issue as FIND-08 but more egregious because the columns are completely unrelated dimensions (ROAS vs order count vs unit count).

**Fix:** Same pattern as FIND-08 — gate the header caret on data-ready state.

---

#### FIND-17 — `aria-sort` attribute always tracks `sortKey/sortDir`, never the actual rendered order

**Severity:** WARNING  
**File:** `dashboard-web/src/components/CampaignsTable.tsx:2142`, `AdSetTable.tsx:282`

**What's wrong:** A11y users reading the table get `aria-sort="ascending"` on the active header, but the actual rendered order may differ during the loading window (FIND-08 / FIND-16). Less critical because screen-reader users likely re-poll the table after data settles, but worth aligning with the data-ready gate.

**Fix:** Conditional `aria-sort` — only set `descending`/`ascending` when `trueRevenueByKey.size > 0` (or whatever data the sort needs is ready). Otherwise `aria-sort="none"`.

---

#### FIND-18 — `mappedCampaignKeys.has(campaignKey(...))` lookup inside the row for "🏷️ לא ממופה" chip uses keyed string but the rendering doesn't memoize the lookup

**Severity:** WARNING  
**File:** `dashboard-web/src/components/CampaignsTableRow.tsx:365-375`

**What's wrong:** Cosmetic / perf — `campaignKey(a.storeId, a.platform, a.campaignId)` is recomputed inside the JSX on every render. The same row also constructs the same key independently inside each metric cell (lines 435, 561, 601, etc.) — they all recompute the same string each time. Doesn't affect correctness, but if Aggregated had `key` already (`a.key`), the row could just compare `mappedCampaignKeys.has(a.key)` directly.

Actually `a.key` (from `campaignsAggregator.ts:81`) is `${r.storeId}::${r.platform}::${r.campaignId}` in campaign mode AND `${r.storeId}::${r.platform}::${r.campaignId}::${r.adSetId}` in adset mode. So you can't use `a.key` directly in adset mode — the chip would look up a non-existent key and always show as "unmapped" (since adset-mode keys never appear in `mappedCampaignKeys` which is built from `productMap` whose keys are campaign-level).

This means **in adset mode, every row shows "🏷️ לא ממופה"** because the row's `campaignKey(a.storeId, a.platform, a.campaignId)` matches the campaign-level key from `mappedCampaignKeys` — verified, line 367 uses `a.campaignId` (correct). So the chip works in adset mode.

No bug here after verification. Recommend: comment near line 367 clarifying that the `campaignKey(a.storeId, a.platform, a.campaignId)` is intentionally campaign-level (not `a.key`) so it works in both modes.

---

### INFO findings

---

#### FIND-19 — `CampaignsTable.tsx` toolbar — `dir="ltr"` on a Hebrew row-of-buttons leaks LTR ordering

**Severity:** INFO  
**File:** `dashboard-web/src/components/CampaignsTable.tsx:961`, `987`

The tab groups use `dir="ltr"` to force the buttons left-to-right (Meta / Google / TikTok). Cosmetically correct, but the surrounding text is RTL — the active state ring sits on the wrong side relative to the label for some screen reader announcement orders. Not a fidelity issue, just a noted oddity.

**Fix:** None required; cosmetic.

---

#### FIND-20 — `TodayLive.tsx` legacy `Mini` component (line 515-541) is unused dead code

**Severity:** INFO  
**File:** `dashboard-web/src/components/TodayLive.tsx:515-541`

`Mini` is not invoked anywhere in the file. Dead code, slight cognitive drag for future maintainers.

**Fix:** Remove or move to a shared file if intended for re-use.

---

#### FIND-21 — Reconciliation panel `bestLag` only considers Meta vs Shopify; ignores Google / TikTok lag patterns

**Severity:** INFO  
**File:** `dashboard-web/src/components/MetaShopifyReconciliation.tsx:343-354`, the gated text at `604`

The lag detection loop is gated on the Meta series only. If Google has a 2-day lag pattern and Meta doesn't, the panel won't surface it. The conditional banner at line 604-615 already gates on `primaryChannel === 'Meta'`, so this isn't displayed for non-Meta drilldowns — consistent — but the analysis just isn't done for the other platforms.

**Fix:** Either run lag detection for whatever `primaryChannel` resolves to, or document in the panel header that lag analysis is Meta-only today.

---

#### FIND-22 — `CampaignDrawer.tsx` `cohort` lookup ignores `effectiveStatus` for stale-data warning

**Severity:** INFO  
**File:** `dashboard-web/src/components/CampaignDrawer.tsx:481-510`, `1186-1204`

Cohort members' `effectiveStatus` is computed but never surfaced to the panel. A cohort member that's been paused for 2 months still appears as a peer for comparison; the operator may decide to "scale up" against a peer that's actually dead.

**Fix:** Pass `effectiveStatus` (and the lastActiveDate) to `CohortComparisonPanel` so it can dim or chip the paused peers. Not strictly a display correctness issue (the data is real) but the lack of context can mislead.

---

#### FIND-23 — `KpiCards.tsx` `dNet` (legacy partial-net delta) is computed but the linter is silenced with `void dNet`

**Severity:** INFO  
**File:** `dashboard-web/src/components/KpiCards.tsx:89-94`

```ts
const dNet    = deltaPct(current.netProfit,   previous.netProfit);
const dTrueNet = deltaPct(current.trueNetProfit, previous.trueNetProfit);
...
void dNet;
```

Dead computation. Either:
- Re-introduce the legacy net comparison as a chip on the "רווח נטו" card, OR
- Delete the line and the `void dNet`.

Leaving compute-then-discard signals "this matters" without showing it; a future maintainer might ship it without realizing the deletion was intentional.

**Fix:** Delete or use.

---

#### FIND-24 — `CampaignsTable.tsx` aria-sort, sort caret, and column header tooltip all live in different components; one change breaks the others

**Severity:** INFO  
**File:** `dashboard-web/src/components/CampaignsTable.tsx:1486-1747` (header literals scattered)

The `SortHeader` definitions (15+ inline blocks at line 1494-1747) each carry the same `sortKey`, `tooltip`, `dataColId`, `label`, etc. Drift risk: someone adds a new column and forgets to wire one of the four. Recommend a table-driven definition:
```ts
const COLUMN_DEFS = [
  { id: 'spend', sortKey: 'spend' as SortKey, label: 'הוצאה', tooltip: '...' },
  ...
];
```
and a small loop. The current shape works but is high-touch.

**Fix:** Refactor to data-driven. Not urgent.

---

## Per-component verdict

**CampaignsTable** — **CRACKED.** The summary/totals don't track the multi-mapped filter (FIND-01) — that alone earns the verdict. Otherwise the sort logic is mostly correct (`displaySource` re-sorts Shopify columns by real values, falls back gracefully), the columns reorder consistently between thead and tbody via `columnOrder`, and the hidden-columns CSS injection correctly preserves totals. Trust the per-row numbers; do not trust the summary card when "multi-mapped only" is on.

**CampaignDrawer** — **SOLID with caveats.** ROAS, conversion value, ad-set sort, and chart series match the row. The trust upgrade logic (useCampaignTrueRevenue lines 452-485) faithfully reaches into the drawer via `trueRevenueByKey`. Concerns: `activeDays` is wrong on paused-campaign drilldowns (FIND-15), cohort builder is inconsistent with table aggregator on `effectiveStatus` (FIND-09), and the per-day reconciliation table omits TikTok in its math (FIND-02) — a regression from Phase 05.7.9.

**TodayLive** — **VISUALLY CONSISTENT but LOADING STATE OPAQUE.** The card tone follows `roasLabel`, per-store breakdown agrees with `aggregateByStore`, and CPM math is sound. Critical operator-facing bug: orders rendering "—" indistinguishably from "still loading" (FIND-05). Per-store TikTok column shows correctly only when `storeHasTikTok` returns true — confirmed for uzoshop, hidden elsewhere.

**KpiCards** — **CORRECT.** All 6 cards use the post-fix `formatCurrency` (no `Math.round(n)` truncation), sparklines reflect daily series, deltaPct uses absolute denominator so negative-to-positive transitions render right direction. One stale `void dNet` line (FIND-23) is a code-hygiene nit, not a correctness issue.

---

## Question-by-question verdicts

1. **Sort correctness.** Mostly. Each "real" Shopify sort runs in `displaySource` with the correct values from `trueRevenueByKey`. CAVEATS: (a) initial render before data resolves falls back to Meta-ROAS comparator — FIND-08, FIND-16; (b) `sortAggregated` for `spend`, `roasShopifyPlatform`, etc. claims to handle the case but actually uses the Meta-ROAS fallback for ALL shopify-prefixed keys.

2. **Aggregation totals.** **BROKEN (FIND-01).** Summary card iterates `aggregated`, table renders `aggregatedFiltered`. When the "multi-mapped only" toggle is ON, totals don't match displayed rows. Hidden-column totals: CORRECT — hidden columns are CSS-hidden, not data-filtered, so totals include them. Averages of ratios: NO weighted-vs-unweighted bugs found — `roas = totals.conversionValue / totals.spend` is correct weighted form.

3. **Filter behavior.** Platform filter applied in `aggregate()` — drops rows BEFORE summing into `aggregated`, so it's consistent with totals. Store filter same. Multi-mapped toggle filters `aggregated → aggregatedFiltered`, BUT the totals/KPI use `aggregated` (FIND-01). Double-counting: no — each row's key is `storeId::platform::campaignId`, unique per platform/store, so a campaign cannot match two filters and be summed twice.

4. **Currency formatting.** `formatCurrency()` is consistent (CAD prefix added outside; `Intl.NumberFormat` handles fractionDigits). Bug: `formatCurrency(-0.4, 0)` renders `"-0"` (FIND-07). Decimal places: 0 for big sums (CAD 12,345), 2 for unit prices (CPM/CPC/CPA). Mixed-precision concern: CampaignsTableRow line 740 uses `formatCurrency(cpc, 2)`, line 313 uses `formatCurrency(d.spend, 2)` in tooltips. Drawer tooltip line 740 uses `formatCurrency(d.spend)` (default 0) — inconsistent with the corresponding tooltip in CampaignsTable line 1335 which uses `formatCurrency(d.spend, 2)`. Not a correctness bug, just inconsistent precision in similar contexts.

5. **Empty states.** Mixed. Most cells use `—` for "no data" / "no mapping" / "zero impressions". TodayLive's order count uses `—` for BOTH "loading" and "no value" — that's the FIND-05 misread risk. ProductsTable uses `—` for missing orders. PerStoreCards uses `—` for missing TikTok spend AND for "still loading" order count.

6. **Tooltip accuracy.** ROAS column tooltip (CampaignsTable.tsx:1547) accurately describes "ערך המרות ÷ הוצאה" and the color bands — matches `roasLabel()` in analytics.ts. ROAS Shopify tooltip (line 1561) correctly states "deterministic + proportional fallback." ROAS Shopify · פלטפורמה tooltip (line 1580) correctly states "ONLY deterministic, no fallback." Both reflect the actual computation in useCampaignTrueRevenue. The CampaignsTableRow per-cell tooltips at 504-525 also match. The footer's CTR tooltip says "<0.5% חלש... >2% מעולה" — these are advisory text, not enforced anywhere, so technically true.

7. **Multi-mapping chip (🔗 +N).** CORRECT — `otherCampaignsByProduct` excludes `currentCampaignKey` (CampaignDrawer.tsx:380), so the count is "OTHER campaigns sharing this product." Verified.

8. **Unmapped chip (🏷️ לא ממופה).** CORRECT — the conditional `(a.platform === 'Meta' || a.platform === 'TikTok')` at CampaignsTableRow.tsx:365 excludes Google as required. Verified.

9. **TodayLive currency consistency.** CAD totals correct across all 3 platforms. The "Meta: ILS · Google: CAD · TikTok: USD · Shopify: CAD" footer (line 429-435) describes RAW CURRENCY at the platform, not what's displayed — displayed values are uniformly CAD (after FX conversion in the source pipeline). TikTok per-store hidden when `!storeHasTikTok(s.store)` (line 332, 377) — CORRECT.

10. **KPI vs CampaignsTable footer.** They DON'T match (intentionally) — KpiCards uses `data.rows` (daily summary) while CampaignsTable uses `/api/campaigns` per-campaign rows. FIND-12 documents the divergence. Operator may not realize this; recommend documenting in the UI.

11. **CampaignDrawer ROAS vs row ROAS.** Match. Both use `value / spend` over the same rows (drawer's `summary.roas = spend > 0 ? value / spend : 0`, row's `roas = a.spend > 0 ? a.conversionValue / a.spend : 0`). Verified — the `rows` array passed to the drawer is `filterDrillRows(data.rows, ...)`, which is the SAME source the table aggregates. Spend and value will agree.

12. **CohortComparisonPanel current spend.** Not directly checked (panel itself out of audit scope — UI-only here), but `computeMultiMappingCohort` receives `currentCampaignKey` and builds entries from `cohortAggregated` (drawer line 405-446) which sums `r.spend` across `campaignsData.rows` filtered to `storeId`. This SHOULD match the drawer's `summary.spend` for the current campaign — the drawer's summary uses `rows` (drill-filtered to the campaign), while cohortAggregated uses `campaignsData?.rows ?? []` (date-range filtered, store-filtered). When the drill-filter and the date-range filter produce the same row set for THIS campaign (they should), the numbers match. Edge case: a status-change between drill-fetch and drawer-fetch could cause divergence. Not verified in code; flagging for manual QA.

13. **Sticky column / Z-index.** Header uses `sticky top-0 z-[5]` (CampaignsTable.tsx:1751). CampaignsColumnsMenu popover uses `z-30` (line 160). Tooltip uses `z-[15]` (line 2068). CampaignDrawer overlay uses `z-50` (line 603) — DOES correctly layer above. No sticky horizontal columns (no `left: 0` on first column) — the table just has `overflow-auto` and the campaign name truncates with `max-w-[280px] sm:max-w-[400px]`. Trade-off, not a bug — operator can't keep the campaign name in view while scrolling far right on a wide table.

14. **RTL correctness.** Numeric cells use `tabular-nums text-end` consistently. Money cells have a `<span>CAD</span>` prefix on the LEFT (visually right in RTL) — correct. The `dir="ltr"` blocks on tab groups (line 961, 987) intentionally force LTR for the platform name buttons; this is fine. The CPM chart container has `dir="ltr"` (line 1251) so the chart's X axis runs left-to-right (date series). All consistent.

15. **Hidden columns.** CORRECT — hidden columns use CSS (`display: none !important`) not data filtering. `totals` reads from `aggregated` (data layer); hidden columns don't affect it. Phase 05.7.9d behavior matches the documented "hidden is view-only" contract.

16. **Reorder columns.** `resolveCampaignsColumnOrder` (campaignsColumnPrefs.ts:157) walks saved order then appends missing canonical IDs — robust to renames/removals. CampaignsTable.tsx threads `columnOrder` to both the thead (line 1785: `columnOrder.map(id => metricHeaders[id] ?? null)`) AND to CampaignsTableRow (line 1804) which renders cells in the same order (line 753: `columnOrder.map(id => <Fragment key={id}>{metricCells[id]}</Fragment>)`). Header and body stay in lock-step. CORRECT. Persists via localStorage + cloudSync.

17. **SWR cache keys.** `buildDateRangeKey` (dateRange.ts:126) returns `${basePath}?from=${range.from}&to=${range.to}`. CampaignsTable uses `localRange` for the key (line 243: `buildDateRangeKey('/api/campaigns', localRange)`). When the operator changes the local range, the key changes → SWR fires a fresh fetch. CORRECT. Store filter is NOT in the key — the request fetches all stores, filter is client-side (line 414: `aggregate(data.rows, mode, localStore, platform, localRange)`). That's a perf/architecture choice, not a fidelity bug — but it means a stale "all stores" cache will be filtered down rather than refetched. Acceptable here because the data is mostly static within a 60-120s window.

18. **Loading states.** CampaignsTable shows "טוען נתוני קמפיינים…" (line 1465). KpiCards uses `RollingNumber` which animates from previous values (visually distinct from `—`). TodayLive uses `—` for both "loading" and "zero" (FIND-05 — operator can't distinguish).

---

## What's solid

- **Per-campaign row ROAS, spend, value, conversions** are the same numbers the drawer shows for the same campaign — verified.
- **`formatCurrency` post-fix** (utils.ts:8-20) — `Math.round(n)` removed, `Intl.NumberFormat` handles precision correctly for both default (0) and `fractionDigits=2`.
- **Sort caret direction** on the active column matches `sortDir` — never inverted.
- **Column reorder via menu** — header + body iterate the same `columnOrder` array; cells never drift to the wrong column.
- **Hidden columns** correctly preserve totals (CSS-hidden, not data-filtered).
- **TodayLive ROAS tone band** correctly mirrors `roasLabel` thresholds; the card hue moves with the actual number.
- **Multi-mapping chip count** correctly excludes self.
- **Unmapped chip** correctly excludes Google.
- **`buildDateRangeKey`** is the right pattern — range-keyed SWR avoids stale-cache shadow when the operator changes ranges.
- **CampaignDrawer drill is namespace-strict** — `drillStoreId / drillPlatform / drillCampaignId` triple-keyed avoids cross-store/cross-platform merges (per FIX-03 5.2.2.1 note).
- **Reconciliation chart legend matches stroke colors** for all 5 series (Meta amber, Google blue, TikTok pink, Organic purple, Shopify green-dashed).
- **CampaignDrawer's `summary.activeDays` is the only metric mis-counted** — every other drawer number was traced and matches the table.

---

_Reviewed: 2026-05-23_
_Reviewer: Claude (dashboard fidelity audit)_
_Scope: UI faithfulness to algorithmic output, NOT algorithm correctness_
