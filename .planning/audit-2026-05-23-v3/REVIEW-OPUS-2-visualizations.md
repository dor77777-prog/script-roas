---
phase: audit-2026-05-23-v3 — visualizations & secondary panels (OPUS-2)
reviewed: 2026-05-23T00:00:00Z
depth: deep
files_reviewed: 16
files_reviewed_list:
  - dashboard-web/src/components/RoasChart.tsx
  - dashboard-web/src/components/Sparkline.tsx
  - dashboard-web/src/components/AnnotationsPanel.tsx
  - dashboard-web/src/components/AttributionAnalysisPanel.tsx
  - dashboard-web/src/components/CohortComparisonPanel.tsx
  - dashboard-web/src/components/ProductChannelBreakdown.tsx
  - dashboard-web/src/components/PnLBreakdown.tsx
  - dashboard-web/src/components/RefundIndicator.tsx
  - dashboard-web/src/components/SectionIntro.tsx
  - dashboard-web/src/components/RollingNumber.tsx
  - dashboard-web/src/components/MetricHelp.tsx
  - dashboard-web/src/components/WhatsWorking.tsx
  - dashboard-web/src/components/DetailTable.tsx
  - dashboard-web/src/components/CollapsibleSection.tsx
  - dashboard-web/src/components/CampaignsColumnsMenu.tsx
  - dashboard-web/src/lib/chartColors.ts
  - dashboard-web/src/lib/sparklineGeometry.ts (cross-file dependency, audited)
  - dashboard-web/src/lib/campaignsColumnPrefs.ts (cross-file dependency, audited)
  - dashboard-web/src/lib/attributionAnalysis.ts (cross-file dependency, audited)
findings:
  critical: 3
  high: 5
  medium: 7
  low: 4
  total: 19
status: issues_found
---

# OPUS-2 — Visualizations & Secondary Panels (3rd-pass audit)

## Summary Table

| ID | Sev | File | Line | One-line |
|----|-----|------|------|----------|
| CR-01 | CRITICAL | `ProductChannelBreakdown.tsx` | 41-49, 96-100 | Channel breakdown bar double-counts orders with stale `fbclidPresent` + non-meta `source`; segments sum to >100% of unique orders |
| CR-02 | CRITICAL | `RoasChart.tsx` | 50-54 + analytics.ts:232-257 | RoasChart X-axis is categorical over rows-with-data; multi-day gaps render as 1-step adjacency → slope visually wrong |
| CR-03 | CRITICAL | `KpiCards.tsx` (cross-file) | 113 | Net-profit sparkline computes `rev - spend - cogs` (ignores fees + fixed); trajectory doesn't match the displayed `trueNetProfit` value above it |
| HI-01 | HIGH | `campaignsColumnPrefs.ts` | 231, 238 | `toggleCampaignsColumnHidden` + `restoreAllCampaignsColumns` silently DROP the operator's saved column `order`; reordering wiped on every visibility toggle |
| HI-02 | HIGH | `MetricHelp.tsx` | 47-77 | Hover-opened popover snaps shut during 8-px cursor transit (`mt-2` gap + onMouseLeave→close); operator can never actually read it on hover, only via click |
| HI-03 | HIGH | `CohortComparisonPanel.tsx` | 261-265 | Composite sort key `roasShopify*1e6 + roasShopifyPlatform*1e3 + spend` lets a high `roasShopifyPlatform` (>1000, plausible for micro-spend campaigns) flip the primary-rank ordering — wrong campaign gets the 🥇 |
| HI-04 | HIGH | `KpiCards.tsx` (cross-file) | 112 | COGS sparkline uses fixed `COGS_RATE_OF_REVENUE` (0.25); per-store `${STORE}_COGS_RATE` env value is ignored — sparkline shape disagrees with big-number above |
| HI-05 | HIGH | `RoasChart.tsx` (+ analytics.ts:252-254) | 95-101, 149-166 | "Store missing on this day" rendered as ROAS=0 (not null); chart shows the store crashing to zero on no-data days |
| MED-01 | MEDIUM | `RollingNumber.tsx` | 41-95 | NaN propagation: if `value` flips from finite to NaN (or vice-versa), `from + (to-from)*eased` is NaN; displayed value stuck at NaN until prop changes again |
| MED-02 | MEDIUM | `PnLBreakdown.tsx` | 243 | Hardcoded "X ימים מתוך 30" label breaks for ranges > 30 days (e.g., "60 ימים מתוך 30") |
| MED-03 | MEDIUM | `PnLBreakdown.tsx` | 95, 217-247 | When `revenue === 0` and `spend > 0`, cost lines render "0.0%" — implies "0% of revenue" while spending real money |
| MED-04 | MEDIUM | `DetailTable.tsx` | 17-21 | Negative revenue (refund-only days) → negative ROAS rendered raw without explanation; passes the `revenue === 0` gate and falls through to `formatNumber(roas)` with gray bg |
| MED-05 | MEDIUM | `RefundIndicator.tsx` | 192 | `isTouchDevice()` snapshot is taken on first render only; hybrid devices (touchscreen laptop with mouse) lose hover affordance for the whole session |
| MED-06 | MEDIUM | `CollapsibleSection.tsx` | 29-45, 64 | `defaultOpen` initial state + post-mount localStorage read causes hydration mismatch on `aria-expanded` + chevron rotation flash |
| MED-07 | MEDIUM | `WhatsWorking.tsx` | 47-56 | `adsManagerLink` has no TikTok branch — a winning TikTok campaign in "top-campaign" insight renders without click-through |
| LOW-01 | LOW | `Sparkline.tsx` | 54 | Helper returns `degenerate` flag but Sparkline ignores it; documented "suppress target line on degenerate" affordance unused → coincident target+data lines |
| LOW-02 | LOW | `RoasChart.tsx` | 30-38 | `STORE_COLORS` is hardcoded to 3 store names; new/renamed stores fall through to palette[idx % 5] and a 4th+ store can collide on `SERIES_PALETTE[0]`, both rendering as "primary" weight |
| LOW-03 | LOW | `AnnotationsPanel.tsx` | 232, 241 | `commit()` doesn't validate that `date` is within an allowed range; only the `<input type="date" max={today}>` browser-side guard, easy to bypass via DevTools |
| LOW-04 | LOW | `MetricHelp.tsx` | 75-77 | Popover `onMouseEnter/Leave` is wired correctly but unreachable due to HI-02; dead code path |

---

## CRITICAL

### CR-01 — ProductChannelBreakdown double-counts cross-tagged orders; segments mislead about channel mix

**File:** `dashboard-web/src/components/ProductChannelBreakdown.tsx:41-49, 96-100`
**Cross-file:** `dashboard-web/src/lib/attributionAnalysis.ts:1102-1109`

`facebookOrders` in `analyzeProductChannel` counts orders matching the OR predicate:

```ts
// attributionAnalysis.ts:1102-1109
const isFacebook =
  o.source === 'meta-paid' ||
  o.source === 'meta-organic' ||
  o.fbclidPresent === true;       // ← OR-with-source
if (isFacebook) {
  facebookOrders++;
  facebookRevenue += orderMappedRevenue;
}
```

But the same order's `o.source` ALSO increments `bySource[sourceKey]` (line 1095-1099). For an order with `source='google-paid'` AND a stale `fbclidPresent=true` (extremely common with cross-network retargeting + cookie persistence), the order increments BOTH `facebookOrders` AND `bySource['google-paid']`.

The render then double-subtracts:

```ts
// ProductChannelBreakdown.tsx:41-49
const fb = breakdown.facebookOrders;                                       // includes cross-tagged
const google = (breakdown.bySource['google-paid']?.orders ?? 0)
             + (breakdown.bySource['google-organic']?.orders ?? 0);        // also includes it
const tiktok = breakdown.tiktokOrders;
const direct = breakdown.bySource['direct']?.orders ?? 0;
const other = Math.max(0, total - fb - google - tiktok - direct);          // clamps overflow to 0
```

**Worked example** (100 unique orders; 10 are google-paid with stale fbclid):
- fb = 50 (40 pure meta + 10 cross)
- google = 30 (20 pure google + 10 cross)
- tiktok = 5, direct = 15
- unclamped other = 100 - 50 - 30 - 5 - 15 = 0 → renders as 0
- segment widths sum: (50 + 30 + 5 + 15) / 100 = 100% — visually balanced, **but represents 110 order-counts from 100 orders**

The "פייסבוק" segment shows 50% of the bar but only 40 orders are exclusively Facebook. The "גוגל" segment shows 30% but only 20 are exclusively Google. An operator scaling the Facebook campaign because "50% of mapped orders come from FB" is acting on an inflated number.

Worse: the additional `email`/`other-paid`/`other-referral` orders that ALSO had `fbclidPresent=true` are LOST from the "other" segment entirely — `total - fb - …` subtracts them once via `fb`, then they have nowhere else to be added.

```tsx
// ProductChannelBreakdown.tsx:96-100 — the 5 segment widths
<div className="h-full bg-roas-blue"   style={{ width: `${(fb / total) * 100}%` }} />
<div className="h-full bg-amber-500"   style={{ width: `${(google / total) * 100}%` }} />
<div className="h-full bg-pink-500"    style={{ width: `${(tiktok / total) * 100}%` }} />
<div className="h-full bg-text-muted"  style={{ width: `${(direct / total) * 100}%` }} />
<div className="h-full bg-text-subtle" style={{ width: `${(other / total) * 100}%` }} />
```

The summary line above the bar (line 92) shows the same inflated numbers as plain text: `פייסבוק: {fb} · גוגל: {google} · …` — sums look fine because the residual got clamped, but per-channel counts each overcount by the cross-tagged share.

**Fix (one of):**

Option A — define `facebookOrders` to be EXCLUSIVE of non-meta sources:

```ts
// attributionAnalysis.ts
const isFacebook =
  (o.source === 'meta-paid' || o.source === 'meta-organic') ||
  // Only credit fbclid → facebook when source is unknown/direct.
  (o.fbclidPresent === true && (o.source === '' || o.source === 'direct'));
```

Option B — let the renderer subtract bySource buckets directly so cross-tagged orders go to the bucket their `source` selected:

```ts
// ProductChannelBreakdown.tsx — replace fb/google/tiktok/direct/other
const metaOrders = (breakdown.bySource['meta-paid']?.orders ?? 0)
                 + (breakdown.bySource['meta-organic']?.orders ?? 0);
const google = (breakdown.bySource['google-paid']?.orders ?? 0)
             + (breakdown.bySource['google-organic']?.orders ?? 0);
const tiktok = breakdown.bySource['tiktok-paid']?.orders ?? 0;
const direct = breakdown.bySource['direct']?.orders ?? 0;
const knownExplicit = metaOrders + google + tiktok + direct;
const other = Math.max(0, total - knownExplicit);
// Now segments sum to exactly total — no double-count, no lost residual.
```

Note: Option B drops the `fbclidPresent`-only signal from the "facebook" bucket. If that signal matters (per the comment at attributionAnalysis.ts:9-12 "Meta can't fake fbclid"), surface it as a SEPARATE indicator next to the bar — not by inflating the bar.

---

### CR-02 — RoasChart X-axis is categorical; gap days warp the line shape

**File:** `dashboard-web/src/components/RoasChart.tsx:50-54, 87-94`
**Cross-file:** `dashboard-web/src/lib/analytics.ts:232-257`

```ts
// RoasChart.tsx:50-54
const chartData = data.map(d => ({
  date: d.date,
  dateLabel: formatDate(d.date).slice(0, 5), // DD/MM
  ...d.byStore,
}));
```

`data` comes from `dailySeries(cur, stores)` which only creates a map entry for dates that exist in `cur` (`analytics.ts:233-242`). Dates where ALL stores have zero rows are silently dropped. The XAxis is then:

```tsx
// RoasChart.tsx:88-94
<XAxis
  dataKey="dateLabel"          // categorical — string keys
  tick={{ fontSize: 11, ... }}
  axisLine={false}
  tickLine={false}
  tickMargin={6}
/>
```

Categorical mode means Recharts spaces points evenly — day 7 is the same X-distance from day 6 whether the calendar gap is 1 day or 5. A 30-day range with a 5-day data outage in the middle (e.g., system downtime, campaign paused) renders 25 points spread evenly across the full chart width. The slope between the points spanning the outage looks identical to a 1-day slope.

This is the same class of bug v2 flagged for HeroOverview's RoasTrendChart (CR-03 in `charts-and-viz-REVIEW.md`) but for the **primary** RoasChart that drives operator ROAS-trend interpretation. v2 fixed HeroOverview but RoasChart was not addressed — and RoasChart is the more prominent chart (top of analysis tab, full width).

**Why surface-level "it looks fine" missed this:** the XAxis is `hide={false}` by default and shows DD/MM labels for every point. The labels read "01/05 · 02/05 · 05/05 · 06/05 …" — the gap is technically VISIBLE in the label sequence, but the line itself is continuous and the spacing is constant. An operator's eye reads the LINE first.

**Fix:**

```ts
// dailySeries — fill the entire requested range, not just rows-with-data.
// Pass the range in; the caller already has it in filters.range.
export function dailySeries(
  rows: DailyRow[],
  stores: string[],
  range?: DateRange,
): DailySeries[] {
  const map = new Map<string, DailySeries>();
  for (const r of rows) {
    if (!map.has(r.date)) map.set(r.date, { date: r.date, byStore: {}, totalRoas: 0, totalRevenue: 0, totalSpend: 0 });
    const entry = map.get(r.date)!;
    entry.byStore[r.storeName] = r.roas;
    entry.totalRevenue += r.revenue;
    entry.totalSpend += r.totalSpend;
  }
  // Walk the full date range, filling missing days with null per-store
  // so the line breaks at gaps (instead of bridging them).
  if (range) {
    const out: DailySeries[] = [];
    let d = range.from;
    while (d <= range.to) {
      const e = map.get(d);
      if (e) {
        for (const s of stores) if (!(s in e.byStore)) e.byStore[s] = null as unknown as number;
        out.push(e);
      } else {
        const empty: DailySeries = { date: d, byStore: {}, totalRoas: 0, totalRevenue: 0, totalSpend: 0 };
        for (const s of stores) empty.byStore[s] = null as unknown as number;
        out.push(empty);
      }
      d = addOneDay(d); // YYYY-MM-DD inc
    }
    return out;
  }
  // existing fallback path
  for (const e of map.values()) {
    e.totalRoas = e.totalSpend > 0 ? e.totalRevenue / e.totalSpend : 0;
    for (const s of stores) if (!(s in e.byStore)) e.byStore[s] = 0;
  }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}
```

(Then either keep `connectNulls` on the `<Line>` for visual continuity, or remove it so gaps render as actual visual breaks — the latter is more honest.)

---

### CR-03 — KpiCards Net Profit sparkline shape doesn't match the displayed value

**File:** `dashboard-web/src/components/KpiCards.tsx:109-113, 179-189`

```ts
// KpiCards.tsx:109-113 — sparkData computation
const revenue = dailyTotals(series, r => r.revenue);
const spend = dailyTotals(series, r => r.totalSpend);
const grossProfit = dailyTotals(series, r => r.grossProfit);
const cogs = dailyTotals(series, r => r.revenue * COGS_RATE_OF_REVENUE);
const netProfit = revenue.map((rev, i) => rev - (spend[i] ?? 0) - (cogs[i] ?? 0));
//                                              ^^^^^^^^^^^^^^^^^^^^^^^^^^^^
// Missing: transaction fees + fixed costs. This is `gross - COGS`, NOT `trueNetProfit`.
```

But the card itself displays the full true net profit:

```tsx
// KpiCards.tsx:179-189
<KpiCard
  label="רווח נטו"
  help={METRIC_HELP.netProfit}
  rawValue={current.trueNetProfit}            // ← Revenue − Spend − COGS − Fees − Fixed
  format={n => formatCurrency(n)}
  valuePrefix="CAD"
  delta={dTrueNet}
  icon={<Wallet size={14} />}
  accent={current.trueNetProfit >= 0 ? 'pos' : 'neg'}
  spark={{ values: sparkData.netProfit }}     // ← Revenue − Spend − COGS only
/>
```

The big number says "רווח נטו" with `trueNetProfit` (Revenue − Spend − COGS − Fees − Fixed, per `analytics.ts:161`). The sparkline trajectory computes (Revenue − Spend − COGS) per day — no fees, no fixed costs. The two metrics diverge by `transactionFees + fixedCosts/days` per day.

**Operational impact:**
- For a small store with CAD 200 fixed/month + 6.5% fees: trueNetProfit can be 30% lower than `revenue - spend - cogs`. The sparkline shows a HEALTHIER trend than the actual number.
- For a store with high spend and tight margin, the sparkline can show a positive trend while the displayed value is negative — operator sees "going up green!" but the number says CAD −500.
- Day-to-day sparkline slope is misleading because per-day fixed-cost proration is missing (it's a flat ~CAD 7/day baseline shift the sparkline doesn't reflect).

The `MetricHelp.netProfit` content states the formula as `Revenue − Ad Spend − COGS (25%) − Fees (6.5%) − Fixed`. So the displayed value AND the help description both promise a different metric than the sparkline trajectory.

**Fix:**

```ts
// KpiCards.tsx — derive the sparkline from the SAME formula as the big number.
const transactionFees = dailyTotals(series, r => r.revenue * TRANSACTION_FEES_RATE);
// Per-day fixed cost: fixed_total / daysInRange (or current.daysCovered).
const perDayFixed = (current.fixedCosts ?? 0) / Math.max(1, current.daysCovered);
const netProfit = revenue.map((rev, i) =>
  rev - (spend[i] ?? 0) - (cogs[i] ?? 0) - (transactionFees[i] ?? 0) - perDayFixed
);
```

Also: the COGS sparkline (HI-04) compounds this issue. Combine the fix.

---

## HIGH

### HI-01 — Hiding/restoring a column wipes the operator's saved reorder

**File:** `dashboard-web/src/lib/campaignsColumnPrefs.ts:223-241`
**Surface:** `dashboard-web/src/components/CampaignsColumnsMenu.tsx:108-116`

```ts
// campaignsColumnPrefs.ts:223-234
export function toggleCampaignsColumnHidden(id: string): CampaignsColumnPrefs {
  const cur = readCampaignsColumnPrefs();             // returns { hidden, order }
  const set = new Set(cur.hidden);
  if (set.has(id)) set.delete(id); else set.add(id);
  const next: CampaignsColumnPrefs = { hidden: Array.from(set).sort() };  // ← order DROPPED
  writeCampaignsColumnPrefs(next);
  return next;
}

// And:
export function restoreAllCampaignsColumns(): CampaignsColumnPrefs {
  const next: CampaignsColumnPrefs = { hidden: [] };  // ← order DROPPED
  writeCampaignsColumnPrefs(next);
  return next;
}
```

Neither function spreads `...cur`. The new object has only `hidden` — `order` is silently undefined-ed. `writeCampaignsColumnPrefs` then serializes that to localStorage and pushes to cloud.

The menu in CampaignsColumnsMenu lets the operator (a) reorder via up/down chevrons and (b) toggle visibility via checkboxes. The reorder is the more expensive interaction (one click at a time, ~16 metric columns). One careless checkbox click wipes minutes of careful reordering. There's no undo.

Worse: cloud-sync replicates the broken state across devices.

**Fix:**

```ts
export function toggleCampaignsColumnHidden(id: string): CampaignsColumnPrefs {
  const cur = readCampaignsColumnPrefs();
  const set = new Set(cur.hidden);
  if (set.has(id)) set.delete(id); else set.add(id);
  const next: CampaignsColumnPrefs = {
    ...cur,                                          // preserve order
    hidden: Array.from(set).sort(),
  };
  writeCampaignsColumnPrefs(next);
  return next;
}

export function restoreAllCampaignsColumns(): CampaignsColumnPrefs {
  const cur = readCampaignsColumnPrefs();
  const next: CampaignsColumnPrefs = { ...cur, hidden: [] };  // preserve order
  writeCampaignsColumnPrefs(next);
  return next;
}
```

---

### HI-02 — MetricHelp popover snaps closed during cursor transit; unreadable on hover

**File:** `dashboard-web/src/components/MetricHelp.tsx:45-77`

```tsx
<span className={cn('relative inline-block', className)}>
  <button
    type="button"
    onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
    onMouseEnter={() => setOpen(true)}
    onMouseLeave={() => setOpen(false)}            // ← fires the instant cursor leaves button
    onFocus={() => setOpen(true)}
    onBlur={() => setOpen(false)}
    aria-label={`הסבר על ${content.name}`}
    className={cn(
      'inline-flex items-center justify-center w-4 h-4 rounded-full transition-colors',
      ...
    )}
  >
    <Info size={11} />
  </button>

  {open && (
    <div
      role="tooltip"
      dir="rtl"
      className={cn(
        'absolute z-30 top-full mt-2 end-0',        // ← 8px gap between button and popover
        'w-[260px] sm:w-[300px] max-w-[min(90vw,320px)]',
        'rounded-xl bg-text-primary text-white p-3 shadow-elevated',
        ...
      )}
      onMouseEnter={() => setOpen(true)}            // unreachable in practice
      onMouseLeave={() => setOpen(false)}
    >
```

The popover sits 8px below the button (`top-full mt-2`). To transit from button → popover, the cursor crosses 8px of empty space where neither element is under it. `onMouseLeave` on the button fires the moment cursor exits the button's 16×16 box. `setOpen(false)` runs → popover unmounts → cursor never reaches it.

The popover's own `onMouseEnter` (line 75) and `onMouseLeave` (line 76) are dead code — by the time mouse would enter them, they don't exist.

**Operational impact:** every in-card help icon (one per KPI card, plus inline metric helps elsewhere) appears to work on hover but actually only reveals briefly while the cursor is *exactly on* the 16×16 button. Operator moves down to read the content → snap, gone. Operator concludes "help tooltips are broken" and stops using them. The keyboard focus + click paths still work, so a power user might rely on those — but the discoverable hover affordance is dead.

Same root-cause as `RefundIndicator`'s d/CR-08 fix (v2 audit). The same grace-period pattern applies.

**Fix:** apply RefundIndicator's pattern (200ms grace timer + cancelled on cursor re-entry to button OR popover):

```tsx
// MetricHelp.tsx — sketch
const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
function cancelHide() {
  if (hideTimer.current !== null) { clearTimeout(hideTimer.current); hideTimer.current = null; }
}
function scheduleHide() {
  cancelHide();
  hideTimer.current = setTimeout(() => { setOpen(false); hideTimer.current = null; }, 200);
}
useEffect(() => () => cancelHide(), []);
// ... onMouseEnter={() => { cancelHide(); setOpen(true); }} on both button + popover
// ... onMouseLeave={scheduleHide} on both
```

Or zero the gap (`top-full` with no `mt-2`) so cursor never crosses dead space.

---

### HI-03 — CohortComparisonPanel ranking composite key lets `roasShopifyPlatform` flip primary order

**File:** `dashboard-web/src/components/CohortComparisonPanel.tsx:261-265`

```ts
intraSection.sort((a, b) => {
  const sa = a.metrics
    ? a.metrics.roasShopify * 1e6
      + a.metrics.roasShopifyPlatform * 1e3
      + a.metrics.spend
    : -Infinity;
  const sb = b.metrics
    ? b.metrics.roasShopify * 1e6
      + b.metrics.roasShopifyPlatform * 1e3
      + b.metrics.spend
    : -Infinity;
  return sb - sa;
});
```

The intent is "ROAS Shopify first; if tied, ROAS Shopify platform; if still tied, spend." The composite key encodes this as `r1 * 1e6 + r2 * 1e3 + spend`.

**Problem:** the encoding assumes each term is bounded such that the next-higher term always dominates. But `roasShopifyPlatform * 1e3 ≥ 1e6` whenever `roasShopifyPlatform ≥ 1000`. That's not theoretical — a micro-spend campaign with CAD 0.10 of platform spend and CAD 100 of platform-attributed Shopify revenue yields `roasShopifyPlatform = 1000`. The secondary term then contributes ≥ 1e6 to the composite, equivalent to a +1 in `roasShopify`. A campaign with `roasShopify = 2` and `roasShopifyPlatform = 5000` outranks a campaign with `roasShopify = 3` and `roasShopifyPlatform = 4`.

**Visible UX failure:**
- Operator sees cohort leader 🥇 = "Campaign Z" with displayed values: ROAS Shopify 2.0, ROAS Shopify-Platform 5,000
- Campaign Y (rank #2 with this bug) shows ROAS Shopify 3.0, ROAS Shopify-Platform 4
- Operator's intuition: "Y has better global ROAS, why is Z first?"
- Tagline ("rivals באותה זירה") doesn't explain the inversion. The ranking visually contradicts the displayed primary metric.

This is also a misleading-viz issue because the 🥇/🥈/🥉 medals and the "במקום X מתוך N" header chip both depend on this sort. The HIGH-02 audit gate (loud-red "weakest" only when `intraCount >= 3`) doesn't help: the medal positions are still wrong.

**Fix:** clamp the secondary term to its dominance budget:

```ts
const compositeKey = (m: CohortMetrics) =>
    m.roasShopify * 1e6
  + Math.min(m.roasShopifyPlatform, 999) * 1e3   // bounded so it never exceeds 1e6 - 1
  + Math.min(m.spend, 999);                       // ditto

intraSection.sort((a, b) => {
  const sa = a.metrics ? compositeKey(a.metrics) : -Infinity;
  const sb = b.metrics ? compositeKey(b.metrics) : -Infinity;
  return sb - sa;
});
```

Or better — use a tuple comparator that doesn't risk numerical overflow at all:

```ts
intraSection.sort((a, b) => {
  if (!a.metrics) return 1;
  if (!b.metrics) return -1;
  if (a.metrics.roasShopify !== b.metrics.roasShopify) return b.metrics.roasShopify - a.metrics.roasShopify;
  if (a.metrics.roasShopifyPlatform !== b.metrics.roasShopifyPlatform) {
    return b.metrics.roasShopifyPlatform - a.metrics.roasShopifyPlatform;
  }
  return b.metrics.spend - a.metrics.spend;
});
```

---

### HI-04 — KpiCards COGS sparkline ignores per-store COGS rate

**File:** `dashboard-web/src/components/KpiCards.tsx:112`
**Cross-file:** `dashboard-web/src/lib/analytics.ts:30-41` (per-store rate helper)

```ts
// KpiCards.tsx:112
const cogs = dailyTotals(series, r => r.revenue * COGS_RATE_OF_REVENUE);  // ← fixed 0.25
```

But the COGS big-number displayed above (`current.cogs`) is built by `aggregate(...)` which respects the per-store rate (`analytics.ts:133-136`):

```ts
const rowCogs = r.hasCogs
  ? r.cogs                                              // live writer used per-store rate
  : r.revenue * getCogsRateForStore(r.storeId);         // back-fill uses per-store env
cogs += rowCogs;
```

For an operator with `ZOLPLUS_COGS_RATE=0.35`, the displayed big number includes 35%-margin COGS for Zol Plus rows. The sparkline below computes 25% for the SAME rows. The trajectory disagrees with the value.

**Operational impact:** delta arrow + displayed value say "COGS up 15%", sparkline shows a flatter trend (because it's at 25% for stores actually billed at 35%). The viz line shape is wrong.

Combine the fix with CR-03 (net-profit sparkline) since they share the COGS computation.

**Fix:**

```ts
// KpiCards.tsx
const cogs = dailyTotals(series, r =>
  r.hasCogs ? r.cogs : r.revenue * getCogsRateForStore(r.storeId)
);
```

---

### HI-05 — RoasChart conflates "store had no data" with "store ROAS = 0"

**File:** `dashboard-web/src/components/RoasChart.tsx:95-101, 149-166`
**Cross-file:** `dashboard-web/src/lib/analytics.ts:252-254`

```ts
// analytics.ts:252-254 — dailySeries fill-missing logic
for (const s of stores) {
  if (!(s in e.byStore)) e.byStore[s] = 0;          // ← "missing day" gets ROAS=0
}
```

The map entry for date D only contains `byStore` keys for stores with at least one row on that date. Stores absent on D get explicitly set to `0`. The chart then renders:

```tsx
// RoasChart.tsx:153-165
<Line
  key={s}
  type="monotone"
  dataKey={s}
  stroke={color}
  strokeWidth={isPrimary ? 2.75 : 2}
  dot={false}
  activeDot={{ r: isPrimary ? 5 : 4, strokeWidth: 0 }}
  connectNulls
/>
```

`connectNulls` is set — but the value is `0`, not `null`, so the line simply passes through Y=0 on missing days. A store launched mid-period (or paused mid-period) shows as **crashing to zero** before its real data starts/after it ends.

**Visual lie example:** Store B launched on day 10 of a 30-day period. Days 1-9 have `byStore.B = 0`. Day 10+: actual ROAS values (e.g., 2.5, 3.1, 2.8…). The chart renders a line at Y=0 for days 1-9, then JUMPS to 2.5 on day 10. Operator reads: "Store B was performing at 0 ROAS and suddenly recovered." Reality: "Store B didn't exist in the period for those days."

The tooltip surfaces `formatNumber(v)` for each store including the 0 entries (`RoasChart.tsx:138-140`). Hovering day 5 shows "Store B — ROAS 0.00" — which is doubly misleading because zero ROAS implies "had spend, got no revenue." Reality is "had no spend."

**Fix:** distinguish missing data from real zero:

```ts
// analytics.ts:252-254 — replace
for (const s of stores) {
  if (!(s in e.byStore)) e.byStore[s] = null as unknown as number;  // null = no data
}
```

```tsx
// RoasChart.tsx tooltip — skip null entries
if (entry.value === null || !Number.isFinite(v)) return null;
```

`connectNulls` on the `<Line>` then bridges the gap visually (or remove it for explicit breaks).

---

## MEDIUM

### MED-01 — RollingNumber NaN propagation

**File:** `dashboard-web/src/components/RollingNumber.tsx:55-83`

```ts
const from = display;                       // could be NaN if display was NaN
const to = value;                           // could be NaN if value is NaN
fromRef.current = to;
// …
function tick(t: number) {
  // …
  const next = from + (to - from) * eased;  // NaN + NaN = NaN
  setDisplay(next);
}
```

If `display` is a real number and `value` flips to NaN (e.g., upstream `revenue/spend` division by zero that isn't pre-guarded), `to = NaN`. Then every `tick` sets `display = NaN`. The card shows whatever `format(NaN)` returns (`"NaN"`, `"$NaN"`, etc.).

Even after `value` returns to a valid number, the recovery path is unreliable: the early-return at line 53 (`if (fromRef.current === value) return`) compares with `===`, and `NaN === <anything>` is false — so the effect runs, `from = display = NaN`, and the formula keeps producing NaN until the prop changes to something `!== NaN`. But `fromRef.current` was set to NaN, and `NaN === <new value>` is false → effect always runs again. So self-recovery on next prop change DOES work; the bug is only the transient NaN display state.

Lower than HIGH because today's upstream paths guard against `roas` being NaN (`postgresReaders.ts:303-306` defaults to 0). But the component should defend against the input contract being broken.

**Fix:**

```ts
useEffect(() => {
  if (typeof window !== 'undefined') {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) { setDisplay(value); fromRef.current = value; return; }
  }
  // Bail out cleanly on non-finite input — show the value as-is.
  if (!Number.isFinite(value)) {
    setDisplay(value);
    fromRef.current = value;
    return;
  }
  if (fromRef.current === value) return;
  const from = Number.isFinite(display) ? display : value;
  // … rest unchanged
}, [value, durationMs]);
```

---

### MED-02 — PnLBreakdown "X ימים מתוך 30" label breaks for ranges > 30 days

**File:** `dashboard-web/src/components/PnLBreakdown.tsx:243`

```ts
note={
  hasConfiguredFixed
    ? `${activeForScope.length} מנויים פעילים${oneTimeInScope.length > 0 ? ` + ${oneTimeInScope.length} חד-פעמיים` : ''} · ${current.daysCovered} ימים מתוך 30`
    : 'לא הוגדרו עלויות — לחץ על "עלויות חודשיות" למעלה'
}
```

`current.daysCovered` is `dates.size` from the rows (`analytics.ts:149`). For a 60-day range with full data, daysCovered = 60. The label renders "60 ימים מתוך 30" — mathematically nonsensical. The actual proration in `billingForRange` correctly handles ranges > 30 days (cost × range_days / 30), but the LABEL doesn't reflect this.

**Fix:** show the proration multiplier explicitly:

```ts
const monthlyMultiplier = current.daysCovered / 30;
const periodLabel = monthlyMultiplier === 1
  ? '~חודש מלא'
  : monthlyMultiplier < 1
    ? `${current.daysCovered} מתוך 30 ימים`
    : `${monthlyMultiplier.toFixed(1)} חודשים`;
// "5 ימים מתוך 30" / "1.0 חודשים" / "2.0 חודשים"
```

---

### MED-03 — PnLBreakdown cost lines show "0.0%" when revenue is zero

**File:** `dashboard-web/src/components/PnLBreakdown.tsx:95, 217-247`

```ts
// line 95
const pct = (n: number) => (revenue > 0 ? (n / revenue) * 100 : 0);

// line 217 — cost line uses pct
<PnLLine
  label="הוצאות פרסום"
  amount={-current.spend}
  pct={-pct(current.spend)}           // ← 0 when revenue is 0, even if spend > 0
  tone="cost"
  …
/>
```

When `revenue = 0` and `spend = CAD 500`, the row renders:
- amount: "−500.00"
- pct: "0.0%" ← lies; the spend is "infinite %" of revenue
- running: appropriate negative number

The pct column is the visual signal for "how big is this cost compared to revenue." Showing "0.0%" implies "no impact" while the real running balance crashes. Operator scanning percentages might miss that pure-loss days exist.

**Fix:** render "—" or "∞%" when revenue is zero:

```ts
// PnLLine — adjust the pct display
<div className="text-[10px] text-text-muted tabular-nums mt-0.5">
  {revenue === 0 && amount !== 0
    ? '—'
    : pct > 0 && tone === 'positive'
      ? '100%'
      : `${pct.toFixed(1)}%`}
</div>
```

(Requires passing `revenue` to `PnLLine` or refactoring.)

---

### MED-04 — DetailTable renders raw negative ROAS on refund-only days

**File:** `dashboard-web/src/components/DetailTable.tsx:17-21`

```ts
function roasCellStyle(roas: number, revenue: number, totalSpend: number) {
  if (revenue === 0 && totalSpend > 0) return { className: 'bg-black text-white', text: '0' };
  if (revenue === 0 && totalSpend === 0) return { className: '', text: '' };
  return { className: ROAS_BG[roasLabel(roas).tone], text: formatNumber(roas) };
}
```

Both conditions check `revenue === 0`. A refund-only day where `revenue = -CAD 50` (orders cancelled but ad spend continued) falls through to the third branch:
- `roasLabel(-0.5)` → `tone: 'gray'` (per `analytics.ts:260-261`)
- `text: formatNumber(-0.5)` → `"-0.50"` (or he-IL equivalent)

The cell shows a negative ROAS in gray bg with NO contextual flag. The operator scans a column of mostly positive ROAS and sees a "-0.50" entry — likely interpreted as "rendering glitch" or "weird metric value", not "this day was net-negative because of refunds."

The `RefundIndicator` chip next to revenue (line 83-86) catches the refund-day, but the ROAS cell renders independently and gives no signal.

**Fix:** extend the gate to handle negative revenue:

```ts
function roasCellStyle(roas: number, revenue: number, totalSpend: number) {
  if (revenue <= 0 && totalSpend > 0) {
    // Negative revenue + ad spend = pure loss day. Render distinct.
    return { className: 'bg-roas-red text-white', text: revenue < 0 ? '⚠' : '0' };
  }
  if (revenue === 0 && totalSpend === 0) return { className: '', text: '' };
  return { className: ROAS_BG[roasLabel(roas).tone], text: formatNumber(roas) };
}
```

---

### MED-05 — RefundIndicator captures touch-vs-mouse once; hybrid devices lose hover

**File:** `dashboard-web/src/components/RefundIndicator.tsx:100-107, 192`

```ts
function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    (typeof navigator !== 'undefined' && navigator.maxTouchPoints > 0) ||
    'ontouchstart' in window
  );
}
// …
const touch = useRef(isTouchDevice()).current;       // snapshot at mount, never re-evaluated
```

`maxTouchPoints > 0` is true on touchscreen LAPTOPS (Surface, ThinkPads with touchscreen, iPads with attached mouse). These devices register as "touch" once, then permanently use click-to-toggle mode for the session. The hover affordance — the entire user-facing reason RefundIndicator was redesigned with the grace timer — is unreachable on these devices.

The captured boolean also doesn't change if the user plugs in / unplugs a mouse mid-session.

**Fix:** prefer per-event input detection:

```ts
// Bind both onMouseEnter and onPointerEnter; in the handler, check pointerType.
// pointerType === 'mouse' → treat as hover; 'touch' or 'pen' → no hover.
function handlePointerEnter(e: React.PointerEvent) {
  if (e.pointerType === 'mouse') { cancelHide(); setOpen(true); }
}
function handlePointerLeave(e: React.PointerEvent) {
  if (e.pointerType === 'mouse') scheduleHide();
}
// onClick remains the universal toggle.
```

This makes the hover behavior depend on the ACTUAL input device per interaction, not the device's CAPABILITIES at mount.

---

### MED-06 — CollapsibleSection causes hydration flash + aria-expanded mismatch

**File:** `dashboard-web/src/components/CollapsibleSection.tsx:29-45, 60-93`

```ts
const [open, setOpen] = useState(defaultOpen);   // ← initial render uses defaultOpen
const [hydrated, setHydrated] = useState(false);

useEffect(() => {
  // runs AFTER first paint; reads storage and may flip `open`
  if (!storageKey) { setHydrated(true); return; }
  try {
    const saved = localStorage.getItem(`roas-section:${storageKey}`);
    if (saved !== null) setOpen(saved === '1');
  } catch { /* ignore */ }
  setHydrated(true);
}, [storageKey]);
```

The first render uses `defaultOpen`. Server-side SSR renders with `defaultOpen=true` (say). Client mounts with `defaultOpen=true`. Then useEffect runs, reads `localStorage` → may set `open=false`. The chevron rotation transition runs, the children unmount.

**Symptoms:**
1. `aria-expanded` initial render is `true` (defaultOpen). SSR HTML says aria-expanded=true. Client first paint matches. Then useEffect updates state to false. React applies the change. For screen readers and observers reading the DOM right after page load, a flash from expanded→collapsed.
2. The chevron's `rotate-180` transition fires unintentionally (transition-transform on the icon).
3. If `defaultOpen=false` but storage says `'1'`, the OPPOSITE flash occurs: closed → animated open.

This isn't pure SSR mismatch (React 19 squelches some of these warnings), but it IS a layout twitch.

**Fix:** lazy-init from localStorage so first render already matches the stored state:

```ts
const [open, setOpen] = useState(() => {
  if (typeof window === 'undefined') return defaultOpen;
  if (!storageKey) return defaultOpen;
  try {
    const saved = localStorage.getItem(`roas-section:${storageKey}`);
    if (saved !== null) return saved === '1';
  } catch { /* */ }
  return defaultOpen;
});
const [hydrated, setHydrated] = useState(typeof window !== 'undefined');
// Remove the useEffect storage-read; only the storage WRITE remains in toggle().
```

This may re-introduce the strict hydration warning on SSR — guard with `useSyncExternalStore` or `'use client'`-only paths to suppress.

---

### MED-07 — WhatsWorking has no Ads Manager link for TikTok winners

**File:** `dashboard-web/src/components/WhatsWorking.tsx:47-56`

```ts
function adsManagerLink(platform: string, campaignId: string): string | null {
  if (!campaignId) return null;
  if (platform === 'Meta') return `https://business.facebook.com/adsmanager/manage/ads?selected_campaign_ids=${encodeURIComponent(campaignId)}`;
  if (platform === 'Google') return `https://ads.google.com/aw/campaigns?campaignId=${encodeURIComponent(campaignId)}`;
  return null;       // ← TikTok falls through
}
```

The "top-campaign" insight aggregates campaigns across all platforms (line 96-127). A TikTok campaign winning by ROAS gets no `href` — the row renders without `<a>`, no click target. The operator sees the insight, wants to act, has nowhere to click. Per phase 05.7.9 TikTok was promoted to first-class; this code wasn't updated.

**Fix:**

```ts
if (platform === 'TikTok') {
  // TikTok Ads Manager doesn't support deep-link to a specific campaign ID
  // via URL parameter (last verified 2026-05); link to the campaigns
  // overview instead so the operator at least lands in the right product.
  return 'https://ads.tiktok.com/i18n/dashboard/campaign';
}
```

---

## LOW

- **LOW-01** — `Sparkline.tsx:54` destructures only `points, targetY` from the geometry helper. The helper exposes a `degenerate` flag specifically (with a comment at `sparklineGeometry.ts:23-26`) so callers can suppress the optional target line when it would visually coincide with the data line. Sparkline ignores it, producing a single coincident line for constant-equal-to-target series. Fix: `if (!degenerate) render target-line; else skip`.

- **LOW-02** — `RoasChart.tsx:30-38` hardcodes color mapping for three store names (`uzoshop`, `Zol Plus`, `360usmile`). New/renamed stores fall through to `SERIES_PALETTE[idx % 5]`. With four stores, the 4th picks `SERIES_PALETTE[3]` (violet); fine. But the `isPrimary` flag (line 64) tests `color === SERIES_PALETTE[0]` (navy). If a 6th store cycles back to index 0, BOTH the "uzoshop" line and the 6th store get rendered as `isPrimary` (bold + 2.75px stroke). Two "dominant" lines visually compete. Use a `Set<string>` of intentionally-primary store names instead.

- **LOW-03** — `AnnotationsPanel.tsx:232, 241` — the form-level `commit()` doesn't validate `date` against any range. Only the `<input type="date" max={today}>` (line 288) prevents future dates client-side, easily bypassed via DevTools. For an internal single-operator tool the risk is minimal, but the trust model is "operator can corrupt their own data only", and corrupting your own annotations dates breaks chart overlays. Add `if (date > todayInIsrael()) return;` in commit.

- **LOW-04** — `MetricHelp.tsx:75-77` — the popover's own `onMouseEnter` and `onMouseLeave` handlers are dead code because of HI-02 (popover unmounts before the cursor can reach them). Remove them once HI-02 is fixed, OR keep them but ensure the grace-timer pattern means they're actually reachable.

---

## Per-component verdict (post-v2 fixes)

- **RoasChart.tsx** — STILL MISLEADING. v2 added the ROAS unit label in the tooltip (HI-04 fixed). But CR-02 (categorical X-axis bridges gap days) and HI-05 (missing-store-day rendered as ROAS=0) are both newly surfaced in this pass. The chart is the primary trend signal on the analysis tab and these two issues each independently distort line shape.

- **Sparkline.tsx** — TRUSTWORTHY for current input. The geometry-helper extraction + degenerate-case centering (HI-05 in v2) holds. LOW-01 is cosmetic.

- **AnnotationsPanel.tsx** — OK. List/form work correctly. LOW-03 is defensive only.

- **AttributionAnalysisPanel.tsx** — OK with caveats. FIX-12 width clamp is correctly applied. `detRoas` / `metaRoas` correctly guard divide-by-zero. Bar segment differentiation via opacity-only (v2 MED-06) NOT addressed but is in OPUS-2 scope; not re-raising since v2 already flagged.

- **CohortComparisonPanel.tsx** — RANKING CAN INVERT. HI-03 (composite-key overflow) flips primary vs secondary order for cohorts where one member has spike-y `roasShopifyPlatform`. The visible medals (🥇/🥈/🥉) and the rank chip in the header can both be wrong.

- **ProductChannelBreakdown.tsx** — STILL MISLEADING. v2 fixed `total <= 0` early-return (d/CR-05). But CR-01 (double-count of `fbclidPresent` + non-meta source) compounds with the existing v2 MED-07 (`other` undercount) — the bar widths cannot be trusted to represent attribution.

- **PnLBreakdown.tsx** — MOSTLY TRUSTWORTHY with two surfaced issues. The hero strip + line-item ladder are well-architected. MED-02 (X / 30 hardcoded) and MED-03 (0.0% with positive spend) are framing/label issues, not numerical.

- **RefundIndicator.tsx** — MOSTLY OK. v2 d/CR-08 fix (touch-detect + grace timer + portal click absorption) is correct. MED-05 (capture-at-mount instead of per-pointer-event) is the only outstanding limitation.

- **SectionIntro.tsx** — OK. Inline mode silently drops unused props (title/formula/rightSlot) — minor API smell, not a bug.

- **RollingNumber.tsx** — OK with NaN-input gap (MED-01). Easing + reduce-motion respect are correct.

- **MetricHelp.tsx** — POPOVER UNREADABLE ON HOVER. HI-02 — the 8px cursor-transit dead zone closes the popover before the operator can read it. Same root cause as v2 d/CR-08 but for a sibling component that wasn't migrated to the grace-timer pattern.

- **WhatsWorking.tsx** — OK. The "rising" infinity filter (line 149) correctly excludes new products; one could argue it shouldn't, but the design choice is defensible. MED-07 (no TikTok deep link) is a UX gap, not a correctness bug.

- **DetailTable.tsx** — OK with one surfaced issue. MED-04 (negative-ROAS rendering on refund-only days) is rare but visually confusing. The TikTok-column-when-non-zero gate is correct. RefundIndicator integration is correct.

- **CollapsibleSection.tsx** — HYDRATION FLASH. MED-06 — the post-mount localStorage read causes a chevron rotation + children unmount on first paint, plus an aria-expanded mismatch. Lazy-init resolves both.

- **CampaignsColumnsMenu.tsx** — UI is correct, but `toggleCampaignsColumnHidden` / `restoreAllCampaignsColumns` in `lib/campaignsColumnPrefs.ts` silently wipe the operator's saved `order` field (HI-01). Cloud-sync replicates the destruction across devices.

- **chartColors.ts** — TRUSTWORTHY. The v2 HI-01 fix (TikTok → slate-700) is in place with a clear comment explaining the colorblind tradeoff. No new findings.

---

## What's solid (no v3 findings)

- **`sparklineGeometry.ts`** extracted as a pure helper with explicit `degenerate` flag and unit tests at `lib/__tests__/sparklineGeometry.test.ts`. Solid v2 fix that this audit confirms remains correct.

- **`chartColors.ts`** central token file with descriptive comments about the colorblind tradeoffs and the "do not change Meta without also rethinking the dash/solid contract" warning. Anti-drift comment is exactly the right pattern.

- **`AttributionAnalysisPanel`** width clamp at line 92, 96 (`Math.max(0, Math.min(100, …))`) defensively guards both negative revenue and over-100% conditions. Correct post-FIX-12 state.

- **`PnLBreakdown`** hero strip with proportional bars + `Math.max(2, Math.min(100, …))` width clamp at line 375 — the min-2% ensures tiny values still register visually without overflow. Good defensive pattern.

- **`RefundIndicator`** portal-escape with grace timer + dual-ref click-outside detection — well-architected solution to a class of bugs that often gets fixed once and re-introduced. The grace timer + portal ref pattern is now textbook here.

---

_Reviewed: 2026-05-23_
_Reviewer: gsd-code-reviewer (OPUS-2, adversarial mode, parallel with OPUS-1/3/4)_
_Depth: deep (cross-file: 19 files; explicit cross-reference into analytics.ts, attributionAnalysis.ts, campaignsColumnPrefs.ts, sparklineGeometry.ts)_
