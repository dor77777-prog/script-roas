# Phase E1.6 — Account-level Spend → Workers Design Spec

**Date:** 2026-05-30
**Status:** Approved (user-confirmed full design)
**Phase context:** Follow-on to Phase E1.5 (cron-live cleanup). User questioned the "cron-live → Shopify-only" claim after observing an Inngest run still showing `fetch-meta-google-tiktok-spend-light-3day` in cron-live-uzoshop. E1.5 indeed removed the status/enrollment/historical-update steps but left the account-level aggregate spend fetch in place because no alternative path existed for `data_daily.fb_spend_cad / ga_spend_cad / tt_spend_cad` mid-day. E1.6 closes that gap by moving the account-aggregate fetch into the 3 hot_metrics worker branches.

## Goal

Make cron-live **truly Shopify-only** by relocating the per-platform account-level spend + impressions fetch into the 3 hot_metrics worker branches (metaWorker, googleWorker, tiktokWorker). After E1.6:
- `data_daily.fb_spend_cad / ga_spend_cad / tt_spend_cad / fb_impressions / ga_impressions / tt_impressions` for today + yesterday + day-before are updated within ≤10 min by the 3 workers per the orchestrator cadence.
- cron-live owns only Shopify (revenue + orders attribution + persist of revenue+derived columns).
- Dashboard freshness is preserved bit-for-bit — operator sees no data change, only a cleaner architecture and one fewer step.run in cron-live (Inngest budget savings ~10%).

## Why now

The user's observation (2026-05-30 ~17:50 IL Inngest screenshot) caught E1.5's incomplete claim. Two corrective options were on the table: (A) update docs to admit cron-live = "Shopify + per-platform spend aggregate", (B) finish the move. User chose (B) for architectural consistency and to preserve "all platform fetches per store via per-store workers" as the mental model.

## Architecture

### Before E1.6
```
cron-live-{store} (every 10 min, per store):
  step.run('fetch-shopify-rolling-3day')                       — Shopify
  step.run('fetch-meta-google-tiktok-spend-light-3day')        — Meta+Google+TikTok account-level
  step.run('fetch-shopify-orders-attribution-today')           — Shopify
  step.run('select-prior-spend-{date}') × 3                    — read prior data_daily.fb/ga/tt_spend_cad
  step.run('persist-rolling-3day')                             — UPSERT data_daily with revenue+derived+spend

cron-tick-orchestrator (every 10 min):
  fan-out 18 events (3 stores × 3 platforms × 2 scopes)
  → meta/google/tiktokWorker.runXxxStatusBranch              — fetches campaign/adset/ad statuses + writes registries + adset placeholders (E1.5)
  → meta/google/tiktokWorker.runXxxHotMetricsBranch          — fetches hot-id metrics + writes campaigns_daily + ads_daily
```

### After E1.6
```
cron-live-{store} (every 10 min, per store):
  step.run('fetch-shopify-rolling-3day')                       — Shopify
  step.run('fetch-shopify-orders-attribution-today')           — Shopify
  step.run('persist-rolling-3day-shopify')                     — UPSERT data_daily with Shopify revenue + derived
                                                                  (SELECTs current data_daily spend inline for derived)
  (3 platform steps + 3 select-prior steps REMOVED, ~150 lines)

cron-tick-orchestrator (every 10 min, unchanged):
  fan-out 18 events (3 stores × 3 platforms × 2 scopes)
  → meta/google/tiktokWorker.runXxxStatusBranch              — unchanged
  → meta/google/tiktokWorker.runXxxHotMetricsBranch:
       1. BUC pre-flight gate (existing)
       2. Hot ids fetch + campaigns_daily + ads_daily (existing)
    +  3. NEW: account-aggregate spend → data_daily.fb/ga/tt_spend_cad + impressions
                for [today, yesterday, day-before]
       4. recordFreshness success (existing)
```

### Race-condition mitigation: partial-column UPSERT
Both writers target `data_daily(date, store_id)` PK but disjoint columns:
- **Workers** UPSERT payload `{date, store_id, fb_spend_cad, fb_impressions}` (Meta example) — only the platform's 2 columns it owns.
- **cron-live** UPSERT payload `{date, store_id, gross_revenue_cad, net_revenue_cad, refunds_cad, roas, gross_profit_cad, cogs_cad, net_profit_cad}` — Shopify revenue + derived computed from current SELECT.

Supabase JS `.upsert({...payload}, { onConflict: 'date,store_id' })` builds the SET clause from payload keys only. Two writers with disjoint payloads merge cleanly per-column. Same semantic cron-live + cron-daily relied on for years.

### Derived-column timing
cron-live's persist-rolling-3day-shopify SELECTs the latest data_daily row's spend (whatever workers wrote most recently) and computes derived columns. Tick-to-tick consistency:
- t=0: worker writes new spend at 9:50:00 (≤2s after start)
- t=0+5s: cron-live SELECTs that spend, computes derived
- Result: derived columns reflect the freshest spend within ~5 sec.

If the worker is mid-fetch when cron-live's SELECT runs (race), cron-live reads the previous tick's spend (≤10 min stale). Next cron-live tick (10 min later) self-heals. Equivalent to the current behavior where cron-live's fetch-light and persist were sequential within the same step — never atomically consistent with workers anyway.

### agg_tiktok_spend_per_store_for_date RPC
**Retained, called only by cron-daily (nightly).** It sums per-row campaigns_daily TikTok → data_daily.tt_spend_cad as authoritative recompute. During the day, the TikTok worker's account-aggregate write is the live source. RPC becomes a nightly cross-check (and a fallback if the worker is silenced).

### FX-failure semantics
The current cron-live `cadConvert` (lines 882-901) returns null on FX timeout/error, and the persist step's per-platform preserve keeps the prior column value. E1.6 mirrors this exactly: workers call the same `cadConvert` helper (extracted to `dashboard-web/src/lib/inngest/cadConvert.ts` for reuse), and on null result, OMIT the affected CAD column from the UPSERT payload. Supabase preserves the existing value. Behavior: "FX outage → operator sees yesterday's value, not garbage" — preserved bit-for-bit.

## Components — files touched

### New files
| File | Responsibility |
|---|---|
| `dashboard-web/src/lib/fetchers/metaAccountSpend.ts` | `fetchMetaAccountSpendForDates(storeId, dates: string[]): Promise<Array<{date, spendCad, impressions}>>` — single account-level Graph API call returning all 3 dates. Reuses existing `fetchMetaSpendForDayLight` building blocks. |
| `dashboard-web/src/lib/fetchers/googleAccountSpend.ts` | Same shape, GAQL `SELECT metrics.cost_micros, metrics.impressions FROM customer WHERE segments.date BETWEEN ...`. |
| `dashboard-web/src/lib/fetchers/tiktokAccountSpend.ts` | Same shape, TikTok `/report/integrated/get/?data_level=AUCTION_ADVERTISER&dimensions=["advertiser_id","stat_time_day"]`. |
| `dashboard-web/src/lib/inngest/cadConvert.ts` | Extracted CAD-conversion helper (FX failure → null per audit fix 2026-05-23 a/WARN-3). Currently inlined inside cron-live; promoted to a shared module so workers can reuse identically. |
| `dashboard-web/src/lib/inngest/upsertDataDailySpend.ts` | `upsertDataDailySpend({admin, storeId, date, platform, spendCad, impressions})` — partial-column UPSERT to data_daily for ONE (platform, date) tuple. Null-CAD inputs result in OMITTED columns (preserve semantics). |

### Modified
| File | Change |
|---|---|
| `dashboard-web/src/inngest/functions/metaWorker.ts` | Add new step "meta-account-aggregate-spend" inside `runMetaHotMetricsBranch`, after the existing hot-ids upsert + before `recHotPair('success')`. Calls `fetchMetaAccountSpendForDates(storeId, [today, today-1, today-2])` then for each result, `upsertDataDailySpend({platform:'meta', ...})`. Soft-fail on fetch error — log + continue (the per-tick hot_metrics success path remains). |
| `dashboard-web/src/inngest/functions/googleWorker.ts` | Same shape for Google. |
| `dashboard-web/src/inngest/functions/tiktokWorker.ts` | Same shape for TikTok. |
| `dashboard-web/src/inngest/functions/cronLive.ts` | Remove `fetch-meta-google-tiktok-spend-light-3day` step (lines 866-~1040). Remove the 3 `select-prior-spend-{date}` step.runs (lines ~1108-1128). Adjust `persist-rolling-3day` to SELECT current data_daily spend inline before computing derived. Rename step id to `persist-rolling-3day-shopify` to reflect new scope. Remove unused imports: `fetchMetaSpendForDayLight`, `fetchGoogleAdsSpendForDay`, `fetchTikTokSpendForDay` (the LIGHT variants only — full insights are no longer called from here). |
| Tests | 3 new unit tests for the new fetchers (`metaAccountSpend.test.ts` etc.). 3 new integration tests for worker step (mock fetch, verify upsertDataDailySpend called with expected args). Drop the cron-live tests that exercise the removed `fetch-meta-google-tiktok-spend-light-3day` step. |

### Docs
- `docs/ARCHITECTURE.md`: add §Phase E1.6 — replace the "cron-live → Shopify-only" claim from §Phase E1.5 with the corrected story (E1.5 was partial; E1.6 completes the move). Update the function-inventory table to show the new step count.
- `docs/ROAS-Dashboard-User-Manual.md`: bump 2.3.0 → 2.3.1. One-paragraph note: "מעבר אדריכלי פנימי — cron-live עכשיו Shopify-only באמת. ה-spend של פייסבוק/גוגל/טיקטוק מתעדכן ב-data_daily דרך workers פר-חנות פר-פלטפורמה (אותה תדירות, אותם נתונים)."

## API call budget impact

| Source | API calls / 10 min — before E1.6 | After E1.6 | Delta |
|---|---|---|---|
| cron-live: fetch-light (3 platforms × 3 dates × 3 stores) | 27 | 0 | −27 |
| Worker hot_metrics (per-campaign) | 9 (3 stores × 3 platforms × 1 bulk) | 9 | 0 |
| Worker account-aggregate (NEW) | 0 | 9 (3 × 3 × 1 bulk per worker covers all 3 dates in one call) | +9 |
| **Total platform API calls / 10 min** | **36** | **18** | **−18 (−50%)** |

Net: **fewer API calls** because each worker bundles all 3 dates into a single account-aggregate call (Meta `date_preset=last_3d`, Google `BETWEEN`, TikTok date range). Previously cron-live made 27 separate calls (one per date per platform per store).

Meta BUC impact reduced by half. Free-tier Inngest step.run count also drops (one step in cron-live becomes one step in each of 3 workers, but the worker's step.run already exists for hot_metrics — adding another step inside the same Inngest function is just one extra step counted against the per-tick budget, not a separate function execution).

## Verification

### Pre-deploy
- tsc clean
- vitest: 1548 baseline + 6 new (3 fetcher tests + 3 worker tests) − 2 removed (cron-live fetch-light tests) = ~1552
- `npm run audit:reconcile:hot-vs-heavy` — still green (workers still write campaigns_daily; the harness doesn't care about data_daily directly)
- Manual: compare data_daily.fb_spend_cad before deploy vs the value cron-live just wrote at the previous tick, to capture baseline.

### Post-deploy (after Vercel build + 1 orchestrator cycle = ≤10 min)
- Inngest dashboard: confirm cron-live runs now have only 3 step.run entries (was 5+); confirm each worker's hot_metrics function shows the new "account-aggregate-spend" step.
- Direct query: `SELECT fb_spend_cad, ga_spend_cad, tt_spend_cad FROM data_daily WHERE date=today AND store_id IN (uzoshop, zolplus, usmile360)` — values match what hot_metrics workers most-recently wrote (compared against Meta Ads Manager / Google Ads UI / TikTok Ads Manager as the source of truth).
- `/operator` panel: `data_daily.last_write_at` advances every ≤10 min for every store (was every ≤10 min — should be unchanged).
- 24h soak: no data_daily column shows "stuck at value from yesterday" — every column advances at least once per 10 min during the day.

### Rollback
`git revert` the E1.6 commits + push. Vercel redeploys in 3-5 min. cron-live's fetch-light + select-prior-spend + persist-rolling-3day are restored. Workers stop writing the new account-aggregate (the step is gone). No data loss — cron-live takes over again.

## What is NOT in scope (defer)

- Refactoring `persistCampaignsLive.ts` to be Shopify-only (it currently has Meta/Google/TikTok branches for the cron-daily path; touching it is out of E1.6's scope — that's a separate cleanup once cron-daily is the only consumer).
- Computing data_daily aggregates from campaigns_daily via Postgres triggers (more aggressive cleanup; would also remove the need for worker account-aggregate fetches but introduces aggregation-correctness questions when hot_set ≠ all-campaigns). Defer to a future "aggregate-from-source" refactor if desired.
- Removing the `agg_tiktok_spend_per_store_for_date` RPC (keep as nightly recompute fallback).

## Related

- spec antecedent: `docs/superpowers/specs/2026-05-30-phase-e1-decommission-cron-live-heavy-design.md` (E1+E1.5 design)
- memory: `phase-e1-e1-5-shipped`
- memory: `phase-e-scope-decision` — E1.6 is not in the original E1-E4 list but is a corrective extension of E1.5; conceptually part of E1
