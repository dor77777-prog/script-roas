# Phase C — Hot metrics + Google/TikTok workers (pre-decommission)

**Date:** 2026-05-30
**Status:** Approved (operator-confirmed scope + decommission-after-canary)
**Parent umbrella spec:** [`2026-05-29-freshness-contract-incremental-sync-design.md`](2026-05-29-freshness-contract-incremental-sync-design.md)
**Predecessor scoped spec:** [`2026-05-30-phase-b-registries-meta-status-design.md`](2026-05-30-phase-b-registries-meta-status-design.md)
**Predecessor phases (shipped):**
- Phase A (foundation), Phase A.5 v2 (TikTok mapping), Phase B (registries + Meta status, HEAD `5bb0b5c` + `50e972a`).

## Why this scoped spec exists

Phase C in the umbrella spec bundles seven deliverables that combine to "hot metrics across all 3 platforms + decommission cron-live-heavy." The full bundle takes 5–7 days and the decommission step requires a 3-day canary that we cannot compress. This scoped spec ships the **implementation** of all hot-metrics components tonight and runs them in parallel with `cron-live-heavy`, deferring the actual decommission to a Phase C.5 follow-up after the canary period demonstrates parity.

## Goals

1. Hot-set SQL helpers (`getHotCampaignIds`, `getHotAdsetIds`, `getHotAdIds`) per platform, using the 5-branch UNION from the umbrella spec.
2. Extend `meta-worker` with a `scope='hot_metrics'` handler that fetches Meta insights filtered by hot ids and writes to `campaigns_daily` + `ads_daily` with `source='live_tick'`.
3. New `google-worker` Inngest function handling `scope='status'` (via `change_status` GAQL) and `scope='hot_metrics'` (via `WHERE id IN (hot_ids)` GAQL). Populates `*_registry` and `campaigns_daily` / `ads_daily`.
4. New `tiktok-worker` Inngest function handling `scope='status'` (via `/campaign/get/?primary_status=STATUS_ALL`) and `scope='hot_metrics'` (via `/report/integrated/get/?filtering=campaign_ids`). Honors the Phase A.5 campaign-store-map so newly mapped campaigns write under the correct `store_id`.
5. Orchestrator extension: now emits four scopes per store (`status` + `hot_metrics` for Meta; same for Google and TikTok). Dynamic-threshold logic reuses the Phase B layers; only the cooldown-tier values may differ per scope (status = 8 min standard; hot_metrics = 5 min standard since metrics churn faster).
6. UI changes (minimal): `CampaignsTable` gains a per-row `last_live_tick_at` freshness chip; `CampaignDrawer` gains a "status + freshness" section reading from the registries.
7. `npm run audit:reconcile` extended with a hot-metrics-vs-cron-live-heavy mode that compares the two pipelines' output for T-0 and T-1 and reports drift per (store, platform, campaign).

## Non-goals (deferred to Phase C.5)

- **Decommission of `cron-live-heavy`.** Requires 24–72 hours of `audit:reconcile` showing 0 drift. Decommission ships in Phase C.5 once acceptance is met.
- **CampaignsTable / CampaignDrawer full registry-status wiring.** Phase D scope. Phase C only adds the `last_live_tick_at` chip + one status-and-freshness section in Drawer.
- **`FreshnessChip` new states** (`skipped_budget`, `unreconciled`) → Phase D.
- **TodayLive "live (provisional)" banner** → Phase D.
- **Rolling reconcile T-2..T-14**, `cron-weekly-reconcile` → Phase E.
- **Decommission of `cron-live`** (the 10-min Shopify rolling + Meta budgets fetch). Phase D scope; Phase C only adds parallel layers, doesn't remove any existing layer.

## Acceptance

1. Within 10 minutes of deploy, `cron_tick_snapshots` shows fan-out events for **all four scopes** (Meta status, Meta hot_metrics, Google status+hot_metrics, TikTok status+hot_metrics) across all 3 stores.
2. `campaign_registry` populated for Google + TikTok platforms (Phase B already covered Meta).
3. `campaigns_daily` + `ads_daily` show `source='live_tick'` + `last_live_tick_at` populated within 10 minutes for entities in the hot set (verified via `SELECT source, COUNT(*) FROM campaigns_daily WHERE date = CURRENT_DATE GROUP BY source`).
4. `npm run audit:reconcile -- --hot-metrics-vs-heavy` runs without throwing and reports either ✓ match or a structured diff per (store, platform, campaign). Material drift would block Phase C.5.
5. `cron-live-heavy` continues to run in parallel — no removal.
6. Operator opens `CampaignsTable` and sees a freshness chip on each row reflecting `last_live_tick_at`. Opens `CampaignDrawer` and sees a status+freshness section reading `effective_status` from the registry.

## Final architecture (Phase C slice)

```
EVERY 10 MIN
  cron-tick-orchestrator (extended)
    ├── compute-events: now produces 6 events per tick max
    │     (3 stores × 2 scopes; per-platform branching for google/tiktok
    │      happens inside the worker, not the orchestrator)
    └── step.sendEvent fan-out

  meta-worker (extended)
    ├── scope='status' (Phase B, unchanged)
    └── scope='hot_metrics' (NEW)
          1. BUC pre-flight (ads_insights pool, not ads_management)
          2. getHotCampaignIds(storeId, 'meta')
          3. fetchMetaHotMetricsForStore({ hotIds, ... })
          4. upsert campaigns_daily + ads_daily with source='live_tick'
          5. mark data_freshness 'campaign_metrics' success

  google-worker (NEW)
    ├── scope='status'
    │     1. fetchGoogleStatusForStore (change_status GAQL)
    │     2. diff vs registries → status events
    │     3. upsert registries
    │     4. mark data_freshness 'campaign_status'/'adset_status'/'ad_status' success
    └── scope='hot_metrics'
          1. getHotCampaignIds(storeId, 'google')
          2. fetchGoogleHotMetricsForStore({ hotIds, dateStr })
          3. upsert campaigns_daily + ads_daily with source='live_tick'
          4. mark data_freshness 'campaign_metrics' success

  tiktok-worker (NEW)
    ├── scope='status'
    │     1. fetchTikTokStatusForStore (campaign/get list-all)
    │     2. apply campaign-store-map (Phase A.5) before diff
    │     3. diff vs registries → status events
    │     4. upsert registries
    │     5. mark data_freshness 'campaign_status' success
    └── scope='hot_metrics'
          1. getHotCampaignIds(storeId, 'tiktok')
          2. fetchTikTokHotMetricsForStore({ hotIds, dateStr })
          3. apply campaign-store-map → per-row store_id (DELETE-then-UPSERT pattern from Phase A.5)
          4. upsert campaigns_daily + ads_daily
          5. mark data_freshness 'campaign_metrics' success

cron-live-heavy (existing, UNCHANGED for Phase C)
   Continues running in parallel for the 3-day canary window.
   Phase C.5 removes it once audit:reconcile shows 0 drift.
```

## Data shapes — design decisions

### Hot-set SQL functions

Three Postgres functions per platform — `get_hot_campaign_ids(p_store_id, p_platform)`, `get_hot_adset_ids(...)`, `get_hot_ad_ids(...)`. Each returns `text[]` (array of ids). 5-branch UNION per the umbrella spec §"Hot set SQL". Branches:

1. `is_serving = true AND is_enabled = true AND is_removed = false` — status-active in registry
2. `status_changed_at >= now() - INTERVAL '24 hours'` — recently status-changed
3. `first_seen_at >= now() - INTERVAL '72 hours'` — recently created
4. `campaigns_daily WHERE date = CURRENT_DATE AND (spend>0 OR impressions>0 OR clicks>0 OR conversions>0)` — has activity today
5. `campaigns_daily WHERE date = CURRENT_DATE - 1 AND spend_cad > 0` — yesterday tail

Adset and ad helpers follow the same 5-branch shape against their respective registries + `ads_daily`.

**`platform_updated_at` vs `status_changed_at`:** branch (2) reads `status_changed_at` (only bumps on real status changes), NOT `platform_updated_at` (bumps on any edit including name/budget/creative). A renamed campaign should NOT re-enter the hot set. This invariant is enforced by Phase B's `upsertRegistryFromMeta` and Phase C extends it to the new Google + TikTok worker registry writers.

### `campaigns_daily` / `ads_daily` writes

Workers' `hot_metrics` scope writes to `campaigns_daily` + `ads_daily` with:
- `source = 'live_tick'`
- `is_finalized = false`
- `last_live_tick_at = <now()>`

This matches Phase A's source/finalization columns. `cron-daily` at 01:00 IL continues to rewrite the same rows with `source='daily_reconcile'` + `is_finalized=true`. Phase D's reconcile UI will surface the source distinction.

### Worker concurrency + throttle

| Worker | Concurrency key | Concurrency limit | Throttle |
|---|---|---|---|
| `meta-worker` (existing) | `event.data.store_id` | 1 | 900/h per store (Phase B value) |
| `google-worker` (NEW) | `event.data.store_id` | 1 | 600/h per store (Google Ads developer-token Basic tier ~= 15k ops/day; 600/h leaves room) |
| `tiktok-worker` (NEW) | `event.data.store_id` | 1 | 1500/h per store (TikTok Ads API ~10/sec) |

### Dynamic-threshold strategy (extended)

Phase B's 3-layer strategy applies per worker. Per-worker BUC equivalents:
- Meta: `ads_management` BUC for status; `ads_insights` BUC for hot_metrics (per the umbrella spec §"meta-worker concurrency").
- Google: `developerTokenStatus` quota (no live BUC equivalent — use rate-limit retry-after header).
- TikTok: `x-rate-limit-remaining` header (TikTok-specific).

Each worker's `bucProbe` returns `{ pct, etaMinutes }` as in Phase B, normalized across platforms.

## Worker implementation contracts

### `meta-worker` scope='hot_metrics' (extension)

```typescript
async function runMetaHotMetricsJob(input: RunMetaHotMetricsInput) {
  if (event.scope !== 'hot_metrics') return;
  if (buc.etaMinutes > 0 || buc.adsInsightsCallPct >= HARD_SKIP_PCT) { /* mark freshness budget_skip; return */ }

  const hotIds = await getHotCampaignIds(storeId, 'meta');  // SQL RPC
  if (hotIds.length === 0) { /* mark freshness success with zero rows */ return; }

  const metrics = await fetchMetaHotMetricsForStore({ storeId, adAccountId, accessToken, hotIds, dateStr: today });
  await upsertCampaignsDailyFromMeta(metrics);
  await upsertAdsDailyFromMeta(metrics);
  await markFreshness({ scope: 'campaign_metrics', status: 'success' });
}
```

`fetchMetaHotMetricsForStore` uses the existing Meta insights endpoint with `filtering=[{field: "campaign.id", operator: "IN", value: hotIds}]` and time range = `since=today, until=today`. Returns the same shape as the existing `fetchMetaAdSetInsights` + `fetchMetaAdInsights` outputs so the upsert helpers can reuse `persistCampaignsLive.ts` logic.

### `google-worker`

Mirrors `meta-worker` shape:

```typescript
inngest.createFunction(
  {
    id: 'google-worker',
    concurrency: [{ key: 'event.data.store_id', limit: 1 }],
    throttle: { limit: 600, period: '1h', key: 'event.data.store_id' },
  },
  { event: 'google/job.requested' },
  async ({ event, step }) => {
    if (scope === 'status') return runGoogleStatusJob(...);
    if (scope === 'hot_metrics') return runGoogleHotMetricsJob(...);
  }
);
```

**Status discovery:** GAQL query `SELECT campaign.id, campaign.name, campaign.status, campaign.serving_status, change_status.last_change_date_time FROM change_status WHERE change_status.last_change_date_time DURING LAST_24_HOURS AND change_status.resource_type IN ('CAMPAIGN', 'AD_GROUP', 'AD_GROUP_AD')`. For each returned id, follow up with `SELECT … FROM campaign WHERE id = X` to get the full status row. Upsert into registries with the same `buildRegistryUpsertRow` from Phase B.

**Hot metrics:** GAQL `SELECT … FROM campaign WHERE campaign.id IN ('id1','id2',…) AND segments.date DURING LAST_2_DAYS`. Same for ad-group and ad levels.

### `tiktok-worker`

Mirrors `meta-worker` shape with concurrency + throttle as in the table above.

**Status discovery:** `/open_api/v1.3/campaign/get/?primary_status=STATUS_ALL&page_size=1000` paginated. Returns all campaigns; iterate `/adgroup/get/` and `/ad/get/` for the same advertiser. **Critically**: each row's `store_id` resolves via the Phase A.5 campaign-store-map (`resolveStoreForCampaign` helper) before diff/upsert. A campaign mapped from `uzoshop` to `usmile360` writes its registry row under `usmile360`.

**Hot metrics:** `/open_api/v1.3/report/integrated/get/?advertiser_id=<adv>&data_level=AUCTION_CAMPAIGN&dimensions=["campaign_id"]&metrics=[…]&start_date=…&end_date=…&filtering=[{"field_name":"campaign_ids","filter_type":"IN","filter_value":hotIds}]`. Same campaign-store-map resolution. Uses the existing Phase A.5 v2 DELETE-then-UPSERT pattern in `persistCampaignsLive.ts` to avoid the duplicate-row bug.

## Orchestrator changes

The orchestrator's `buildEvents` becomes a per-platform fan-out:

```typescript
function buildEventsAllPlatforms(input): InngestEventPayload[] {
  const out = [];
  for (const storeId of stores) {
    // Meta — Phase B for status, NEW Phase C for hot_metrics
    if (shouldFanOut(storeId, 'meta', 'status', ...)) out.push(makeEvent(storeId, 'meta', 'status', ...));
    if (shouldFanOut(storeId, 'meta', 'hot_metrics', ...)) out.push(makeEvent(storeId, 'meta', 'hot_metrics', ...));
    // Google — both scopes NEW Phase C
    if (shouldFanOut(storeId, 'google', 'status', ...)) out.push(makeEvent(storeId, 'google', 'status', ...));
    if (shouldFanOut(storeId, 'google', 'hot_metrics', ...)) out.push(makeEvent(storeId, 'google', 'hot_metrics', ...));
    // TikTok — both scopes NEW Phase C
    if (shouldFanOut(storeId, 'tiktok', 'status', ...)) out.push(makeEvent(storeId, 'tiktok', 'status', ...));
    if (shouldFanOut(storeId, 'tiktok', 'hot_metrics', ...)) out.push(makeEvent(storeId, 'tiktok', 'hot_metrics', ...));
  }
  return out;
}
```

The `shouldFanOut` predicate applies the Phase B Layer 1+2+3 logic per (store, platform, scope), with scope-specific cooldown tier:
- `status` cooldown: 5/8/15 min (Phase B values)
- `hot_metrics` cooldown: 3/5/10 min (metrics need fresher data; tighter window)

Max events per tick: 3 stores × 3 platforms × 2 scopes = 18, but in steady-state with low staleness most ticks emit 6–9 events.

## UI changes (minimal)

### `CampaignsTable` — `last_live_tick_at` chip
Add a small chip beside each row's spend column. Source: `campaigns_daily.last_live_tick_at` (already exists, Phase A). Display: green dot if `< 15 min`, yellow if `15–60 min`, gray if `> 60 min` or null. Tooltip shows relative time. Reuse the existing token vocabulary from `FreshnessPanel`.

### `CampaignDrawer` — status + freshness section
Add a section "סטטוס + טריות" above the existing product map section. Sources: `*_registry` for status fields (`configured_status`, `effective_status`, `delivery_status`, `status_changed_at`, `first_seen_at`), `data_freshness` for the metrics lag. Display in 2 columns: left = status fields, right = freshness fields.

These two UI additions are intentionally lightweight — Phase D does the full registry-status wiring (replacing `campaigns_daily.effective_status` reads with `*_registry` reads everywhere).

## `audit:reconcile` extension

Add a new mode flag to the existing `npm run audit:reconcile` script (the harness lives at `dashboard-web/src/lib/audit/__tests__/reconcile.live.test.ts`):

```bash
AUDIT_LIVE=1 npm run audit:reconcile -- --hot-metrics-vs-heavy
```

The new mode:
1. Records the current state of `campaigns_daily` for today.
2. Waits for one full orchestrator tick (10 min) plus cron-live-heavy tick (30 min worst case).
3. Re-reads `campaigns_daily` rows touched by both pipelines (joins on `(date, store_id, platform, campaign_id)`).
4. Compares per-row spend / impressions / clicks / conversions / conversion_value across the two `source` values (`live_tick` vs whatever cron-live-heavy writes).
5. Reports drift per (store, platform, campaign): absolute diff + relative diff.
6. Exits 0 if all rows match within tolerance (1% relative or $1 absolute); exits 1 otherwise.

This is the canary harness Phase C.5 will rely on. Tonight we just ship it; the operator (or a cron job) runs it tomorrow and the day after.

## Out of scope (deferred to subsequent phases)

| Item | Phase |
|---|---|
| Decommission `cron-live-heavy` | C.5 (post-canary) |
| `CampaignsTable` full registry-status wiring | D |
| `CampaignDrawer` registry-status replacement of `campaigns_daily.effective_status` reads | D |
| `FreshnessChip` new states | D |
| Rolling reconcile + `cron-weekly-reconcile` | E |

## Dependencies

- **Phase A:** `meta_buc_usage`, `data_freshness`, finalization columns. All in place.
- **Phase A.5 v2:** TikTok campaign-store-map + DELETE-then-UPSERT pattern in `persistCampaignsLive.ts`. Required by the TikTok worker.
- **Phase B:** registries, `cron-tick-orchestrator`, `meta-worker` (status scope), `priorityBuilder`, `diff`, `upsert` helpers. Required by all Phase C workers.

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Adding Google + TikTok status discovery triples the API call volume → BUC pressure (Meta), GAQL quota (Google), TikTok rate limits | Per-platform dynamic-threshold logic (Phase B Layer 1+2). Each worker independently throttles. |
| `audit:reconcile` finds drift → blocks Phase C.5 decommission indefinitely | Drift is acceptable as a finding; the canary's job is to surface it. Phase C.5 doesn't ship until drift is resolved. |
| First Phase C tick stresses Vercel cold starts (18 events fan out simultaneously) → some workers timeout | Workers run on independent function invocations. Concurrency 1 per (worker, store) means most events queue. Vercel cold start budget per function: 60s — should comfortably handle status fetch + hot metrics. |
| Google `change_status` returns no rows on first call (90-day retention) → first registry warm-up misses old-but-active campaigns | Fall back to direct campaign listing for the initial warm-up tick if `change_status` returns empty. After the first tick, the registry knows the baseline and subsequent ticks use `change_status` incrementally. |
| TikTok campaign-store-map missing for some campaigns in hot set → DELETE-then-UPSERT pattern operates against wrong store_id | The fetcher's `resolveStoreForCampaign` defaults to the advertiser's owner store (uzoshop) when map lookup misses. Same fallback the existing `cron-live-heavy` uses. |
| Operator UI changes break the existing `CampaignsTable` layout | Both UI additions are additive (new chip + new section). Snapshot DOM tests verify no regression. |

## Migration order + rollback

1. Apply migration `<timestamp>_phase_c_hot_set_functions.sql` (additive: 3 Postgres functions for the hot-set SQL).
2. Deploy worker + UI code.
3. Verify within 10 min:
   - `cron_tick_snapshots` rows show fan-out ≥ 6 events per tick.
   - `campaign_registry` populated for Google + TikTok platforms.
   - `campaigns_daily` rows show `source='live_tick'` + populated `last_live_tick_at` for at least one row in the hot set per (store, platform).
4. Trigger `npm run audit:reconcile -- --hot-metrics-vs-heavy` after one full 30-min cron-live-heavy cycle has elapsed.
5. Operator monitors for 24h: drift acceptable, snapshots clean.

**Rollback path:** disable Phase C workers via Inngest feature toggle (one env var). `cron-live-heavy` continues unchanged — pipeline reverts to Phase B + cron-live-heavy. No data loss; `*_registry` for Google + TikTok stops getting populated but doesn't break existing reads.
