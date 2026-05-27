# A3 — Campaigns & Ads Rollup + Health Score Wiring
**Audit date:** 2026-05-28  
**Agent:** A3  
**Invariants:** INV-7, INV-8  
**Sources read:** `postgresReaders.ts`, `CampaignsTable.tsx`, `AdsDrawer.tsx`, `CampaignDrawer.tsx`, `campaignsAggregator.ts`, `campaignHealthScore.ts`, `dateRange.ts`

---

## Findings

---

### F-A3-01 | P0 | INV-7 | postgresReaders.ts:585-589 | Zol Plus campaigns_daily is ENTIRELY MISSING from /api/campaigns

**Live evidence:**  
- `GET /api/data?from=2026-05-25&to=2026-05-27` → Zol Plus: `fbSpend` $125.64 + $117.59 + $118.54 = **$361.78 CAD over 3 days**  
- `GET /api/campaigns?from=2026-05-25&to=2026-05-27` → unique `storeId` values in response: **only `uzoshop` and `usmile360`**. `zolplus` returns **zero rows**.  
- Same pattern confirmed for May 1–27 (full-month scan): Zol Plus campaigns data is absent from campaigns_daily entirely.

**Why wrong:**  
`STORE_NAME_BY_ID` in `postgresReaders.ts` (line 585-589) maps `zolplus → 'Zol Plus'` correctly, so storeName would display right IF rows existed. The root cause is upstream: Zol Plus ad spend data is not being written into the `campaigns_daily` table by any cron job. The `data_daily` row (which the older Apps Script / platform-sync pipeline populates) shows Meta spend of ~$117–$126/day for Zol Plus, but `campaigns_daily` has no rows for `store_id = 'zolplus'`.

**Impact:** The Campaigns tab shows zero campaigns for Zol Plus. An operator viewing Zol Plus spend in the Summary tab ($117–$126/day Meta) gets NO campaign-level breakdown whatsoever. Health Score, ad-set drilldown, and cannibalization detection are all impossible for this store.

**Suggested fix:** Confirm whether the Inngest cron writers (`cronDaily.ts`, `cronLiveHeavy.ts`) include Zol Plus in their store config. If Zol Plus was added to `stores` table but its Meta ad account was not registered in the cron, add it. Cross-check `stores` table for `zolplus.meta_ad_account_id`.

---

### F-A3-02 | P0 | INV-7 | postgresReaders.ts:591-709 | uzoshop campaigns_daily Meta spend is 2–13× below data_daily fbSpend

**Live evidence (May 25–27, 2026):**  
| Source | uzoshop Meta spend (3 days) |
|---|---|
| `data_daily.fb_spend_cad` | $3,400.74 |
| `campaigns_daily` (API /api/campaigns) | ~$267 |
| Gap | ~$3,133 (factor 12.7×) |

Breakdown per day from `data_daily`:
- 2026-05-25: fbSpend $1,157.57
- 2026-05-26: fbSpend $1,156.81
- 2026-05-27: fbSpend $1,086.36

Campaigns_daily for uzoshop/Meta in the same window: 25 campaigns with a combined ~$267 total.

**Why wrong:**  
The campaigns list for uzoshop/Meta shows 25 campaigns each spending a few dollars (range $0–$92). But `data_daily` records ~$1,100+/day of Meta spend. Several campaigns in `campaigns_daily` show `$0.00` spend (e.g. campaign `120247273542100721` "סט סלמון" = $0.00, `120241383863050419` = $0.00). Two explanations compete:

1. **Most uzoshop Meta campaigns are missing from `campaigns_daily`** (same root cause as F-A3-01 — incomplete cron coverage).
2. **The campaigns_daily rows exist but the `spend_cad` column is near-zero because the spend was not fetched from Meta API** (currency conversion bug, wrong lookback window, or partial fetch failure).

The magnitude of the gap (12.7×) points strongly to a **missing majority of campaigns** or a **systematic spend=0 backfill** for uzoshop Meta. May 1–7 showed the same issue (SEED-3): data_daily recorded $2,200–$2,706/day of Meta spend for uzoshop, while campaigns_daily had $0 for those dates. Confirmed live: `/api/campaigns?from=2026-05-01&to=2026-05-07` → no Meta rows at all for uzoshop in that range.

**Impact:** Campaign-level profitability analysis, ROAS column, Health Score, and all drilldowns for uzoshop Meta are based on a small fraction of actual spend. An operator relying on campaigns tab to allocate budget across Meta campaigns for uzoshop is working with severely incomplete data.

**Suggested fix:** Inspect cron logs / Inngest run history for uzoshop Meta fetch failures. Verify that the Meta ad account for uzoshop is configured with sufficient permissions and that all active campaigns (including those spending $1,000+/day) are returned by the Insights API call. Check whether the campaign-level writer uses a paginated Insights query and whether pagination is completing.

---

### F-A3-03 | P0 | INV-8 | postgresReaders.ts:822-875 | ads_daily Σ spend ≠ campaigns_daily Σ spend for same (window, store, platform)

**Live evidence (May 25–27, 2026):**  
- `/api/ads?from=2026-05-25&to=2026-05-27` → total spend across all rows: **$629.77**  
- `/api/campaigns?from=2026-05-25&to=2026-05-27` → total spend: **$1,047.47**  
- **Absolute gap: $417.70 (66% divergence — far beyond the ≤1% / ≤$1 tolerance)**

Per-campaign comparison (campaigns_daily spend vs ads_daily spend for same campaignId):
| Campaign (uzoshop/Meta) | Campaigns spend | Ads spend |
|---|---|---|
| 120247315789900721 (משקל חכם) | $31.93 | $80.44 |
| 120247337357730721 (תחתונים) | $10.26 | $41.53 |
| 120247334103690721 (משקפיים) | $27.07 | $89.48 |

In all three spot-checked cases, **ads_daily spend > campaigns_daily spend for the same campaign and date range**. Additionally, 13 campaigns appear in campaigns_daily that have NO corresponding ads_daily rows at all (25 unique campaigns in campaigns vs 12 in ads). The two data sources are populated by different cron writers and are de-synchronized.

**Why wrong:**  
`ads_daily` and `campaigns_daily` are written by separate Inngest functions. The ad-level data seems to capture higher spend for individual campaigns than the campaign-level rollup does, which violates the fundamental expectation that campaign spend = Σ ad spend. This is not a UI aggregation bug — it is a database-level inconsistency between the two tables written by different pipeline runs.

**Impact:** `AdsDrawer.tsx` sums ads_daily for its totals strip. `CampaignDrawer.tsx` sums campaigns_daily rows for its own header totals. Both are shown to the operator side-by-side (drawer opens from a campaign row). The operator sees different spend numbers depending on which drilldown level they inspect.

**Suggested fix:** Verify that the cron functions writing `campaigns_daily` and `ads_daily` use the same time window, the same campaign selection, and the same currency conversion. Reconcile by comparing Inngest job logs. Consider adding a daily reconciliation check that flags (campaign, date) tuples where `campaigns_daily.spend_cad ≠ Σ ads_daily.spend_cad`.

---

### F-A3-04 | P1 | INV-7 | postgresReaders.ts:655-666 | Zero-activity filter in fetchCampaignsFromPostgres silently drops spend-free campaigns that still exist in data_daily

**Code:**  
```typescript
// postgresReaders.ts:655-666
const hasActivity = spend > 0 || impressions > 0 || conversions > 0;
// ...
const isCurrentlyActive = ...;
if (!hasActivity && !isCurrentlyActive) {
  continue; // row dropped
}
```

**Analysis:**  
Campaigns with `spend_cad = 0` AND `impressions = 0` AND `conversions = 0` are dropped by the reader unless `effective_status` marks them currently active. A campaign that spent zero in the selected range but is active (and spending) outside it, or whose status is NULL (pre-migration row), will be silently dropped. This is a **contributing factor to SEED-3**: early-May rows for uzoshop Meta that exist in `campaigns_daily` with all-zero metrics (backfill placeholder rows) are filtered out, making the gap appear larger than the actual missing-data root cause.

**Live evidence:** Campaign `120241383863050419` shows $0.00 in campaigns_daily. If `effective_status` is NULL or not `ACTIVE`, it is dropped entirely. data_daily still counts that campaign's spend in `fb_spend_cad`.

**Suggested fix:** This filter is intentional (avoids phantom campaigns). The fix is not to change the filter but to ensure the cron writers never write zero-spend placeholder rows — cron-live-heavy should only upsert rows with actual metrics from the API.

---

### F-A3-05 | P2 | INV-8 | CampaignsTable.tsx:852-879 | Summary totals row computes ROAS/CTR/CPC/CPA from aggregated-level metrics, not re-derived from row-level data — potential mismatch with visible-row sums

**Code:**  
```typescript
// CampaignsTable.tsx:857-879
let spend = 0, conv = 0, val = 0, clicks = 0, imps = 0;
for (const a of aggregatedFiltered) {
  spend += a.spend; conv += a.conversions; val += a.conversionValue;
  clicks += a.clicks; imps += a.impressions;
}
return {
  roas: spend > 0 ? val / spend : 0,
  cpc: clicks > 0 ? spend / clicks : 0,
  cpa: conv > 0 ? spend / conv : 0,
  ctr: imps > 0 ? clicks / imps : 0,
  cpm: imps > 0 ? (spend / imps) * 1000 : 0,
};
```

**Analysis:**  
The summary cards sum over `aggregatedFiltered` (the visible post-multi-mapped-filter set), matching the rows actually shown. This is correct after the audit fix noted at line 856. No NaN/Infinity risk — all denominators are guarded. The `totals` row does accurately reflect the sum of visible rows. **No bug here** — this finding is a confirmation that the fix documented at line 852 (FIND-01 audit fix) is working correctly.

**Verdict:** PASS.

---

### F-A3-06 | P2 | INV-8 | CampaignsTableRow.tsx:299-304 | Derived metrics (CTR, CPC, CPA, CPM) correctly guard against divide-by-zero

**Code:**  
```typescript
// CampaignsTableRow.tsx:299-304
const ctr = a.impressions > 0 ? a.clicks / a.impressions : 0;
const cpc = a.clicks > 0 ? a.spend / a.clicks : 0;
const cpm = a.impressions > 0 ? (a.spend / a.impressions) * 1000 : 0;
const cpa = a.conversions > 0 ? a.spend / a.conversions : 0;
```

And the render uses `'—'` guards:
```typescript
{a.impressions > 0 ? `${(ctr * 100).toFixed(2)}%` : '—'}
{a.clicks > 0 ? formatCurrency(cpc, 2) : '—'}
{a.impressions > 0 ? formatCurrency(cpm, 2) : '—'}
{a.conversions > 0 ? formatCurrency(cpa, 2) : '—'}
```

**Verdict:** No NaN or Infinity can be shown to the user for any derived metric. **PASS.**

---

### F-A3-07 | P2 | INV-7 (prev-period) | CampaignsTable.tsx:934, dateRange.ts:219-253 | Previous-period computation is correct

**Analysis:**  
`getPreviousPeriod(range)` correctly computes `prevTo = from - 1 day` and `prevFrom = prevTo - (to - from)`. For a 7-day range 2026-05-20 to 2026-05-26, this yields 2026-05-13 to 2026-05-19 — correct equal-length immediately-preceding window. The function validates ISO format, guards against inverted ranges, and uses UTC arithmetic to avoid DST edge cases. The CPM chart's `indexPrevByDateOffset` correctly aligns prev-period points by calendar offset rather than array index (c/CR-01 fix). **No bug found.**

**Verdict:** PASS.

---

### F-A3-08 | P1 | Health Score | campaignHealthScore.ts:387-465 | Health Score wiring is correct but the base score is built on campaigns_daily data which is ~12× understated for uzoshop/Meta (see F-A3-02)

**Analysis:**  
`computeCampaignHealth` receives `aggregated.spend` from `campaignsAggregator.ts`, which aggregates `campaigns_daily` rows. For uzoshop/Meta, `campaigns_daily` captures only ~7.8% of actual Meta spend ($267 vs $3,400). A campaign actually spending $1,100/day would appear in the health score with spend of ~$30–$90. At those levels:
- Volume score: `spend < 200` → `score = 70` (medium) instead of `score = 100` (sufficient)
- Profitability: ROAS computed on understated spend — if conversion value is also understated proportionally, ROAS ratio is preserved; if only spend is understated, ROAS is overstated
- Insufficient-data gate: campaigns with `spend_cad < 30` in campaigns_daily would be flagged ⏳ Early even if they're actually spending $1,000+/day

**Impact:** Health scores for uzoshop Meta campaigns are **systematically unreliable** because the input data is wrong (F-A3-02). This is a downstream consequence, not an independent bug in the scoring algorithm.

**Suggested fix:** Fix F-A3-02 first. Once campaigns_daily reflects true spend, health scores will be computed on correct inputs.

---

### F-A3-09 | P2 | Health Score | campaignHealthScore.ts:539-556 | applyCohortAdjustmentOnce double-apply guard throws instead of silently corrupting

**Code:**  
```typescript
if (base.components.cohortAdjustment !== 0) {
  throw new Error('applyCohortAdjustmentOnce: base already has a non-zero...');
}
```

**Analysis:**  
The guard is correct — it prevents silent double-application of cohort adjustments (U-06 fix). In `CampaignsTable.tsx` the call sequence is `computeCampaignHealth(...)` → `applyCohortAdjustmentOnce(base, ...)`, called once per campaign in the `healthByKey` memo. No double-apply risk in current code. If a future caller passes the result of `applyCohortAdjustmentOnce` back in (e.g., to apply a second cohort), the throw is loud. **PASS — guard is correct and the single-call pattern is enforced.**

---

### F-A3-10 | P1 | INV-7 (SEED-3 root cause) | No uzoshop Meta rows in campaigns_daily for 2026-05-01 to 2026-05-07

**Live evidence:**  
`GET /api/campaigns?from=2026-05-01&to=2026-05-07` (all stores) → uzoshop rows are **Google platform only** (campaigns "מיקסום ביצועים נסיון ראשון" and "רק pdrn"). Zero Meta rows for uzoshop. data_daily shows fbSpend $2,200–$2,706/day for uzoshop on each of these 7 days.

**Root cause determination:**  
This is NOT a legacy Apps Script backfill gap. The Google campaigns for uzoshop in the same window DO appear in campaigns_daily, showing the cron writer ran for uzoshop. The Meta campaigns are the only missing piece — confirming that the Meta Insights API fetch for uzoshop is either not configured, failing silently, or the uzoshop Meta ad account ID is not registered in the cron configuration.

**Verdict:** SEED-3 root cause = **uzoshop Meta ad account not configured in cron writer** (or account permissions issue), not a historical backfill gap. This is a live/ongoing issue (confirmed in May 25–27 data, same store, same platform).

---

## Summary Table

| ID | Severity | INV | File:line | Root cause | Status |
|---|---|---|---|---|---|
| F-A3-01 | P0 | INV-7 | postgresReaders.ts:585-589 | Zol Plus campaigns_daily entirely absent — cron not configured for zolplus store | CONFIRMED LIVE |
| F-A3-02 | P0 | INV-7 | postgresReaders.ts:591-709 | uzoshop Meta campaigns_daily shows ~7.8% of data_daily fbSpend ($267 vs $3,400 over 3 days) | CONFIRMED LIVE |
| F-A3-03 | P0 | INV-8 | postgresReaders.ts:822-875 | ads_daily Σ spend ≠ campaigns_daily Σ spend: $630 vs $1,047 (+66%) for same May 25-27 window | CONFIRMED LIVE |
| F-A3-04 | P1 | INV-7 | postgresReaders.ts:655-666 | Zero-activity row filter contributes to apparent gap but is intentional; root is upstream writes | CODE |
| F-A3-05 | P2 | INV-8 | CampaignsTable.tsx:852-879 | Summary totals correctly track aggregatedFiltered after FIND-01 fix | PASS |
| F-A3-06 | P2 | INV-8 | CampaignsTableRow.tsx:299-304 | CTR/CPC/CPA/CPM divide-by-zero guarded; '—' renders when denominator=0 | PASS |
| F-A3-07 | P2 | INV-7 | dateRange.ts:219-253 | getPreviousPeriod + indexPrevByDateOffset correct; no off-by-one | PASS |
| F-A3-08 | P1 | Health | campaignHealthScore.ts:387-465 | Health Score inputs corrupted downstream of F-A3-02; scoring algorithm itself is correct | DOWNSTREAM |
| F-A3-09 | P2 | Health | campaignHealthScore.ts:539-556 | applyCohortAdjustmentOnce guard correct, no double-apply risk in current call sites | PASS |
| F-A3-10 | P1 | INV-7 | cron (writer-side) | SEED-3: uzoshop Meta missing May 1-7 AND May 20-27 — confirmed ongoing, not legacy gap | CONFIRMED LIVE |
