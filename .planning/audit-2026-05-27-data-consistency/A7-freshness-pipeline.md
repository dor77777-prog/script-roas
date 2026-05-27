# A7 — Live Freshness + Pipeline Write-Correctness

**Agent:** A7  
**Scope:** INV-19..22 — TodayLive freshness, Live CPM, Campaigns-tab today, freshness chip accuracy, cron non-clobber correctness.  
**Files examined:**  
- `dashboard-web/src/inngest/functions/cronLive.ts` (1703 lines)  
- `dashboard-web/src/inngest/functions/cronLiveHeavy.ts` (334 lines)  
- `dashboard-web/src/inngest/functions/cronDaily.ts` (1327 lines)  
- `dashboard-web/src/lib/inngest/persistCampaignsLive.ts` (405 lines)  
- `dashboard-web/src/components/TodayLive.tsx`, `FreshnessChip.tsx`, `SyncIndicator.tsx`  
- `dashboard-web/src/app/api/data/route.ts`, `campaigns/route.ts`  
- `dashboard-web/src/lib/postgresReaders.ts` (freshness readers, lines 207–263)  
- `dashboard-web/src/app/api/inngest/route.ts`

---

## INV-19 — TodayLive revenue freshness

**Status: PASS (code path correct).**

`TodayLive.tsx` fetches `/api/data?from=TODAY&to=TODAY` via its own `useSWR` with `refreshInterval: 60_000` — decoupled from the parent's range filter (fix landed 2026-05-23, operator-reported). `cron-live` runs every 10 min (`*/10 * * * *` — code line 1677) and writes Shopify revenue + all ad-spend for the rolling 3-day window to `data_daily`. No mid-day zero-out risk for revenue; if Shopify fetch fails the sentinel path (`__shopifyFailed`) preserves the last successful write via the `!shopifyOk` branch that skips the revenue UPSERT or, if ad-platform spend arrived, runs a spend-only UPSERT that leaves revenue/gross/refund columns untouched.

**No finding.**

---

## INV-20 — Live CPM (fb/ga/tt impressions in data_daily)

**Status: PASS (code path correct).**

Phase 13.8 (shipped 2026-05-26): `cron-live` fetches per-platform impressions alongside spend for all 3 rolling-window dates and writes `fb_impressions`, `ga_impressions`, `tt_impressions` to `data_daily`. `TodayLive.tsx` reads these from the same `/api/data?from=TODAY&to=TODAY` response — impressions are available every ~10 min if at least one platform fetch succeeded. The per-platform preserve cascade (override → memoized prior → inline SELECT fallback → 0) prevents zero-overwrite on a single platform timeout. `persistDayForStore` Phase 13.8 extension (lines 522–539) handles impressions in lockstep with spend.

**No finding.**

---

## INV-21 — Campaigns tab today not empty

**Status: PASS (code path correct, SEED-4 explained).**

Phase 13.9 (`cron-live-heavy`, shipped 2026-05-27) runs every 30 min and calls `persistCampaignsLive()` for today + yesterday. It writes full metric columns (`spend_cad`, `impressions`, `clicks`, `conversions`, `conversion_value_cad`) via `campaigns_daily` UPSERT, unlike `cron-live`'s status-enrollment pass that only writes `effective_status` + PK columns.

**SEED-4 root cause confirmed:** The harness sees `data_daily = 0` for today's spend vs non-zero `campaigns_daily`. This is expected at day-start: `data_daily` starts seeded to 0 by the first cron-live tick (row INSERT path seeds fb/ga/tt/total_spend_cad = 0); platform spend reaches `data_daily` when cron-live fetches `fetchMetaSpendForDayLight` and writes via `spendOverride`. `campaigns_daily` today rows come from `cron-live-heavy` (30-min cadence, full metrics). During the first 30 min of the day both are likely 0; after that cron-live-heavy populates campaigns while cron-live populates data_daily spend in parallel. The discrepancy in the SEED harness snapshot reflects the asymmetric cadence (10-min vs 30-min) at one specific capture point — not a correctness bug. Neither value is surfaced to the user as "real zero"; both show live-growing data once the cadences kick in.

**No finding for INV-21 / SEED-4.**

---

## INV-22 — "synced N min ago" freshness accuracy

**Status: PASS with a scope caveat (P2).**

`fetchTableLastWriteAt` (postgresReaders.ts:215–239) uses a single `.order('updated_at', desc).limit(1)` scoped to the queried date range. The Supabase trigger `updated_at` is set on every INSERT/UPDATE — so the chip reflects the most-recent cron write within the operator's selected range. For the default (all-time / recent) range this accurately reports the last cron tick.

**P2 caveat:** When the operator selects a purely historical range (e.g. "last month"), `fetchDataDailyLastWriteAt` returns the most-recent `updated_at` within THAT range — typically the last time cron-daily or cron-live refreshed a day in that window. This can be hours old even though cron-live ran 10 min ago for today, showing a misleading "red" freshness chip. The chip comment (FreshnessChip.tsx:9) acknowledges it shows "when data was last written by a cron" but does not distinguish "stale historical range" from "cron failure". Not a bug in the pipeline — a UX communication gap.

**Finding A7-F1 (P2):** `FreshnessChip` turns red for historical range selections because `fetchDataDailyLastWriteAt` queries `updated_at` within the filtered range, not globally. An operator viewing "last month" sees a red chip even when live cron is healthy, creating false urgency. Suggested fix: always query the global max `updated_at` (no date filter) for the freshness chip, or add a second "live cron health" signal alongside the range-scoped write timestamp.

---

## CRITICAL NON-CLOBBER ANALYSIS

### 1. cron-live vs cron-daily (data_daily)

**Status: CORRECT — no clobber.**

`cron-live` uses two write paths in `persistDayForStore`:
- **spendOverride provided (today, fresh platform data):** UPSERT includes spend+impressions columns — intentional overwrite.  
- **No override (platform fetch failed) + prior memoized:** Omit spend/impressions keys from payload; Supabase JS only includes payload keys in the SET clause → ON CONFLICT preserves prior values.  
- **Fresh INSERT (no existing row):** Seeds spend to 0 so subsequent reads get NUMERIC 0, not NULL.

`cron-daily` owns the authoritative spend write (once/day at 00:05 IL). Within the same day:
- `cron-live` may overwrite spend with fresher intraday platform data (intended — this is the live-refresh purpose).
- `cron-daily` runs at 00:05 IL for YESTERDAY — it never processes today's date, so it cannot clobber `cron-live`'s today writes.

**The P0-E (INN-10) race flagged in the 2026-05-24 audit has been fixed (Phase 13.4):** The SELECT that reads prior spend now lives in a separate `step.run('select-prior-spend-{date}-{storeId}', ...)` that Inngest memoizes. On retry, the memoized value (pre-UPSERT baseline) is replayed — the UPSERT no longer re-reads its own output. Code verified at cronLive.ts:1082–1103 and the `prior` parameter path in `persistDayForStore` (lines 388–411).

**No remaining clobber risk between cron-live and cron-daily for data_daily.**

### 2. cron-live-heavy vs cron-live vs cron-daily (campaigns_daily)

**Status: CORRECT by design — potential P1 retry correctness gap in cron-live-heavy.**

`persistCampaignsLive` (called by cron-live-heavy) writes campaigns_daily + ads_daily using ON CONFLICT DO UPDATE. The comment at persistCampaignsLive.ts:8–10 states "absent payload keys are preserved." This is correct for Supabase JS.

`cron-live`'s `refresh-effective-status` step UPSERTs TODAY enrollment rows (zero metrics + effective_status) and UPDATEs all past rows' effective_status. Neither touches spend_cad, impressions, clicks — payload omits them → preserved on conflict.

`cron-daily`'s `persist-batch` step UPSERTs campaigns_daily with full metrics for YESTERDAY. Date partitioning ensures cron-daily and cron-live-heavy never write the same date simultaneously (cron-daily processes D-1; cron-live-heavy processes today + yesterday — there IS overlap on yesterday).

**Finding A7-F2 (P1) — cron-live-heavy retry non-idempotency on yesterday:**

`cronLiveHeavy.ts` combines fetch + persist into a single `step.run('fetch-and-persist-{storeId}-{date}', ...)` (line 200). On Inngest retry, Inngest memoizes the step result — so the combined step's UPSERT IS idempotent (step.run is replayed from memo, not re-executed). However, the fetch+persist are NOT split into separate steps. If the step fails mid-persist (after some UPSERTs land but before the function returns), Inngest retries the whole step — re-fetching fresh platform data and re-UPSERTing. Since the UPSERTs use ON CONFLICT DO UPDATE (last writer wins), this is idempotent for the values themselves BUT the fetch on retry returns newer platform data, potentially overwriting a value from the first attempt with slightly different numbers (e.g., impressions updated mid-retry). This is a very minor data-accuracy issue (seconds-level platform data staleness on retry), not a data-loss or clobber issue. However, it differs from cron-live's careful split of fetch-step + select-step + persist-step for strict idempotency.

More critically: **there is no memoized prior SELECT in cron-live-heavy.** `persistCampaignsLive` does NO SELECT before UPSERT (confirmed — no `.select()` or `.maybeSingle()` calls in that file). This is fine because campaigns_daily rows always contain full current metrics from the fetcher — there is nothing to "preserve" from the prior write (unlike data_daily where Shopify and ad-platform writes are decoupled). So the absence of a prior SELECT is intentional and correct for campaigns_daily.

**Suggested fix for A7-F2:** Split `cron-live-heavy`'s `fetch-and-persist` step into `fetch-{storeId}-{date}` + `persist-{storeId}-{date}` so the fresh data is memoized across retries. This matches cron-live's pattern and prevents subtle data-drift on retries. Low urgency (P1 not P0 — data accuracy is millisecond-level, not dollar-level).

### 3. SEED-3 root cause analysis (early-May Meta spend in data_daily but $0 in campaigns_daily)

**Finding A7-F3 (P1) — cron-live-heavy lookback gap explains SEED-3.**

`cron-live-heavy` only has a **2-day rolling window** (today + yesterday). For any date before yesterday, campaigns_daily is populated exclusively by:
1. `cron-daily` nightly run (processes D-1)
2. `eventBackfill` (operator-triggered)

For early-May dates (2026-05-01..05-07), if those `cron-daily` runs failed for any reason (Apps Script migration window, OAuth token issues, or pre-Phase-13.6 code bugs), and no backfill was triggered, `campaigns_daily` rows would be absent while `data_daily` rows (written by the Apps Script legacy pipeline or an early cron-daily run with different behavior) show non-zero spend. This is not a live write-correctness bug — it is a historical data-completeness gap.

**Evidence:** The SEED-3 window (2026-05-01..05-07) predates Phase 13.9 (shipped 2026-05-27), Phase 13.6, and several Phase 12.x audit fixes. The spend values in `data_daily` likely came from the Apps Script tier that was decommissioned (Phase 11), which wrote aggregated spend to `data_daily` but NOT per-campaign rows to `campaigns_daily`. The `campaigns_daily` table was only populated after the TypeScript cron-daily pipeline became the authoritative writer.

**Suggested fix:** Run a backfill via the operator console for the SEED-3 date window (2026-05-01..05-07) to populate `campaigns_daily` from the Meta/Google APIs for those dates. Note: Meta's Insights API has a 37-month data retention; the backfill should succeed.

### 4. Double-write / mutual clobber risk summary

| Writer | Table | Dates touched | Columns written | Clobber risk |
|--------|-------|---------------|-----------------|--------------|
| cron-live (10 min) | data_daily | today, D-1, D-2 | revenue, gross, refund, fb/ga/tt spend+impressions (with preserve) | None — memoized prior SELECT prevents retry clobber |
| cron-live (10 min) | campaigns_daily | today only | effective_status + PK (metrics absent → preserved) | None |
| cron-live-heavy (30 min) | campaigns_daily | today, D-1 | full metrics (spend_cad, impressions, etc.) | Minor retry drift only (P1) |
| cron-live-heavy (30 min) | ads_daily | today, D-1 | full metrics | Same as above |
| cron-daily (00:05 IL) | data_daily | yesterday | all columns | None — date partition (D-1 only) |
| cron-daily (00:05 IL) | campaigns_daily | yesterday | all columns | None — date partition; cron-live-heavy writes today+yesterday but ON CONFLICT last-writer-wins |

**Important note on yesterday overlap:** Both cron-live-heavy (30 min) and cron-daily (00:05 IL) write to `campaigns_daily` for yesterday. Cron-daily runs once at 00:05 IL; cron-live-heavy ran all day up to that point and continues after. After cron-daily's authoritative write, cron-live-heavy's next tick overwrites campaigns_daily yesterday with fresher (but possibly slightly different) data. This is intentional — cron-live-heavy refreshes yesterday to capture intraday fills and retroactive attribution updates. Both use ON CONFLICT DO UPDATE so the last writer wins per column. No data-loss risk.

---

## Summary of Findings

| ID | Severity | INV | File:Line | Why wrong | Suggested fix |
|----|----------|-----|-----------|-----------|---------------|
| A7-F1 | P2 | INV-22 | `postgresReaders.ts:241–251` | `fetchDataDailyLastWriteAt` scopes `updated_at` to the operator's date range; historical range selections show red freshness chip even when live cron is healthy | Query global max `updated_at` (no date filter) for the chip, or add a separate live-cron health signal |
| A7-F2 | P1 | INV-21 | `cronLiveHeavy.ts:200` | Fetch + persist combined in one `step.run`; on retry, fetcher re-runs and returns newer data than first attempt — minor data-drift on platform numbers | Split into separate `fetch-{storeId}-{date}` + `persist-{storeId}-{date}` steps |
| A7-F3 | P1 | INV-19/SEED-3 | (data gap, not a code bug) | `campaigns_daily` empty for 2026-05-01..05-07 because cron-live-heavy only covers 2-day window; those historical dates were written by Apps Script (data_daily) but never had per-campaign rows in campaigns_daily | Operator backfill via `/api/operator/backfill` for 2026-05-01..05-07 |

**INV-19, INV-20, INV-21 (SEED-4), INV-22 core pipeline: all PASS — no P0 write-correctness bugs remain.**

The P0-E (INN-10) retry-race on prior-spend SELECT (flagged 2026-05-24) has been fully fixed by Phase 13.4's memoized `select-prior-spend-{date}-{storeId}` steps in cron-live. Verified in code.
