---
phase: audit-2026-05-23-v2 — charts & visualizations
reviewed: 2026-05-23T00:00:00Z
depth: deep
files_reviewed: 12
files_reviewed_list:
  - dashboard-web/src/components/RoasChart.tsx
  - dashboard-web/src/components/Sparkline.tsx
  - dashboard-web/src/components/HeroOverview.tsx
  - dashboard-web/src/components/MetaShopifyReconciliation.tsx
  - dashboard-web/src/components/CampaignsTable.tsx
  - dashboard-web/src/components/CampaignDrawer.tsx
  - dashboard-web/src/components/AnnotationsPanel.tsx
  - dashboard-web/src/components/KpiCards.tsx
  - dashboard-web/src/components/AttributionAnalysisPanel.tsx
  - dashboard-web/src/components/ProductChannelBreakdown.tsx
  - dashboard-web/src/components/CohortComparisonPanel.tsx
  - dashboard-web/src/lib/chartColors.ts
findings:
  critical: 3
  high: 6
  medium: 7
  low: 5
  total: 21
status: issues_found
---

# Charts & Visualizations — Adversarial Audit

## Summary

The dashboard's chart layer is **partially trustworthy**, but several charts can visually mislead the operator into wrong decisions. Three problems are bad enough to block ship:

1. **CPM-over-time chart aligns previous-period by INDEX, not by date.** The chart explicitly drops zero-impression days from BOTH series before pairing — so when the current period had an off-day that prev did not (or vice versa), "day 7" of current is aligned against a different-numbered weekday from prev. The original audit FIND-13 was **not fixed**: same-index alignment over filtered series silently warps every operator decision about "vs same period last month." See `CampaignsTable.tsx:1217-1221` and `CampaignDrawer.tsx:908-912`.

2. **CPM chart Y-axis is zero-suppressed** (`domain={[dataMin * 0.88, dataMax * 1.12]}`). A 3% week-over-week CPM increase (CAD 12.00 → 12.36) visually fills most of the chart height. The operator looks at this and sees "CPM is exploding"; reality is a noise-level change. This is the textbook zero-suppression manipulation we audit external dashboards for, and it ships in our own product. See `CampaignsTable.tsx:1304-1307` and `CampaignDrawer.tsx:1011-1014`.

3. **HeroOverview RoasTrendChart silently drops zero-revenue/zero-spend days from the series, then claims `{series.length} ימים` in the date axis footer** — but the visible date axis ends are still the un-filtered range from/to. If the operator's selected 30 days contains 5 paused days, the chart shows the from→to range header that suggests 30 continuous days while the curve actually skips 5 — visually rendering a **misaligned shape**. The `series.length` count in the footer also disagrees with `daysInRange` shown 30 lines above in the eyebrow. See `HeroOverview.tsx:350` and `HeroOverview.tsx:501-505`.

Beyond those three blockers, the multi-line MetaShopifyReconciliation chart has weak color contrast in colorblind palettes (Meta-amber vs Shopify-green is the second-most-common red-green confusion), several tooltips lack a CAD currency label, the Hero chart's annotation labels can stack illegibly on the same day, and the Hero chart's left-edge data points are unconditionally hidden under the navy ContextStat bar because the chart has no left padding plus the navy gradient extends past the chart bounds.

**The narrative answer to "could a chart mislead me?":** Yes — three production charts can. The CPM Y-axis exaggerates noise as drama. The CPM "vs previous period" mode pairs the wrong days. The Hero ROAS trend chart skips zero days but presents the date range as continuous.

---

## Findings

### CRITICAL

#### CR-01: CPM-vs-previous-period chart pairs wrong dates (index-aligned, not date-aligned)

**File:** `dashboard-web/src/components/CampaignsTable.tsx:1217-1221`, `dashboard-web/src/components/CampaignDrawer.tsx:908-912`
**Why it matters:** The chart promises "vs תקופה קודמת באותו אורך" — equal-length comparison. The operator reads the dashed line as "this is what CPM was on the same weekday last period."

The implementation:

```ts
// CampaignsTable.tsx:1217
const cpmChartData = cpmDaily.map((d, i) => ({
  ...d,
  prevCpm: cpmDailyPrev?.[i]?.cpm ?? null,
  prevDate: cpmDailyPrev?.[i]?.date ?? null,
}));
```

But **both** `cpmDaily` and `cpmDailyPrev` were pre-filtered to drop zero-impression days (lines 710 + 770). If the current 14-day window had 12 active days and the prev 14-day window had 14, then "current day 7" is paired with "prev day 7" — which is now off by 2 calendar days. If the campaign was paused for the weekend in current but not prev, the dashed line at "Tuesday" actually shows the prev period's *Sunday* CPM.

The tooltip surfaces `d.prevDate` correctly (`formatDate(d.prevDate)`) so a careful operator hovering each point can audit the mismatch, but no one operates that way at a glance — the **visual line shape** is what drives "is CPM up or down?" decisions. The shape is wrong whenever paused days exist in either window.

Compounding this: the analyzer label says `"(תקופה קודמת באותו אורך)"` which is also misleading — it's same `localRange` length, but after filtering it can be *fewer aligned days* than that.

The original audit's FIND-13 flagged this exact issue and it has NOT been corrected. The audit fix would be: keep both series at the same calendar offset (zero-fill missing days in `cpmDailyPrev`) OR explicitly join by `previousRange.from + i` calendar date and surface gaps as nulls.

**Fix:**
```ts
// Build by calendar offset from the period start, NOT by surviving-index.
// Map prev rows by their date-from-period-start offset so missing days
// stay missing instead of getting reassigned to a different day.
const prevByOffset = new Map<number, { cpm: number; date: string }>();
const prevPeriodStart = new Date(cpmPrevRange.from + 'T00:00:00Z').getTime();
for (const p of (cpmDailyPrev ?? [])) {
  const offsetDays = Math.round(
    (new Date(p.date + 'T00:00:00Z').getTime() - prevPeriodStart) / 86400000
  );
  prevByOffset.set(offsetDays, { cpm: p.cpm, date: p.date });
}
const curPeriodStart = new Date(localRange.from + 'T00:00:00Z').getTime();
const cpmChartData = cpmDaily.map(d => {
  const offsetDays = Math.round(
    (new Date(d.date + 'T00:00:00Z').getTime() - curPeriodStart) / 86400000
  );
  const prev = prevByOffset.get(offsetDays);
  return { ...d, prevCpm: prev?.cpm ?? null, prevDate: prev?.date ?? null };
});
```

---

#### CR-02: CPM chart Y-axis zero-suppressed — every chart visually exaggerates noise

**File:** `dashboard-web/src/components/CampaignsTable.tsx:1304-1307`, `dashboard-web/src/components/CampaignDrawer.tsx:1011-1014`
**Why it matters:** Y-axis zero-suppression is the most common dashboard-misleads-operator pattern. A real example with this dashboard's settings:

```ts
domain={[
  (dataMin: number) => Math.max(0, dataMin * 0.88),
  (dataMax: number) => dataMax * 1.12,
]}
```

If CPM is CAD 10.00 every day except one spike at CAD 12.00, the Y axis renders as `[8.80, 13.44]` — the baseline appears at ~25% chart height and the spike at ~70%, visually a doubling. The actual change is +20%. Worse: a flat 10.00/10.10/10.20 pattern (2% variation) gets visually mapped to a "trending up sharply" curve.

The ROAS overlay has the same domain settings (`CampaignDrawer.tsx:1026-1029`), so the same distortion applies to the dashed green ROAS line.

Operationally this matters because the CPM chart sits next to a smart-analysis chip that says things like "CPM ירד 4% — חיובי" — the chart visual screams DRAMATIC FALL while the chip says 4%. The chart wins, every time.

The "right" answer depends on use:
- For absolute-value charts, `domain={[0, 'auto']}` (which the `RoasChart` correctly uses, line 99, and the area chart in the drawer correctly uses, line 810).
- For change-emphasizing charts, keep zero-suppression but mark it clearly: render a clipped/broken Y axis indicator + change the label tone so operators don't read it as full range.

**Fix:** Either start at 0 always, OR keep suppression but add a visible Y-axis broken-axis indicator + an inline caption "טווח הציר: X – Y (לא מתחיל באפס)". The current setup has no visible cue that the chart is non-linearly zoomed.

```ts
// Option A — start at 0 (recommended for an operator dashboard):
<YAxis domain={[0, (dataMax: number) => dataMax * 1.12]} ... />

// Option B — keep suppression but disclose:
<YAxis domain={[(dataMin: number) => Math.max(0, dataMin * 0.88), (dataMax: number) => dataMax * 1.12]} ... />
// + add to the chart card:
<div className="text-[10px] text-amber-700">⚠️ הציר אינו מתחיל באפס — שינויים קטנים נראים גדולים</div>
```

---

#### CR-03: HeroOverview RoasTrendChart drops zero-spend days but presents date axis as continuous

**File:** `dashboard-web/src/components/HeroOverview.tsx:350, 501-505`
**Why it matters:** The chart filters the series:

```ts
const series = data.filter(d => d.spend > 0 || d.revenue > 0);  // line 350
```

…then renders the X-axis as `<XAxis dataKey="date" hide />` (line 421) — so Recharts uses categorical (not time-scale) X positioning. Day 7 of the visible curve is drawn at the same X distance from day 6 whether the underlying calendar gap is 1 day or 5.

Below the chart, the date footer says:
```
{fmtDateShort(fromDate)} ... {series.length} ימים ... {fmtDateShort(toDate)}
```

So if the operator selects May 1–May 30, but only 17 days had data, the chart shows 17 points spread evenly across the chart width with the labels "01/05" on the left, "30/05" on the right, "17 ימים" in the middle. The operator's expectation: each X step = 1 day. Reality: each X step = roughly 1.7 days. A 2-day spike that crosses a paused weekend looks like a continuous trend.

Additionally, `daysInRange` is computed at line 196-201 from the unfiltered range bounds and is shown in the eyebrow header as `{daysInRange} ימים`. This will disagree with `{series.length} ימים` in the chart footer for the same scope — operator sees two different "how many days" counts. Confusion guaranteed.

**Fix:**
```ts
// 1) Don't filter — fill missing days with null and let connectNulls render gaps.
const series = enumerateDateRange(fromDate, toDate).map(date => {
  const d = data.find(x => x.date === date);
  return {
    date,
    revenue: d?.revenue ?? 0,
    spend: d?.spend ?? 0,
    roas: d && d.spend > 0 ? d.roas : null,  // null so the line breaks at gaps
  };
});

// 2) Match the eyebrow count:
<span>{daysInRange} ימים</span>
// (not series.length, which is post-filter)
```

---

### HIGH

#### HI-01: MetaShopifyReconciliation chart has weak color contrast and colorblind-hostile palette

**File:** `dashboard-web/src/lib/chartColors.ts:6-12`, `dashboard-web/src/components/MetaShopifyReconciliation.tsx:690-708`
**Why it matters:** The 5-line palette is:
- Meta: `#d97706` (amber)
- Google: `#2563eb` (blue)
- TikTok: `#ec4899` (pink)
- Organic: `#9333ea` (purple)
- Shopify: `#15803d` (green, dashed)

**Pink (TikTok) vs Purple (Organic) are adjacent hues** at ~340° vs ~280° on the wheel; with the chart at 32px height per line at 1.5px strokeWidth, they collapse to nearly identical magenta-ish lines for protanopia and deuteranopia (red-green colorblind, ~8% of male population).

**Amber (Meta) vs Green (Shopify)** is the most common red-green confusion at high opacity — and Shopify is *dashed* which is fine, but Meta is *85% opacity solid* (line 690) which the eye reads as the "actual" line. A colorblind operator inverts the meaning: they'll perceive Meta as the source of truth and Shopify as a derived secondary line. The dashboard's whole framing is "Shopify is truth, platforms are claims" — the visual encoding contradicts that for ~8% of viewers.

The legend at lines 714-750 has the same color failure mode plus an extra issue: the SVG legend swatch for Shopify (lines 737-748) uses `currentColor` with `className="text-roas-green"` — but the SVG is wrapped in a `<span class="inline-flex">` not a text element, and `currentColor` resolves to the inherited color, which on Tailwind's `<svg>` is browser-default (usually black). Quick test confirms the SVG would inherit from the closest `text-*` class; the className IS on the line itself which is the only element with currentColor. This is correct but fragile — any wrapper that injects an intermediate text color breaks it.

**Fix:**
1. Replace TikTok pink with a darker high-chroma color that's hue-separated from purple. E.g. `#0ea5e9` (sky blue — but conflicts with Google). Better: `#000000` (true black) or `#374151` (slate-700) — semantic "non-paid color" with maximum hue separation.
2. Add a pattern indicator (dotted vs dashed vs solid) to each line so the chart remains parseable in grayscale / printed.
3. Move the Shopify swatch to use a literal `stroke={CHART_COLORS.shopify}` instead of currentColor for robustness.

---

#### HI-02: Reconciliation chart Y-axis tick labels lose magnitude precision via `formatCurrency(v)` integer rounding

**File:** `dashboard-web/src/components/MetaShopifyReconciliation.tsx:648`
**Why it matters:**
```ts
tickFormatter={v => `C$${formatCurrency(Number(v))}`}
```

`formatCurrency(n)` defaults to `fractionDigits=0`. So when daily revenue spans $0–$3 (small product), the Y axis labels render `C$0, C$1, C$2, C$3` — but Recharts auto-picks ticks at fractional values like 0.5, 1.5, 2.5 → which all round to the same `C$0/1/2/3`, producing **duplicate adjacent tick labels** like `C$0, C$0, C$1, C$1, C$2`. The chart looks visually broken.

Similarly the CampaignDrawer's value/spend area chart (`CampaignDrawer.tsx:808`) uses `tickFormatter={v => `C$${formatCurrency(Number(v))}`}` — same issue for sub-dollar campaigns.

**Fix:** Use 2 decimal places for low-magnitude domains:
```ts
tickFormatter={v => {
  const n = Number(v);
  return `C$${formatCurrency(n, n >= 100 ? 0 : 2)}`;
}}
```

---

#### HI-03: Annotation pins on HeroOverview chart can stack/overlap unreadably on same day

**File:** `dashboard-web/src/components/HeroOverview.tsx:440-458`
**Why it matters:** When the operator logs 3 events on the same day (e.g., "launch", "budget", "sale"), the code renders 3 `<ReferenceLine x={a.date}>` elements with `label.position='top'` and the kind's emoji. Recharts places all 3 emoji labels at the same X coordinate, same Y position (top) — they **collide and render on top of each other**, completely unreadable. There's no offset logic, no stack, no "+2 more" indicator.

Worse, the SECOND fix that bumped `top` margin from 8 to 28 (line 414 comment) was added because *single* annotations were getting clipped. Multi-annotation stacking was never addressed; the operator just sees a smudge at the top of the chart with no way to disambiguate.

Real operational risk: launches + budget changes + creative refreshes often happen the same day. The chart loses fidelity exactly when the operator needs it most.

**Fix:** Group annotations by date in the loop and either:
1. Render one badge per date with a count, e.g. emoji of first + `+N` text, OR
2. Stagger the vertical position by index within the same date.

```ts
const byDate = new Map<string, Annotation[]>();
annotations.forEach(a => {
  if (!series.some(d => d.date === a.date)) return;
  if (!byDate.has(a.date)) byDate.set(a.date, []);
  byDate.get(a.date)!.push(a);
});
// Then render one ReferenceLine per date, label = first emoji + (count > 1 ? `+${count - 1}` : '')
```

---

#### HI-04: ROAS chart tooltip number formatting silently drops the "CAD" prefix for non-monetary metrics — but the same tooltip is reused for monetary values via formatNumber

**File:** `dashboard-web/src/components/RoasChart.tsx:133`
**Why it matters:** The tooltip displays:
```ts
<bdi dir="ltr" className="font-semibold ms-auto">
  {formatNumber(v)}  // 2 decimals, no currency prefix
</bdi>
```

But the data key is the store name — and the value (per `dailySeries` at `analytics.ts:149`) is `r.roas`, a unitless ratio. That's actually correct *for ROAS*. But the chart title is "מגמת ROAS לאורך זמן" so the tooltip should make units obvious — currently the tooltip just shows store name + a number with 2 decimals. An operator briefly hovering might confuse the 2.85 number for a different denomination (CAD?).

The tooltip in `HeroOverview.tsx:483-491` solves this better by labelling explicitly: `ROAS <bdi>{d.roas.toFixed(2)}</bdi>`. The `RoasChart` tooltip should follow that pattern.

**Fix:**
```tsx
<li key={String(entry.dataKey)} className="flex items-center gap-2">
  <span className="inline-block w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }} />
  <span className="text-white/85">{String(entry.dataKey)}</span>
  <bdi dir="ltr" className="font-semibold ms-auto">
    ROAS {formatNumber(v)}
  </bdi>
</li>
```

---

#### HI-05: Sparkline component returns empty placeholder (`< 2 values`) but consumer gates on `length >= 2` — boundary condition is correct, BUT min/max guard uses Infinity sentinels that breaks when ALL values equal target

**File:** `dashboard-web/src/components/Sparkline.tsx:51-53`
**Why it matters:**
```ts
const min = Math.min(...values, target ?? Infinity);
const max = Math.max(...values, target ?? -Infinity);
const range = max - min || 1;
```

If all values are identical to the target (e.g., constant ROAS = 3.0 for 7 days with target=3.0), `min === max === 3.0`, range falls back to 1, and every point's Y is `pad + (1 - (3.0 - 3.0)/1) * innerH = pad + innerH` — i.e., a flat line at the **BOTTOM** of the sparkline box, regardless of value.

A constant ROAS of 3.0 should render as a *centered* flat line (since the target line is at the same Y as the data) — but the data shows at the bottom. Reads visually as "trending toward zero" when it's actually a perfect-on-target metric.

Also note: when `target` is undefined and all values are identical, the same bug — flat line at the bottom — applies. A constant series should render visually centered to clearly communicate "no change."

**Fix:**
```ts
const allVals = target !== undefined ? [...values, target] : values;
const min = Math.min(...allVals);
const max = Math.max(...allVals);
const range = max - min;
// When range is degenerate (all equal), render the line centered:
const y = range > 0
  ? pad + (1 - (v - min) / range) * innerH
  : pad + innerH / 2;
```

---

#### HI-06: Reconciliation chart tooltip uses `formatCurrency(d.meta)` (integer rounding) — fractional cents disappear, sub-dollar revenue shows as CAD 0

**File:** `dashboard-web/src/components/MetaShopifyReconciliation.tsx:668, 672, 676, 680, 684`
**Why it matters:** The tooltip is the operator's high-precision view of a chart point. Cells in the table show rounded numbers; tooltips traditionally show full precision. Here every tooltip number defaults to integer:

```ts
<span>Meta: CAD {formatCurrency(d.meta)}</span>  // rounds 0.49 → "0"
```

For a campaign promoting a $1.99 product, **every tooltip number reads as CAD 0** unless the day has at least one $0.50 sale. Operator hovers, sees zero, concludes "no data" — incorrect.

Same precision issue in the per-day table at lines 805-809.

**Fix:** Pass 2 decimal precision in tooltips for sub-$100 values:
```ts
<span>Meta: CAD {formatCurrency(d.meta, d.meta < 100 && d.meta > 0 ? 2 : 0)}</span>
```
Even better: a `formatCurrencyAuto` helper that picks precision by magnitude (≥100 → 0 dp, ≥1 → 2 dp, <1 → 4 dp).

---

### MEDIUM

#### MED-01: HeroOverview chart `dir="ltr"` reverses date order under RTL parent — but the date labels at the bottom show fromDate on LEFT, toDate on RIGHT, which CONTRADICTS the chart's left-to-right time flow expectations under Hebrew

**File:** `dashboard-web/src/components/HeroOverview.tsx:370, 501-505`
**Why it matters:** The Hero is rendered in RTL parent. The chart container has `dir="ltr"` so the chart itself flows LTR (correct for time-series — earlier on left, later on right). But:
```jsx
<div className="flex items-center justify-between ... mt-1" dir="ltr">
  <span>{fmtDateShort(fromDate)}</span>
  <span className="text-white/35">{series.length} ימים</span>
  <span>{fmtDateShort(toDate)}</span>
</div>
```

The label container is also `dir="ltr"`, so fromDate is on the left (correct under LTR chart axis). Good.

But the eyebrow text 250 lines above (line 244):
```jsx
<span className="tabular-nums">
  {fmtDateShort(filters.range.from)} — {fmtDateShort(filters.range.to)}
</span>
```

…is inside the RTL parent without an explicit `dir`. The em-dash's bidi class can reorder the visual rendering; under RTL the operator may see `to — from` instead of `from — to`. This is the classic "date range reads backwards in Hebrew" bug that triggered the `<bdi>` helpers in lib/format.

Wrap with `<bdi dir="ltr">`:
```jsx
<bdi dir="ltr" className="tabular-nums">
  {fmtDateShort(filters.range.from)} — {fmtDateShort(filters.range.to)}
</bdi>
```

---

#### MED-02: CampaignDrawer area chart legend dots are swapped relative to Recharts render order

**File:** `dashboard-web/src/components/CampaignDrawer.tsx:825-826, 830-839`
**Why it matters:** Chart areas are drawn in source order; the LAST `<Area>` paints on top. The chart renders:
```tsx
<Area type="monotone" dataKey="value" ... fill="url(#drawer-value)" />
<Area type="monotone" dataKey="spend" ... fill="url(#drawer-spend)" />
```
So **spend** paints on top of value. But the legend below lists `ערך המרות` first then `הוצאה` second — visually "value is dominant" while the chart actually shows spend dominant (overlaying value).

For most campaigns where value > spend (ROAS > 1), the green value curve peeks above the red spend curve at the top and below it at the bottom, which looks coherent. But when ROAS < 1 (spend > value), the green curve is completely hidden behind red spend area; the operator sees only red and the legend implies "but green is here too" — confusing for poor-ROAS campaigns where this view matters most.

**Fix:** Render `value` last so it's on top, OR use stroke-only (no fill) for one of them so both lines are visible regardless of order.

---

#### MED-03: ReferenceLine at ROAS=3 drifts with auto-scaled Y axis (drawer + Hero area chart), correctly anchored in `RoasChart`

**File:** `dashboard-web/src/components/HeroOverview.tsx:422`, `dashboard-web/src/components/RoasChart.tsx:103-109`
**Why it matters:**
- `RoasChart.tsx` uses `domain={[0, 'auto']}` — ROAS=3 reference line position is meaningful (always at a constant Y-fraction of the chart given a 0-anchored axis).
- `HeroOverview.tsx:422` uses `domain={[0, maxRoas]}` where `maxRoas = Math.max(3.2, ...series.map(d => d.roas))` — also 0-anchored, so the reference line stays at 3/maxRoas which IS visually accurate.

So actually OK in those two places. But consider: the Hero chart auto-floors at 3.2 so the reference line is always close to the top (3/3.2 = 93%). For a high-performing store with ROAS 8, the reference line drops to 3/8 = 37.5% — visually a different position even though the *meaning* (target 3.0) is invariant. The operator's eye anchors to the line position; if it moves between zoom levels, they have to re-orient. Not a blocker, but worth noting that the dashed reference line is most useful when **shown alongside a consistent Y axis** so its visual position == its semantic position.

Fix is to anchor the Y domain at a fixed maximum (e.g., `domain={[0, Math.max(maxRoas, 6)]}`) so the target line position is stable across stores. Otherwise, hovering across stores in the same dashboard view, the operator perceives "target moved up" or "target moved down" which is false.

---

#### MED-04: CohortComparisonPanel `MedalIcon` is fine for ranks 1-3 and 4+, but the section's currentRankIntra status logic doesn't handle ties — if two campaigns have identical roasShopify, both could legitimately be #1 but the array index ordering decides — operator may see "אתה החלש" when actually tied

**File:** `dashboard-web/src/components/CohortComparisonPanel.tsx:261-265, 276`
**Why it matters:**
```ts
intraSection.sort((a, b) => {
  const sa = a.metrics ? a.metrics.roasShopify * 1e6 + a.metrics.roasShopifyPlatform * 1e3 + a.metrics.spend : -Infinity;
  ...
});
```

The composite key uses ROAS as primary, ROAS-platform as tiebreak, spend as final tiebreak — clever, but if a "current" campaign has identical or very-close-to-zero `roasShopify`, it gets pushed to the back. Then:
```ts
const currentRankIntra = intraSection.findIndex(m => m.isCurrent) + 1;
```
…returns the sorted-position which may render as "אתה החלש בקבוצה" (line 315) when the underlying difference is .001 ROAS — operationally indistinguishable from a tie. The badge is colored `bg-roas-redBg` (loud red) which is a strong negative signal for a near-tie.

The HIGH-02 audit comment at line 302-307 attempts to mitigate by gating loud red on `intraCount >= 3`, but doesn't address ties.

**Fix:** Detect "near tie" (e.g., relative diff < 5%) and downgrade the badge tone. Or always require a meaningful margin (e.g., 10%) before claiming "החלש".

---

#### MED-05: Sparkline color tokens hardcoded as RGB strings instead of using design system tokens

**File:** `dashboard-web/src/components/KpiCards.tsx:233-235`
**Why it matters:**
```ts
const sparkColor =
  accent === 'pos' ? 'rgb(21, 128, 61)' // roas-green
  : accent === 'neg' ? 'rgb(220, 38, 38)' // roas-red
  : 'rgb(13, 54, 128)'; // primary
```

These RGB constants are duplicated from Tailwind's roas-green / roas-red / primary — if the design system changes the token (e.g., re-tune the green to be more accessible), this hardcoded copy silently drifts. The comments explain the link but compiler can't catch the drift.

Also: sparkline color reflects the CARD's accent (only pos/neg for the net-profit card) — not the metric's TREND. The Q22 expectation was "positive trend = green, negative = red" — but here a *good metric* (revenue) trending DOWN still gets primary blue, while only net-profit gets red/green at all. This contradicts the audit question's premise and may confuse operators who expect sparkline color to match the delta pill's color.

**Fix:** Either pass color through CSS custom properties bound to design tokens, or drive sparkColor from `delta.direction` + `inverseDelta` (matching the delta pill's coloring logic at lines 223-224).

---

#### MED-06: AttributionAnalysisPanel deterministic vs modeled bars use opacity-25 vs opacity-70 to differentiate — operator can't distinguish them in screenshots / dim displays

**File:** `dashboard-web/src/components/AttributionAnalysisPanel.tsx:89-99`
**Why it matters:**
```tsx
<div className="h-full bg-current opacity-70" style={{ width: ... }} />
<div className="h-full bg-current opacity-25" style={{ width: ... }} />
```

Both segments use the same `bg-current` color (inherited from the trustBg color, which itself is e.g. `text-roas-green`). The only visual distinction is opacity 70 vs 25 — a 2.8x ratio. On a "high trust" card with `bg-roas-greenBg/50` background plus green segments at 70%/25%, the modeled segment is barely visible against the background. The legend above is text-only; without a color difference, the visual breakdown isn't a chart, it's two slightly-darker green blobs.

**Fix:** Use distinct colors (e.g., `bg-current` for deterministic, hatched/striped pattern for modeled), or use solid + outline-dashed.

---

#### MED-07: ProductChannelBreakdown stacked bar can produce zero-width segments AND can sum to > 100% — `total` is the source of truth but `other = Math.max(0, total - fb - google - tiktok - direct)` does NOT subtract `other-referral` source which is also in `breakdown.bySource`

**File:** `dashboard-web/src/components/ProductChannelBreakdown.tsx:37, 83-89`
**Why it matters:**
```ts
const other = Math.max(0, total - fb - google - tiktok - direct);
...
<div className="h-full bg-roas-blue"   style={{ width: `${(fb / total) * 100}%` }} />
<div className="h-full bg-amber-500"   style={{ width: `${(google / total) * 100}%` }} />
<div className="h-full bg-pink-500"    style={{ width: `${(tiktok / total) * 100}%` }} />
<div className="h-full bg-text-muted"  style={{ width: `${(direct / total) * 100}%` }} />
<div className="h-full bg-text-subtle" style={{ width: `${(other / total) * 100}%` }} />
```

When `total === 0`, every width becomes `NaN%` — rendered as either nothing or browser-default. The component is gated by parent on `total >= 3` for the amber chip but not for the bar itself; if upstream changes the gating, the bar silently breaks.

Separately: the `direct` bucket is `bySource['direct']?.orders ?? 0` — but `bySource` may have other source keys (`other-paid`, `email`, `social-organic`, etc.) that the explicit subtraction doesn't account for. The `other = total - fb - google - tiktok - direct` math can therefore *overcount* "other" by including buckets that have their own classification in `bySource`. The chart will visually inflate the gray "other" segment with bars that are accounted for elsewhere — operator can't trust the segment widths.

**Fix:**
```ts
if (total <= 0) return null; // or render empty-state
// Compute "other" as the residual of ALL known sources, not just the 4 explicit ones:
const known = Object.entries(breakdown.bySource ?? {})
  .reduce((acc, [k, v]) => {
    if (['facebook-paid', 'google-paid', 'tiktok-paid', 'direct'].includes(k)) return acc + v.orders;
    return acc;
  }, 0);
const other = Math.max(0, total - fb - google - tiktok - direct);  // OR list all sources explicitly
```

---

### LOW

#### LOW-01: HeroOverview tooltip mixes Hebrew RTL with embedded LTR digits inconsistently

**File:** `dashboard-web/src/components/HeroOverview.tsx:483-490`
**Why it matters:** The tooltip has `dir="rtl"` outer + multiple `<bdi dir="ltr">` for digits. But `ROAS` (Latin letters) sits naked in the RTL container at line 485, and `הכנסות`/`הוצאה` labels share a line with `<bdi>`-wrapped digits. The bidi rendering of mixed Hebrew + Latin word + LTR digit can place the digit at unexpected positions on some browsers (older Safari especially). Lower priority because the `<bdi>` does its job for the digit *itself*, but inconsistent — `RoasChart`'s tooltip wraps the entire numeric atom but `HeroOverview`'s doesn't.

**Fix:** Wrap `ROAS` similarly: `<bdi dir="ltr">ROAS {d.roas.toFixed(2)}</bdi>` or use the labelled `fmtNum2` pattern.

---

#### LOW-02: RoasChart legend's "יעד 3.0" reference indicator uses `border-roas-green` for the dashed line preview, but the actual chart reference line uses hex `#16a34a` — colors are similar but not identical, and they should be tied to the same token

**File:** `dashboard-web/src/components/RoasChart.tsx:78, 105`
**Why it matters:** Legend swatch uses `border-roas-green` (Tailwind utility); actual ReferenceLine uses hardcoded `#16a34a`. `roas-green` in the Tailwind theme is `#15803d` (700) but `#16a34a` is `green-600`. Two different greens. Operator probably doesn't notice in a single chart, but a careful eye catches the inconsistency, and any green-token refactor breaks the legend-to-chart sync.

**Fix:** Use the same color source — either inline the hex on both sides or use the Tailwind token in both via `CHART_COLORS` constants.

---

#### LOW-03: CampaignsTable + CampaignDrawer CPM legends and the chart use slightly different dashes — legend has `border-dashed` (CSS) and the chart has `strokeDasharray="5 3"` — visual pattern doesn't match exactly

**File:** `dashboard-web/src/components/CampaignDrawer.tsx:1132, 1099`, `dashboard-web/src/components/CampaignsTable.tsx:1420, 1389`
**Why it matters:** CSS `border-dashed` is browser-default `[4px, 2px]`-ish (varies); SVG `strokeDasharray="5 3"` is exactly 5px dash + 3px gap. The legend swatch doesn't match the chart line's exact pattern. Low priority cosmetic, but it weakens the "legend = chart" promise.

**Fix:** Replace CSS `border-dashed` legend swatches with inline SVG dashed lines that match the chart's `strokeDasharray`.

---

#### LOW-04: CohortComparisonPanel `StatusBadge` returns null for missing status, displays "פעיל" or "כבוי" for known statuses — but TikTok status `ADGROUP_STATUS_DELIVERY_OK` is hard-coded in the active list; other valid TikTok states (paused, in-review) all fall through to "כבוי" which is misleading for "in-review"

**File:** `dashboard-web/src/components/CohortComparisonPanel.tsx:68-86`
**Why it matters:** The chip says either "פעיל" (active green) or "כבוי" (paused/off gray) — no middle ground for "in review" / "rejected" / "removed" statuses. Operator sees "כבוי" for a campaign awaiting review and may relaunch it manually. The chip color matches its text consistently (good), but the binary classification loses semantic information.

**Fix:** Add an "אחר" or specific intermediate state for non-active-non-paused statuses.

---

#### LOW-05: MetaShopifyReconciliation per-day table uses `s.date.slice(5)` for column 1 → renders as `MM-DD` instead of `DD/MM/YYYY` (he-IL convention) — and the format is inconsistent with the chart tooltip's `formatDate(d.date)` which renders `DD/MM/YYYY`

**File:** `dashboard-web/src/components/MetaShopifyReconciliation.tsx:804`
**Why it matters:** A hover on the chart shows `23/05/2026`; the table row right below shows `05-23`. Same date, two formats, opposite digit orders (the slice is `MM-DD` not `DD-MM`). Operator scanning the table sees "05-23" and unconsciously parses as "05 May, day 23" or "MM-DD" — in Hebrew context, where leading digit is the day, this reads wrong.

**Fix:** Use `fmtDateShort` everywhere for short dates:
```tsx
<td>{fmtDateShort(s.date)}</td>  // → "23/05"
```

---

## Per-chart verdict

- **RoasChart.tsx** (multi-store ROAS over time): **TRUSTWORTHY**. Y axis starts at 0, target reference line consistently rendered, tooltip displays per-store breakdown, colors picked for hue separation (~120° wheel apart). Minor cosmetic issues: tooltip lacks "ROAS" unit label (HI-04), reference line color hex drifts from legend token (LOW-02). Operator can read this chart correctly.

- **Sparkline.tsx** (KPI card mini-charts): **MOSTLY TRUSTWORTHY** with one degenerate-input bug. When all values equal each other (or equal the target), the line draws at the bottom of the box instead of the center (HI-05). Otherwise sound. Sparkline scale (per Q21) is independent per card and there's no indicator informing the operator that two adjacent sparklines aren't comparable — operationally this is a known sparkline tradeoff, not a bug.

- **HeroOverview.tsx → RoasTrendChart**: **MISLEADING**. Zero-spend days dropped from series, but date axis shown as continuous from→to (CR-03). Inconsistent day-count between eyebrow and footer. Annotation pins stack illegibly on same-day events (HI-03). Tooltip number formatting better than RoasChart's but still mixes Hebrew/Latin in places that bidi could mangle (LOW-01).

- **MetaShopifyReconciliation.tsx → ComposedChart**: **MISLEADING in colorblind palettes**. 5 lines with one inadequately hue-separated pair (TikTok pink + Organic purple) and a Meta amber that confuses with Shopify green for red-green colorblind viewers (HI-01). Y axis labels show duplicate values for sub-dollar series (HI-02). Tooltip numbers integer-rounded for low-value campaigns (HI-06). The chart correctly renders TikTok now (post-T1.2 fix verified in code), and the Shopify dashed pattern is a strong differentiator for sighted users.

- **CampaignsTable.tsx → CPM-over-time LineChart**: **MISLEADING**. Y axis zero-suppressed exaggerates noise (CR-02). Previous-period overlay aligns by index of filtered series, NOT by calendar date — paused days warp the comparison (CR-01). Otherwise tooltip is well-structured and shows Δ% appropriately.

- **CampaignDrawer.tsx → AreaChart + LineChart**: **PARTIALLY MISLEADING**. Same CR-02 zero-suppression. Same CR-01 index-alignment in the CPM chart. AreaChart for value vs spend has render-order issue where spend overpaints value (MED-02). Y-axis tick labels for low-value campaigns show duplicates (HI-02). Otherwise tooltip is rich.

- **AnnotationsPanel.tsx**: **OK** for the panel itself (list + form). The chart integration is handled by HeroOverview's RoasTrendChart and inherits HI-03 stacking issue.

- **KpiCards.tsx → Sparkline embedding**: **OK** with caveats. Sparkline scaling is independent per card (per spec); sparkColor only differentiates pos/neg for one card type (net-profit); the chart-color tokens are duplicated as hardcoded RGB strings (MED-05). No misleading scaling, but the visual feedback is weaker than the spec promised.

- **AttributionAnalysisPanel.tsx**: **OK with weak segment differentiation**. The "deterministic vs modeled" stacked bar uses opacity-only to distinguish segments, which fails on screenshots / low-contrast displays (MED-06). The clamp to [0, 100] from the FIX-12 audit comment is correctly applied.

- **ProductChannelBreakdown.tsx**: **OK with NaN risk**. The 5-segment stacked bar can produce `NaN%` widths when total is 0; current parent gating mitigates but isn't defensive (MED-07). The "other" segment math also undercounts when bySource has uncategorized buckets.

- **CohortComparisonPanel.tsx**: **OK**. Medals correct, status badges semantically narrow (LOW-04), tie-breaking in ranking is composite-key sorted but can produce confidently-loud "weakest" badges for near-tied campaigns (MED-04). The HIGH-02 audit comment correctly gates the loud red on `intraCount >= 3` floor.

- **chartColors.ts**: **REVIEW NEEDED for accessibility**. The 11 hex constants are reasonable for sighted users but the (Meta amber #d97706, Shopify green #15803d) pair is the most common red-green confusion, and (TikTok pink #ec4899, Organic purple #9333ea) pair is too close in hue (HI-01).

---

## Question-by-question verdicts

1. **Dual-axis Y normalization**: CPM chart's ROAS overlay (`CampaignsTable.tsx:1310-1325`, `CampaignDrawer.tsx:1017-1032`) correctly uses two `<YAxis>` with distinct `yAxisId`. Each scales independently. So spend-at-CAD-50 and ROAS-at-2.5 won't collapse onto each other visually. **OK**.
2. **Y-axis zero suppression**: **VIOLATED** in CPM charts (CR-02). Correct in RoasChart, HeroOverview RoasTrendChart, and CampaignDrawer area chart.
3. **X-axis date formatting + gap handling**: Dates rendered as `MM/DD` (line 1293, 999) — *not* the he-IL convention of `DD/MM`. RTL containers wrap a `dir="ltr"` chart sub-tree. Gaps handled as filtered-out (continuous interpolation across deleted days), NOT as gaps — this is the CR-01 / CR-03 issue. **VIOLATED**.
4. **Multi-platform line chart with $0 days**: MetaShopifyReconciliation uses `series` mapped from `enumerateDateRange` (line 303-310) so every day is in the series with value 0 → chart correctly shows continuous 0 line. **OK**.
5. **Tooltip precision vs cell precision**: Drawer/reconciliation tooltips use `formatCurrency(d.meta)` integer rounding (HI-06) — cells also integer. So no inconsistency, but tooltips give up precision they could provide. **PARTIAL**.
6. **Tooltip currency label**: Most tooltips include "CAD" (drawer line 819, 1054; reconciliation line 668-684). RoasChart tooltip omits unit (HI-04). **MOSTLY OK**.
7. **Tooltip date labels**: Use `formatDate(d.date)` → `DD/MM/YYYY` (he-IL style) consistently. **OK**.
8. **Stacked area chart breakdown**: The drawer area chart isn't stacked (overlay), so no "breakdown" expected. Tooltip shows both lines. **OK**.
9. **Color contrast across platforms**: **FAILS** for colorblind viewers on (Meta vs Shopify) and (TikTok vs Organic). HI-01.
10. **Legend color matches line color**: Mostly matches but uses Tailwind tokens in legends and hex literals in lines — drift risk. RoasChart legend dashed indicator uses different green hex than its reference line (LOW-02). **MOSTLY OK**.
11. **Legend click toggle**: **NO TOGGLE IMPLEMENTED**. All legend items are static `<span>` elements. Operator cannot hide individual lines. The MetaShopifyReconciliation has 5 lines that overlap heavily without a way to focus on one — significant UX limitation but documented design (no toggle was promised). **Spec OK, UX limited**.
12. **Reference line at ROAS=3.0**: Position is technically accurate (both charts use 0-anchored Y axis) but visual position varies with auto-scaled max (MED-03). Acceptable for single-store but moves across views.
13. **Annotation overlap**: **FAILS** — HI-03. Multiple annotations on same day render emoji on top of each other.
14. **AnnotationsPanel ↔ chart alignment**: Annotations correctly match by `d.date === a.date` (HeroOverview line 441). When the date is in the visible filtered series, the pin renders at the right place. When the date is NOT in the filtered series (because that day was zero-spend), the annotation silently disappears from the chart — but still shows in the AnnotationsPanel list, so the operator sees "event logged for X day" but the chart has no pin. Confusing edge case linked to CR-03.
15. **Single-data-point chart**: HeroOverview gates on `series.length >= 2` (line 365). CPM charts gate on `cpmSeries.length >= 2` (drawer line 861). Other charts: RoasChart's `Sparkline` returns empty placeholder for `length < 2`. **OK** — single-day shows nothing instead of an unintelligible dot.
16. **All-zero-data chart**: HeroOverview has the FIND-04 audit fix at line 394-400 to return `'—'` instead of `Infinity` for min — fix correctly in place. The chart line itself would be at Y=0 across all days (since `domain={[0, maxRoas]}` with maxRoas=3.2 floor), correctly visible as a flat line. **OK**.
17. **Loading state**: SWR re-fetches return stale data while in flight. No skeleton or spinner specific to charts; CampaignsTable shows a "טוען נתוני קמפיינים…" string at line 1497 but only when `isLoading` is true (no cached data). Mid-revalidation, the existing chart re-renders with new data — no visual cue that data is updating. **VIOLATED** (not visually distinct from "no data"; SWR keeps the prior render until new data arrives).
18. **TikTok line color in reconciliation**: Pink `#ec4899` is rendered (line 692). Visually distinguishable from Organic purple `#9333ea` for sighted users (~60° hue gap) but problematic for colorblind viewers (HI-01). **PARTIAL**.
19. **Stacking order in reconciliation**: Meta → Google → TikTok → Organic → Shopify (last). So Shopify dashed line draws on top (intended, source-of-truth). **OK** — render order intentional.
20. **CPM previous-period alignment**: **VIOLATED** — CR-01. Aligns by index of filtered series, not by date.
21. **Sparkline scale comparability**: Each card's sparkline normalizes independently. Operator gets no warning that sparklines aren't comparable absolute. Standard sparkline tradeoff (not a bug per design), but worth a tooltip / hover-help. **AS-DESIGNED**.
22. **Sparkline color**: Only the net-profit card uses pos/neg coloring; other cards always use primary blue regardless of trend direction (MED-05). Doesn't match the audit question's premise of "positive trend = green, negative = red." **PARTIAL**.
23. **Medal column rank ≥ 4**: `MedalIcon` correctly returns `#N` text for ranks ≥ 4 (line 51). **OK**.
24. **Member status chip color**: `StatusBadge` uses consistent `bg-roas-greenBg/40 text-roas-green` for active and `bg-surfaceMuted text-text-muted` for off (line 76-80). Color matches the text semantic. **OK**.

---

## What's visually solid

- **RoasChart.tsx**: Multi-store line chart with clear color separation, 0-anchored Y axis, target reference line at constant position, RTL-aware tooltip with per-store breakdown, dot-free clean styling. Operator can trust this chart's visual fidelity. The only watch-item is the tooltip's missing unit label (HI-04).

- **CampaignDrawer area chart Y-axis**: The Phase 05.7.x fix to add visible CAD Y-axis labels (was previously `hide`) closed the "peaks indistinguishable from troughs" failure — the chart now communicates magnitude correctly. Good remediation.

- **HeroOverview RoasTrendChart, on its own merits when the operator selects a fully-active range**: The 0-anchored Y axis, target reference line, tooltip-with-context, and annotation overlay are well-designed. The failure mode (CR-03) only manifests with paused days.

- **MetaShopifyReconciliation per-day table**: The FIX-16 / FIX-02 audit-fixed delta classification (`computeDayDelta`) handles edge cases (channels-only, Shopify-only, both-zero) cleanly with appropriate neutral/green/red tones. Operator gets correct semantic chips, not just `NaN%`.

- **Sparkline component for non-degenerate input**: Pure SVG, fast, RTL-safe via parent `dir="ltr"` wrapping, target line + endpoint dot. The HI-05 bug only fires on perfectly-constant input.

- **CohortComparisonPanel ranking**: The 3-tier sort key (roasShopify → roasShopifyPlatform → spend) is well-considered. Medal mapping is correct. The audit-comment-gated loud-red threshold (intraCount >= 3 only) handles the 2-cohort "loser by construction" trap.

- **chartColors.ts**: A central token file for all chart hex literals is the right architecture. The Phase comment at line 1 ("single source of truth") is correctly followed throughout the codebase. The issues with the actual color choices (HI-01) don't undermine the design.

---

_Reviewed: 2026-05-23_
_Reviewer: gsd-code-reviewer (adversarial mode)_
_Depth: deep (cross-file: 12 files, ~6,000 lines analyzed; cross-reference: annotation library, format helpers, analytics helpers)_
