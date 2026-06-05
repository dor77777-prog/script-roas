# Creative-Fatigue Frequency Leg + Early-Warning Insight — Design

**Date:** 2026-06-05 · **Owner:** single operator · **Deploy:** `git push origin main` only
**Gap:** roadmap #14 (`creative-ad-fatigue-signal`) — the deferred **frequency leg**.
**CAPI:** read-only / CAPI-safe by construction (pulls existing platform report metrics; never emits an event).

---

## 1. Goal

Add ad-impression **frequency** (avg times each person saw an ad) as a new fatigue signal, surfaced as a **separate, earlier, softer "early-warning" insight** — so the operator learns an ad is saturating *before* CTR craters and CPM climbs, not after.

The existing strong insight (`detectAdFatigue`: CTR drop ≥30% **AND** CPM rise ≥20%, [adFatigue.ts](../../../dashboard-web/src/lib/insights/adFatigue.ts)) stays **unchanged in its firing rule** — it remains the "confirmed fatigue" signal. The frequency work is additive.

### Non-goals
- No change to the existing 2-leg firing thresholds.
- No Google frequency (Google Search/Shopping/PMax has no per-user frequency metric — those ads stay `reach=null` and are skipped).
- No pixel/CAPI emission. No new UI surface beyond text in the existing insights board (insights render through the existing `Insight` pipeline).
- No "absolute weekly frequency" claim — see §6 (reach is not additive across days).

---

## 2. Decisions locked (this brainstorm)

1. **Behavior = separate early-warning insight** (not informational-only, not a 2-of-3 rewrite). New softer/lower-weight insight; existing strong insight untouched.
2. **Store one new column `reach`** on `ads_daily` (BIGINT, nullable). Frequency is derived = `impressions ÷ reach`. (Reach is more fundamental + reusable; frequency is never stored.)
3. **Backfill included** — re-pull per-day ad-level reach for Meta + TikTok across all available history (~from 2026-05-01, ~36 days). The signal works immediately after the run, not just going forward.
4. **Platforms:** Meta ✓, TikTok ✓, Google ✗ (blind — skipped).
5. **No double-fire:** if an ad already qualifies for the strong insight, the early-warning is suppressed for that ad.

---

## 3. Architecture by layer

### 3.1 Data layer
- **Migration** (`supabase/migrations/<ts>_add_reach_to_ads_daily.sql`): `ALTER TABLE ads_daily ADD COLUMN IF NOT EXISTS reach BIGINT;` Additive, nullable → no consumer breaks. Apply via the supervised procedure (hide root `.env`, move the 2 duplicate-timestamp gap files out, `supabase db push`, restore — see [[reference-supabase-migration-procedure]]).
- **`ads_enriched` VIEW (REQUIRED)**: `fetchAdsFromPostgres` reads `.from('ads_enriched')` ([postgresReaders.ts ~1078](../../../dashboard-web/src/lib/postgresReaders.ts)), and the view uses an **explicit column projection** (it COALESCEs registry/daily names — last defined in `supabase/migrations/20260605120000_enriched_views_coalesce_name.sql`). The same migration that adds `ads_daily.reach` MUST `CREATE OR REPLACE VIEW ads_enriched` to also project `ad.reach` — otherwise the reader never sees the column even after the backfill writes it.
- **Meta fetchers**: add `reach` to `AD_INSIGHTS_FIELDS` in [metaHotMetrics.ts](../../../dashboard-web/src/lib/fetchers/metaHotMetrics.ts:40) and the equivalent ad-insights field list in [meta.ts](../../../dashboard-web/src/lib/fetchers/meta.ts). Meta returns `reach` as a standard insight field; per-day query → clean daily reach. Parse `reach: Math.round(Number(r.reach ?? 0)) || null`.
- **TikTok fetcher**: add `reach` to the metrics array in [tiktokHotMetrics.ts](../../../dashboard-web/src/lib/fetchers/tiktokHotMetrics.ts:125). TikTok BASIC report exposes `reach` at ad level; single-day query → daily reach.
- **Google fetchers**: untouched. `reach` stays absent → null in `ads_daily`.
- **ads_daily writers** must include `reach` in their upsert payloads where available: `metaHotMetrics`, `meta.ts`, `tiktokHotMetrics`, and the worker/cron paths that upsert ad rows ([metaWorker.ts](../../../dashboard-web/src/inngest/functions/metaWorker.ts), [tiktokWorker.ts](../../../dashboard-web/src/inngest/functions/tiktokWorker.ts), [cronDaily.ts](../../../dashboard-web/src/inngest/functions/cronDaily.ts)). Google writers omit it (column defaults null).
- **Type + reader**: add optional `reach?: number | null` to `AdRow` ([ads.ts:12](../../../dashboard-web/src/lib/ads.ts)); add `reach` to the SELECT list and map `reach: toNumber(r.reach)` (→ null/0 tolerated) in `fetchAdsFromPostgres` ([postgresReaders.ts ~1087](../../../dashboard-web/src/lib/postgresReaders.ts)).

### 3.2 Backfill
One-off script `dashboard-web/scripts/backfillAdsReach.ts` (mirrors existing backfill-script env conventions — root `.env` dotted keys mapped to UPPER_SNAKE; `npx tsx`; DRY_RUN support). For each store × each date in range (2026-05-01 … today), for Meta + TikTok only: re-pull ad-level reach and `UPDATE ads_daily SET reach = … WHERE date/store_id/ad_id`. Read-only toward platforms; writes only the `reach` column. Logs per-store updated-row counts. Re-runnable.

### 3.3 Detector — new early-warning function
In [adFatigue.ts](../../../dashboard-web/src/lib/insights/adFatigue.ts), add `reach` to `HalfAgg` + `aggregateHalf` (sum reach per half), and export a second function `detectAdFatigueEarlyWarning(ads: AdRow[]): Insight[]` that reuses the same grouping + half-split + gating, then:
- Compute half-frequency = `sumImpr ÷ sumReach` for prior and recent halves (guard `reach>0` in both halves; skip ads with no reach → Google-blind).
- **Fire** iff: `recentFreq ≥ FREQ_CLIMB × priorFreq` **AND** `recentFreq ≥ FREQ_FLOOR` **AND** the ad does **NOT** already satisfy the strong rule (`recentCtr ≤ 0.7×priorCtr AND recentCpm ≥ 1.2×priorCpm`) — suppression to avoid double-fire.
- Emit `Insight` with `id: ew-fatigue-${adId}`, lower `weight` than the strong rule's 68 (e.g. 52), severity `'opportunity'`, kind `'recommendation'`, plain-Hebrew copy (title "אזהרה מוקדמת — שחיקה מתקרבת: {ad}", detail "התדירות עלתה X% — אותם אנשים רואים את המודעה יותר ויותר. שקול לרענן קריאייטיב לפני שהביצועים נפגעים.", `why` with prior→recent freq), carrying the parent `campaignId`/`campaignName`/`platform`/`storeId`/`storeName` + Ads-Manager `href` (identical pattern to the strong rule).
- Wire into the pipeline at [insights.ts:884](../../../dashboard-web/src/lib/insights.ts) next to `detectAdFatigue` (concat both result arrays).
- **Bonus:** in the existing `detectAdFatigue`, populate the currently-empty `freqNote` ([adFatigue.ts:121](../../../dashboard-web/src/lib/insights/adFatigue.ts)) with "(התדירות עלתה X%)" when reach is present on both halves; leave it `''` when reach is null so Google/legacy rows are unaffected.

---

## 4. Thresholds (explicit, tunable as named constants)
- `MIN_DATES = 12`, `MIN_PER_HALF = 6`, `NOISE_FLOOR_IMPR = 5000` — reuse existing gates.
- `FREQ_CLIMB = 1.2` — recent half-frequency ≥ 1.2× prior (≥20% climb).
- `FREQ_FLOOR = 1.3` — recent half-frequency must clear a small absolute floor (avoid flagging barely-repeated ads). Tunable.
- Suppression: skip if the strong CTR+CPM rule already fires for the ad.

---

## 5. Data availability (verified-style summary)
`reach`/`frequency` are **not** fetched anywhere today. Meta + TikTok report ad-level reach; Google does not (Search/Shopping/PMax). So this is a **Meta + TikTok** signal, Google-blind by design. `ads_daily` currently spans only ~36 days (from 2026-05-01) — enough for the ≥12-dates gate on ads that have run ≥12 days; backfill makes those eligible immediately.

## 6. The reach-not-additive caveat (why this is honest)
Reach = unique people; summing daily reach double-counts anyone reached on multiple days, so `sumImpr ÷ sumReach` **under**states true window frequency. We therefore report a **relative trend** ("frequency is climbing"), not an absolute "weekly frequency = X". The same downward bias applies to both halves, so the recent÷prior ratio remains a valid trend signal. Copy reflects this ("התדירות עלתה X%", never an absolute frequency claim).

---

## 7. Testing (TDD — failing test first)
- `detectAdFatigueEarlyWarning`: (a) fires on a clean frequency climb with no CTR/CPM crash; (b) suppressed when the strong rule already fires for the ad; (c) skipped for ads with null/zero reach (Google-blind); (d) respects `MIN_DATES`/per-half/noise-floor/`FREQ_FLOOR`; (e) does not fire on flat/declining frequency.
- Existing `detectAdFatigue` tests stay green; add one asserting `freqNote` appears when reach present and stays `''` when null.
- Fetcher unit tests: reach parsed from Meta + TikTok shapes; null-safe.
- Full gate: `tsc` · vitest node+DOM · lint · User Manual bump (new insight type) · ARCHITECTURE note (ads_daily.reach + backfill script) · supervised migration → single push.

---

## 8. Open risks / checklist
1. **`ads_enriched` view** must be recreated to project `reach` in the SAME migration (confirmed: reader uses the view, not the table) — else the reader is blind to the column. This is a hard requirement, not a verify-later.
2. **Which writers** populate ad rows in production today (hot_metrics workers vs cronDaily) — ensure each Meta/TikTok writer includes `reach` so live + nightly stay consistent.
3. **Meta/TikTok `reach` field names** — confirm exact API field keys during implementation (Meta `reach`; TikTok metric `reach`).
4. Backfill is **Meta+TikTok only**; Google rows intentionally remain null.

## 9. Out of scope
Absolute weekly-frequency reporting; Google frequency; any frequency-based WhatsApp push (the digest path is descoped per the roadmap); new dashboard tabs/charts.
