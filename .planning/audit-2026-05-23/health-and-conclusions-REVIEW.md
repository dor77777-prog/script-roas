---
audit: health-and-conclusions
reviewed: 2026-05-23
scope:
  - dashboard-web/src/lib/campaignHealthScore.ts (base components only)
  - dashboard-web/src/lib/aiReport.ts
  - dashboard-web/src/lib/insights.ts
  - dashboard-web/src/lib/cpmRoasAnalysis.ts
  - dashboard-web/src/lib/attributionAnalysis.ts
  - dashboard-web/src/components/InsightsPanel.tsx
  - dashboard-web/src/components/InsightsBoard.tsx
  - dashboard-web/src/components/WhatsWorking.tsx
  - dashboard-web/src/components/AiReportButton.tsx
  - dashboard-web/src/lib/notifications/sendDailySummary.ts
  - dashboard-web/src/lib/notifications/summary.ts
  - dashboard-web/src/lib/notifications/templateParams.ts
  - dashboard-web/src/lib/notifications/whatsapp.ts
  - dashboard-web/src/inngest/functions/cronWhatsapp.ts
  - dashboard-web/src/lib/__tests__/campaignHealthScore.test.ts
  - dashboard-web/src/lib/__tests__/cpmRoasAnalysis.test.ts
out-of-scope:
  - applyCohortHealthAdjustment / cohort logic (Agent 2)
  - allocateProductRevenue / revenue allocation (Agent 1)
findings:
  critical: 4
  high: 8
  medium: 9
  low: 6
  total: 27
---

# Health Score · AI Report · Daily Summary · Insights — Adversarial Audit

## Summary

**Health Score (base components):** *Mostly trustworthy, with one important caveat.* The 4-component weighted formula is mathematically sound, well-tested (39 tests), and correctly handles the dominant failure modes (zero spend, missing trust, low data). The weights and grade ladder are *documented and defensible*. The two material issues are: (1) ROAS thresholds are platform-agnostic — Meta, Google, and TikTok are all judged against the same `(ROAS-1)/2*100` curve, even though baseline ROAS differs materially between platforms (Google Shopping vs Meta Reels) and between stores (uzoshop's basket value ≠ Zol Plus's); (2) the campaign-level `metaClaim` path uses **platform-reported `conversionValue`** which Meta itself inflates via modeled/view-through — and the trust modulation only kicks in when `attribution.trust` exists. For Google PMax (no attribution data) the trust modulator defaults to `0.5` which silently *halves* every Google campaign's profitability score. **Verdict: operator can trust the score as a *relative ranking* within a single platform/store, but should not compare Google scores to Meta scores directly.**

**AI Report:** *Trustworthy for diagnostic narrative; one BLOCKER for actionable recommendations.* The report's data sources are the same `daily / products / campaigns / orders / ads` arrays the dashboard table uses (filtered by the same `inRange` predicate), so the totals reconcile with the table. The Pixel↔Shopify reconciliation section is the gold-standard of what this report does well. **However**, the Multi-Mapping section (`🔗 מוצרים משותפים`) uses `netRevenue` × `spend share` — **completely ignoring the deterministic per-platform allocation that `allocateProductRevenue` computes elsewhere**. This double-counts revenue across cohort members in EXACTLY the way the operator was told it wouldn't. The Campaign Health Score table inside the report synthesizes a fake `TrueRevenueInfo` with `attribution.trust.score = coverage * 100`, which **diverges from the dashboard's real Health Score** because the dashboard's `TrueRevenueInfo` has window-stability downgrades, outlier penalties, and a confidence-vs-trust distinction the report ignores. The same campaign will get a *different* Health Score in the AI report vs the table — by design, but not advertised. The report's date range is clearly stated in the header (`**טווח**: from → to`), so range confusion is unlikely.

**Daily summary (WhatsApp):** *Trustworthy for what it claims, with two correctness defects.* The 5-parameter mapping is correct (`{1}` title, `{2..4}` store blocks, `{5}` totals). Recipients are gated to whatever `phone1` + `phone2` are in the active `notification_config` row — *not* hardcoded to +972524809540 — so the operator's project-memory expectation needs explicit verification of the DB row. The HIGH-severity bug: **store ordering in the message is `Object.keys()` order**, which is JavaScript's insertion order from the Supabase query — **not deterministic**. If Supabase returns stores in a different order on different days, the same store will appear in `{2}` one day and `{3}` the next. There's also a quiet bug in the EOD title: `titleEod(dateStr)` formats the *input* date as DD/MM/YYYY but `cronWhatsappEod` passes `yesterdayJerusalem()` so the title reads "סיכום יום מלא — 22/05/2026" when sent at 00:10 on 2026-05-23 — that's correct. But the noon/evening titles read "12:00, 23/05/2026" which is *today*'s date, while the data range is also *today*. OK by design but worth confirming with operator. Failed sends are surfaced in the `SendResult` return value but **NOT alerted anywhere** — if both `phone1` and `phone2` fail, the only trace is in Inngest's run history.

**Insights / WhatsWorking / InsightsBoard:** *Trustworthy at the metric level, but the scope is misleading.* The board hardcodes "14 ימים אחרונים" in its subtitle (InsightsBoard.tsx:251) but the underlying `generateRecommendations` uses `lookback = addDays(today, -13)` (insights.ts:232) which is **the last 14 calendar days including today** — correct. The `WhatsWorking` widget compares this-week-vs-last-week, but uses `todayInIsrael()` for both ends of both windows, so if the dashboard data hasn't caught up to today (e.g., today's data only partially populated), the "this week" total includes a partial day and is artificially low — making the W/W delta look worse than reality. The anomaly detection (`detectAnomalies`) requires 8+ days of data per store and uses robust z-score against the trailing 14 days — defensible. **But:** the `InsightsPanel` (the smaller component, not InsightsBoard) ranks the "bottom store" as "lowest non-zero ROAS" without a sample-size floor (InsightsPanel.tsx:17) — a store with $1 spend and $0.50 revenue gets flagged as "needs attention." This is a *quality* defect, not a correctness defect, but it surfaces nonsense in the operator's quick-glance view.

---

## Findings

### CRITICAL

#### CR-01: AI Report multi-mapping section uses full `netRevenue × sharePct` — double-counts revenue across cohort members
**Files:** `dashboard-web/src/lib/aiReport.ts:1734-1816`

The section assembles a per-product "shared campaigns" table with a column `הכנסה משוערת` computed as `sp.totalNetRevenue * c.sharePct` (line 1813). `totalNetRevenue` (line 1737-1739) is the **full** Shopify product net revenue summed across all date rows — *unattributed*. `sharePct` is `c.spend / totalSpend` where `totalSpend` is the sum across ALL platforms (Meta + Google + TikTok) that share the product.

This is the exact double-counting the operator was warned about in the docstring at line 50-62:
> "the AI could say 'Scale Campaign A — it owns product X' when in fact Campaign A shares product X with Campaign B and the revenue is split"

The fix exists already in `allocateProductRevenue` (`campaignProductMap.ts:285-405`) which does deterministic per-platform attribution first (`detByPlatform`), then spend-proportional within platform. The AI report **does not use it**. The report's "estimated revenue per campaign" is therefore *not* the per-campaign true revenue — it's a naive split that:
- Gives **the same `netRevenue` total** to every campaign in the cohort, weighted only by their spend share
- **Ignores** that orders with `fbclid` should go to Meta campaigns and orders with `gclid` should go to Google campaigns *deterministically*
- Will systematically over-credit the larger-spend campaign on a cross-platform cohort

**Concrete failure case:** Product X mapped to Meta Campaign A ($500 spend) + Google Campaign B ($500 spend). Net revenue = $2000, of which $1500 came from orders with `gclid` (Google-attributed). `allocateProductRevenue` gives Google = $1500, Meta = $500. **AI report** gives Meta = $1000 (50% × $2000), Google = $1000 (50% × $2000). AI then recommends "Scale Meta Campaign A" because its allocated revenue looks healthy — wrong call.

**Fix:** Wire `allocateProductRevenue` into the multi-mapping section. Pass `orders` (already available), build the `productRevenue` array from `products`, build the `campaignSpend` map, then read `revenue` / `deterministicRevenue` from the returned `CampaignAllocation` per campaign instead of doing the naive split.

```ts
import { allocateProductRevenue } from './campaignProductMap';
// ... after building campaignLookup ...
const productRevenue = products.map(p => ({
  productId: p.productId,
  netRevenueCad: p.netRevenue ?? 0,
  units: p.units,
}));
const campaignSpend = new Map(
  Array.from(campaignLookup.values()).map(c => [c.key, c.spend]),
);
const allocByCampaign = allocateProductRevenue({
  storeId: /* per store */,
  map: productMap,
  productRevenue,
  campaignSpend,
  orders: orders.map(o => ({ /* map to AllocatorOrder shape */ })),
});
// Then per-campaign allocated revenue = allocByCampaign.get(c.key)?.revenue
```

---

#### CR-02: Daily WhatsApp store ordering is non-deterministic — same store can land in `{2}`, `{3}`, or `{4}` across days
**Files:** `dashboard-web/src/lib/notifications/templateParams.ts:131-139`, `dashboard-web/src/lib/notifications/summary.ts:176, 215`

`templateParams.ts:131` does:
```ts
const storeIds = summary && summary.stores ? Object.keys(summary.stores) : [];
for (let i = 0; i < 3; i++) {
  const sid = storeIds[i];
  ...
}
```
`storeIds` is the keys of `stores` in **insertion order** (since `summary.ts:215` does `stores[storeId] = {...}` in the order Supabase returns rows). Supabase's default query has no ORDER BY clause (`summary.ts:93-99`), so the row order is **whatever the planner picks** — typically the physical storage order, which is *not* stable across writes/vacuums.

**Consequence:** On Monday WhatsApp shows `{2}=uzoshop, {3}=Zol Plus, {4}=360usmile`. On Tuesday the order may flip. Operator reading the message at a glance will misattribute spend to the wrong store. The Hebrew text inside `{N}` does say "🏪 uzoshop:" so it's *recoverable* by reading the brand name, but it defeats the purpose of fixed positions.

**Fix:** Sort `storeIds` deterministically. Most defensible is store-name alphabetical, or operator-defined order via a `display_order` column:
```ts
const storeIds = summary && summary.stores
  ? Object.keys(summary.stores).sort((a, b) =>
      summary.stores[a].storeName.localeCompare(summary.stores[b].storeName)
    )
  : [];
```

Or add `.order('store_id', { ascending: true })` to the data_daily query in `summary.ts:99`.

---

#### CR-03: AI Report's in-report Campaign Health Score diverges from the dashboard's actual Health Score
**Files:** `dashboard-web/src/lib/aiReport.ts:1136-1192`

The report builds a synthetic `TrueRevenueInfo` (lines 1136-1153) with:
- `attribution.trust.score = coverage * 100` (where `coverage = det / metaClaim`, clamped to [0,1])
- `attribution.trust.level = trustScore >= 80 ? 'high' : ...`
- NO `windowStability`, NO `outlierDays`, NO refund-adjusted coverage

The dashboard's real `TrueRevenueInfo` (from `useCampaignTrueRevenue.ts:415-475`) calls `analyzeAttribution` which:
- Downgrades `trust.level` from `'high'` → `'medium'` when window-stability verdict is `'volatile'` (`attributionAnalysis.ts:521-523`)
- Bumps trust UP when the Meta↔Shopify gap is small AND there's mapping agreement
- Clamps negative coverage from refund-heavy windows
- Computes `roasInterval` (95% CI) which can drag the score down

**Consequence:** The same campaign will get *different* Health Scores in the AI report vs the dashboard table. Operator copies the report into Claude/GPT, gets recommendations based on report scores, then sees different grades when they open the table — confusion + loss of trust in BOTH numbers. Worse: the report's score is systematically *higher* than the dashboard's (no volatility downgrade), so report-driven scale-up recommendations will be too aggressive.

The fault is structural — the report doesn't have access to the orders-attribution analyzer's full output because that's computed per-render in a React hook. The report only has raw `orders`, `campaigns`, `products`.

**Fix (cheap):** Add a disclaimer in the report stating "Health Score in this report is a simplified approximation; the dashboard table has the authoritative score." Currently NO such disclaimer exists in the Hebrew prose around the score table (lines 1209-1219).

**Fix (right):** Call `analyzeAttribution()` directly from `aiReport.ts` for each top campaign (it's a pure function), then synthesize `TrueRevenueInfo` from the full result. This requires passing dailyMeta series for outlier detection, which the report already builds at line 1044-1057.

---

#### CR-04: AI Report's Health Score table uses a malformed `TrueRevenueInfo.attribution` shape — likely silent runtime failure or wrong score
**Files:** `dashboard-web/src/lib/aiReport.ts:1146-1148`

The synthesized `attribution` object:
```ts
attribution: {
  trust: { level: trustLevel as 'high' | 'medium' | 'low', label: trustLevel, score: trustScore },
} as unknown as ReturnType<typeof analyzeCpmVsRoas>['details'] extends infer X ? X : never,
```

This cast is *nonsense*. It's casting to `ReturnType<typeof analyzeCpmVsRoas>['details']` which is `{ n: number; cpmDeltaPct: ...; roasDeltaPct: ...; pearson: ... }` — a totally unrelated type. The runtime object only contains `trust`, missing every field `computeCampaignHealth` actually reads.

`scoreAttributionClarity` (`campaignHealthScore.ts:239-266`) reads `info.attribution.trust` and `info.attribution.trust.level` / `info.attribution.trust.score` — those DO exist on the synthesized shape, so it works **by accident**. But:
- `scoreProfitability` (`campaignHealthScore.ts:165-170`) reads `info.attribution.trust.level` to decide if it should use `info.attribution.trust.score / 100` as the modulator vs the `0.7` default. This works.
- If the upstream `computeCampaignHealth` is ever refactored to read another field on `attribution` (e.g., `attribution.windowStability`), the synthesized object will throw `TypeError: Cannot read property 'verdict' of undefined`, but the cast hides this from the type checker.

**Concrete defect right now:** the trust modulator on line 1145 uses `trustLevel: trustScore >= 80 ? 'high' : trustScore >= 40 ? 'medium' : 'low'`. Then `scoreProfitability` line 168-170 checks `info.attribution && info.attribution.trust.level !== 'unknown'` → true, then uses `info.attribution.trust.score / 100` as the modulator. **But** the threshold is `coverage * 100`. So a campaign with coverage = 0.42 (medium trust by the function's own ladder, score = 42) gets trust modulator = 0.42 — even though the dashboard's *real* MEDIUM trust gives 70 in `confidence.level === 'medium' ? 0.7` (campaignHealthScore.ts:177). The report's Health Score will be systematically lower for medium-coverage campaigns.

**Fix:** Either properly populate the full `AttributionAnalysis` shape (call `analyzeAttribution` for real), or drop the synthesis and use the `confidence`-path branch by passing `deterministicRevenue: 0` and a real `trueRevenue`. The current state misuses the type system to hide a real arithmetic defect.

---

### HIGH

#### HR-01: Health-score profitability fallback gives platform-only campaigns (Google) a fixed 0.5 trust multiplier — silently halves Google scores
**Files:** `dashboard-web/src/lib/campaignHealthScore.ts:181-184`

```ts
} else {
  baseRoas = aggregated.conversionValue / spend;
  trustModulator = 0.5;
  sourceLabel = 'הצהרת פלטפורמה (לא מאומת)';
}
```

This branch fires when `info` is undefined OR when neither `deterministicRevenue > 0` nor `trueRevenue > 0`. For Google PMax campaigns (no per-product attribution wired up), `info.attribution` is always `null` (per the docstring at line 244-247) and `trueRevenue` requires a productMap — for unmapped Google campaigns this branch runs always.

So a Google Search campaign with ROAS 4.0 reports a raw profitability of `(4-1)/2*100 = 100`, then halved by 0.5 → **50**. A Meta campaign with the SAME ROAS 4.0 backed by deterministic Shopify data with trust 90 gets `100 * 0.9 = 90`. **The same business outcome scores 40 points apart purely by platform.**

The `attributionClarity` component is *also* set to 50 for Google (`campaignHealthScore.ts:243-247`), which is fine — but profitability is the **40%-weighted** component, so a 40-point gap there moves the final score by 16 points. A Google A-grade campaign with ROAS 4.0 will land at 64 (mid-B) while the Meta equivalent lands at 80 (mid-A). The operator looking at the unified ranking column will systematically under-scale Google.

The justification in the comment (`"no verification possible"`) is true but the choice of 0.5 was unilateral and not platform-tested. A Google Search/Shopping campaign with strong conversion-value data is *more* reliable than a Meta campaign with mediocre click-id coverage — but this code says the opposite.

**Fix:** Per-platform default trust modulators. Google with `purchase` event from Shopping ads → ~0.85 (highly reliable). Google PMax → ~0.6. Meta with no orders-attribution → ~0.5 (current). The `Aggregated.platform` field is available; switch on it. Or: implement the `metric_source = 'google_purchase'` distinction once.

---

#### HR-02: Health Score ROAS thresholds are platform/store-agnostic
**Files:** `dashboard-web/src/lib/campaignHealthScore.ts:187`

```ts
const rawRoasScore = Math.max(0, Math.min(100, ((baseRoas - 1.0) / 2.0) * 100));
```

The curve breaks even at ROAS 1.0 and tops out at 3.0. This is a single global threshold:
- TikTok's baseline ROAS for an awareness-stage campaign with cold audience is typically 1.5-2.0; Meta retargeting can easily hit 4-5. **Same ROAS 2.0 means very different things on each platform.**
- uzoshop's AOV is ~$30; Zol Plus is ~$50; 360usmile is ~$80. **High AOV stores have higher break-even ROAS** because their margins are different (single COGS rate of 25% assumed for ALL stores — see also IN-01).
- A "great" ROAS for a brand-awareness campaign should not be the same as for a retargeting/conversion campaign. Currently the score doesn't know the difference.

**Consequence:** Operator scaling decisions calibrated to "anything above 3.0 ROAS is A" miss platform-specific opportunities (a TikTok prospecting campaign at 2.2 might be excellent in its peer group but scores ~60).

The grade ladder is documented and tuned, but tuned to one implicit benchmark.

**Fix (cheap):** Document the limitation explicitly in the drilldown popover ("Score is calibrated to e-commerce ROAS 1-3; comparing across platforms is approximate").

**Fix (right):** Per-platform/store ROAS multipliers in `WEIGHTS` — e.g., `TIKTOK_ROAS_PIVOT = 2.0`, `META_ROAS_PIVOT = 3.0`. Configurable, not magic.

---

#### HR-03: CPM trajectory neutral score (60) for "no data" inflates new campaigns into A/B grades
**Files:** `dashboard-web/src/lib/campaignHealthScore.ts:221-225`

```ts
if (!analysis || !analysis.hasData) {
  return {
    score: 60,
    reason: 'אין מספיק היסטוריה ל-CPM trend (פחות מ-5 ימים) — ציון נייטרלי',
  };
}
```

`scoreTrajectory` returns 60 when `analysis.hasData === false`, which happens for campaigns with `< 5 valid days`. That's 25% × 60 = **15 points** of the final weighted score, contributed by a non-signal.

A campaign with:
- ROAS 3.0 deterministic, trust 90 → profitability ≈ 90 × 0.4 = 36
- Spend $500 → volume = 100 × 0.15 = 15
- Trajectory unknown (new campaign) → "neutral" 60 × 0.25 = 15
- Attribution 90 → 90 × 0.2 = 18
- Total: **84 (A grade)**

The campaign has 4 days of data. The neutral score reads "we don't know if momentum is positive or negative" but the weighted contribution behaves as if it's *moderately positive*. A truly unknown signal should contribute 0 with the weights renormalized over the remaining components — OR the score should mark this as "trajectory unknown" and prevent the A grade.

**Operator impact:** Just-launched campaigns above the insufficient-data floor ($30) but below the CPM-trend floor (5 days) will routinely grade A on the strength of week-1 ROAS alone — when the very point of the trajectory component is to prevent over-reliance on a small recent sample. The `isInsufficient` gate at line 305 catches `spend < 30`, but a campaign with $150 spent in 4 days passes that gate and gets the "neutral trajectory" boost.

**Fix:** Either drop the weight contribution when `analysis.hasData === false` (renormalize the others — `(40 + 15 + 20) → 75` total → scale each up by 100/75), or use a *lower* default (e.g., 40 instead of 60) so missing trajectory acts as a slight penalty rather than a moderate boost.

---

#### HR-04: Daily summary failures are NOT surfaced anywhere — silently dropped after Inngest retries exhaust
**Files:** `dashboard-web/src/lib/notifications/sendDailySummary.ts:73-88`, `dashboard-web/src/inngest/functions/cronWhatsapp.ts:46-102`

```ts
for (const to of recipients) {
  result.recipientsAttempted.push(to);
  try {
    await sendWhatsAppTemplate({ ... });
    result.recipientsSucceeded.push(to);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    result.recipientsFailed.push({ to, error });
    // Continue to next recipient — phone1 failure must not block phone2.
  }
}
```

The `result.recipientsFailed` array is returned to Inngest. Inngest retries the *whole step* up to 3 times. But:
1. **Per-recipient failure does NOT trigger a retry**. Because the loop catches each recipient's exception and continues, the step's `await` resolves successfully → Inngest sees a clean run → no retry. Only a *whole-step* throw (e.g., a Supabase outage in `loadActiveMetacloudConfig`) triggers Inngest retries.
2. **Even if Inngest's retries exhaust**, the only place the failure is recorded is the Inngest dashboard run history. There's NO alert path. The operator's project memory notes that token-failure alerts are gated by Meta template approval — but this is a *send-failure*, not a token-failure, and there's no fallback notification mechanism (e.g., email, console, status page).

**Consequence:** WhatsApp template gets rejected (template paused, language mismatch, recipient outside 24h window with non-template message), per-recipient send fails silently, Inngest run shows "success" because the orchestrator caught the exception, operator never sees the failure until they realize they haven't gotten their noon summary in 3 days.

**Fix:** When `result.recipientsFailed.length > 0`, throw a soft `Error(JSON.stringify(result))` after the loop so Inngest:
- Marks the run as failed (visible in Inngest dashboard)
- Triggers an alert via an Inngest function with `triggers: [{ event: 'inngest/function.failed' }]`

OR: write to a `notification_send_log` table with status='failed' and have a separate cron check it daily.

---

#### HR-05: WhatsApp message recipient list is not validated against the operator's documented intent
**Files:** `dashboard-web/src/lib/notifications/sendDailySummary.ts:61-68`, `dashboard-web/src/lib/notifications/whatsapp.ts:160-185`

Per project memory: "Token-failure alerts go ONLY to +972524809540". The daily-summary code reads `phone1` + `phone2` from `notification_config` (where active=true, provider=metacloud). There's no:
- Audit log of which numbers received what (other than Inngest's run history)
- DB constraint that `phone1` is the locked operator number
- Sanity check that `phone1` matches a known operator number

If the `notification_config` row was ever edited (operator UI exists per project memory — `/operator`), a typo'd phone number would silently fan out daily summaries to a stranger.

**Consequence:** Privacy + cost (each WhatsApp template message costs a fraction of a USD; sending to wrong number could hit a stranger's WhatsApp 3 times/day indefinitely).

**Fix:** Add an env-var allowlist `NOTIFICATION_RECIPIENT_ALLOWLIST=+972524809540,+972...` and reject sends in `sendWhatsAppTemplate` to numbers outside the allowlist. Logged loudly when rejected.

---

#### HR-06: AI Report "Top campaigns" list ranks by ROAS using `c.value / c.spend` where `c.value` is platform-claimed `conversionValue` — not the deterministic Shopify ROAS
**Files:** `dashboard-web/src/lib/aiReport.ts:779-787`

```ts
const campaignsList = Array.from(campaignAgg.values())
  .map(c => ({
    ...c,
    roas: c.spend > 0 ? c.value / c.spend : 0,
    ...
  }))
  .filter(c => c.spend >= 50)
  .sort((a, b) => b.roas - a.roas);
```

`c.value` is `conversionValue` from the platform (Meta's `actions[value]` for purchase, Google's `conversions_value`, TikTok's `complete_payment_value`). These are precisely the numbers the report's preamble warns about ("Meta יכול לסבול מ-under-reporting...").

So the report:
1. Tells the AI "ROAS at the campaign level is unreliable, use Shopify-side for decisions"
2. Then ranks campaigns by exactly that unreliable ROAS
3. Feeds the top-25 list of platform-ROAS-ranked campaigns into the AI for analysis

The "Pixel↔Shopify" comparison table later in the report (line 883-924) is sorted by spend, not ROAS, so the operator only sees the deterministic-ROAS column for high-spend campaigns. A campaign with massive Meta-claimed value but ~0 Shopify orders will appear at the top of the "Top campaigns" table looking like a star, and only reading further down does the Pixel↔Shopify section reveal it's a hallucination.

**Fix:** Rank by `det / spend` when `det > 0`, else by `c.value / c.spend` with a "(Pixel only)" tag. Or rank by Shopify-side ROAS only for the top-25 list.

---

#### HR-07: `WhatsWorking` widget's week-over-week comparison uses today (partial day) as the end of "this week"
**Files:** `dashboard-web/src/components/WhatsWorking.tsx:62-67, 138-139`

```ts
const today = todayInIsrael();
const last7Start = addDays(today, -6);
const prev7Start = addDays(today, -13);
const prev7End   = addDays(today, -7);
...
if (p.date >= last7Start && p.date <= today) e.thisWeek += p.units;
else if (p.date >= prev7Start && p.date <= prev7End) e.lastWeek += p.units;
```

`thisWeek` includes `today`. If the dashboard data hasn't fully populated for today yet (e.g., at 10am, Shopify revenue is still rolling in for orders that will land at noon), `thisWeek` is **artificially low** vs `lastWeek` which is a full 7-day window. Every metric that compares thisWeek to lastWeek will look worse than reality for the first half of every day.

A "falling product" Insight that triggers at 11am may resolve itself by 11pm just from the day filling out.

**Fix:** End "this week" at yesterday, not today. `last7Start = addDays(today, -7); last7End = addDays(today, -1);` and `prev7Start = addDays(today, -14); prev7End = addDays(today, -8);`. Two clean, comparable 7-day windows.

---

#### HR-08: AI Report's Multi-Mapping `sharePct` uses `storeFilter` heuristic that may include orphan mappings
**Files:** `dashboard-web/src/lib/aiReport.ts:1709-1718`

```ts
if (storeFilterId) {
  const sampleCampaign = campaignLookup.get(campaignKey);
  if (!sampleCampaign) continue;
  const storeMatches = campaigns.some(
    c => c.storeId === keyStoreId && c.storeName === storeFilterId,
  );
  if (!storeMatches) continue;
}
```

The store filter is matching by `storeName` (`storeFilter = storeName === 'All' ? null : storeName`) against the productMap key's `storeId`. The cross-reference (`storeId === keyStoreId && storeName === storeFilterId`) **requires** the store's campaigns to be present in the current range's `campaigns` array. If the store's campaigns weren't active in the selected range, `storeMatches` is false and ALL of its productMap entries are silently dropped — even legit ones.

Worse: when filter is "All" (storeFilterId === null), this branch is skipped and ALL productMap entries from ALL stores are processed — but the campaign lookup may still be missing them (`if (!campaign) continue` on line 1720), so we silently drop stale mappings without telling the operator. There's no "you have 12 mapped campaigns that didn't run this period" diagnostic.

**Fix:** Build the store filter from `storeId` directly. The `filters.store` in AiReportButton is a name; convert it to a storeId via `storeAggs` lookup before passing to `generateAiReport`. Or: thread the `storeId` through Props/Params so the comparison is `storeId === storeId` not `storeName === storeName`.

---

### MEDIUM

#### MR-01: `COGS_RATE_OF_REVENUE = 0.25` is hardcoded for ALL stores — net-profit math is wrong for non-25% margin stores
**Files:** `dashboard-web/src/lib/analytics.ts:11`, used in `aiReport.ts:482`, `insights.ts:501`

The COGS rate is a single global constant. uzoshop, Zol Plus, 360usmile may have very different COGS profiles (electronics ≠ apparel ≠ accessories). The AI report's "**רווח נטו**: ${fmtCad(netProfit)}" headline number uses this rate for ALL stores in the "All" report. The forecastMonthEnd projection in `insights.ts:501` does the same.

**Consequence:** The "single most important number" (net profit) on the dashboard is calibrated wrong for at least 2 of 3 stores. Operator decisions to pause campaigns "below profitability" are made against a fake threshold.

**Fix:** Per-store COGS rate (config table or env var), defaulting to 0.25 only when unknown. Surface in the report as "COGS (25% מההכנסה, *משוער כללי*)" so it reads as estimate, not fact.

---

#### MR-02: `analyzeAttribution` window-stability has a path where `windowCountWithData < 2` returns `null` but the upstream code uses `>= 2` check that may quietly skip the downgrade
**Files:** `dashboard-web/src/lib/attributionAnalysis.ts:511-525, 614`

```ts
if (windowStability && windowStability.windowCountWithData >= 2) {
  if (windowStability.verdict === 'stable') {
    reasons.push(...);
  } else if (windowStability.verdict === 'volatile') {
    ...
    if (trust.level === 'high') {
      trust = { level: 'medium', label: 'חלקי', score: Math.min(trust.score, 65) };
    }
  }
}
```

`computeWindowStability` returns `null` when `coverages.length < 2` (line 614). The `windowStability && windowStability.windowCountWithData >= 2` check is therefore *double-defensive* (the function-level guard already enforces this). Not a bug, but the asymmetry is confusing — `'mixed'` verdict never triggers a downgrade (only 'volatile' does) which is silently inconsistent with the docstring `STABLE < 0.15; MIXED 0.15-0.35; VOLATILE >= 0.35`. A mixed campaign should arguably get a half-strength downgrade.

**Fix:** Either downgrade for 'mixed' too (with a smaller penalty), or document explicitly why only 'volatile' triggers.

---

#### MR-03: AI Report "Drainers" (`⚠️ קמפיינים שמבזבזים`) filter checks `c.spend / Math.max(c.conversions, 0.001)` as CPA — uses a tiny floor that lets `0 conversions` rows always exceed any CPA threshold
**Files:** `dashboard-web/src/lib/aiReport.ts:1431`

```ts
.filter(c => c.spend >= SPEND_FLOOR && (c.roas < 1.5 || c.spend / Math.max(c.conversions, 0.001) > 200))
```

For a campaign with $50 spend and 0 conversions, `c.spend / Math.max(0, 0.001) = 50 / 0.001 = 50000` — way more than 200. So it qualifies as a drainer, which is *probably the right outcome* but the math `spend / 0.001` is meaningless (the conversions divisor is fake). The real condition is "0 conversions with meaningful spend" which is already covered by `c.roas < 1.5` IF conversions > 0 (then ROAS = value/spend < 1.5). If conversions = 0, `c.value` is *probably* 0 too, so `c.roas = 0 < 1.5` already qualifies.

The Math.max(_, 0.001) is dead code — it doesn't change the filter outcome. Just code smell.

**Fix:** `c.spend >= SPEND_FLOOR && (c.roas < 1.5 || (c.conversions > 0 && c.spend / c.conversions > 200))`.

---

#### MR-04: Insights's `detectMetricAnomalies` ZERO-revenue check uses a $50 spend floor without checking timezone
**Files:** `dashboard-web/src/lib/insights.ts:174-184`

```ts
if (today.totalSpend > 50 && today.revenue === 0) {
  insights.push({
    severity: 'critical',
    title: `יום אבוד ב-${scope}`,
    ...
  });
}
```

The "today" row is `rows[rows.length - 1]` which is whatever date appears last in the sorted store rows. If the daily aggregator hasn't populated today yet (e.g., at 8am IL time, Meta API may have $300 spent already but Shopify revenue for today is $0 because no orders yet), this fires a CRITICAL "wasted day" alert daily at 8am. Stale by 11am.

The InsightsBoard caches via SWR for 2 minutes; the `done` action hides it for 7 days. The 7-day hide is the mechanism that makes this tolerable — but the first 7am check after a $50+ spend day with no early orders still falsely alarms.

**Fix:** Either skip "today" for this check (only run on yesterday's row), or require `today.totalSpend > 200` to materially exceed the noise floor.

---

#### MR-05: `InsightsPanel` (legacy) "Bottom store" picks lowest non-zero ROAS without sample-size floor
**Files:** `dashboard-web/src/components/InsightsPanel.tsx:17`

```ts
const bottomList = [...storeAggs].filter(s => s.roas > 0).sort((a, b) => a.roas - b.roas);
const bottom = bottomList[0];
```

A store with $1 ad spend and $0.50 revenue has ROAS 0.5 and qualifies as "needs attention" — even if it's a brand-new store seeing its first dollar of test spend. No spend floor.

**Fix:** `.filter(s => s.roas > 0 && s.spend >= 100)` to gate the signal on at least $100 spend.

---

#### MR-06: `InsightsBoard` 14-day hardcoded subtitle disagrees with the actual data passed to `buildAllInsights`
**Files:** `dashboard-web/src/components/InsightsBoard.tsx:250-253`, `dashboard-web/src/lib/insights.ts:232, 192-198`

The subtitle says "14 ימים אחרונים" (last 14 days). But:
- `data.rows` (the daily rows passed to `buildAllInsights`) are filtered by the user's selected date range in the dashboard, not the last 14 days.
- `detectAnomalies` filters to last 21 days internally (insights.ts:194-196), not 14.
- `generateRecommendations` filters to last 14 days internally (insights.ts:232).
- `WhatsWorking` uses last 7 days.

So the subtitle is correct for *some* signals but misleading for others — and crucially, it doesn't reflect the user's selected range. An operator looking at last-30-days view sees "14 ימים אחרונים" subtitle and assumes the insights are for 30 days.

**Fix:** Either remove the literal "14 days" claim or compute per-signal date range disclosures.

---

#### MR-07: `cpmRoasAnalysis.ts` `categorize()` maps `delta === null` to `'flat'` — silently confuses "unknown" with "stable"
**Files:** `dashboard-web/src/lib/cpmRoasAnalysis.ts:199-204`

```ts
function categorize(delta: number | null): 'up' | 'down' | 'flat' {
  if (delta === null) return 'flat';
  ...
}
```

`halfOverHalfDelta_` returns `null` when first-half mean is 0 (no prior data to compare against). The categorize() collapses this to "flat", and the resulting verdict ("יציבות מלאה — הקמפיין במצב סטדי") implies we measured something stable. We didn't — we couldn't measure anything.

For a 5-day series where the first 3 days have zero ROAS (campaign warming up), the `meanOrNull_` returns null → categorize returns 'flat' → "steady state" verdict. Operator reads this and thinks the campaign has converged to a steady ROAS. It hasn't — it just hasn't generated any ROAS yet.

**Fix:** Add a 4th category 'unknown' and return a 'neutral' tone with "אין מספיק נתונים להשוואה" text. Or guard at the caller level by checking `cpmDelta === null && roasDelta === null` upfront.

---

#### MR-08: AI Report's `match by storeId::platform::campaignId` for adsetsByCampaign uses `endsWith(::platform::campaignId)` — collides on duplicate campaignIds across stores
**Files:** `dashboard-web/src/lib/aiReport.ts:1103-1106, 1462-1464`

```ts
const matchingDailyKey = Array.from(dailyByKey.keys()).find(k =>
  k.endsWith(`::${c.platform}::${c.campaignId}`),
);
```

Both Meta and TikTok generate numeric campaign IDs. The collision space is small but non-zero — a Meta campaign ID `123456` and a Google ID `123456` would both match `::Meta::123456`. The endsWith match correctly includes the platform prefix, so cross-platform collision is impossible. **But** across stores, two campaigns in different stores can theoretically share an ID (e.g., if an operator imports the same campaign skeleton into two Meta ad accounts). The `find()` returns the FIRST match, which is non-deterministic across iterations.

`campaignsList` (the top-level aggregation at line 778) is keyed by `${c.storeId}::${c.platform}::${c.campaignId}` so it preserves per-store identity. But this `find(k.endsWith(...))` lookup discards the storeId and matches the first daily-key with the same platform/campaign. **Result:** if two stores both have a campaign with the same Meta ID (rare but possible), the daily series for one store gets used for the other's Health Score computation.

The same anti-pattern repeats at line 1462-1464 for ad-set drilldown.

**Fix:** Include the storeId in the lookup. `campaignsList` doesn't carry storeId directly — but the prior loop at line 778 does. Thread storeId through.

---

#### MR-09: AI Report's `effectiveStatus` "last write wins" lookup is order-dependent
**Files:** `dashboard-web/src/lib/aiReport.ts:1075-1079`

```ts
const statusByKey = new Map<string, string>();
for (const c of campaigns) {
  if (!c.effectiveStatus) continue;
  const key = `${c.storeId}::${c.platform}::${c.campaignId}`;
  statusByKey.set(key, c.effectiveStatus);
}
```

Comment on line 1078: `last write wins (sorted iteration would be ideal, but campaigns is unordered — close enough for status)`. This is incorrect — if effective_status changed mid-period (e.g., campaign was ACTIVE for 3 days then PAUSED for 7), the loop's "last write" depends on input array order. If `campaigns` is sorted by date ASC, last write = most recent status (correct). If sorted DESC or unsorted (e.g., Supabase default), last write = whatever comes last in iteration — could be the *first* day's status.

The `cronWhatsapp` daily summary doesn't use this, but the AI report's "Currently Off Campaigns" section relies on it. An operator who paused a campaign yesterday but whose API returns rows in DESC order will see the campaign listed as "currently active" in the report.

**Fix:** Sort by date before iterating, or aggregate to "most recent date per campaign" explicitly:
```ts
const latestStatusByKey = new Map<string, { date: string; status: string }>();
for (const c of campaigns) {
  if (!c.effectiveStatus) continue;
  const key = `${c.storeId}::${c.platform}::${c.campaignId}`;
  const cur = latestStatusByKey.get(key);
  if (!cur || c.date > cur.date) {
    latestStatusByKey.set(key, { date: c.date, status: c.effectiveStatus });
  }
}
```

---

### LOW

#### LR-01: `detectOutlierDays` uses `OUTLIER_LOOKBACK_DAYS + 1 = 8` minimum but the docstring says ">= 7"
**Files:** `dashboard-web/src/lib/attributionAnalysis.ts:636-637`

The check `if (series.length < OUTLIER_LOOKBACK_DAYS + 1) return []` requires at least 8 days. The earlier comment block (line 628-630) says "trailing OUTLIER_LOOKBACK_DAYS baseline". Minor doc/code drift, not a defect.

---

#### LR-02: `pearson()` and `pearsonForCpmRoas()` are duplicate implementations
**Files:** `dashboard-web/src/lib/attributionAnalysis.ts:158-186`, `dashboard-web/src/lib/cpmRoasAnalysis.ts:68-91`

Same algorithm, two files, two test suites. Both correctly guard against zero-variance and small-N. The `cpmRoasAnalysis` version's N>=3 threshold differs from `attributionAnalysis`'s N>=2. Combine into one helper in `lib/stats.ts` to prevent drift.

---

#### LR-03: AI Report `escapeMd` only escapes pipe + newline — does NOT escape backticks, brackets, or asterisks
**Files:** `dashboard-web/src/lib/aiReport.ts:2136-2141`

```ts
function escapeMd(s: string): string {
  return String(s)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, ' ')
    .trim();
}
```

A campaign name containing `*` or `_` or `[` will be interpreted as markdown formatting by the downstream AI parser. E.g., a campaign named `[NEW] Sale 50% off` becomes bracketed text in the rendered markdown. Cosmetic, not correctness — but a campaign name with a pipe `|` is the only one currently guarded. Brackets in particular cause the campaign name to be parsed as a link.

**Fix:** Extend the replace list. Or wrap in backticks: `` ` ${name} ` ``.

---

#### LR-04: `WhatsWorking` falling threshold uses `delta < -0.15` (15% drop) which is too sensitive on a 7-day window
**Files:** `dashboard-web/src/components/WhatsWorking.tsx:160`

A product going from 10 units → 8 units (perfectly normal weekly variance) is flagged "בירידה" — a 20% drop. The threshold should account for sample size; e.g., require absolute delta > sqrt(2 × baseline) for noise robustness. As-is, every week some random product is flagged falling.

---

#### LR-05: `summary.ts` builds CPM by summing all impressions across the day's campaigns, then `(totalSpend / impressions) × 1000` — but doesn't handle the case where `totalSpend` includes ttSpend but `impressions` came only from Meta+Google rows that the upstream API returned
**Files:** `dashboard-web/src/lib/notifications/summary.ts:228-232`

The query at line 108-111 selects from `campaigns_daily` for all rows on `date=dateStr`. If TikTok's campaigns aren't being written to `campaigns_daily` yet (Phase 05.7.5 docstring at line 19 says ttSpend is 0 until "Phase B writer ships"), then ttSpend is 0, impressions don't include TikTok, and the calculation is consistent. **But** when the writer ships, if it writes spend to `data_daily` but not impressions to `campaigns_daily` (likely scenario for incremental rollout), CPM will be inflated (numerator includes TikTok spend, denominator doesn't include TikTok impressions). Race condition between deployments.

**Fix:** Add `.in('platform', ['Meta', 'Google'])` to the campaigns_daily query OR derive CPM per-platform and present them separately.

---

#### LR-06: AI Report's "currentlyOff" lookup at line 1259-1268 duplicates the same status-decision logic from line 1080-1087, with the same per-platform UPPERCASE comparison
**Files:** `dashboard-web/src/lib/aiReport.ts:1080-1087, 1259-1268`

Same `isStatusOff` / `isOff` function, defined twice in the same file. The status string set is hardcoded; a TikTok status of e.g. `ADGROUP_STATUS_FROZEN` would not match `ADGROUP_STATUS_DELIVERY_OK` and would be classified as "off". OK for now — TikTok's possible statuses are limited — but the duplication invites drift.

**Fix:** Hoist to a module-level helper.

---

## Health Score component table

| Component | Weight | Range | Documentation | Defensibility | Verdict |
|---|---|---|---|---|---|
| **Profitability** | 40% | 0–100 | Docstring + comment block (campaignHealthScore.ts:135-150) explains the priority chain (deterministic > combined > platform) and ROAS curve. Tests at line 187-281. | Sound formula. ROAS pivot is single-threshold ([1, 3]) — defensible for e-commerce baseline but misses platform/store calibration (HR-02). Trust modulation is correct for Meta/TikTok but Google PMax silently gets 0.5 (HR-01). | **Trustworthy as a relative ranking within a single platform; cross-platform comparison is biased against Google.** |
| **Volume** | 15% | 0–100 | Documented at line 109-116. Tiers $500/$200/$50/$0 → 100/70/40/10. Tests at line 287-308. | Sound. Tiers are aligned with the operator's typical spend ranges. Spend-floor reasoning ("small spend = noisy ROAS") is correct. | **Trustworthy.** |
| **Trajectory** | 25% | 0–100 | Docstring at line 217-237. Maps `cpmRoasAnalysis.tone` → score. Tests at line 314-343. | Sound *when there's data*. When `hasData=false` returns 60 (neutral), which contributes +15 to a campaign with no momentum signal (HR-03). | **Trustworthy *post-data*; inflates new-campaign scores.** |
| **Attribution Clarity** | 20% | 0–100 | Documented at line 239-266. Maps `info.attribution.trust.score` directly; defaults 50 for no info, 30 for unknown. | Sound. The 50 default for "no attribution" (Google) is honest — "we don't know, neutral signal". The 30 floor for explicit "unknown" (utm_campaign misconfigured) correctly signals "tracking is broken". | **Trustworthy.** |
| **Operator Adjustment** | ±15 to ±30 (separate from weighted sum) | -30 to +15 | Documented at line 268-283. +15 optimized, -30 isCurrentlyOff. Tests at line 389-425. | Sound. +15 for operator vouching is conservative. -30 for off is aggressive but documented and reasonable. | **Trustworthy.** |
| **Cohort Adjustment** | -15 to +3 (separate, applied after operator adjustment) | -15 to +3 | Documented at line 372-398. Out of scope for this audit per assignment. | (Out of scope) | (Out of scope) |
| **Grade Ladder** | A: 75+, B: 60+, C: 45+, D: 30+, F: 0+ | n/a | Documented at line 122-128. | Sound. Tuned so the 4-component max realistic score lands in B/A range; F is reserved for genuinely-bad. | **Trustworthy.** |
| **Insufficient-data Gate** | Short-circuits to `unknown` | n/a | Documented at line 296-311. Tests at line 137-181. | Sound. `spend < 30` OR `spend < 100 AND conversions = 0` → ⏳ Early. Prevents F-grade on early-lifecycle campaigns. | **Trustworthy.** |

**Overall:** The component design is principled, documented, and tested. The two HIGH-severity issues (HR-01 platform bias, HR-03 new-campaign trajectory inflation) are tractable with targeted fixes. The CRITICAL issues all sit in the AI Report's *consumption* of the score, not the score itself.

---

## Cross-view consistency verdict

| View Pair | Agreement? | Evidence |
|---|---|---|
| **AI Report total spend ↔ Table footer total spend** | ✅ AGREE (same source) | Both consume `dailyRows` filtered by the same `inRange(date, range)` + `storeName === filter` predicate. Report sums `r.fbSpend + r.gaSpend + r.ttSpend` (aiReport.ts:159-165). Table footer sums identically. The `filters.range` is passed to AiReportButton (AiReportButton.tsx:91) and to the table via the same DashboardContext. **However**: the report fetches `/api/orders-attribution` and `/api/ads` with `buildDateRangeKey` (AiReportButton.tsx:67, 75), while the table may use a different cache key — for the **same** range the data is identical. |
| **AI Report ROAS in "Top campaigns" ↔ Table per-row ROAS** | ⚠️ DIVERGE | Report computes `roas = c.value / c.spend` where `c.value` is `conversionValue` (platform-claimed). Table likely shows multiple ROAS variants (Platform, Shopify combined, Shopify deterministic) per the project memory. The report's "Top campaigns" table ranks by platform-ROAS, the table's default is per-platform Shopify ROAS. Same underlying numbers, different default presentation. See HR-06. |
| **AI Report Health Score ↔ Table Health Score** | ⚠️ DIVERGE (by design, not advertised) | Report synthesizes a minimal `TrueRevenueInfo` (aiReport.ts:1136-1153) with `trust.score = coverage × 100`. Table uses real `useCampaignTrueRevenue` hook which calls `analyzeAttribution` (full window-stability, outlier detection, refund-adjusted coverage). Same `computeCampaignHealth` function, different inputs → **different scores for the same campaign**. See CR-03, CR-04. |
| **Daily summary "ROAS" ↔ Dashboard ROAS column** | ✅ AGREE (same formula) | Both compute `revenue / spend` where revenue is Shopify-side and spend is the platform sum. summary.ts:222 = `totalSpend > 0 ? revenue / totalSpend : 0`. The dashboard's per-store ROAS uses the same formula. |
| **Daily summary "Orders" ↔ Dashboard order count** | ✅ AGREE | Both bucket `orders_attribution` rows by `source` and store. summary.ts:166-174 mirrors the dashboard's classification logic. |
| **Daily summary "Facebook" / "Google" / "Other" buckets ↔ dashboard "Other"** | ⚠️ TEMPORARY ROUNDING | Per Phase 05.7.5 (templateParams.ts:57-66), `tiktok-paid` is folded into `אחרים` until a new Meta template with 4 slots is approved. The dashboard's table shows TikTok as its own row. **For now** the daily summary's "other" count is *higher* than the dashboard's "other" by the count of TikTok-paid orders. Documented in code but operator should know. |
| **TodayLive numbers ↔ KPI cards** | (Out of scope — files not in audit) | TodayLive component not in audit scope. |
| **AI Report "ימים חריגים" anomaly days ↔ InsightsBoard anomaly insights** | ⚠️ INDEPENDENT METHODS | Report uses median+MAD with `|z| >= 2.0` threshold per-day (aiReport.ts:471-472). InsightsBoard uses robust z-score against trailing 14-day MAD with `|z| >= 2.5` threshold (insights.ts:90-100, 118). **Same statistical principle, different thresholds** — a day flagged by the report may not appear in the InsightsBoard and vice versa. Both are correct; neither is the "official" source. |

---

## Question-by-question verdicts

### Health Score base logic

**Q1. Weights & defensibility.** Documented at `campaignHealthScore.ts:21-31, 92-100`. Sum = 1.0 (with module-load assertion at line 105-107). Profitability 40%, Volume 15%, Trajectory 25%, Attribution 20%. Plus ±operator adjustment (-30 to +15). Plus ±cohort adjustment (-15 to +3, applied after). A high-ROAS micro-spend campaign **cannot score 100** because Volume component caps at 10 for spend < $50, contributing only 1.5 weighted points. ✅ Defensible.

**Q2. Thresholds.** Single global threshold for ROAS (`(roas - 1) / 2 * 100`, capped at [0,100]) — pivot at ROAS 2.0 = 50, ROAS 3.0 = 100. **Same across all platforms and stores.** ⚠️ See HR-02 — this is the *single biggest defect* in the score design.

**Q3. CPM trend.** Computed via `cpmRoasAnalysis.ts:140-275`. **Half-over-half % change** when no prev-period data; **prev-period mean-to-mean % change** when caller passes prev with ≥3 active days. Window: last 7 active days (filtered by `cpm > 0`). New-campaign behavior: `< 5 active days` → `hasData = false` → trajectory score 60 (neutral). ⚠️ See HR-03 — neutral isn't truly neutral on the weighted final score.

**Q4. Spend-volume signal.** Zero-spend → insufficient-data short-circuit (`isInsufficient` at line 305-311 returns true for `spend < 30`). Returns `score = 0, grade = 'unknown', insufficient = true`. A paused-with-zero-spend campaign therefore correctly gets the ⏳ Early state, NOT "healthy". ✅ Sound.

**Q5. Trust chip integration.** Trust chip is computed in `attributionAnalysis.ts:410-508` (`analyzeAttribution` function). The chip's label ↔ computation mapping:
- "אמין" (`high`, 80+ score) ← `coverage >= 0.8`
- "חלקי" (`medium`, 40-65) ← `coverage 0.4-0.8`
- "לא אמין" (`low`, ≤coverage*100) ← `coverage < 0.4`
- "לא ניתן לקבוע" (`unknown`, 30) ← `deterministicOrders === 0 && metaClaim > 0`
- "אין המרות" (`unknown`, 0) ← Both zero — operator-friendly framing
- Volatile-downgrade: `high` → `medium` when `windowStability.verdict === 'volatile'` (line 521-523)

The chip is used as `trust.score / 100` for profitability modulation and `trust.score` for attribution-clarity component. **Match between chip label and computation is faithful** ✅.

**Q6. Edge cases.** Zero conversions handled (insufficient gate). Zero impressions handled (CPM calc returns 0 → analysis hasData=false). Zero spend → insufficient. Division-by-zero risk: `metaClaim === 0` path in `computeCoverage` (attributionAnalysis.ts:143-149) returns `1 if det > 0 else 0` — handled. Refund-heavy (negative coverage) clamped (attributionAnalysis.ts:486-489). ✅ Edge cases solid.

### AI Report

**Q7. Data source.** Same source as table: `dailyRows` / `productRows` / `campaignRows` filtered identically. ✅ Totals will match.

**Q8. Insight generation.** **Rule-based, deterministic, fully verifiable.** Not LLM-generated. The "AI" in the name refers to the report being *consumed* by an external LLM, not generated by one. All logic is `if-then-else` over numeric thresholds. ✅ No hallucination risk in the report itself; hallucination risk shifts to whatever LLM the operator pastes it into, where the user-facing AI strategist prompt at line 1937-2127 acts as a guardrail.

**Q9. Top performers / weakest performers.** "Top campaigns" ranks by `c.value / c.spend` (platform-ROAS). "Drainers" filter by `roas < 1.5 OR cpa > 200`. "Winners" (creative-level) require `>= 2 conversions + ROAS >= 2.0 + spend >= $25`. Ties: not explicitly handled — `.sort` is stable for arrays of <= ~32K elements in V8 (which is our case). Empty data: returns "אין קמפיינים עם הוצאה משמעותית..." placeholder. ⚠️ See HR-06 — ranking key is the unreliable platform-ROAS.

**Q10. Multi-mapping awareness.** ⚠️ **BLOCKER.** The multi-mapping section (`🔗 מוצרים משותפים`) was added 2026-05-23 but uses naive `netRevenue × sharePct` instead of the `allocateProductRevenue` deterministic allocator. **See CR-01.**

**Q11. Date range echoing.** Report header at line 121-131:
```
# דוח ביצועים — {store}
**טווח**: {from} → {to}
**מספר ימים**: {days}
**יוצר**: {today}
```
✅ Clear and unambiguous. The "מספר ימים" formula (line 124-129) uses `Math.round((to - from) / 86400000) + 1` which is correct for inclusive ranges.

### Insights / Insights Board / WhatsWorking

**Q12. Source of "what's working".** WhatsWorking pulls from `/api/products` + `/api/campaigns` (the SWR fetchers at line 173-180). Same data the table uses. **Consistent with table** ✅.

**Q13. Stale insights.** SWR refresh interval = 120s (`InsightsBoard.tsx:103, 107`). When the date range changes, the **filtered `data.rows` passed in** updates, but the SWR-cached campaigns/products don't get re-keyed by range — they're always last-14-days from `todayInIsrael()`. ⚠️ Insights *do not respect the user's date filter*. If the operator selects "last 30 days" on the dashboard, the insights still show 14-day signals. See MR-06.

### Daily summary

**Q14. Template placeholder mapping.** Verified at `templateParams.ts:130-145`:
- `{1}` = `title` (e.g., "12:00, 23/05/2026") ✅
- `{2}` = `storeBlock(stores[storeIds[0]])` or "—" ⚠️ (CR-02: ordering non-deterministic)
- `{3}` = `storeBlock(stores[storeIds[1]])` or "—" ⚠️
- `{4}` = `storeBlock(stores[storeIds[2]])` or "—" ⚠️
- `{5}` = `totalsBlock(totals)` or "אין נתונים זמינים" ✅
Each storeBlock contains: store name, spend, revenue, ROAS, CPM, orders, (facebook+google+other counts). Each value individually correct ✅.

**Q15. Template language vs computed values.** Template is Hebrew (cfg.templateLang defaults to 'he'). Computed strings inside `{N}` are Hebrew + English numbers (`C$`, `ROAS`) — operator-set strings, not Meta-template translations. Hebrew script + Arabic numerals coexist correctly. ✅ No Hebrew/English contamination of the template *header* (Meta-translated parts).

**Q16. Date scope.** Verified via call sites:
- `whatsappNoon` (`cronWhatsapp.ts:46-58`): `dateStr = todayJerusalem()` → labels as "12:00, today" → summary covers TODAY so far ✅
- `whatsappEvening` (cronWhatsapp.ts:64-77): same, `dateStr = todayJerusalem()` → "18:00, today" → TODAY so far ✅
- `whatsappEod` (cronWhatsapp.ts:89-102): `dateStr = yesterdayJerusalem()` (runs at 00:10) → label "סיכום יום מלא — yesterday" → YESTERDAY full day ✅

Computation matches label across all three. ✅ Operator gets the date they expect.

**Q17. Recipient guard.** ⚠️ See HR-05. No allowlist. Fully driven by DB row. The project memory's claim that "alerts go ONLY to +972524809540" applies to the token-failure path (separate code, pending Meta approval), NOT to this daily-summary path. The daily summary sends to `phone1` + `phone2` from the active `notification_config` row — and there's no check that those are the operator's numbers.

**Q18. Send failure handling.** ⚠️ See HR-04. Per-recipient failures are silently captured in `result.recipientsFailed` and NEVER surfaced. Whole-step failures retry 3× via Inngest then go to run history. No alert mechanism. **Operator only finds out by noticing missing messages.**

### Cross-view consistency

**Q19. AI Report total spend vs CampaignsTable footer.** ✅ AGREE (same source data + same filter). See cross-view table above.

**Q20. Daily summary "total revenue" vs dashboard ROAS Shopify column.** ✅ AGREE for matching scope (single date, all stores) — both read from `data_daily.revenue_cad`.

**Q21. TodayLive vs KPI cards.** OUT OF SCOPE — those files not in this audit.

---

## What's solid

The following are *trustworthy* and the operator can rely on them:

1. **`computeCampaignHealth` mathematical correctness.** Weights sum to 1.0 (asserted at module load). Score clamped to [0,100]. Grade ladder is monotonic. Insufficient-data gate correctly excludes early-lifecycle campaigns. 39 tests covering edge cases.
2. **`analyzeAttribution` algorithmic soundness.** `computeCoverage` correctly handles signed-input edge cases (refunds, negative claims). `detectOutlierDays` uses robust MAD + lookback. `computeWindowStability` correctly drops null-coverage windows.
3. **`analyzeCpmVsRoas` interpretation matrix.** 9 cells (UP/DOWN/FLAT × UP/DOWN/FLAT) all distinct, each with appropriate tone. Pearson correlation gate (N≥3, non-zero variance) is correct. FIX-25 correctly distinguishes "active day" from "had conversions" — improvement over the prior version.
4. **AI Report date range labeling.** Header section is unambiguous; computation matches label.
5. **Daily summary value computations.** Each individual number (spend, revenue, ROAS, CPM, orders breakdown) is computed correctly with proper divide-by-zero guards. Per-store + totals are internally consistent (totals = Σ stores).
6. **Daily summary noon/evening/EOD title-vs-data alignment.** All three cron paths correctly pair title with the date range the data covers.
7. **InsightsBoard severity laddering.** Correct critical → warning → opportunity → positive → info ordering. Hide/show state persisted in localStorage with 7-day TTL on "done" (sane UX).
8. **Anomaly detection.** Robust z-score on 14-day MAD baseline at 2.5σ threshold is standard practice for operator-facing anomaly detection; signal-to-noise will be reasonable.
9. **Pixel ↔ Shopify reconciliation section in the AI report.** The header section warns about Meta attribution unreliability; the per-campaign comparison table shows the operator exactly how much to trust each campaign's platform-claimed ROAS. This is the report's highest-value section and it's well-built.
10. **Cohort/cannibalization adjustment logic** (out of scope for this audit, but the file's structure and tests look sound at a glance).

---

_Audit: 2026-05-23_
_Auditor: Claude (gsd-code-reviewer, adversarial mode)_
_Depth: deep (cross-file analysis, traced call chains, identified type-cast defects)_
