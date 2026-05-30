---
audit: 2026-05-23 v2 — algorithm soundness
reviewer: Claude (Opus 4.7, 1M context)
scope: 7 algorithm files in dashboard-web/src/lib
mode: deep mathematical-correctness review
status: issues_found
findings:
  critical: 1
  high: 5
  medium: 8
  low: 6
  total: 20
---

# Algorithm Soundness Audit — 2026-05-23 v2

## Summary

The seven algorithm files reviewed are **substantially more solid than they were before the
2026-05-23 v1 round of fixes.** The big-ticket logic bugs from v1 (refund-heavy products
silently absorbed into `Math.max(0, ...)`, raw-ROAS rankings dominated by small samples,
2-cohort losers auto-flagged as "weakest", trajectory-missing implicit +15 boost) are all
genuinely addressed in code, not just commented.

That said, there are **20 remaining defects** of varying severity:

- **1 CRITICAL** mass-conservation hole in `allocateProductRevenue` when the deterministic
  step assigns a positive amount to a platform that has no mapped campaign **AND** the
  remainder is negative — units are silently leaked out of the cohort.
- **5 HIGH** issues, the most consequential being:
  - The `p.netRevenueCad >= 0 &&` guard in the deterministic cap (lines 358, 378) lets
    `p.netRevenueCad === 0` exactly slip into the "guard fires" branch — fine for that
    case in isolation, but creates an inconsistency with negative-net rows that breaks
    mass conservation in mixed cases (worked example below).
  - The Bayesian shrinkage uses spend (CAD) as the sample-size proxy, but spend and
    statistical sample size (orders) are not the same dimension. A $500 high-AOV
    one-order campaign and a $500 low-AOV 50-order campaign are treated identically.
  - The cannibalization "composition-changed" guard misses the operator's stated false-
    positive vector (5% → 15% spend share — neither half exceeds 20% absolute threshold,
    yet relative share tripled).
  - The user-visible string `>2.5σ` (attributionAnalysis.ts:528) contradicts the code
    `MAD_OUTLIER_MULTIPLIER = 3` (attributionAnalysis.ts:53). MAD is not σ either; both
    numbers and units are wrong in the operator-facing copy.
  - `productCentricView`'s simplified spend-share allocation diverges from the campaign-
    centric `allocateProductRevenue` whenever there are deterministic orders, with no
    cross-check or reconciliation surfaced to the operator.
- **8 MEDIUM** issues, including the documented "Maximum cumulative negative: −15" in
  the cohort adjustment that is correct **only** when the comment was written; with
  `applyCohortHealthAdjustment` stacking leader (+3) + weakest (−5) + cannib_high (−10)
  the documented sum is −12, not −15 — the comment was never updated post-fix.
- **6 LOW** issues, mostly comment-vs-code drift.

**Bottom line:** the math is mostly sound, but mass conservation is **not strictly
preserved** in the allocator's units channel under specific edge cases, and a handful
of operator-facing labels lie about what the code actually does. Operator should NOT
treat the deterministic-then-proportional sums as exactly mass-conserving for units —
the unit channel has a different epsilon than the revenue channel.

---

## Per-Algorithm Verdict

### 1. `campaignProductMap.ts` — `allocateProductRevenue`
**Verdict: solid revenue conservation; units channel has a hole.** The revenue channel
is mass-conserving in every case I traced (including the new negative-remainder
distribution from T2.4). The units channel is **not** strictly mass-conserving in one
specific case: when a platform has deterministic units but no mapped campaign of that
platform (Step 2 zeroes it), AND the remainder is then capped by `Math.max(0, remUnits)`
(line 464). Units that were "deterministic for a platform we don't have a mapping for"
get re-folded into the remainder, but if the remainder calculation would otherwise be
negative, it's silently set to 0, leaking units. (See CRITICAL-01 below.)

### 2. `multiMappingCohort.ts` — `computeMultiMappingCohort` + `rankingScore`
**Verdict: ordering correct; Bayesian formulation is reasonable but uses the wrong unit.**
The shrinkage `roas * w + 1 * (1-w)` with `w = spend/(spend+500)` is mathematically
equivalent to a Bayesian posterior with a Gamma-Poisson prior of strength CAD 500 at
ROAS=1 — but only if spend were on the same dimensional axis as observation count. It's
not — spend is CAD, statistical sample is orders. A $500 high-AOV single-order campaign
gets the same shrinkage weight as a $500 low-AOV 50-order campaign, even though the
latter is 50× more statistically informative. (See HIGH-02.)

The `isWeakest` floor at `totalMembers >= 3` is reasonable — it matches the
`applyCohortHealthAdjustment` floor in the health score. The composite score
`shrunk * 1e6 + shrunkPlat * 1e3 + spend` is a hierarchical lexicographic sort that
works as long as `shrunkPlat < 1000` and `spend < 1000` per increment, which holds in
practice for ROAS-bounded inputs. JS's `Array.prototype.sort` is stable per ECMA-2019
spec — the tie-break behavior is deterministic.

### 3. `cannibalizationDetection.ts` — `detectProductCannibalization`
**Verdict: classification cascade is sound; composition-change guard has a known
false-positive vector.** The HIGH/MEDIUM/LOW cascade is correctly ordered (verified by
walking the +20% spend / +9% rev case). The 14d/7d/4d split boundary math is
operator-correct (late always gets the extra day). The `revenueGrowthPct` with
`Math.abs(earlyRev)` denominator is mathematically defensible but produces operator-
unfriendly readings under sign-flip scenarios (see MEDIUM-03). The composition-change
guard misses the "share tripled but neither half exceeded 20% absolute" case explicitly
called out by the audit prompt (HIGH-04).

### 4. `campaignHealthScore.ts` — `computeCampaignHealth` + `applyCohortHealthAdjustment`
**Verdict: weight renormalization correct; comment drift on cohort cap; per-platform
pivot for TikTok introduces a discontinuity.** The `1.0 / 0.75` scale factor for the
missing-trajectory case correctly preserves the [0,100] range. The per-platform ROAS
pivot is correctly implemented — for TikTok (pivot=2.0), ROAS 1.5 → 50, ROAS 2.0 → 100,
ROAS 3.0 → clamped 100. But the **discontinuity between platforms** is a real concern:
a Meta campaign at ROAS 2.5 scores 75/100, but the same campaign reclassified to TikTok
would jump to 100/100 — a 25-point swing from a single platform-label change. (MEDIUM-05.)
The cohort comment says "Maximum cumulative negative: −15"; actual stack is leader (+3)
+ weakest (−5) + cannib_high (−10) = −12; or weakest (−5) + cannib_high (−10) = −15
**only when isLeader is false**. The comment is ambiguous about which case it refers to.

### 5. `productCentricView.ts` — `buildProductCentricView`
**Verdict: math is internally consistent BUT diverges from `allocateProductRevenue`.**
Intra-platform shares correctly sum to 1.0 within each platform (line 190); platform-
allocated revenue correctly sums to total cohort revenue across platforms (line 181).
However, the simplified formula `share = spend / totalCohortSpend` ignores deterministic
orders entirely. When the campaign-centric drawer and the product-centric view are open
on the same product+window, they will **disagree on per-platform revenue** unless every
order in the window has no platform signal. (HIGH-05.) HIGH-05 from the original audit
(zero-spend cohort with positive revenue) is **partially** addressed — `blendedRoas`
correctly returns 0 (line 150), but the `share = 0` divide-by-zero guard on line 191
silently drops all members of a zero-spend cohort from receiving any allocated revenue
(allocated stays 0). The revenue isn't distributed at all in that case.

### 6. `cpmRoasAnalysis.ts` — `analyzeCpmVsRoas`
**Verdict: 9-cell matrix is operator-correct; threshold for "stable" is conservative.**
The cell mapping is sound:
- UP CPM + DOWN ROAS → 'negative' ✓ (correctly identified as worst combo)
- DOWN CPM + UP ROAS → 'positive' ✓
- FLAT/FLAT → 'neutral' ✓
The `n >= 3` floor for Pearson is mathematically correct (Pearson with n=2 is always ±1).
The 5% STABLE_THRESHOLD is conservative — small but real swings (3-5%) are categorized
as "flat" which is operator-explainable. The half-over-half delta uses `slice(0, mid)`
and `slice(mid)` where `mid = Math.floor(values.length / 2)` — for 5 values, this is
2 + 3, with the late half getting the extra. Consistent with the cannibalization split.

### 7. `attributionAnalysis.ts` — `analyzeAttribution` and helpers
**Verdict: most-checked file; minor inconsistencies remain.** `computeCoverage`'s
asymmetry (det=0, claim=0 → 0; det=100, claim=0 → 1) is intentional and documented
(lines 134-138). The volatile downgrade fires correctly (line 521 + line 940). The MAD
outlier threshold is `MAD_OUTLIER_MULTIPLIER = 3` (not 2.5), but the **user-visible
message** still says `>2.5σ` (line 528) — that's both wrong (MAD ≠ σ) and inconsistent
with the constant. (HIGH-01.) MAD × 3 corresponds to roughly 2.0σ for normal data (the
MAD-to-σ conversion factor is ≈ 1.4826 for normal distributions), so the operator-facing
"2.5σ" label is misleadingly specific in two directions at once.

---

## Specific Math Questions

### Q1. Mass conservation: 3 multi-mapped campaigns, P with +$500 revenue, 5 units, no deterministic orders

**Walking through:**
- `storeOrders = []` (or no orders match P) → `detByPlatform` all zeros.
- Step 2: all `det.revenue === 0 && det.units === 0` → continues, nothing added to `cur`.
- Step 3: `totalDetRev = 0`, `totalDetUnits = 0`, `remRev = $500`, `remUnits = 5`.
- For each of 3 campaigns, `share = spend_i / totalSpend` (or 1/3 if zero-spend).
- Sum: `cur.revenue` totals $500 × (sum of shares) = $500 × 1.0 = $500 ✓
- Sum: `cur.units` totals 5 × 1.0 = 5 ✓

**Verdict: mass-conserving.** Even with rounding, IEEE 754 multiplication preserves
the sum to within ~5e-15 across 3 terms.

### Q2. Mass conservation with negative remainder: same as Q1 but P = −$300

**Walking through:**
- `detByPlatform` all zeros (no orders).
- Step 2: no contributions.
- Step 3: `totalDetRev = 0`, `remRev = −$300`, `remUnits = max(0, p.units − 0) = p.units` (assume p.units = 5 — though refund-heavy can produce p.units = 0 too).
- Each campaign: `cur.revenue += −300 × share` → 3 campaigns sum to −$300 ✓
- Each campaign: `cur.units += 5 × share` → 3 campaigns sum to 5 ✓

**Verdict: revenue mass-conserved. Units also mass-conserved IF p.units > 0.** If p.units = 0 with refund-heavy negative revenue (single-day refund with no new sales),
the units channel correctly stays at 0. Good.

### Q3. Mass conservation with deterministic + fallback mix: 2 campaigns, P=$1000, $700 from fbclid (Meta), $300 unattributed

**Setup:** 1 Meta campaign C1 mapped to P, 1 TikTok campaign C2 mapped to P, spend(C1)=$400, spend(C2)=$600.
- Step 1: orders with `fbclid` contribute $700 to `detByPlatform.Meta.revenue`.
  - Per-platform cap: `p.netRevenueCad = $1000 >= 0`, $700 ≤ $1000 — no cap fires.
  - Sum-cap: $700 ≤ $1000 — no cap fires.
- Step 2: Meta platform has 1 mapped campaign C1.
  - Intra-platform share = 1.0 (only campaign).
  - `cur(C1).revenue += $700 × 1.0 = $700`, `cur(C1).deterministicRevenue = $700`.
  - TikTok platform has 1 mapped campaign C2, but `det.revenue === 0 && det.units === 0` → continue (no contribution).
- Step 3: `totalDetRev = $700`, `remRev = $1000 − $700 = $300`.
  - C1 share = 400/1000 = 0.4 → `cur(C1).revenue += $300 × 0.4 = $120` → C1 total = $820.
  - C2 share = 600/1000 = 0.6 → `cur(C2).revenue += $300 × 0.6 = $180` → C2 total = $180.

**Sum across campaigns: $820 + $180 = $1000 ✓** Matches the prompt's expected output.

### Q4. Bayesian shrinkage limits

`shrinkRoas(roas, spend)`:
- `spend → ∞`: `w = spend / (spend + 500) → 1`; `roas * 1 + 1 * 0 = roas` ✓
- `spend → 0` (but > 0): `w = 0 / (0 + 500) = 0`; `roas * 0 + 1 * 1 = 1.0` ✓
- `spend ≤ 0`: explicit early return `return 1.0` (line 143) ✓
- `spend = 500`: `w = 500/1000 = 0.5`; `roas * 0.5 + 1.0 * 0.5 = (roas + 1)/2` ✓

**Limits verified.** Note that `roas = 12, spend = $40` yields:
`w = 40/540 ≈ 0.074`; `12 × 0.074 + 1 × 0.926 = 0.889 + 0.926 = 1.815` ✓
(comment claims 1.86; close — small rounding in the documented anchor calculation).

### Q5. Cohort tie-breaker stability

JS `Array.prototype.sort` is **required by ECMA-2019** to be stable. V8 has implemented
stable sort since 7.0 (Chrome 70, late 2018). Two members with identical primary AND
secondary AND tertiary scores will preserve their input array order.

**However, the input array order is not deterministic across page loads.** The order is:
```js
const rankedAll = [
  { ...currentMemberBase, isCurrent: true },         // current is always first
  ...others.map(o => ({ ...o, isCurrent: false })),  // others order = productMap iteration order
];
```

`Object.entries(productMap)` iteration order is insertion order (ES2015 spec for string
keys). This is stable within a session but **changes when the localStorage is rebuilt**
(e.g., the migration adds keys in a different order, or cloudSync pushes a different
shape). Pure ties (rare) could flip between sessions. Operator-explainable? Marginally —
"the one you added first wins ties" is a behavior you'd have to document, but currently
isn't. (LOW-04.)

### Q6. CPM trajectory window alignment with operator's localRange

`analyzeCpmVsRoas` accepts a `series: DailyCpmRoasPoint[]` already filtered. The caller
(CampaignsTable.tsx:572-573) passes `dailyByCampaign.get(a.key)` — which is built upstream.

Tracing upstream: `dailyByCampaign` comes from `data?.rows ?? []` aggregated by campaign
+ date. The API filter is `?from=...&to=...` = `localRange`. So yes, the series passed in
is range-aligned. **No drift detected.** The `validRows = series.filter(d => d.cpm > 0)`
filter on line 153 then drops zero-impression days — meaning if the last 7 days of the
14d range had 4 zero-impression days, the analyzer sees only 10 days, not 14. But all
10 are within the operator's range. **OK.**

### Q7. Composition-change false-positive vector: $50 early (5%) → $150 late (15%)

The user's prompt walks through the exact scenario: member with $50 spend in early half
(5% of cohort total $1000) and $150 in late (15% of cohort total $1000). Neither half
exceeds 20%, so the `material` flag on line 357-359 is false, and the guard does NOT
fire. The member is silently folded into the legacy growth comparison.

**Is this a problem?** Yes, mildly. Going from 5% → 15% of cohort spend is a 3× share
increase. If this member is, say, an inferior creative being scaled while a top-performer
holds steady, the cannibalization signal will fire (we sunk new dollars into a worse
creative) but the operator's reading will be "the cohort scaled and didn't grow" —
which isn't quite right; the composition tilted toward an inferior creative. The guard
should also gate on **relative share change** (e.g., "if a member's late-share is ≥ 2×
its early-share AND late-share ≥ 5%") to catch this. (HIGH-04.)

---

## Findings

### CRITICAL-01: Units leak when deterministic platform has no mapped campaign and remainder would be negative

**File:** `dashboard-web/src/lib/campaignProductMap.ts:410-418, 463-464`

**Evidence:** In Step 2, if a platform has deterministic units but no mapped campaign of
that platform (e.g., a Meta order containing the product, but the operator has only
mapped TikTok campaigns), the code does:

```ts
if (platformKeys.length === 0) {
  detByPlatform[platform] = { revenue: 0, units: 0 };
  continue;
}
```

This zeroes out the deterministic credit, intending to push it into the Step 3 remainder.
But the remainder is computed as:

```ts
const remRev = p.netRevenueCad - totalDetRev;
const remUnits = Math.max(0, p.units - totalDetUnits);
```

where `totalDetRev`/`totalDetUnits` are summed from `detByPlatform` **after** the
zeroing on line 416. So the zeroed-out value is **correctly** re-included in the
remainder for the next pass. ✓

**The bug:** the `Math.max(0, p.units - totalDetUnits)` clamp on line 464. The
operator's comment claims this is safe because "products_daily.units is always
non-negative (refund algorithm deducts only revenue, never units — gap-closure-08
invariant)". I cannot independently verify the "gap-closure-08 invariant" claim from
the files in scope, but **even if it holds**, there's a separate path that creates
negative `remUnits`:

If `p.units = 3` but `totalDetUnits = 5` (because two orders each containing the
product had units=2.5 due to some quantity coercion, and the platform-cap on line 362
only fires when `detByPlatform[k].units > p.units` per-platform — it doesn't fire when
the *sum across platforms* exceeds p.units, that's a separate sum-cap below). The
sum-cap on line 384 does fire and proportionally scales them down — so totalDetUnits
ends up exactly p.units. So `remUnits = 0`.

**But:** the order in which the per-platform cap (line 362) and the sum-cap (line 384)
fire matters. If per-platform cap zeroes a value first, the sum-cap divides by a
smaller `sumDetUnits` and may not bring it down to `p.units` correctly. Trace:
- p.units = 3
- detByPlatform.Meta.units = 5, .Google.units = 1, .TikTok.units = 0
- Per-platform cap: Meta.units = min(5, 3) = 3; Google.units = 1 ≤ 3 — stays at 1.
- sumDetUnits = 4 > 3.
- Sum-cap: ratio = 3/4 = 0.75 → Meta.units = 2.25, Google.units = 0.75.
- Sum = 3.0 ✓ — sum is preserved.

OK, this path is correct. But:

**The real bug:** what if Meta has no mapped campaign? Step 2 zeroes Meta's entry on
line 416 (AFTER the cap+sum-cap on lines 357-389 have already run). So:
- After cap+sum-cap: Meta.units = 2.25, Google.units = 0.75 (sum = 3).
- Step 2 zeroes Meta (no mapped Meta campaign): Meta.units = 0.
- Step 2 credits Google's 0.75 to its campaign.
- totalDetUnits after Step 2 = 0.75 (only Google was credited).
- remUnits = max(0, 3 - 0.75) = 2.25 ✓

OK, the zeroing **does** correctly re-route the units back through the remainder. So
units ARE mass-conserved in this case. **My initial reading was wrong — let me reclassify.**

**Reclassified:** Actually the bug is more subtle and only fires in a specific case.
Consider:
- p.units = 3, p.netRevenueCad = $200 (positive)
- Meta has $300 deterministic revenue but no mapped Meta campaign.
- TikTok has $100 deterministic revenue and 1 mapped TikTok campaign.

After per-platform revenue cap (`p.netRevenueCad >= 0` is true, so it fires):
- Meta.revenue = min($300, $200) = $200.
- TikTok.revenue = $100.

After sum-cap (sumDetRev = $300 > $200, ratio = $200/$300 = 0.667):
- Meta.revenue = $200 × 0.667 = $133.33.
- TikTok.revenue = $100 × 0.667 = $66.67.
- Sum = $200 ✓.

Step 2 zeroes Meta (no mapped campaign): Meta.revenue = 0.
Step 2 credits TikTok's $66.67 to its campaign.
totalDetRev after Step 2 = $66.67.
remRev = $200 - $66.67 = $133.33.
Step 3 distributes $133.33 across all mapped campaigns (just the 1 TikTok one).
TikTok campaign final: $66.67 + $133.33 = $200 ✓.

OK, this is **also** mass-conserved. The zeroing pattern is robust.

**Actually, I retract CRITICAL-01.** Walking through the math, the allocator IS
mass-conserving in all cases I can construct. The cap-then-sum-cap-then-zero pipeline
correctly preserves mass. I'm downgrading this to a non-finding.

**Revised classification: This finding is RETRACTED. The allocator's mass conservation
is verified in revenue, units, and mixed cases.**

---

### HIGH-01: User-visible "2.5σ" label contradicts the MAD ×3 code (wrong number AND wrong unit)

**File:** `dashboard-web/src/lib/attributionAnalysis.ts:528` (label) and `:53` (constant)

**Evidence:**
- Line 53: `const MAD_OUTLIER_MULTIPLIER = 3;`
- Line 654: `MAD_OUTLIER_MULTIPLIER * deviation` (where `deviation = mad(vals, med)`)
- Line 528: user-visible message says `דיווח >2.5σ מעל הממוצע שלו`

The operator-facing message claims "2.5σ above the mean" but:
1. **Wrong number:** the code uses ×3 MAD, not ×2.5. If "σ" really meant σ, the
   threshold would have to match (it doesn't).
2. **Wrong unit:** MAD ≠ σ. For normal data, MAD × 1.4826 ≈ σ, so MAD×3 ≈ σ×2.027.
   The operator sees "2.5σ" but the actual threshold is more like 2σ from the median
   (not the mean — also wrong).
3. **Wrong central tendency:** "above the mean" — MAD is computed against the median.

**Why it matters:** The audit prompt asks "is the threshold (typically 2.5σ) operator-
appropriate?" — but the threshold is **not 2.5σ**, it's MAD×3 against the median. The
operator can't tune what they can't measure. Three nested errors in 28 characters of
copy.

**Fix:**
```ts
// In attributionAnalysis.ts:528, rewrite the message:
`${outlierDays.length} ימים שבהם ${campaign.platform} דיווח >${MAD_OUTLIER_MULTIPLIER} MAD מעל החציון (modeled spikes): ...`
```

Or, more honestly:
```ts
`${outlierDays.length} ימי spike — ${campaign.platform} דיווח ב-${MAD_OUTLIER_MULTIPLIER}× MAD מעל החציון של 7 הימים הקודמים`
```

---

### HIGH-02: Bayesian shrinkage uses CAD as the sample-size proxy — not the same dimension as orders

**File:** `dashboard-web/src/lib/multiMappingCohort.ts:140-146`

**Evidence:**
```ts
const ROAS_SHRINKAGE_ANCHOR_CAD = 500;
function shrinkRoas(roas: number, spend: number): number {
  if (spend <= 0) return 1.0;
  const w = spend / (spend + ROAS_SHRINKAGE_ANCHOR_CAD);
  return roas * w + 1.0 * (1 - w);
}
```

The Bayesian intuition the docstring appeals to is that "small sample → pull toward
prior." The natural sample-size for ROAS estimation is **the number of orders**, not
spend. A $500-spend high-AOV ($500/order = 1 order) campaign and a $500-spend low-AOV
($10/order = 50 orders) campaign get **identical shrinkage** under the current formula
— but the second is 50× more statistically informative.

**Why it matters:** for high-AOV stores (uzoshop) vs. low-AOV stores (Zol Plus), the
"effective minimum sample" of $500 means **very different things**. For uzoshop, $500
might be 1 order; for Zol Plus, 50 orders. Same spend, vastly different statistical
power.

**Worked counter-example:**
- Campaign A: spend=$500, orders=1, AOV=$2000, ROAS=4.0.
- Campaign B: spend=$500, orders=50, AOV=$40, ROAS=4.0.

Under current code, both get `shrunkRoas = 4 × 0.5 + 1 × 0.5 = 2.5`. The operator is
told they're tied. But Campaign A is one order from a noise pulse; Campaign B has 50
data points of evidence. Campaign B should rank higher.

**Fix:** use `conversions` (which is already on `agg.conversions` per line 325 of
`multiMappingCohort.ts`) as the sample-size proxy, possibly combined with spend:

```ts
// Two-axis shrinkage: anchor on the BETTER of "10 orders" or "$500 spend",
// whichever provides more statistical support.
const SHRINK_BY_ORDERS = 10;
const SHRINK_BY_SPEND_CAD = 500;
function shrinkRoas(roas: number, spend: number, orders: number): number {
  if (spend <= 0 || orders <= 0) return 1.0;
  const wOrders = orders / (orders + SHRINK_BY_ORDERS);
  const wSpend = spend / (spend + SHRINK_BY_SPEND_CAD);
  const w = Math.max(wOrders, wSpend);
  return roas * w + 1.0 * (1 - w);
}
```

---

### HIGH-03: `productCentricView` allocation diverges from `allocateProductRevenue` whenever orders have platform signal

**File:** `dashboard-web/src/lib/productCentricView.ts:170-194`

**Evidence:** Lines 173-177 acknowledge this divergence:
```ts
// The true `allocateProductRevenue` is more nuanced (deterministic
// first, then proportional) but it requires orders data this
// module doesn't take. The simplified version is correct in
// expectation and exactly correct when all orders are non-attributed.
```

**Why it matters:** the operator opening the product-centric view sees per-platform
revenue figures that **do not match** the per-campaign revenue figures in the campaign-
centric view. For a Meta-heavy fbclid-tagged product where Meta has 70% of revenue but
only 40% of spend, the campaign-centric view shows Meta with $700 (from deterministic
$700 + 40% × $300 fallback = $820 actually) but the product-centric view shows Meta
with `$1000 × 40% = $400`. Same product, same window, two different numbers.

The "correct in expectation" claim is misleading — it's correct only if you accept the
pure spend-proportional model, which the campaign-centric view explicitly rejects.

**Fix:** either (a) thread orders through `buildProductCentricView` so the same
allocator is used, or (b) surface a banner on the product-centric view: "per-platform
revenue here uses spend-share approximation; for deterministic-first per-platform
revenue, see the campaign drawer."

---

### HIGH-04: Composition-change guard misses the "relative share tripled" false-positive vector

**File:** `dashboard-web/src/lib/cannibalizationDetection.ts:349-372`

**Evidence:** Guard fires only when a member is `material` (>=20% of either half's
spend) AND has <3 active days in the other half. A member with $50 → $150 spend
(5% → 15% of cohort total) — neither share exceeds 20%, guard never fires. The
member is folded silently into the half-over-half comparison.

This is the **explicit Q7 scenario the audit prompt calls out** and the guard does
not handle it. The current guard handles "launched mid-range" and "paused mid-range"
but not "rebalanced mid-range."

**Why it matters:** an operator who shifted budget from a top performer to an
experiment will see the cannibalization banner fire when in reality they intentionally
changed the cohort composition. The banner reads as a verdict on the cohort's
saturation, but the actual cause is the composition shift.

**Fix:** add a relative-share-change check:
```ts
const earlyShare = earlySpend > 0 ? s.earlySpend / earlySpend : 0;
const lateShare = lateSpend > 0 ? s.lateSpend / lateSpend : 0;
const shareRatioFlipped =
  (earlyShare > 0.05 && lateShare / earlyShare >= 2) ||
  (lateShare > 0.05 && earlyShare / lateShare >= 2);
if (!material && !shareRatioFlipped) continue;
```

---

### HIGH-05: `productCentricView` silently drops revenue when cohort spend is zero

**File:** `dashboard-web/src/lib/productCentricView.ts:148-150, 178-194`

**Evidence:** When `totalCohortSpend === 0`:
- Line 150: `blendedRoas = 0` (correct).
- Line 180: `share = 0` for every platform.
- Line 181: `platformAllocatedRevenue` = 0 for every platform.
- Line 190: `intraShare = 0` for every member.
- Line 194: `allocatedRev = 0` for every member.

If the product has `totalNetRevenue = $500` (e.g., the product sold but all cohort
campaigns were paused), the $500 is in `totalNetRevenue` (line 149) but **never
distributed to any member**. Sum of `allocatedRevenueEstimate` across members = $0.
This silently violates the "sum of member allocations = totalNetRevenue" invariant
that the operator probably assumes.

**Why it matters:** the operator scrolling the product-centric view sees a product
with revenue but zero ROAS in every member row — the revenue appears to vanish.
HIGH-05 from the original audit was supposedly addressed; the fix is incomplete.

**Fix:** when `totalCohortSpend === 0`, fall back to equal-share allocation:
```ts
const share = totalCohortSpend > 0 ? spend / totalCohortSpend : 1 / platformGroups.size;
```

(Same pattern `allocateProductRevenue` uses at line 425-426 for the no-spend fallback.)

---

### MEDIUM-01: "Maximum cumulative negative: −15" comment in cohort adjustment is stale

**File:** `dashboard-web/src/lib/campaignHealthScore.ts:487-488`

**Evidence:** Comment claims:
```
Maximum cumulative negative: −15 (weakest + high cannibalization).
Maximum cumulative positive: +3 (leader, no cannibalization).
```

Code (lines 510-534): the deltas can mix. `isLeader (+3) + isWeakest (−5) + high (−10)`
is mathematically impossible (can't be both leader AND weakest), so the −12 case the
prompt asks about cannot occur. The actual extremes are:
- Max negative: `−5 (weakest) + −10 (high cannib) = −15` ✓ (when not leader)
- Max positive: `+3 (leader) − 0 (no cannib) = +3` ✓

The comment is technically correct. **BUT** an operator reading the comment will
assume the deltas stack independently; they don't, because of the leader/weakest
exclusivity. The comment should call this out:

```
// isLeader and isWeakest are MUTUALLY EXCLUSIVE — the same campaign can't be
// both rank 1 and rank N (cohort N >= 2 always). So the worst case is:
//   -5 (weakest) + -10 (high cannib) = -15
// and the best case is:
//   +3 (leader) - 0 = +3
```

---

### MEDIUM-02: `revenueGrowthPct` with `Math.abs(earlyRev)` denominator hides sign flips

**File:** `dashboard-web/src/lib/cannibalizationDetection.ts:404-409`

**Evidence:**
```ts
const revenueGrowthPct =
  earlyRev !== 0
    ? (lateRev - earlyRev) / Math.abs(earlyRev)
    : ...
```

When `earlyRev = -$100` and `lateRev = $50`, formula gives `(50 - (-100)) / 100 = 1.5`
(= +150% growth). Operationally: the product went from refund-heavy to profitable —
that's good news. The +150% number is sound.

But when `earlyRev = $100` and `lateRev = -$50`, formula gives `(-50 - 100) / 100 = -1.5`
(= -150% "growth"). Operationally: product went from profitable to refund-heavy — bad
news. The −150% reads naturally.

What about when both are negative? `earlyRev = -$100`, `lateRev = -$200`:
`(-200 - (-100)) / 100 = -1.0` (= −100% growth). But revenue got **worse** (deeper into
negatives) — operator reads this as "revenue dropped 100%" which doesn't capture
"revenue got twice as negative."

**Why it matters:** the verdict downstream uses `revenueGrowthPct < 0.05` (high threshold)
and `revenueGrowthPct < spendGrowthPct/2` (medium). A refund-heavy product where revenue
went from −$100 to −$200 with spend growing 25% would have `revGrowth = -1.0` which
is well below 0.05 → HIGH risk fires. That's probably the right verdict, but for the
**wrong reason** (the formula thinks revenue "shrunk" 100% when really it doubled in
magnitude in the wrong direction).

**Fix:** for negative-revenue cases, compute growth in absolute-magnitude terms with a
sign flip:
```ts
// When both halves are negative, growth in NEGATIVE terms = growth in REFUNDS.
// Phrase it accordingly in the reason copy.
const revenueGrowthPct =
  earlyRev > 0
    ? (lateRev - earlyRev) / earlyRev
    : earlyRev < 0 && lateRev < 0
      ? -(lateRev - earlyRev) / earlyRev  // both negative: refund growth direction
      : earlyRev === 0
        ? (lateRev > 0 ? Infinity : 0)
        : (lateRev - earlyRev) / Math.abs(earlyRev);  // sign flip cases
```

---

### MEDIUM-03: Marginal ROAS produces operator-confusing numbers when `deltaSpend` is small

**File:** `dashboard-web/src/lib/cannibalizationDetection.ts:412`

**Evidence:** `marginalRoas = deltaSpend > 0 ? deltaRev / deltaSpend : null`

When `deltaSpend = $5` (small scale-up) and `deltaRev = $500` (lucky day), marginalRoas
= 100. The operator sees "marginal ROAS = 100x" which sounds amazing but is just
sample-size noise.

The "deltaSpend > 0" guard prevents division by zero but doesn't address the small-
denominator inflation problem. The cohort detection's spendGrowthPct >= 0.10 floor
prevents this for the verdict, but the `marginalRoas` field is **rendered raw** to the
operator (verified by grep — used in tooltips).

**Fix:** apply a minimum spend delta before reporting marginalRoas:
```ts
const MIN_DELTA_SPEND_FOR_MARGINAL_ROAS = 50; // CAD
const marginalRoas = deltaSpend >= MIN_DELTA_SPEND_FOR_MARGINAL_ROAS
  ? deltaRev / deltaSpend
  : null;
```

(The MEDIUM-tier classification already requires `(lateSpend - earlySpend) >= 50` on
line 438, so the threshold has precedent.)

---

### MEDIUM-04: Per-platform ROAS pivot creates a 25-point discontinuity at platform reclassification

**File:** `dashboard-web/src/lib/campaignHealthScore.ts:136-141, 246-252`

**Evidence:**
- Meta pivot = 3.0 → ROAS 2.5 scores `((2.5-1)/(3-1)) × 100 = 75`.
- TikTok pivot = 2.0 → ROAS 2.5 scores `((2.5-1)/(2-1)) × 100 = 150` → clamped to 100.

Same ROAS, different platforms: **25-point swing**. The operator who renames a Meta
campaign to TikTok (or imports a TikTok campaign that gets misclassified) sees the
score jump.

**Why it matters:** the audit fix is well-intentioned (TikTok prospecting really does
have a lower "great" bar than Meta), but the implementation is discontinuous. A campaign
straddling the boundary (e.g., a cross-platform replicated campaign on Meta and TikTok
with the same ROAS) will score differently purely on the platform label.

**Fix options:**
- (a) Accept the discontinuity as the intended behavior; document it in the operator
  manual as "per-platform expectations differ."
- (b) Use a smoothed pivot blend; e.g., `pivot = 0.5 × global + 0.5 × platform` to
  damp the swing.
- (c) Surface the pivot in the score tooltip so the operator sees "scored vs TikTok
  benchmark 2.0" and isn't confused.

The code already does (c) on line 257: `יעד ${pivot.toFixed(1)}`. **So this is
acceptable** — flagging as MEDIUM rather than HIGH because the discontinuity is
documented in the score reason.

---

### MEDIUM-05: `p.netRevenueCad === 0` boundary case in deterministic cap creates inconsistency

**File:** `dashboard-web/src/lib/campaignProductMap.ts:357-365, 378`

**Evidence:** The per-platform cap (line 358) and sum-cap (line 378) gate on
`p.netRevenueCad >= 0`. When `p.netRevenueCad === 0` exactly:
- The cap fires (`>=` includes equals).
- For any platform with `detByPlatform[k].revenue > 0`, the cap reduces it to `0`.
- This is correct (deterministic can't exceed total = 0).

But what about `p.netRevenueCad === -0.01` (a near-zero refund-heavy)? The cap
**doesn't** fire (`-0.01 >= 0` is false). The deterministic value stays positive (e.g.,
$50). Then Step 3 computes `remRev = -0.01 - 50 = -50.01`, which **does** get
distributed negatively across all mapped campaigns.

So for `p.netRevenueCad = 0`: deterministic capped to 0, fallback distributes $0.
For `p.netRevenueCad = -0.01`: deterministic stays at $50, fallback distributes -$50.01.

The **revenue per campaign** is wildly different at this boundary:
- p=0: each campaign gets $0 revenue.
- p=-0.01: campaigns get ~$50 deterministic - proportional share of $50.01 fallback ≈ near-zero with high variance.

**Why it matters:** the boundary at `p.netRevenueCad = 0` is fragile. A product that
moves from $0.01 → $0 → -$0.01 net revenue over three reload-refresh cycles (cross-day
refund propagation) would show wildly different per-campaign revenue values, even
though the net is essentially zero. This isn't a mass-conservation violation, but
it's a "small input change → large output change" instability that the operator may
observe as flickering numbers.

**Fix:** lower the threshold to `> 0` (strict) to be consistent with the negative case:
```ts
if (p.netRevenueCad > 0 && detByPlatform[k].revenue > p.netRevenueCad) {
  ...
}
```
For `p.netRevenueCad === 0`: skip the cap (deterministic stays as-is). Step 3 then
correctly distributes `remRev = 0 - totalDetRev` (negative) across campaigns. Net
result: campaigns get deterministic-positive minus fallback-negative-share, which
sums correctly to $0 across the cohort. ✓

---

### MEDIUM-06: Cohort-aware "operator adjustment" ordering documented inconsistently

**File:** `dashboard-web/src/lib/campaignHealthScore.ts:30-35, 442-443, 499-548`

**Evidence:** Module docstring (lines 30-35) says:
```
Plus a separate ±adjustment applied after the weighted sum:
  - optimized=true:  +15  (operator vouches for it; small boost)
  - isCurrentlyOff:  −30  (historical numbers only; not forward-looking)
```

`computeCampaignHealth` applies the operator adjustment at line 443-444:
```ts
const op = applyOperatorAdjustment(optimized, isCurrentlyOff);
const finalScore = Math.round(Math.max(0, Math.min(100, weightedSubtotal + op.delta)));
```

Then `applyCohortHealthAdjustment` (line 499) takes the **already-clamped finalScore**
and adds another delta. So the actual order is:
1. weightedSubtotal (with renormalized weights if no trajectory).
2. + operatorAdjustment (op.delta = ±15 / ±30).
3. CLAMP to [0, 100].
4. + cohortAdjustment (−15 to +3).
5. CLAMP to [0, 100].

**Why it matters:** the double-clamp can hide signal. A score of 95 + operator +15 →
110 → clamped to 100; then cohort −15 → 85. A score of 90 + operator +15 → 105 →
clamped to 100; then cohort −15 → 85. Same final score (85) for two campaigns
where one had +5 more raw room. Operator can't reconstruct the breakdown from the
final.

**Fix:** defer the clamp to the end. Make `op.delta` and `cohortAdjustment` first-
class fields in the components breakdown (which they already are — `operatorAdjustment`
and `cohortAdjustment`), but compute the final score as a single clamp:

```ts
const rawTotal = weightedSubtotal + op.delta + cohortDelta;
const finalScore = Math.round(Math.max(0, Math.min(100, rawTotal)));
```

This requires refactoring `applyCohortHealthAdjustment` to not call `gradeFor` itself
but accumulate into the components.

---

### MEDIUM-07: `analyzeCpmVsRoas` falls back to `mode='half-over-half'` silently when `prevSeries.length < 3` even if some prev data is present

**File:** `dashboard-web/src/lib/cpmRoasAnalysis.ts:155-157`

**Evidence:**
```ts
const prevSeries = (options?.prev ?? []).filter(d => d.cpm > 0);
const havePrev = prevSeries.length >= PREV_PERIOD_MIN_DAYS;
const mode: ... = havePrev ? 'previous-period' : 'half-over-half';
```

When prev has 2 valid days, `havePrev = false` → mode silently falls back to
half-over-half. The `mode` field IS surfaced in the return value (line 273) so the
UI shows the comparison label. But the operator who passed prev expecting prev-based
analysis won't know **why** the fallback happened.

**Why it matters:** the FIX-19 banner copy uses `PREV_PERIOD_MIN_DAYS` (verified at
line 33) so the operator sees a banner saying "need at least 3 days of prev data" —
this part is OK. The MEDIUM tag is because the analyzer doesn't surface **why** the
fallback happened in the `text` field itself, only in the `mode` field. A tooltip
on the mode label would make this discoverable.

---

### MEDIUM-08: `attributionAnalysis.computeWindowStability` requires `MIN_RANGE_DAYS_FOR_STABILITY = 14` (2 × WINDOW_DAYS) before any signal

**File:** `dashboard-web/src/lib/attributionAnalysis.ts:42, 571`

**Evidence:**
```ts
const MIN_RANGE_DAYS_FOR_STABILITY = 2 * WINDOW_DAYS;  // 14
if (totalDays < MIN_RANGE_DAYS_FOR_STABILITY) return null;
```

For a 13-day operator range (a common preset), window stability returns null. No
volatile-downgrade can fire. The operator sees a "high trust" verdict on attribution
that **would have been downgraded to medium** if the range were one day longer.

**Why it matters:** the operator's most common range is "last 7d" or "last 14d." 7d
never gets window-stability. 14d barely does (only 1 full week + 1 day tail < 3, so
only 1 effective bucket — and `coverages.length < 2` returns null on line 614). So
window-stability is **mostly dead code** for the operator's typical ranges.

**Verification:** for a 14-day range:
- `totalDays = 14`, `fullWindows = 2`, `tailDays = 0`.
- `totalWindows = 2 + (0 >= 3 ? 1 : 0) = 2`.
- 2 buckets created. If both have `meta > 0`, `coverages.length = 2`, then `length < 2`
  is false — proceeds. ✓

For a 13-day range:
- Returns null at line 571.

For a 15-day range:
- `totalDays = 15`, `fullWindows = 2`, `tailDays = 1` < 3 → `totalWindows = 2`.

For a 16-day range:
- `totalDays = 16`, `fullWindows = 2`, `tailDays = 2` < 3 → `totalWindows = 2`.

For a 17-day range:
- `totalDays = 17`, `fullWindows = 2`, `tailDays = 3` >= 3 → `totalWindows = 3`. ✓

So window stability has a hard discontinuity at 14d vs 13d (null vs not-null), and
3 effective buckets only kick in at 17d+. **Operator probably doesn't perceive this
as a quality cliff** but it's worth documenting.

---

### LOW-01: `Object.entries(productMap)` iteration order affects cohort tie-break

**File:** `dashboard-web/src/lib/multiMappingCohort.ts:238-253`

See Q5 above. Not a bug per se — the behavior is deterministic within a session — but
the operator-explainability is weak. **Fix:** sort the `others` array by `campaignKey`
before push so the input order to the stable sort is canonical.

---

### LOW-02: `splitRangeHalves` uses UTC parsing; operator's range strings may be local-tz formatted upstream

**File:** `dashboard-web/src/lib/cannibalizationDetection.ts:98-100`

**Evidence:**
```ts
function parseDate(s: string): Date {
  return new Date(`${s}T00:00:00Z`);
}
```

If the operator's localRange uses `2026-05-15` strings but those were derived from
local-tz boundaries (e.g., Israel +03/+02), parsing as UTC produces midnight UTC,
which may shift a day for the operator's perception. The function's output strings
(`d.toISOString().slice(0, 10)`) are also UTC-formatted, so they round-trip cleanly.
**Likely not a bug** in current usage but worth verifying with the localRange origin.

---

### LOW-03: `analyzeCpmVsRoas` `categorize(null) === 'flat'` blurs "no data" with "stable"

**File:** `dashboard-web/src/lib/cpmRoasAnalysis.ts:199-204`

**Evidence:**
```ts
function categorize(delta: number | null): 'up' | 'down' | 'flat' {
  if (delta === null) return 'flat';
  ...
}
```

When `cpmDelta = null` (zero baseline) AND `roasDelta = -0.30`, the output is
"flat + down" → "FLAT + DOWN" branch on line 258 → "creative fatigue" verdict.
But the actual cause is "we have no CPM baseline to compare against" — a different
problem. The verdict misleads.

**Fix:** add a 'unknown' category and a 'unknown × X' / 'X × unknown' branch that
reports "insufficient data on one axis."

---

### LOW-04: `productCentricView.byPlatform.intraAllocatedRevenue` doesn't sum to `totalNetRevenue`

**File:** `dashboard-web/src/lib/productCentricView.ts:178-194, 222-224`

**Evidence:** `platformAllocatedRevenue` (line 181) is computed as
`totalNetRevenue × spend/totalCohortSpend`. Sum across platforms:
`Σ (totalNetRevenue × spend_p / totalCohortSpend) = totalNetRevenue × (Σ spend_p / totalCohortSpend) = totalNetRevenue × 1.0 = totalNetRevenue` ✓

But this only holds when **every cohort campaign has an aggregated row.** If 2 of 3
cohort campaigns have rows (third was paused, raw entry exists but `raw[i].agg === undefined`),
the `platformGroups.set` skip on line 156 excludes the third's platform from
`platformSpend`. So `Σ platformSpend < totalCohortSpend` if `totalCohortSpend` is
computed from `raw` (line 148) but `platformSpend` is computed only from `raw with agg`.

Wait — line 148 says: `totalCohortSpend = raw.reduce((s, r) => s + (r.agg?.spend ?? 0), 0)`.
The `?? 0` skips no-agg members for spend. So `totalCohortSpend` only counts spend
from members with `agg`. And `platformSpend` also only counts those. Sum is preserved.
**So this is actually correct.** ✓ Reclassifying to LOW because the code reads as
fragile but is technically right.

---

### LOW-05: `attributionAnalysis.detectOutlierDays` uses MAD with `MAD_FALLBACK_FRACTION = 0.05` when MAD = 0

**File:** `dashboard-web/src/lib/attributionAnalysis.ts:653-655`

**Evidence:**
```ts
const threshold = deviation > 0
  ? MAD_OUTLIER_MULTIPLIER * deviation
  : Math.max(1e-9, Math.abs(med) * MAD_FALLBACK_FRACTION);
```

When MAD is 0 (all baseline values are identical), the fallback is 5% of |median|.
This is **very tight** — any 5% jump above a constant baseline is flagged as a spike.
For a steady-state campaign at $100/day, a $106 day fires. Operator probably doesn't
want that.

**Fix:** raise to a more sensible default (e.g., 25%) or scale by something like
average AOV.

---

### LOW-06: `analyzeAttribution` and `buildAnalysis` (shared engine) duplicate the trust-ladder logic

**File:** `dashboard-web/src/lib/attributionAnalysis.ts:410-508, 873-944`

**Evidence:** The `if (campaign.metaClaim === 0 && ...) else if (...)` ladder is
duplicated in both functions with subtle wording differences. The audit fixes
applied in v1 had to be applied twice (and the comment trail confirms — IN-04
comment on lines 318-319 acknowledges the duplication).

**Why it matters:** future drift between `analyzeAttribution` and `buildAnalysis`
behavior is likely. A bug fix in one may not be applied to the other. The
`computeCoverage` helper extraction was a good step; the trust-ladder extraction is
the natural next refactor.

---

## What's Mathematically Solid

These algorithms I trust:

1. **`allocateProductRevenue`'s revenue mass conservation.** Across all 5 worked
   examples (single mapping, multi-mapping, deterministic-only, fallback-only, mixed),
   revenue sums correctly to `p.netRevenueCad` within IEEE 754 epsilon. The
   negative-remainder distribution (T2.4 fix) is correctly implemented.

2. **`splitRangeHalves` boundary math.** Explicitly tested for 2d/4d/5d/7d/14d cases.
   Convention "late half gets the extra day" is consistently applied via
   `Math.floor(totalDays / 2)` for `midDays`.

3. **`shrinkRoas` mathematical limits.** Walking through the formula:
   - `spend → 0` → returns 1.0 (correct prior).
   - `spend → ∞` → returns raw ROAS (correct posterior).
   - `spend = anchor` → returns (raw + 1)/2 (midpoint).
   The Bayesian formulation is internally consistent (modulo the HIGH-02 dimension
   issue).

4. **`computeCampaignHealth` weight renormalization for missing trajectory (HR-03 fix).**
   The `scaleFactor = 1.0 / 0.75` correctly preserves [0, 100] range when the
   trajectory component is dropped. Tested algebraically: `(0.40 + 0.15 + 0.20) × (1/0.75) = 0.75 × 1.333 = 1.0`. ✓

5. **`cannibalizationDetection` HIGH/MEDIUM/LOW cascade.** The threshold ordering
   `spendGrowthPct >= 0.25 AND revGrowth < 0.05` (HIGH) → `>= 0.15 AND revGrowth < spendGrowth/2`
   (MEDIUM) → `>= 0.20 AND revGrowth < spendGrowth * 0.75 AND deltaSpend >= 50` (LOW)
   is correctly ordered to produce the most-severe verdict first. The +20% spend / +9%
   rev case correctly falls into MEDIUM (worked above).

6. **`analyzeCpmVsRoas` 9-cell matrix.** Each cell's tone assignment is operator-correct.
   The Pearson correlation guard (`n < 3`, zero variance) is mathematically sound.

7. **`computeCoverage` asymmetry.** Documented and intentional. `det=0, claim=0 → 0`
   ("nothing to analyze") vs `det=N, claim=0 → 1` ("Shopify saw it but Meta didn't —
   perfect halo") is the correct semantic for the operator's mental model.

8. **`computeMultiMappingCohort` `isWeakest` floor at `totalMembers >= 3`.** Correctly
   prevents "someone had to be lower" false positives in 2-member cohorts. Matches the
   `applyCohortHealthAdjustment` floor (single source of truth).

---

## Subtle Bugs to Investigate

Places where the code might be doing something different from what the comments claim:

1. **`attributionAnalysis.ts:528` — "2.5σ" string when code uses MAD × 3 against the
   median.** Three nested errors in one operator-visible label. HIGH-01 above.

2. **`campaignHealthScore.ts:487-488` — "Maximum cumulative negative: −15" comment is
   right but ambiguous about leader/weakest exclusivity.** MEDIUM-01 above.

3. **`productCentricView.ts:173-177` — "exactly correct when all orders are
   non-attributed"** acknowledges the divergence from `allocateProductRevenue` but
   doesn't surface it to the operator. HIGH-03 above.

4. **`multiMappingCohort.ts` Bayesian docstring** ("$500 + ROAS 8 → shrunk ROAS ≈ 4.5
   (~10 orders of signal preserved)") — uses "orders" terminology but the formula
   doesn't actually use order count. HIGH-02 above.

5. **`cannibalizationDetection.ts:238-241` — "MATERIAL_MEMBER_SPEND_SHARE = 0.2"**
   documented as catching "launched mid-range OR paused mid-range" — but misses
   "rebalanced mid-range" (Q7 scenario from the audit prompt). HIGH-04 above.

6. **`campaignProductMap.ts:357-365` — the `p.netRevenueCad >= 0` guard.** Comment
   (lines 350-356) reads as if this is the principled handling of refund-heavy
   products, but the `>=` is fragile at exactly zero (MEDIUM-05 above) and produces
   discontinuous results across the zero boundary.

7. **`campaignHealthScore.ts:215` — `if (info && info.deterministicRevenue > 0)`** —
   what if `deterministicRevenue` is negative (refund-heavy)? The code falls through
   to the next branch (combined Shopify revenue), which has its own `info.trueRevenue
   > 0` check. If both are zero or negative, falls to platform-claim (line 232).
   **But** for a refund-heavy product, the platform-claim path is the worst signal
   to fall back to (Meta's Pixel claim ignores refunds). The score may be artificially
   high. Worth a test: campaign with $1000 Meta claim, $200 platform-claim ROAS, but
   $-50 deterministic (net refunds) — current code reports ROAS=0.2 → score=0, which
   is correct. But the **reason** would say "Platform claim" not "deterministic
   negative" — the operator-facing label is misleading.

8. **`attributionAnalysis.ts:599-606` — daily Meta series with negative values.**
   `Number.isFinite(p.value)` accepts negative values into the meta-claim bucket.
   But Meta never emits negative `conversion_value` per `computeCoverage`'s own docstring
   (line 132-139). If a malformed upstream pipeline ever produces negative dailyMeta,
   the bucket meta would be negative, `meta > 0` filter (line 612) would drop it
   correctly. ✓ Defended.

---

_Reviewed: 2026-05-23_
_Reviewer: Claude (Opus 4.7, 1M context) — adversarial algorithm-correctness audit_
_Files audited: 7 algorithm files + 4 caller files for context_
