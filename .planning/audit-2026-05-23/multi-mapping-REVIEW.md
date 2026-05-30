---
audit: multi-mapping intelligence (cohort + cannibalization + product-centric + health adjustment)
reviewed: 2026-05-23
scope:
  - dashboard-web/src/lib/multiMappingCohort.ts
  - dashboard-web/src/lib/cannibalizationDetection.ts
  - dashboard-web/src/lib/productCentricView.ts
  - dashboard-web/src/lib/campaignHealthScore.ts (cohort portion only)
  - dashboard-web/src/components/CohortComparisonPanel.tsx
  - dashboard-web/src/components/ProductCentricView.tsx
findings:
  critical: 2
  high: 5
  medium: 6
  low: 4
verdict: NOT fully trustworthy — leader/weakest labels are noisy on small cohorts and the displayed metric in the panel is mislabeled. Cannibalization HIGH is mostly defensible; LOW is over-eager. Read the per-finding fixes before relying on the chips for scale/pause decisions.
---

# Multi-mapping intelligence audit — 2026-05-23

## Summary

Trust posture per signal:

- **"Cohort leader" 🥇 / "cohort weakest"** — **NOT yet reliable**. The ranking formula is dominated by raw ROAS with no minimum-spend floor, so a $40-spend campaign with ROAS 10 (1 lucky order) will rank above a $20K-spend campaign with ROAS 4. The displayed "ROAS Shopify" column in the cohort panel is currently fed `conversionValue/spend` (Meta-Pixel claim) for non-current members in the drawer code path, not the Shopify-allocated ROAS the label promises — so the column the operator reads to validate the chip is **mislabeled** (CRITICAL-01 + CRITICAL-02).
- **"Cannibalization HIGH"** — Mostly **defensible** when the cohort has steady multi-week spend. Logic is sound. Two false-positive vectors exist: (a) campaign-paused-mid-range scenarios, where the algorithm divides a non-comparable early window into the late window (HIGH-03); (b) the deterministic-Pixel-only spend feed has no fee/tax handling so very-noisy small budgets cross the 25%/5% threshold easily (MEDIUM-04).
- **"Cannibalization LOW"** — **Over-eager**. The threshold (spend ≥ +10% AND revenue < spend × 0.75) means a campaign that grows spend 10% and revenue 7% gets flagged — that's within day-of-week noise on a 14-day window. Recommend raising the floor or hiding LOW from operator-facing banners (HIGH-04).
- **Product-centric pivot** — **Solid arithmetic**. Shares and allocated revenue sum correctly. One real bug: `byPlatform` includes platforms with zero qualifying members (HIGH-05). One semantic confusion: comment claims a deterministic-then-proportional allocator, code is a flat proportional split (MEDIUM-05).
- **Cohort health adjustment** — Math is correct. The `−15` cap is documented and clamping works. BUT the comment in the adjustment block lies: it says "Maximum cumulative negative: −15 (weakest + high cannibalization)" while the code can actually only reach this stack when `cohortSize >= 3` AND there's a HIGH-risk shared product — the comment doesn't mention the cohortSize floor (LOW-04). The own tests explicitly verify the leader-and-weakest case stacks to `-2`, which contradicts the "leader wins" docstring (LOW-03).

**Bottom line for the operator:** Treat the "leader / weakest" chip as a hint, not a verdict, until CRITICAL-01 + CRITICAL-02 + HIGH-01 are fixed. Cannibalization HIGH is worth acting on; LOW is currently noise; MEDIUM is borderline. Do not trust the "ROAS Shopify" column inside the cohort panel — it's the Pixel-claimed ROAS labeled as Shopify.

---

## Findings

### CRITICAL-01 — Cohort-panel "ROAS Shopify" column shows Meta-Pixel ROAS, not Shopify ROAS

**File:** `dashboard-web/src/components/CampaignDrawer.tsx:484-510` + `dashboard-web/src/components/CohortComparisonPanel.tsx:133` (column header "ROAS Shopify")

**Evidence (drawer wiring):**
```ts
// CampaignDrawer.tsx:488
const roasByKey = new Map<string, number>();
for (const a of cohortAggregated) {
  roasByKey.set(a.key, a.spend > 0 ? a.conversionValue / a.spend : 0);
}
return computeMultiMappingCohort({
  ...
  roasShopifyByKey: roasByKey,            // ← Pixel-claimed conversion value / spend
  roasShopifyPlatformByKey: roasByKey,    // ← same Pixel value
});
```

The drawer cohort `cohortAggregated` builder explicitly aggregates `conversionValue` from `/api/campaigns` daily rows (i.e. the **platform-reported** Pixel value). It is then passed into `roasShopifyByKey` and rendered in the panel's column labeled "ROAS Shopify" (`CohortComparisonPanel.tsx:133, 190`). The operator sees a Hebrew column header `ROAS Shopify` but is reading `conversionValue / spend` — the unverified platform claim.

**Why it matters:** This is the SOLE numerical evidence the panel gives for the leader/weakest verdict. An operator looking at the chip "you are weakest in cohort" will validate it against this column. If the column secretly shows Pixel ROAS, the chip's verdict no longer matches the table — and the chip is itself derived from the same wrong ROAS so both are wrong together. A campaign that is the Shopify-deterministic loser but the Pixel winner will be labeled "cohort leader" by both the chip AND the table — silently incorrect.

**Fix:** Thread the parent's `trueRevenueByKey` (Shopify-allocated revenue) and the deterministic-only platform value through to the drawer's cohort computation. The drawer comment already acknowledges the limitation:
```ts
// CampaignDrawer.tsx:399-401
// use a SIMPLER proxy here: ROAS = conversionValue / spend
// (platform-reported). This is the same number the campaigns-table
// "ROAS" column shows...
```
But the panel header is `ROAS Shopify` — the proxy and the label disagree. Either:
1. Pass real Shopify ROAS into the cohort (preferred — restores the contract the type annotations + `multiMappingCohort.ts:54-61` JSDoc promise), OR
2. Rename the column in `CohortComparisonPanel.tsx:190` to `ROAS פלטפ.` (Pixel) until the wiring is done.

Note: the table-level `healthByKey` memo (`CampaignsTable.tsx:552-555`) **does** use `info.trueRevenue / info.spend`, so the leader/weakest chip on the table-row level uses the correct ROAS. The bug is specific to the cohort panel inside the drawer.

---

### CRITICAL-02 — Ranking formula has no minimum-spend floor; tiny-spend anomalies rank above big-spend reality

**File:** `dashboard-web/src/lib/multiMappingCohort.ts:117-124`

**Evidence:**
```ts
function rankingScore(m: CohortMember): number {
  if (!m.metrics) return -Infinity;
  return (
    m.metrics.roasShopify * 1_000_000 +
    m.metrics.roasShopifyPlatform * 1_000 +
    m.metrics.spend
  );
}
```

Concrete worked scenario the user explicitly asked about:
- Campaign A: spend = $40, 1 lucky order, ROAS = 12
- Campaign B: spend = $20,000, 350 orders, ROAS = 4

Scores:
- A: `12 × 1e6 + 12 × 1e3 + 40 = 12,012,040`
- B: `4 × 1e6 + 4 × 1e3 + 20,000 = 4,024,000`

A ranks 3× higher than B. A is labeled "leader" 🥇, B is labeled "weakest". The operator looking at this drawer will be told to scale A and pause B — exact opposite of correct. The spend tertiary tiebreaker is so far down the polynomial it cannot compensate (every 1.0 ROAS unit = 1,000,000 spend units of weight). For the spend tertiary to ever override ROAS, the two ROAS values must be identical to ~6 decimal places.

**Why it matters:** Multi-mapped products are exactly where small experiment campaigns sit alongside mature mass campaigns. The ranking will systematically favor noise. This is the single most damaging defect in the suite because it propagates everywhere: cohort chip in the table, cohort panel ranking, "you are the leader/weakest" Hebrew banner, AND the `applyCohortHealthAdjustment` ±3/−5 deltas.

**Fix:** Apply a sample-size weighting before ROAS counts. Two minimal-disruption options:

```ts
const ROAS_MIN_SPEND_FLOOR = 100; // CAD; below this, ROAS is a 50/50 coin

function rankingScore(m: CohortMember): number {
  if (!m.metrics) return -Infinity;
  // Bayesian shrinkage toward 1.0 ROAS as spend → 0
  const k = ROAS_MIN_SPEND_FLOOR;
  const w = m.metrics.spend / (m.metrics.spend + k); // 0..1
  const shrunkRoas = m.metrics.roasShopify * w + 1.0 * (1 - w);
  const shrunkRoasPlat = m.metrics.roasShopifyPlatform * w + 1.0 * (1 - w);
  return shrunkRoas * 1_000_000 + shrunkRoasPlat * 1_000 + m.metrics.spend;
}
```

Or, simpler but less mathematically clean: hard floor — campaigns with spend < $100 (or `cohort_max_spend × 5%`) get bucketed at score `0` for ranking purposes, with a "insufficient sample" footnote in the panel.

Add a test in `multiMappingCohort.test.ts` codifying: "A ($40, ROAS 12) vs B ($20K, ROAS 4) → B ranks above A".

---

### HIGH-01 — `roasShopifyPlatformByKey` tie-breaker is non-functional in all call sites today

**File:** `dashboard-web/src/components/CampaignsTable.tsx:582-584` and `CampaignDrawer.tsx:507-508`

**Evidence:**
```ts
// CampaignsTable.tsx:582-584
computeMultiMappingCohort({
  ...,
  roasShopifyByKey,
  roasShopifyPlatformByKey: roasShopifyByKey,   // ← literally the same map
});
// CampaignDrawer.tsx:507-508
roasShopifyByKey: roasByKey,
roasShopifyPlatformByKey: roasByKey,            // ← literally the same map
```

The ranking score is `roasShopify * 1e6 + roasShopifyPlatform * 1e3 + spend`. The middle term, the "platform-deterministic ROAS used as a tie-breaker when the combined ROAS is equal", is fed the SAME value as the primary, so it tie-breaks against itself and contributes zero discrimination.

**Why it matters:** The JSDoc in `multiMappingCohort.ts:56-61` and `multiMappingCohort.ts:152-167` promises the deterministic-only ROAS is the discriminator when combined ROAS ties. The tests (`multiMappingCohort.test.ts:257-279`) verify this discrimination using **different** values for the two maps — proving the algorithm works in isolation. But in production, callers feed the same map. So:
- Two campaigns with identical Shopify-allocated ROAS will fall through to the `spend` tiebreaker. This is the "tie handling" question: in production today, ranking is **deterministic** (`Array.prototype.sort` is stable in V8 since 2018; the iteration order of `Object.entries(productMap)` is insertion order) BUT not in the way the comments claim. Operators reading the chip will be told "you're #1 because deterministic ROAS is higher" — false, the algorithm collapsed to spend ordering.
- The fix for CRITICAL-02 also depends on this being wired correctly; without a real deterministic-only ROAS in production, the secondary signal cannot be used to penalize "high-ROAS but low-coverage" anomalies.

**Fix:**
1. In `CampaignsTable.tsx`, compute a second map from postgres' `shopifyValuePlatform` column (the deterministic-only Shopify value) divided by spend, and pass it as `roasShopifyPlatformByKey`. The column already exists and is rendered as "ערך Shopify · פלטפורמה" (`campaignsColumnPrefs.ts:60`) — it is plumbed all the way to the table, just not into the cohort module.
2. In `CampaignDrawer.tsx`, repeat: compute a `roasShopifyPlatform = shopifyValuePlatform / spend` per member from the same rows.
3. Test in `multiMappingCohort.test.ts`: prove the production wiring discriminates as documented. The current passing tie-breaker tests give false confidence.

---

### HIGH-02 — `isWeakest` flag is true for 2-cohort losers; UI advertises it as a "you're losing" signal

**File:** `dashboard-web/src/lib/multiMappingCohort.ts:235` and consumed at `CohortComparisonPanel.tsx:286-296`

**Evidence:**
```ts
// multiMappingCohort.ts:234-235
const isLeader = currentRank === 1;
const isWeakest = currentRank === totalMembers;
```

For `cohortSize = 2`, the loser is BOTH "not the leader" AND "the weakest". The cohort panel header chip checks `currentRankIntra === intraCount` (`CohortComparisonPanel.tsx:286`) and renders the loud red 🥈 "אתה החלש בקבוצת המיפוי באותה פלטפורמה" banner — for a 2-cohort, that just means "you have one peer and you're number 2". The health-score adjustment correctly gates with `cohortSize >= 3` (so no points deducted) but the UI banner doesn't have the same floor.

**Why it matters:** The operator sees a red "weakest" chip and is nudged toward pausing the campaign when in fact "someone had to be second". Inconsistent with `applyCohortHealthAdjustment`'s own `cohortSize >= 3` gate (`campaignHealthScore.ts:424`) which explicitly states "N >= 3 floor prevents penalizing the loser of a 2-cohort just because someone had to be lower."

**Fix:** Either:
1. Add the same floor to `isWeakest` at the source: `const isWeakest = totalMembers >= 3 && currentRank === totalMembers;` AND update the JSDoc + tests, OR
2. Add a `cohortSize` check in `CohortComparisonPanel.tsx:286-296` before rendering the red chip:
```tsx
currentRankIntra === intraCount && intraCount >= 3
  ? 'bg-roas-redBg/60 …'
  : ...
```
The first option is preferable because it keeps the UI dumb and aligns with the health-score adjustment.

For the operator's mental-model question "should a 2-cohort with one terrible campaign be penalized?": **only if the gap is huge**, which the current formula doesn't measure. A 2-cohort where the loser is 1% behind isn't actionable; a 2-cohort where the loser is at ROAS 0.5 vs leader at ROAS 3.0 is. Recommend NOT penalizing 2-cohorts at all in v1 and revisiting later with a "relative gap" metric.

---

### HIGH-03 — Cannibalization detector falsely "scale-down/none" verdicts when a campaign was paused mid-range

**File:** `dashboard-web/src/lib/cannibalizationDetection.ts:230-355`

**Evidence:** Walk-through. Operator has a 14-day range. Campaigns A and B both map product P. A ran continuously $100/day. B was active days 1-7 ($200/day) but **paused** days 8-14.

Cohort-level early-half spend: 7×100 (A) + 7×200 (B) = $2100
Cohort-level late-half spend:  7×100 (A) + 0 (B)    = $700
spendGrowthPct = (700 − 2100) / 2100 = −0.667

The detector sees spend "shrinking" 67% and short-circuits to NONE (`cannibalizationDetection.ts:317-319`):
```ts
if (spendGrowthPct < 0.1) {
  risk = 'none';
  reason = `ההוצאה גדלה רק ${...}% (סף 10%) — אין הסקייל המספק...`;
}
```

But this is misleading: A's marginal ROAS may have collapsed (other cohort member paused → A now eats B's audience → A's revenue should rise BUT might not). The "cohort spend shrank" framing hides A's individual cannibalization signal.

Symmetric case: B was paused days 1-7 and started days 8-14 → cohort spend doubled, and the detector will report HIGH cannibalization risk even though it's the NORMAL effect of adding a new campaign. The split-half comparison cannot tell "we scaled A by 30%" apart from "we launched B at $700/wk while A held steady".

**Why it matters:** The operator's natural scenario — "I paused a weak cohort member and scaled the strong one" — generates a false NEGATIVE (no cannibalization warning even when there is). Conversely, launching a fresh experiment on a multi-mapped product generates a false POSITIVE (HIGH cannibalization just from sequential activation). Both undermine trust in the cannibalization banner.

**Fix:** Switch from cohort-level totals to per-campaign-active-day-rate analysis:
1. For each cohort member, compute `meanSpendPerActiveDay` in early and late halves separately.
2. Require both halves to have `≥ 3 active days FOR THE SAME COHORT MEMBER` (not "any cohort member"; current code at `cannibalizationDetection.ts:247-261` unions across members which is what creates the launch-of-new-member bug).
3. Add a "composition stable" guard: only run the comparison when each cohort member that contributed >X% of spend in either half was active in BOTH halves.
4. Surface a new verdict `'composition_changed'` when this guard fails, with reason "קבוצת הקמפיינים השתנתה (מישהו נפסק או התחיל) — אי-אפשר להשוות".

Add tests:
- `weak member paused mid-range → algorithm does NOT report NONE — emits composition_changed`
- `new member added mid-range → algorithm does NOT report HIGH — emits composition_changed`

---

### HIGH-04 — Cannibalization LOW threshold is below day-of-week noise; over-fires on 14-day windows

**File:** `dashboard-web/src/lib/cannibalizationDetection.ts:326-329`

**Evidence:**
```ts
} else if (spendGrowthPct >= 0.10 && revenueGrowthPct < spendGrowthPct * 0.75) {
  risk = 'low';
  ...
}
```

On a 14-day window split 7+7, the day-of-week composition is identical (e.g., Mon-Sun vs. Mon-Sun) so this guard is reasonable in theory. But for 13-day windows (8+5) or 7-day windows (7-day window split 3+4 has DIFFERENT day-of-week mix), the day-of-week composition changes the early-vs-late revenue baseline by easily 15-25% on shops where weekends sell more than weekdays. Spending +10% with revenue at +7% gets a LOW flag (`7 < 10 × 0.75 = 7.5`) — that's well within day-of-week swing.

The risk banner (`CohortComparisonPanel.tsx:228-235`) renders LOW as a tinted banner with the wording `סימן מוקדם` (early sign) and an alarm icon — operators will react to it.

**Why it matters:** Operators get noise-level alerts that erode trust in the system. A common product-launch flow (small initial spend → +10% organic growth → revenue takes 2-3 days longer to catch up) trips LOW continuously.

**Fix:**
1. Raise the LOW threshold floor: require `spendGrowthPct >= 0.20` for LOW.
2. Require a minimum absolute delta-spend (e.g. `lateSpend - earlySpend >= 50` CAD) so $50→$56 spend doesn't fire.
3. Add a day-of-week-rotation check: when the early and late halves don't cover identical day-of-week sets, downgrade LOW to "monitor-only" and don't surface in the banner.
4. Consider hiding LOW from the panel banner entirely and only surfacing it in a dedicated "watch list" or tooltip on the row. (The operator's mental triage budget is small — LOW is currently more cost than benefit.)

---

### HIGH-05 — `byPlatform` in product-centric view can include platforms with zero qualifying members

**File:** `dashboard-web/src/lib/productCentricView.ts:153-159` + `:216-227`

**Evidence:**
```ts
// :153-159 — platformGroups is filled ONLY for members with agg
const platformGroups = new Map<string, RawMember[]>();
for (const r of raw) {
  if (!r.agg) continue;
  const platform = r.agg.platform;
  if (!platformGroups.has(platform)) platformGroups.set(platform, []);
  platformGroups.get(platform)!.push(r);
}
```
Good — platforms with no `agg` are dropped.

```ts
// :216-227 — byPlatform is built from platformGroups
const byPlatform = Array.from(platformGroups.entries())
  .map(([platform, raws]) => {
    const platformMembers = members.filter(m => m.platform === platform);
    return {
      platform,
      members: platformMembers,
      ...
    };
  })
  .sort(...);
```

This itself is fine. But cross-reference: at `:185-210` the `members` array is built ONLY from `raw.filter(r => r.agg !== undefined)`. If at `:154-158` a `RawMember` had `agg` but the agg's `spend` is 0 (campaign existed for impressions/conversions only), `platformGroups` will contain it; `members` will contain it; `byPlatform.members` will contain it — so far consistent.

The real bug is subtler. Looking at the test `productCentricView.test.ts:203-225`:
```ts
it('all-zero-spend cohort yields zero shares (no NaN)', () => {
  ...
  aggregated: [
    makeAgg({ key: k('Meta', 'c1'), spend: 0, impressions: 1 }),
    makeAgg({ key: k('Meta', 'c2'), campaignId: 'c2', spend: 0, impressions: 1 }),
  ],
  ...
  for (const m of rows[0].members) {
    expect(m.intraPlatformSpendShare).toBe(0);
    ...
  }
});
```

With `totalCohortSpend = 0` and `intraTotal = 0`, the shares are correctly forced to 0 by the `> 0` guards. **However**, `platformAllocatedRevenue.set(platform, totalNetRevenue * share)` (`:179-182`) sets the platform's allocated revenue to `0` even when `totalNetRevenue > 0` (because `share = 0/0` → `0` via the guard). The UI in `ProductCentricView.tsx:289` then renders:
```
הוצאת פלטפ.: CAD 0 · הכנסה מוקצית: CAD 0
```
…for a product that produced $1000 in revenue. The $1000 disappears from the operator's view because all-zero-spend cohorts swallow it.

**Why it matters:** Edge case in the table but real: a product whose cohort campaigns are all paused for the range will appear with 0 allocated revenue and 0 cohort spend even when the product itself sold. The operator looking at the pivot would think "this product has no revenue" — false. Either the row should be hidden entirely OR the allocated revenue should be `totalNetRevenue` distributed evenly (or, more correctly: "unallocated — no spend in cohort").

**Fix:**
1. When `totalCohortSpend === 0` but `totalNetRevenue > 0`, render a distinct UI variant: "אין הוצאה בקבוצה — ההכנסה לא ניתנת לשיוך לקמפיין" instead of showing $0 per platform.
2. Optionally: drop such rows from the default view (they aren't actionable) and surface them in a "needs mapping" list.

---

### MEDIUM-01 — `splitRangeHalves` mid-day uses `early.to = midMs − 1 day`, drops 1 day when range = 2

**File:** `dashboard-web/src/lib/cannibalizationDetection.ts:106-126`

**Evidence:** The test at `cannibalizationDetection.test.ts:62-68` codifies:
```
2-day range: early = {2026-05-01, 2026-05-01}, late = {2026-05-02, 2026-05-02}
```
For 2 days, `totalDays = 2`, `midDays = Math.floor(2/2) = 1`, `midMs = from + 1 day`, `earlyToDate = midMs − 1 day = from + 0 days`, `lateFromDate = from + 1 day`. So early = day 1, late = day 2. ✓

For 5 days the test verifies early = 2 days, late = 3 days (`splitRangeHalves` test line 78-84). So odd splits give the **late** half the extra day. That's consistent with revenue accrual (later days are more recent, more representative of present scale) — defensible. **However**:
- For a 3-day range, the early half is 1 day and late is 2 days. The `earlyActiveDays < 3 || lateActiveDays < 3` floor (`:277`) will always fail for early half on ranges < 6 days — algorithm correctly emits `insufficient` (verified mentally: 3-day range → early=1d, can't reach 3 active days). ✓
- For a 6-day range, early=3d/late=3d — barely passes the floor. With holidays or off-days this is brittle.

**Why it matters:** Smaller defensiveness issue. The algorithm correctly returns `insufficient` (no false alarm), but the operator may not realize the panel suppresses verdicts for short ranges. Add visibility.

**Fix:** When a 5-13 day range is passed, log a one-line console hint in dev mode AND surface a "טווח קצר — חזקה נמוכה" footer in the panel so operators understand why the cannibalization section is empty.

---

### MEDIUM-02 — `revenueGrowthPct` formula uses `Math.abs(earlyRev)` denominator → flips sign on negative early half

**File:** `dashboard-web/src/lib/cannibalizationDetection.ts:303-308`

**Evidence:**
```ts
const revenueGrowthPct =
  earlyRev !== 0
    ? (lateRev - earlyRev) / Math.abs(earlyRev)
    : lateRev > 0
      ? Infinity
      : 0;
```

Suppose `earlyRev = −100` (refund-heavy first half), `lateRev = 50`. Then `(50 − −100) / |−100| = 150 / 100 = 1.5` → "+150% revenue growth". The number is wildly optimistic — going from a $100 refund net to a $50 net is **+$150** absolute improvement but framing it as 150% growth tricks downstream comparisons. Specifically the HIGH threshold (`revenueGrowthPct < 0.05`) won't fire even though spending could have ballooned, because revenueGrowthPct = 1.5 > 0.05.

The test `'handles negative revenue half (refund-heavy week)'` (`cannibalizationDetection.test.ts:458-479`) actually covers a different case (negative LATE, positive EARLY) which works out. The negative-early case isn't tested and the math is broken there.

**Why it matters:** Edge case but real for refunds, fraud reversals, or chargebacks concentrated in week-one. The operator would not see the cannibalization warning that should have fired.

**Fix:** Switch to the standard signed-denominator approach but special-case negatives:
```ts
let revenueGrowthPct: number;
if (earlyRev > 0) {
  revenueGrowthPct = (lateRev - earlyRev) / earlyRev;
} else if (earlyRev === 0 && lateRev > 0) {
  revenueGrowthPct = Infinity;
} else if (earlyRev === 0 && lateRev <= 0) {
  revenueGrowthPct = 0;
} else {
  // earlyRev negative — % growth is undefined; treat as insufficient signal
  // Surface a distinct verdict for the operator.
  revenueGrowthPct = NaN;
}
```
Then upgrade the verdict classifier to emit `insufficient` (reason: "early-half revenue was negative — % growth undefined") when `revenueGrowthPct` is NaN.

---

### MEDIUM-03 — `effectiveStatus` for a paused-then-resumed campaign uses "first-seen" not "latest"

**File:** `dashboard-web/src/components/CampaignDrawer.tsx:427-429`

**Evidence:**
```ts
if (existing) {
  existing.spend += r.spend;
  existing.conversions += r.conversions;
  existing.conversionValue += r.conversionValue;
  if (!existing.effectiveStatus && r.effectiveStatus) {
    existing.effectiveStatus = r.effectiveStatus;  // ← keeps the FIRST non-null seen
  }
}
```

`campaignsData.rows` is not guaranteed to be date-sorted. If row order is "2026-05-22 ACTIVE, 2026-05-21 PAUSED", the loop will lock in `ACTIVE` (correct). But if it's "2026-05-21 PAUSED, 2026-05-22 ACTIVE", the loop will lock in `PAUSED` (wrong — campaign is currently active). The aggregator (`campaignsAggregator.ts:65, around line 100+`) does a **date-aware "chronologically latest wins"** for budgets and `effectiveStatus`, but the drawer's cohort projection doesn't.

The cohort panel shows a "פעיל / כבוי" chip per row (`CohortComparisonPanel.tsx:67-86`), so this misclassification is visible.

**Why it matters:** Wrong status chips. Operators clicking through to investigate "why is this paused" find a campaign that is in fact running.

**Fix:** Match the aggregator's "latest date wins" policy:
```ts
const latestStatusDate = new Map<string, string>();
// in the loop:
const prevDate = latestStatusDate.get(k) ?? '';
if (r.effectiveStatus && r.date > prevDate) {
  existing.effectiveStatus = r.effectiveStatus;
  latestStatusDate.set(k, r.date);
}
```

---

### MEDIUM-04 — Cannibalization detector reads `spend` straight from /api/campaigns without fee/tax normalization

**File:** `dashboard-web/src/lib/cannibalizationDetection.ts:241-242`

**Evidence:** The cohort spend pulled in `:241-242` is whatever `r.spend` arrives from `/api/campaigns`. The product NET revenue at `:265-266` is `r.netRevenue` from `/api/products`. The numerator and denominator come from different pipelines:
- Campaign spend: platform-reported (Meta / Google / TikTok), gross of ad-platform fees/taxes.
- Product NET revenue: Shopify-side, NET of refunds, taxes (Shopify net), and shipping income.

The growth percentages are reasonable assuming both are stable but the **absolute** marginal ROAS (`marginalRoas = deltaRev / deltaSpend`) is comparing apples-to-oranges. The panel banner displays `ROAS שולי` to 2 decimal places — that's a precise number with an imprecise meaning. An operator might compare it to their target ROAS (~3.0) and conclude "marginal ROAS 0.6 means I'm losing money on the margin" when in fact the units don't quite align.

**Why it matters:** Doesn't change the verdict (the thresholds are growth-percentage based, both grow proportionally). But the `marginalRoas` shown in the banner can mislead.

**Fix:** Either:
1. Document the units in the banner tooltip: "ROAS שולי = הכנסה Shopify נטו נוספת / הוצאה פלטפורמה נוספת. שים לב: ההוצאה כוללת עמלות פלטפורמה, ההכנסה לא כוללת מע"מ."
2. Or recompute against a consistent revenue source (e.g. platform-claimed `conversionValue` for both — but then you lose the Shopify ground-truth advantage).
3. Or simply round the displayed `marginalRoas` to 1 decimal (`0.6`) instead of 2 to telegraph the noise.

---

### MEDIUM-05 — `productCentricView.ts` claims "deterministic-then-proportional" allocation but implements flat proportional only

**File:** `dashboard-web/src/lib/productCentricView.ts:65-74` (JSDoc) + `:170-194` (implementation)

**Evidence (JSDoc):**
```ts
/** Aggregate intra-platform revenue (sum of allocated revenue
 *  estimates from the members at this platform). Same as the
 *  per-platform deterministic-then-proportional allocation that
 *  allocateProductRevenue does for the campaign-centric view. */
intraAllocatedRevenue: number;
```

**Implementation:**
```ts
// :179-182
for (const [platform, spend] of platformSpend.entries()) {
  const share = totalCohortSpend > 0 ? spend / totalCohortSpend : 0;
  platformAllocatedRevenue.set(platform, totalNetRevenue * share);
}
// :191-194
const platformRev = platformAllocatedRevenue.get(a.platform) ?? 0;
const allocatedRev = platformRev * intraShare;
```

There's no deterministic-then-proportional split. It's a single flat proportional allocation: `platform's revenue = product net rev × platform's spend share`. The JSDoc earlier (`:170-177`) actually acknowledges this is simplified (`The true allocateProductRevenue is more nuanced...`) — but the contradictory comment at line 72 ("Same as the per-platform deterministic-then-proportional allocation that allocateProductRevenue does for the campaign-centric view") will mislead future maintainers.

Worse, the entire product-centric pivot is rendering a fundamentally different number than the campaign-centric drawer would show for the same product — but the operator won't realize because both labels say "הכנסה מוקצית".

**Why it matters:** Two views of the same data show different per-campaign revenue allocations. An operator who reconciles "campaign C's allocated revenue is $123 in the drawer but $156 in the product pivot" will not know which to trust. The flat proportional allocation systematically over-allocates to high-spend campaigns that have no Shopify click-id matches at all.

**Fix:** Two options:
1. Thread the actual `allocateProductRevenue` (orders + click-id) into `buildProductCentricView` — restores parity with the drawer.
2. Fix the contradictory comment + rename `allocatedRevenueEstimate` to make the simplification explicit (`proportionalRevenueEstimate`) AND surface a "פרופורציונלי בלבד — לא דטרמיניסטי" badge in the UI so operators know not to reconcile this against the drawer.

---

### MEDIUM-06 — Cohort UI cross-platform section adds current as a "greyed reference" but with `isCurrent: true`, causing duplicate render

**File:** `dashboard-web/src/components/CohortComparisonPanel.tsx:385-393`

**Evidence:**
```tsx
{crossSection.length > 0 && (
  <CohortSection
    title="ערוצים מקבילים (פלטפורמות אחרות)"
    subtitle="..."
    members={[
      // The current campaign isn't a cross-platform member of itself,
      // but we include it (greyed) at the top so the operator has a
      // reference baseline to compare cross-platform members against.
      { ...cohort.current, isCurrent: true },
      ...crossSection,
    ]}
    tone="cross"
    onDrillCampaign={onDrillCampaign}
  />
)}
```

The current campaign is also rendered in the intra-platform section above (`:243`). In the cross-platform section it appears AGAIN with `isCurrent: true`. The MemberRow styling renders both with the "את/ה כאן" badge and `bg-primary/8 font-semibold`. There's no `key` collision because cross-section's keys are different members — except for the duplicate current entry. React will warn:
```
Warning: Encountered two children with the same key, `uzoshop::Meta::c1`.
```
…BUT only if there is **at least one** crossPlatformOther AND the current itself is somewhere in the section. Both children have `key={m.campaignKey}` at `CohortComparisonPanel.tsx:202`, and the current campaign's `campaignKey` is unique to itself, so duplication happens only inside the cross-section (current appears 1x). No collision, but the operator sees the same campaign rendered twice (once at top of intra, once at top of cross) with two different rank numbers — confusing.

**Why it matters:** UI noise + confusing ranking interpretation. The operator's "you are #1 of 4 in intra" vs "you are #1 of 4 in cross" creates ambiguity about which is the "real" ranking.

**Fix:** Either:
1. Drop the "greyed reference" current row from the cross-section. Render the cross section as `[...crossSection]` only.
2. If kept, change the rank display in cross to just "—" (current isn't part of the ranking) and hide the medal icon.

---

### LOW-01 — `sumInWindow`, `countActiveDays` lexical string comparison correct for ISO dates but fragile

**File:** `dashboard-web/src/lib/cannibalizationDetection.ts:131-156`

```ts
if (r.date < from || r.date > to) continue;
```

ISO-8601 `YYYY-MM-DD` strings sort lexicographically as dates because the components are zero-padded and ordered most-significant first. This is correct given the schema docstring (`date: string; // YYYY-MM-DD`). But there's no validation — if a row arrives with `'2026-5-1'` (single-digit month) the comparison will misorder it. Same risk for `'5/1/2026'` mis-formatted feeds.

**Fix:** Add a one-line sanity gate at the top of `detectProductCannibalization`:
```ts
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const validCampaigns = campaignsDaily.filter(r => DATE_RE.test(r.date));
const validProducts = productsDaily.filter(r => DATE_RE.test(r.date));
// Use validCampaigns / validProducts instead.
```

---

### LOW-02 — `countActiveDays` helper is declared but never called

**File:** `dashboard-web/src/lib/cannibalizationDetection.ts:131-143`

```ts
function countActiveDays<T extends { date: string }>(
  rows: T[],
  from: string,
  to: string,
  accept: (row: T) => boolean,
): number {
  ...
}
```

The active-day counting inside `detectProductCannibalization` (`:247-261`) re-implements this logic inline. Dead code. Either delete `countActiveDays` or replace the inline implementation with a call to it (refactor — currently the inline version uses two separate `Set`s in one pass which the helper would require two calls to do, so a small redesign is needed if you want DRY).

**Fix:** Delete `countActiveDays`, OR refactor the inline implementation to use it.

---

### LOW-03 — Test asserts "leader-and-weakest stacks to −2" but JSDoc says "Maximum cumulative positive: +3 (leader, no cannibalization)"

**File:** `dashboard-web/src/lib/campaignHealthScore.ts:396-397` + `__tests__/campaignHealthScore.test.ts:656-668`

**Evidence:**
JSDoc:
```
// Maximum cumulative negative: −15 (weakest + high cannibalization).
// Maximum cumulative positive: +3 (leader, no cannibalization).
```

Test:
```ts
it('cannot be both leader AND weakest simultaneously (defensive: leader wins)', () => {
  // If a caller passes both, we credit leader and skip weakest because
  // isLeader is checked first (independent +3) and isWeakest's >=3 floor
  // doesn't gate against isLeader directly. Both ADDITIVELY apply.
  ...
  // +3 (leader) + (-5) (weakest with cohortSize>=3) = -2
  expect(out.components.cohortAdjustment).toBe(-2);
});
```

The test description says "leader wins" but the test body and assertion say "both stack additively". The CODE indeed stacks additively (`campaignHealthScore.ts:420-426` — independent `if` blocks, not `else if`). The test description contradicts itself and the JSDoc says +3 is the cap.

Empirically, leader+weakest+cannibalization-high stacks to `+3 - 5 - 10 = -12`. So the JSDoc "Maximum cumulative negative: −15 (weakest + high cannibalization)" is also wrong when the leader bonus is also set — actual minimum is `+3 - 5 - 10 = -12`. The clamping at `[0, 100]` saves the math but the documentation is inaccurate.

Conceptual question: CAN a campaign be both leader AND weakest? Yes, when `cohortSize === 2` and the current campaign has the higher score (leader=true, weakest=false). But what if all members have identical metrics (stable sort makes current first)? Leader=true, weakest=true (rank 1 AND rank N when N=1? no — cohort requires N≥2). So leader+weakest=true only when N=2 AND ranks happen to make current both #1 and #N — impossible for N=2 (1≠2). For N=2, leader+weakest=true requires rank=1 AND rank=2, which can't happen. The test is testing an impossible state, but the code allows it.

**Fix:**
1. Either: assert `!(isLeader && isWeakest)` in `applyCohortHealthAdjustment` (since it's a logical impossibility given `currentRank === 1 === totalMembers` requires N=1, which is excluded by the `cohortSize < 2` guard). The test then becomes a defensive check that the assertion fires.
2. Or: simply update the JSDoc to be accurate ("Cumulative ranges from +3 to -15, modulo the [0,100] clamp.") and reword the test's "leader wins" comment which is straight-up false.

---

### LOW-04 — `applyCohortHealthAdjustment` JSDoc claims `isWeakest` "−5" applies only when `cohortSize >= 3` BUT doesn't explain interaction with the inflated `isWeakest` flag from CRITICAL-02 path

**File:** `dashboard-web/src/lib/campaignHealthScore.ts:382-397`

This is a documentation-only ding. The JSDoc clearly explains the `N >= 3` floor for the −5 weakest penalty. Good. The contradiction is with the `multiMappingCohort.ts` definition of `isWeakest` (HIGH-02), which DOESN'T have the floor — so the `cohort.isWeakest` passed in is true even for 2-cohorts. The adjustment function correctly defends against it (`:424`) so the score math is safe. But the cohort panel uses the same `isWeakest` flag from the cohort module WITHOUT the floor (`CohortComparisonPanel.tsx:286`) — so the UI shows the loud "you're weakest" chip even when the health score doesn't deduct points. Inconsistent. See HIGH-02 for the fix.

---

## Algorithm correctness checklist (per question)

| # | Question | Verdict |
|---|----------|---------|
| 1 | Ranking formula defensible? Tiny-spend ROAS=100 vs $10K-spend ROAS=4 | **NO** — see CRITICAL-02. No minimum-spend floor; tiny-spend anomalies win. Needs Bayesian shrinkage or hard $100 floor. |
| 2 | Tie handling — stable / explainable / no flip on refresh? | **PARTIAL** — Array.sort in V8 is stable; iteration of `Object.entries(productMap)` is insertion-order; so for a given input, the rank does not flip. **But** the "platform-deterministic as tie-breaker" is a no-op in production (HIGH-01) so the operator's mental model of why a tie broke is wrong. |
| 3 | "Weakest" trigger `cohortSize >= 3` guard correct? 2-cohort with one terrible campaign — penalized? | **PARTIAL** — Health-score adjustment correctly gates with `>= 3` (`campaignHealthScore.ts:424`). UI chip in `CohortComparisonPanel.tsx:286-296` does NOT gate, so a 2-cohort loser sees the loud red "weakest" chip without score deduction. See HIGH-02. A 2-cohort with a terrible campaign is **not** penalized today (correct per spec) but the UI suggests otherwise. |
| 4 | Intra-platform = same platform as current campaign? Cross-store partition correct? | **YES** — `multiMappingCohort.ts:238-239` filters intra/cross strictly by `parts.platform`. Cross-store isolation enforced at `:183, 193` by `storePrefix = ${storeId}::` filter and verified by test `'does not include cross-store campaigns even with identical key shape'` (`multiMappingCohort.test.ts:542-560`). Same for cannibalization detection (`cannibalizationDetection.ts:199, 210, 220`). |
| 5 | Cannibalization split-halves with 3-day range — clean INSUFFICIENT verdict? | **YES** — for a 3-day range, `splitRangeHalves` returns early=1d, late=2d. The active-days floor (`≥ 3 per half`) cannot pass for early=1d, so the function emits `'insufficient'` (`cannibalizationDetection.ts:277-300`). No false fire / false clear for 3-day ranges. Verified by `'returns insufficient when each half has < 3 active days'` test. |
| 6 | Cannibalization thresholds defensible? False-positive risk on noisy small budgets? | **MIXED** — HIGH (+25%/<+5%) and MEDIUM (+15%/<spend/2) are defensible empirically. LOW (+10%/<spend×0.75) is below day-of-week noise (HEAD-04). Tiny budgets without an absolute-delta floor will trip thresholds easily. |
| 7 | `splitRangeHalves` — odd range, which half gets middle day? Consistent with revenue accrual? | **CONSISTENT** — 5 days → early=2, late=3 (test `'splits 5-day range as 2+3 (early gets the shorter half)'`). Late half gets the extra day, which represents "more recent / more representative of present scale" — defensible for spend-trend detection. The test file's name says "early gets the shorter half" but the result equally well reads as "late gets the longer half". Either interpretation is fine. |
| 8 | Cohort comparison panel — displayed metric mirrors the algorithm's ranking source? | **NO** — CRITICAL-01. Panel displays a column labeled "ROAS Shopify" but the drawer feeds `conversionValue/spend` (Pixel) into it. Operator sees Pixel ROAS labeled as Shopify ROAS. Ranking is computed on the same (mislabeled) value, so the chip and the column are internally consistent — but with each other only, not with reality. |
| 9 | Product-centric per-platform spend share sums to 100%? Revenue conservation? | **YES (mostly)** — Shares sum to 1 within each platform AND across the whole cohort, verified by tests at `productCentricView.test.ts:143-184`. Allocated revenue sums to `totalNetRevenue` within ε (verified). Total revenue across products `!=` sum-of-campaigns revenue because revenue is product-keyed and one campaign promotes multiple products; this is expected. ONE edge case: all-zero-spend cohort swallows the product's revenue silently (HIGH-05). |
| 10 | Cohort adjustment cap −15 actually exists? Leader + cannibalization clamp correct? | **MOSTLY** — `[0,100]` clamp at `campaignHealthScore.ts:447` works. The "cap of −15" in the comment ignores the leader-and-weakest-and-high scenario which the code allows to stack to `+3 − 5 − 10 = −12` (or worse if the comment intended the floor without leader). See LOW-03 for the doc inaccuracy. The hard `[0,100]` clamp does prevent negative scores. |

---

## Edge case results (verdicts)

| Edge case | Result |
|-----------|--------|
| Single campaign mapped to a product (cohortSize=1) — cohort no-ops? | **YES** — `computeMultiMappingCohort` returns `null` when no other campaigns share any product (`multiMappingCohort.ts:210`). Test: `'returns null when current has products but no other campaign maps any of them'`. |
| All-zero-spend cohort — ranking returns? Division by zero? | **NO division by zero**. Ranking score collapses to `0 * 1e6 + 0 * 1e3 + 0 = 0` for all members; stable sort preserves insertion order → current campaign appears first (since it's prepended at `:227`). `isLeader=true`, `isWeakest=false`. Misleading rank but no crash. |
| Cohort with one cross-platform member only (1 Meta + 1 TikTok) — intra empty? | **YES** — Tested at `'returns empty intra when current is the only one on its platform'` (`multiMappingCohort.test.ts:402-418`). |
| Two products mapped to same set of 4 campaigns — cannibalization per-product or aggregated? | **PER-PRODUCT**, correct. `detectProductCannibalization` iterates `cohortByProduct.entries()` (`:230`) and emits one verdict per productId. Same cohort can appear in multiple verdicts (one per product). Verified by `'returns one verdict per multi-mapped product'` test. The `worstRisk` rollup at `CampaignsTable.tsx:617-622` correctly takes the max across the campaign's mapped products. |
| Campaign in cohort paused mid-range — algorithm handles partial-range data? | **NO** — HIGH-03. Spend windowed sum sees a "shrinking" cohort; the verdict emits NONE even when individual members may be cannibalizing. Symmetric: a newly-launched cohort member produces a false HIGH. |

---

## What's solid

1. **Cross-store isolation everywhere.** All four modules consistently use `storeId` prefix filtering. Tests explicitly cover the "same productId in different stores" trap and pass. The operator can trust that a cohort scoped to `uzoshop` won't bleed in a `zolplus` campaign.
2. **Single-store + single-platform partitioning logic** in `multiMappingCohort.ts:238-239` is a simple filter on `parts.platform === currentParts.platform`, no surprises.
3. **`cohortSize >= 3` floor for the −5 weakest health-score penalty** is correctly implemented in `applyCohortHealthAdjustment` (`campaignHealthScore.ts:424`) and explicitly tested with the "no penalty for 2-member cohort" case.
4. **Insufficient-data short-circuit** in cannibalization (active-days floor, positive-early-spend requirement) is correctly placed BEFORE the threshold classification and emits a typed `'insufficient'` verdict with a Hebrew operator-readable reason. No false fires when the data is genuinely too sparse.
5. **`splitRangeHalves` boundary math** is correct for the cases tested (2/4/5/14 days). Same-day reversed range returns null defensively.
6. **No NaN propagation** in product-centric shares — every division is guarded by `> 0`. Verified by `'all-zero-spend cohort yields zero shares (no NaN)'` test.
7. **Cannibalization verdict shape** carries enough breakdown (`earlyHalfSpend / lateHalfSpend / earlyHalfRevenue / lateHalfRevenue / marginalRoas`) for the operator to audit "why HIGH?" without needing to re-compute.
8. **Stable sort + insertion-order iteration** mean that for a given input the rank chip won't flip on refresh — defensible, even though the underlying ordering rationale (HIGH-01) is broken.
9. **Pure functions everywhere.** All four library files take inputs, return outputs, no side effects, no IO, no React. Test coverage is high (~50+ assertions across the 4 test files) and the test scenarios reflect realistic operator situations (4 Meta + 3 TikTok, paused-throughout, multi-product cohorts).
10. **Cohort health adjustment correctly skips `insufficient` base scores** (`campaignHealthScore.ts:414`) — won't punish a freshly-launched campaign just because it happens to be in a multi-mapped product's cohort.

---

## Recommended action order for the operator

If you can only fix three things this week, fix in this order:

1. **CRITICAL-02 (ranking floor)** — Without it, every "you are the leader" verdict is suspect. Bayesian shrinkage is ~15 lines of code + 3 tests.
2. **CRITICAL-01 (panel ROAS mislabeling)** — Either thread the real Shopify ROAS into the drawer's cohort, or rename the column. The first option keeps the operator's mental model intact.
3. **HIGH-03 (composition-change in cannibalization)** — Without it, the operator's natural "I scaled one and paused another" flow generates wrong verdicts in both directions. Replace cohort-level totals with per-member active-day rates AND add the `'composition_changed'` verdict.

Everything else can be staged: HIGH-01, HIGH-02, HIGH-04, HIGH-05 should land before announcing the feature to other operators. The MEDIUM and LOW findings are quality polish.
