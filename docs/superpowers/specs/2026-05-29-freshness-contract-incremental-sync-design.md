# 10-minute freshness contract — incremental sync redesign

**Date:** 2026-05-29
**Status:** Approved (brainstorm complete, awaiting plan)
**Supersedes:** `2026-05-29-meta-api-budget-gating-design.md` (this spec absorbs the Meta budget gating piece as Phase A of a larger redesign)

## Predecessor context

Phase 13.9 (commit `33d1fc2`, 2026-05-27) shipped `cron-live-heavy` — a 30-min Inngest cron that refreshes `campaigns_daily` + `ads_daily` for today + yesterday across 3 stores via per-store factory. All 3 store crons fire on `*/30 * * * *` with no inter-store coordination. The current `cron-live` is `*/15 * * * *` (Shopify rolling 3-day refresh + status snapshot via `fetchMetaBudgets`). `cron-daily` at 00:05 is the authoritative nightly reconcile.

Today's pain points (production, 2026-05-29):

1. **Meta `code: 4 / error_subcode: 1504022`** — `ads_insights` BUC quota exhausted by 30-min heavy ticks during business hours. Seen 4 times today, alert #3 (6h-throttled WhatsApp suppresses the rest).
2. **30-min freshness floor for campaigns/adsets/ads** — the dashboard's heaviest tabs (Campaigns, Drawer, Ads, Products) lag 30 min, not 10. Products lag 24h (daily-only).
3. **Status-vs-metrics coupling** — `effective_status` lives on `campaigns_daily` rows, so a campaign that's ON but has no spend today simply doesn't exist in the dashboard. Newly created campaigns and re-enabled paused campaigns are invisible until they spend. The operator has to wait for actual delivery before the campaign appears.
4. **Silent staleness** — when the heavy cron defers Meta to next tick, the dashboard shows yesterday's `campaigns_daily` row as if it's current. No "this is stale because X" indicator.

The new contract: **every user-visible dashboard surface targets ≤ 10 min freshness whenever the source API allows, with explicit "stale because X" visibility when it can't.** Data correctness preserved via a layered architecture (live tick + nightly reconcile + rolling reconcile in Phase E).

### Important: 10 min is a target SLA, not a blind promise

The freshness contract is conditional on source API availability. The promise is:

1. **When Meta/Google/TikTok/Shopify return data normally:** the dashboard reflects it within 10 min.
2. **When a source blocks (rate limit / token expired / 5xx):** the dashboard explicitly surfaces what is stale, why, and the last successful refresh timestamp. The contract is **never** "always show 10-min-fresh data" — that would be a lie when Meta throttles us.
3. **Data correctness is non-negotiable.** Stale ≠ wrong. We show stale labelled-as-stale, never pretend stale is fresh.

The freshness UI is a first-class deliverable, not a polish layer — it's how we honor the contract honestly.

## Goals

1. KPI / store-level / hot-entity / live-product data ≤ 10 min behind reality **whenever** Meta/Google/TikTok/Shopify return data normally.
2. Campaign/adset/ad status (configured + effective + delivery) ≤ 10 min behind, including newly created + re-enabled + paused-with-no-spend entities.
3. Dashboard shows the difference between **live** (provisional, this 10-min tick), **reconciled** (yesterday after nightly), **finalized** (older + reconciled), and **stale** (skipped due to rate limit / token / error).
4. cron-daily preserved as the authoritative finalization layer — re-fetches and rewrites yesterday with `source='daily_reconcile'` + `is_finalized=true`.
5. Meta API budget pressure relieved via header-aware self-throttling + budget-aware queue + cron stagger — never drives the `ads_insights` BUC to 100%.
6. `/operator` shows the per-scope freshness state, the Meta BUC budgets, the status-change feed, and any failed reconciles.

## Non-goals

- Tightening cron cadence below 10 min (not necessary for "fresh enough"; 10 min is the new floor).
- Real-time webhooks for status changes (Meta webhooks don't fire on user pause/unpause per [Meta docs](https://developers.facebook.com/docs/graph-api/webhooks/getting-started/webhooks-for-ad-accounts/); polling is required).
- Per-BUC quota tracking beyond `ads_insights` + `ads_management` (other BUCs aren't the pain point).
- Google Ads developer-token tier upgrade (Basic 15k ops/day is sufficient with `change_status`; document only).
- Replacing cron-daily — it stays as the authoritative reconciliation layer.
- Adding push notifications / SSE to the dashboard for sub-10-min updates (10 min is the contract).

## Final architecture

```
EVERY 10 MIN — cron-tick (single orchestrator)
   │
   ├─ step 1: compute (store × scope) priorities + tick_id
   │          (reads data_freshness, meta_buc_usage, registry timestamps)
   ├─ step 2: optional pre-flight budget skip if meta_buc_usage stale
   ├─ step 3: step.sendEvent fan-out to 4 worker functions:
   │
   │   ┌─── meta-worker ──────────────────────────────────────────┐
   │   │ concurrency: [account: 2 + per-store: 1]                 │
   │   │ throttle: 540/h (90% of 600 ceiling)                     │
   │   │ priority: kind > metrics; staleness > fresh              │
   │   │ cancelOn: meta/budget.exceeded(tick_id)                   │
   │   │                                                           │
   │   │ Body (per event {store_id, scope, tick_id}):              │
   │   │  1. budget probe → if pct >= 80, emit budget.exceeded     │
   │   │  2. fetch:                                                 │
   │   │      - scope='status': /campaigns + /adsets + /ads        │
   │   │        (ads_management BUC, cheap)                        │
   │   │      - scope='hot_metrics': /insights?filtering=IN(...)   │
   │   │        (ads_insights BUC, the bottleneck)                 │
   │   │  3. parse x-business-use-case-usage → upsert meta_buc_usage│
   │   │  4. diff against registry → write campaign_status_events  │
   │   │  5. upsert {campaign,adset,ad}_registry + data_freshness  │
   │   │  6. for hot_metrics: also write campaigns_daily/ads_daily │
   │   │     with source='live_tick', is_finalized=false           │
   │   └────────────────────────────────────────────────────────────┘
   │
   │   ┌─── google-worker ───────────────────────────────────────┐
   │   │ concurrency: per-store 1                                │
   │   │ Body (per event {store_id, scope, tick_id}):            │
   │   │  1. status: GAQL change_status WHERE                    │
   │   │     last_change_date_time > {watermark}                 │
   │   │     (90d retention, 1 op/query, very cheap)             │
   │   │  2. for changed entities: GAQL SELECT campaign.*        │
   │   │     FROM campaign WHERE campaign.id IN (...)            │
   │   │  3. hot_metrics: GAQL SELECT … FROM campaign            │
   │   │     WHERE id IN (hot_set) AND segments.date             │
   │   │     DURING LAST_2_DAYS                                  │
   │   │  4. diff + persist (same as meta worker)                │
   │   └─────────────────────────────────────────────────────────┘
   │
   │   ┌─── tiktok-worker ───────────────────────────────────────┐
   │   │ concurrency: per-store 1                                │
   │   │ Body:                                                    │
   │   │  1. status: /campaign/get/                              │
   │   │     ?primary_status=STATUS_ALL&page_size=1000           │
   │   │     (no delta endpoint — list-and-diff on modify_time)  │
   │   │  2. hot_metrics: /report/integrated/get/                │
   │   │     ?filter_type=IN&campaign_ids=[…] (cap 100 per call) │
   │   │  3. respect X-RateLimit-Remaining + 40133 Retry-After   │
   │   │  4. diff + persist                                       │
   │   └─────────────────────────────────────────────────────────┘
   │
   │   ┌─── shopify-worker ──────────────────────────────────────┐
   │   │ concurrency: per-store 1                                │
   │   │ Body:                                                    │
   │   │  1. existing rolling 3-day refresh (data_daily)          │
   │   │  2. NEW: live product sync for hot product set          │
   │   │     (products_daily source='live_tick')                 │
   │   └─────────────────────────────────────────────────────────┘
   │
   └─ done; tick_id snapshot persisted for observability

EVERY NIGHT 00:05 — cron-daily (authoritative finalization)
   │
   ├─ For each store + each platform:
   │  1. Full re-fetch yesterday from scratch (no scope limit; full ad-set + ad pagination)
   │  2. Upsert data_daily/campaigns_daily/ads_daily/products_daily with:
   │     source='daily_reconcile', is_finalized=true, reconciled_at=now()
   │  3. Update data_freshness: scope='daily_reconcile', last_success_at=now()
   │  4. On failure: persist failure to token_failures + data_freshness,
   │     do NOT block the dashboard's previous reconciled state
   │
   └─ Reconciles YESTERDAY only in Phase A-D. Rolling window
     (T-2, T-3) added in Phase E.

PHASE E — cron-weekly-reconcile (optional, lighter backfill)
   │ Runs Sundays 02:00. Re-checks T-7..T-14 with attribution-lag aware fetch.
   │ Source='weekly_reconcile'.
```

## Freshness contract (per-scope)

| Surface | Today | Yesterday | Older | If source blocks |
|---|---|---|---|---|
| KPI store-level (Hero, TodayLive, GoalTracker, ROAS chart, PnL) | live ≤ 10 min | reconciled (after 00:05 + ~5 min) | finalized | "stale: Meta budget" / "stale: token error" + last-fresh timestamp |
| Campaign status (CampaignsTable status pill) | live ≤ 10 min via registry | reconciled | finalized | "status stale: X min" |
| Adset / ad status | live ≤ 10 min | reconciled | finalized | "status stale: X min" |
| Hot campaign/adset/ad metrics | live ≤ 10 min (campaigns_daily source='live_tick') | reconciled (source='daily_reconcile') | finalized | "metrics stale: X min, status fresh" |
| Cold (non-hot) metrics | provisional from last reconcile | reconciled | finalized | hidden behind "show cold" toggle |
| Newly created campaigns | visible ≤ 10 min after creation via cron-status-discovery | reconciled | finalized | "discovery pending" badge |
| Re-enabled campaigns | visible ≤ 10 min after re-enable | reconciled | finalized | "discovery pending" badge |
| Products with activity today | live ≤ 10 min | reconciled | finalized | "stale" |
| /operator failed reconcile | — | flagged within 30 min of cron-daily failure | — | "reconcile failed: {store}/{platform}/{date}/{table}" + retry button |

## Schema changes

### NEW tables

```sql
-- 1. Entity registries (one row per entity, perpetual)
CREATE TABLE campaign_registry (
  store_id text NOT NULL,
  platform text NOT NULL,                       -- 'meta' | 'google' | 'tiktok'
  campaign_id text NOT NULL,
  name text,
  configured_status text,                       -- operator-set: ACTIVE | PAUSED | DELETED | ARCHIVED
  effective_status text,                        -- platform-native, raw enum
  delivery_status text,                         -- normalized: DELIVERING | PENDING_REVIEW | NOT_DELIVERING | LEARNING | LIMITED | REJECTED | UNKNOWN
  is_enabled boolean,                           -- derived: NOT (configured_status IN PAUSED/DELETED/ARCHIVED)
  is_serving boolean,                           -- derived: delivery_status == DELIVERING
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  status_updated_at timestamptz,                -- when status changed (not just re-observed)
  last_metrics_success_at timestamptz,          -- bumped by hot_metrics scope on success
  last_status_success_at timestamptz,           -- bumped by status scope on success
  raw_status_payload jsonb,                     -- last full status payload, for debugging
  missed_seen_count integer NOT NULL DEFAULT 0, -- consecutive status syncs where this entity was not in the response
  is_removed boolean NOT NULL DEFAULT false,    -- marked true only after N>=3 misses OR explicit platform DELETE
  PRIMARY KEY (store_id, platform, campaign_id)
);
CREATE INDEX idx_campaign_registry_serving ON campaign_registry (store_id, platform, is_serving) WHERE is_serving = true AND is_removed = false;
CREATE INDEX idx_campaign_registry_recent_status_change ON campaign_registry (store_id, platform, status_updated_at DESC NULLS LAST);

CREATE TABLE adset_registry (
  store_id text NOT NULL,
  platform text NOT NULL,
  campaign_id text NOT NULL,                    -- FK back to campaign_registry (composite)
  adset_id text NOT NULL,
  name text,
  configured_status text,
  effective_status text,
  delivery_status text,
  is_enabled boolean,
  is_serving boolean,
  daily_budget_cad numeric(14,4),
  lifetime_budget_cad numeric(14,4),
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  status_updated_at timestamptz,
  last_metrics_success_at timestamptz,
  last_status_success_at timestamptz,
  raw_status_payload jsonb,
  missed_seen_count integer NOT NULL DEFAULT 0,
  is_removed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (store_id, platform, adset_id)
);
CREATE INDEX idx_adset_registry_campaign ON adset_registry (store_id, platform, campaign_id);
CREATE INDEX idx_adset_registry_serving ON adset_registry (store_id, platform, is_serving) WHERE is_serving = true AND is_removed = false;

CREATE TABLE ad_registry (
  store_id text NOT NULL,
  platform text NOT NULL,
  campaign_id text NOT NULL,
  adset_id text NOT NULL,
  ad_id text NOT NULL,
  name text,
  configured_status text,
  effective_status text,
  delivery_status text,
  is_enabled boolean,
  is_serving boolean,
  first_seen_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  status_updated_at timestamptz,
  last_metrics_success_at timestamptz,
  last_status_success_at timestamptz,
  raw_status_payload jsonb,
  missed_seen_count integer NOT NULL DEFAULT 0,
  is_removed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (store_id, platform, ad_id)
);
CREATE INDEX idx_ad_registry_adset ON ad_registry (store_id, platform, adset_id);
CREATE INDEX idx_ad_registry_serving ON ad_registry (store_id, platform, is_serving) WHERE is_serving = true AND is_removed = false;

-- 2. Status change audit log (append-only, deduped)
CREATE TABLE campaign_status_events (
  id bigserial PRIMARY KEY,
  store_id text NOT NULL,
  platform text NOT NULL,
  entity_type text NOT NULL,                    -- 'campaign' | 'adset' | 'ad'
  entity_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  from_status text,                             -- null if entity didn't exist before
  to_status text NOT NULL,
  change_kind text NOT NULL,                    -- 'first_seen' | 'paused' | 'enabled' | 'archived' | 'removed' | 'effective_only' | 'delivery_only'
  raw_event jsonb,                              -- full delta payload
  -- Idempotency: prevents the same delta from being inserted twice when a
  -- discovery tick is retried or runs near a status flap. Bucketing
  -- occurred_at to the minute means two observations of the same transition
  -- within the same minute coalesce (a known platform behavior near review-state edges).
  dedupe_key text GENERATED ALWAYS AS (
    store_id || ':' || platform || ':' || entity_type || ':' || entity_id || ':' ||
    COALESCE(from_status, 'NULL') || ':' || to_status || ':' ||
    to_char(date_trunc('minute', occurred_at), 'YYYY-MM-DD"T"HH24:MI')
  ) STORED,
  UNIQUE (dedupe_key)
);
CREATE INDEX idx_status_events_recent ON campaign_status_events (store_id, platform, occurred_at DESC);
CREATE INDEX idx_status_events_entity ON campaign_status_events (entity_id, occurred_at DESC);
-- Writers MUST use INSERT ... ON CONFLICT (dedupe_key) DO NOTHING.

-- 3. Per-scope freshness tracker
CREATE TABLE data_freshness (
  store_id text NOT NULL,                       -- 'global' for app-wide scopes
  platform text NOT NULL,                       -- 'global' for cross-platform scopes
  scope text NOT NULL,                          -- enum below
  table_name text NOT NULL,
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  status text NOT NULL,                         -- 'success' | 'budget_skip' | 'auth_error' | 'transient_error' | 'unreconciled'
  lag_minutes integer,                          -- computed: now() - last_success_at
  error_code text,
  error_message text,
  budget_skip boolean DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, platform, scope, table_name)
);
-- scope enum: 'kpi_daily' | 'campaign_status' | 'campaign_metrics' | 'adset_status' |
--             'adset_metrics' | 'ad_status' | 'ad_metrics' |
--             'product_live' | 'product_daily' | 'daily_reconcile' | 'weekly_reconcile'

-- 4. Meta BUC usage tracker (per ad-account, NOT per-store).
-- Meta BUC rate limits are reported per ad_account in the
-- x-business-use-case-usage header. Today each store maps to one ad
-- account, but the schema is forward-compatible with multi-account stores
-- (e.g., a store running multiple Meta ad accounts under one Business Manager).
CREATE TABLE meta_buc_usage (
  store_id text NOT NULL,
  ad_account_id text NOT NULL,                  -- the Meta act_<id> the BUC was reported for
  -- ads_insights BUC: the bottleneck (insights endpoint)
  ads_insights_call_pct numeric(5,2) NOT NULL DEFAULT 0,
  ads_insights_cputime_pct numeric(5,2) NOT NULL DEFAULT 0,
  ads_insights_time_pct numeric(5,2) NOT NULL DEFAULT 0,
  ads_insights_eta_minutes integer DEFAULT 0,
  -- ads_management BUC: separate pool for listings/status
  ads_management_call_pct numeric(5,2) NOT NULL DEFAULT 0,
  ads_management_cputime_pct numeric(5,2) NOT NULL DEFAULT 0,
  ads_management_time_pct numeric(5,2) NOT NULL DEFAULT 0,
  ads_management_eta_minutes integer DEFAULT 0,
  -- last URL that updated this row (debug aid)
  last_url text,
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, ad_account_id)
);
CREATE INDEX idx_meta_buc_usage_store ON meta_buc_usage (store_id);
-- Pre-flight queries lookup by store_id (need max BUC across accounts for that store).

-- 5. Tick observability (one row per cron-tick run)
CREATE TABLE cron_tick_snapshots (
  tick_id text PRIMARY KEY,                     -- ISO YYYY-MM-DDTHH:MM (10-min bucket)
  started_at timestamptz NOT NULL,
  finished_at timestamptz,
  fan_out_count integer,                        -- number of events emitted
  events_completed_count integer,
  events_skipped_count integer,                 -- budget skips
  events_failed_count integer
);
```

### Column additions to EXISTING tables

```sql
-- Mark provenance + finalization on all 4 daily tables.
-- 'source' enum: 'live_tick' | 'daily_reconcile' | 'weekly_reconcile' | 'backfill' | 'manual_override'

ALTER TABLE data_daily
  ADD COLUMN source text NOT NULL DEFAULT 'live_tick',
  ADD COLUMN reconciled_at timestamptz,
  ADD COLUMN is_finalized boolean NOT NULL DEFAULT false,
  ADD COLUMN last_live_tick_at timestamptz;

ALTER TABLE campaigns_daily
  ADD COLUMN source text NOT NULL DEFAULT 'live_tick',
  ADD COLUMN reconciled_at timestamptz,
  ADD COLUMN is_finalized boolean NOT NULL DEFAULT false,
  ADD COLUMN last_live_tick_at timestamptz;

ALTER TABLE ads_daily
  ADD COLUMN source text NOT NULL DEFAULT 'live_tick',
  ADD COLUMN reconciled_at timestamptz,
  ADD COLUMN is_finalized boolean NOT NULL DEFAULT false,
  ADD COLUMN last_live_tick_at timestamptz;

ALTER TABLE products_daily
  ADD COLUMN source text NOT NULL DEFAULT 'live_tick',
  ADD COLUMN reconciled_at timestamptz,
  ADD COLUMN is_finalized boolean NOT NULL DEFAULT false,
  ADD COLUMN last_live_tick_at timestamptz;

-- Backfill existing rows: anything older than yesterday is_finalized = true.
UPDATE data_daily       SET is_finalized = true, source = 'daily_reconcile', reconciled_at = updated_at WHERE date < CURRENT_DATE - 1;
UPDATE campaigns_daily  SET is_finalized = true, source = 'daily_reconcile', reconciled_at = updated_at WHERE date < CURRENT_DATE - 1;
UPDATE ads_daily        SET is_finalized = true, source = 'daily_reconcile', reconciled_at = updated_at WHERE date < CURRENT_DATE - 1;
UPDATE products_daily   SET is_finalized = true, source = 'daily_reconcile', reconciled_at = updated_at WHERE date < CURRENT_DATE - 1;
```

## Cron jobs (revised pipeline)

| Function | Schedule | Replaces | Status |
|---|---|---|---|
| `cron-tick-orchestrator` | `*/10 * * * *` | NEW | Phase B |
| `meta-worker` (event-triggered) | event `meta/job.requested` | NEW | Phase B (skeleton), Phase C (hot metrics) |
| `google-worker` (event-triggered) | event `google/job.requested` | NEW | Phase C |
| `tiktok-worker` (event-triggered) | event `tiktok/job.requested` | NEW | Phase C |
| `shopify-worker` (event-triggered) | event `shopify/job.requested` | NEW | Phase D (live products) |
| `cron-live-{store}` (existing) | `*/15 * * * *` | TBD | Phase A (unchanged), Phase D (replaced by orchestrator) |
| `cron-live-heavy-{store}` (existing) | `*/30 7-18 * * *` | DECOMMISSIONED | Phase C (after 3-day canary) |
| `cron-daily-{store}` (existing) | `5 0 * * *` | UNCHANGED | Phase A (adds source/is_finalized/reconciled_at writes) |
| `cron-weekly-reconcile` | `0 2 * * 0` (Sundays 02:00) | NEW | Phase E |
| `cron-oauth-canary`, `cron-whatsapp` | (unchanged) | — | — |

### `cron-tick-orchestrator` shape

```typescript
export const cronTickOrchestrator = inngest.createFunction(
  { id: "cron-tick-orchestrator" },
  { cron: "*/10 * * * *" },
  async ({ step }) => {
    // Stable 10-min bucket for idempotent fan-out
    const tickId = await step.run("tick-id", async () =>
      new Date().toISOString().slice(0, 16) // "2026-05-29T14:30"
    );

    const stores = await step.run("load-stores", loadStores);

    // Compute priorities from data_freshness + meta_buc_usage
    const events = await step.run("compute-priorities", async () => {
      const freshness = await loadFreshnessMatrix();
      const metaUsage = await loadMetaBucUsage();
      return buildEvents(stores, freshness, metaUsage, tickId);
    });

    await step.sendEvent("fan-out", events);

    // Persist snapshot for observability
    await step.run("snapshot", () => insertCronTickSnapshot(tickId, events.length));
  }
);
```

Each event has shape:
```typescript
{
  name: "meta/job.requested" | "google/job.requested" | "tiktok/job.requested" | "shopify/job.requested",
  id: `${platform}:${storeId}:${scope}:${tickId}`,  // idempotency
  data: {
    store_id: string,
    scope: "status" | "hot_metrics" | "kpi" | "products_live",
    tick_id: string,
    staleness_seconds: number,                       // for priority
    budget_pct_estimate: number,                     // last known BUC %
  }
}
```

### `meta-worker` shape (full)

```typescript
import { META_BUDGET_THRESHOLD_PCT } from '@/lib/fetchers/meta';

export const metaWorker = inngest.createFunction(
  {
    id: "meta-worker",
    concurrency: [
      { scope: "account", key: '"meta-api"', limit: 2 },     // global cap across env
      { scope: "fn", key: "event.data.store_id", limit: 1 }, // per-store FIFO
    ],
    throttle: { limit: 540, period: "1h", key: '"meta-api"' },
    priority: {
      run:
        "(event.data.scope == 'status' ? 60 : 0) + " +
        "(event.data.staleness_seconds >= 1200 ? 240 : " +
        " event.data.staleness_seconds >= 600 ? 120 : 0)",
    },
    idempotency:
      "event.data.store_id + ':' + event.data.scope + ':' + event.data.tick_id",
    cancelOn: [{
      event: "meta/budget.exceeded",
      if: "async.data.tick_id == event.data.tick_id",
    }],
    retries: 3,
  },
  { event: "meta/job.requested" },
  async ({ event, step }) => {
    const { store_id, scope, tick_id } = event.data;

    // 1. Budget probe — use BUC, not just x-app-usage
    const usage = await step.run("budget-probe", () => getMetaBucUsage(store_id));
    const relevantPct = scope === "hot_metrics"
      ? Math.max(usage?.ads_insights_call_pct ?? 0,
                 usage?.ads_insights_cputime_pct ?? 0,
                 usage?.ads_insights_time_pct ?? 0)
      : Math.max(usage?.ads_management_call_pct ?? 0,
                 usage?.ads_management_cputime_pct ?? 0,
                 usage?.ads_management_time_pct ?? 0);

    if (relevantPct >= META_BUDGET_THRESHOLD_PCT) {
      await step.sendEvent("trip-budget", {
        name: "meta/budget.exceeded",
        id: `meta-budget:${tick_id}:${scope}`,
        data: { tick_id, scope, store_id, usage_pct: relevantPct },
      });
      await step.run("freshness-skip", () =>
        recordFreshness(store_id, "meta", scope, "budget_skip",
                        `BUC ${scope === "hot_metrics" ? "ads_insights" : "ads_management"} at ${relevantPct}%`));
      return { skipped: "budget", pct: relevantPct };
    }

    // 2. Fetch
    const result = await step.run(`fetch-${scope}`, () => {
      if (scope === "status") return fetchMetaStatusForStore(store_id);
      if (scope === "hot_metrics") return fetchMetaHotMetricsForStore(store_id);
      throw new Error(`unknown scope: ${scope}`);
    });

    // 3. Persist (registry + status events + metrics if applicable)
    if (scope === "status") {
      await step.run("upsert-registry", () => upsertRegistryFromMeta(store_id, result));
      await step.run("write-status-events", () => writeStatusEventsFromDiff(store_id, "meta", result));
    } else {
      await step.run("upsert-metrics", () => upsertCampaignsDailyFromHotMetrics(store_id, result));
    }

    // 4. Bump freshness
    await step.run("freshness-success", () =>
      recordFreshness(store_id, "meta", scope, "success", null));
  }
);
```

### Registry upsert logic — missed-poll handling

```typescript
async function upsertRegistryFromMeta(storeId: string, batchResponse: MetaStatusBatch) {
  const observedIds = new Set(batchResponse.campaigns.map(c => c.id));

  // Step 1: upsert observed entities (reset missed_seen_count to 0).
  for (const c of batchResponse.campaigns) {
    await sb.from("campaign_registry").upsert({
      store_id: storeId, platform: "meta", campaign_id: c.id,
      name: c.name, configured_status: c.configured_status, effective_status: c.effective_status,
      delivery_status: normalizeDeliveryStatus(c.effective_status, c.is_serving, c.issues_info),
      is_enabled: !["DELETED", "ARCHIVED"].includes(c.configured_status),
      is_serving: c.is_serving === true,
      last_seen_at: new Date().toISOString(),
      status_updated_at: c.updated_time,  // ISO from Meta
      last_status_success_at: new Date().toISOString(),
      raw_status_payload: c,
      missed_seen_count: 0,                 // RESET on observation
      is_removed: false,
      // first_seen_at: ON CONFLICT DO NOT update — preserves original
    }, { onConflict: "store_id,platform,campaign_id" });
  }

  // Step 2: increment missed_seen_count for entities NOT in the response.
  // Only mark is_removed=true when count reaches 3.
  await sb.rpc("increment_missed_seen_count", {
    p_store_id: storeId,
    p_platform: "meta",
    p_observed_ids: Array.from(observedIds),
    p_removal_threshold: 3,
  });
}
```

The RPC `increment_missed_seen_count` is defined as:

```sql
CREATE OR REPLACE FUNCTION increment_missed_seen_count(
  p_store_id text, p_platform text,
  p_observed_ids text[], p_removal_threshold int DEFAULT 3
) RETURNS void AS $$
BEGIN
  -- Increment count for entities not seen this tick
  UPDATE campaign_registry
     SET missed_seen_count = missed_seen_count + 1,
         is_removed = (missed_seen_count + 1 >= p_removal_threshold)
   WHERE store_id = p_store_id
     AND platform = p_platform
     AND NOT (campaign_id = ANY(p_observed_ids))
     AND is_removed = false;
END;
$$ LANGUAGE plpgsql;
```

Rationale: a single API hiccup (Meta returns 500 for one of the 3 batch sub-requests, or `/campaigns` returns a truncated page) must NOT make the dashboard show a campaign as deleted. Three consecutive misses (=30 min of cron-tick) is the threshold for treating absence as a real removal. Same logic for adsets + ads with their own RPCs.

### Hot set SQL (per-store, per-platform)

```sql
-- Hot campaigns = UNION of:
--   1. Status-active in registry (effective_status IN delivering-ish enums) — explicit ON state
--   2. Recently status-changed (last 24h) — catches re-enabled even WITHOUT spend yet
--   3. Recently first-seen (last 72h) — catches NEWLY CREATED even WITHOUT spend yet
--   4. Has activity today (spend|impressions|clicks|conversions > 0)
--   5. Had spend yesterday tail (catches "paused this morning")
--
-- IMPORTANT: branches (2) and (3) explicitly DO NOT require spend > 0.
-- A campaign that was just enabled (status PAUSED → ACTIVE 5 minutes ago) MUST
-- enter the hot set so that hot_metrics fetches refresh its zeros into actuals
-- as soon as Meta reports any delivery. Without these branches, the dashboard
-- would show the campaign as ON but with stale-or-missing metrics, which is
-- exactly the "ON but no spend yet" gap requirement 8 in the spec brief.
WITH hot_campaigns AS (
  -- (1) Status-active (the standard case)
  SELECT campaign_id FROM campaign_registry
   WHERE store_id = $1 AND platform = $2
     AND is_removed = false
     AND effective_status IN ('ACTIVE', 'CAMPAIGN_PAUSED', 'PENDING_REVIEW', 'IN_PROCESS', 'PREAPPROVED')
     AND is_enabled = true

  UNION
  -- (2) Recently changed — INCLUDES recently-enabled with zero spend
  SELECT campaign_id FROM campaign_registry
   WHERE store_id = $1 AND platform = $2
     AND is_removed = false
     AND status_updated_at >= now() - INTERVAL '24 hours'

  UNION
  -- (3) Recently created — INCLUDES newly-created with zero spend
  SELECT campaign_id FROM campaign_registry
   WHERE store_id = $1 AND platform = $2
     AND is_removed = false
     AND first_seen_at >= now() - INTERVAL '72 hours'

  UNION
  -- (4) Has activity today
  SELECT DISTINCT campaign_id FROM campaigns_daily
   WHERE store_id = $1 AND platform = $2
     AND date = CURRENT_DATE
     AND (spend_cad > 0 OR impressions > 0 OR clicks > 0 OR conversions > 0)

  UNION
  -- (5) Had spend yesterday tail (covers "paused this morning")
  SELECT DISTINCT campaign_id FROM campaigns_daily
   WHERE store_id = $1 AND platform = $2
     AND date = CURRENT_DATE - 1
     AND spend_cad > 0
)
SELECT array_agg(campaign_id) FROM hot_campaigns;
```

Adset and ad hot sets follow the same UNION shape with their own registry/metrics tables.

## Platform-specific API recipes

### Meta

**Status discovery (ads_management BUC — cheap)**

Batch the 3 lightweight listings in one HTTP request (saves round-trips, but does NOT save quota per Meta docs):

```typescript
async function fetchMetaStatusForStore(storeId: string) {
  const adAccountId = process.env[`${storeId.toUpperCase()}_META_AD_ACCOUNT_ID`];
  const token = process.env[`${storeId.toUpperCase()}_META_ACCESS_TOKEN`];

  const batchBody = [
    { method: "GET", relative_url:
      `act_${adAccountId}/campaigns?fields=id,name,effective_status,configured_status,status,objective,objective_v2,updated_time,created_time,daily_budget,lifetime_budget,is_serving,issues_info{level,error_code,error_message}&limit=500` },
    { method: "GET", relative_url:
      `act_${adAccountId}/adsets?fields=id,name,effective_status,configured_status,campaign_id,updated_time,created_time,daily_budget,lifetime_budget,is_serving,learning_stage_info,targeting,optimization_goal&limit=500` },
    { method: "GET", relative_url:
      `act_${adAccountId}/ads?fields=id,name,effective_status,configured_status,adset_id,updated_time,created_time,is_serving,creative{id}&limit=500` },
  ];

  const res = await fetchMeta(`https://graph.facebook.com/v23.0/?include_headers=false&access_token=${token}`, {
    method: "POST",
    body: new URLSearchParams({ batch: JSON.stringify(batchBody) }),
  });
  // fetchMeta wrapper parses x-business-use-case-usage and writes meta_buc_usage

  return parseStatusBatch(await res.json());
}
```

**Hot metrics (ads_insights BUC — the bottleneck)**

```typescript
async function fetchMetaHotMetricsForStore(storeId: string) {
  const hotIds = await getHotCampaignIds(storeId, 'meta'); // SQL above
  if (hotIds.length === 0) return { campaigns: [], adsets: [], ads: [] };

  const chunks = chunk(hotIds, 50); // Meta IN list practical max
  const results = [];

  for (const ids of chunks) {
    const res = await fetchMeta(`https://graph.facebook.com/v23.0/act_${adAccountId}/insights?` +
      `level=campaign&` +
      `fields=campaign_id,impressions,spend,clicks,conversions,conversion_values,purchase_roas,cpm,ctr&` +
      `time_range=${encodeURIComponent(JSON.stringify({since: today, until: today}))}&` +
      `filtering=${encodeURIComponent(JSON.stringify([{field: "campaign.id", operator: "IN", value: ids}]))}&` +
      `use_unified_attribution_setting=true&` +
      `limit=500&` +
      `access_token=${token}`);

    results.push(...await res.json().then(r => r.data));
  }

  // Same shape for level=adset, level=ad with their own hot sets
  return aggregateResults(results);
}
```

**`fetchMeta` wrapper (parses BUC headers)**

```typescript
export async function fetchMeta(url: string, init?: RequestInit): Promise<Response> {
  const res = await fetchWithBackoff(url, init);

  // Prefer BUC over generic app-usage
  const bucRaw = res.headers.get("x-business-use-case-usage");
  if (bucRaw) {
    try {
      const buc = JSON.parse(bucRaw);
      const accountId = extractAdAccountIdFromUrl(url);
      const storeId = lookupStoreByAdAccount(accountId);
      const insightsRow = buc[accountId]?.find(r => r.type === "ads_insights");
      const managementRow = buc[accountId]?.find(r => r.type === "ads_management");

      void recordMetaBucUsage({
        store_id: storeId,
        ad_account_id: accountId,    // composite key — multi-account-per-store ready
        ads_insights_call_pct: insightsRow?.call_count ?? 0,
        ads_insights_cputime_pct: insightsRow?.total_cputime ?? 0,
        ads_insights_time_pct: insightsRow?.total_time ?? 0,
        ads_insights_eta_minutes: insightsRow?.estimated_time_to_regain_access ?? 0,
        ads_management_call_pct: managementRow?.call_count ?? 0,
        ads_management_cputime_pct: managementRow?.total_cputime ?? 0,
        ads_management_time_pct: managementRow?.total_time ?? 0,
        ads_management_eta_minutes: managementRow?.estimated_time_to_regain_access ?? 0,
        last_url: url,
      });

      // Throw on the BUC that's relevant to the current call (heuristic by URL pattern)
      const relevantPct = url.includes("/insights")
        ? Math.max(insightsRow?.call_count ?? 0, insightsRow?.total_cputime ?? 0, insightsRow?.total_time ?? 0)
        : Math.max(managementRow?.call_count ?? 0, managementRow?.total_cputime ?? 0, managementRow?.total_time ?? 0);

      if (relevantPct >= META_BUDGET_THRESHOLD_PCT) {
        throw new MetaBudgetHighError(relevantPct);
      }
    } catch (e) {
      if (e instanceof MetaBudgetHighError) throw e;
      console.warn("[fetchMeta] failed to parse x-business-use-case-usage:", bucRaw, e);
    }
  }

  return res;
}
```

### Google Ads

**Status discovery is a TWO-step model:** `change_status` returns only the delta (which resource IDs changed) — it does NOT include the current values of those resources. After the delta query, a hydration query against the entity tables is required. Google documents up to **~3 minute latency** before a change appears in `change_status`. This is acceptable for our 10-min SLA but not for sub-5-min freshness.

**Status discovery via `change_status` watermark + hydration**

```typescript
async function fetchGoogleStatusForStore(storeId: string) {
  const customerId = process.env[`${storeId.toUpperCase()}_GOOGLEADS_CUSTOMER_ID`];
  const watermark = await getGoogleChangeWatermark(storeId); // from data_freshness or registry

  const changeQuery = `
    SELECT change_status.resource_name, change_status.last_change_date_time,
           change_status.resource_status, change_status.resource_type,
           change_status.campaign, change_status.ad_group, change_status.ad_group_ad
    FROM change_status
    WHERE change_status.last_change_date_time > '${watermark}'
    ORDER BY change_status.last_change_date_time
    LIMIT 10000
  `;
  const changes = await searchStream(customerId, changeQuery);

  if (changes.length === 0) return { changed_ids: [], full_listing: null };

  // For changed entities, re-fetch full status
  const changedCampaignIds = uniq(changes.filter(c => c.resource_type === "CAMPAIGN").map(c => extractIdFromResourceName(c.campaign)));

  const statusQuery = `
    SELECT campaign.id, campaign.name, campaign.status, campaign.serving_status, campaign.experiment_type
    FROM campaign
    WHERE campaign.id IN (${changedCampaignIds.join(",")})
  `;
  const statuses = await searchStream(customerId, statusQuery);

  // Advance watermark for next tick
  const newWatermark = changes[changes.length - 1].last_change_date_time;
  await setGoogleChangeWatermark(storeId, newWatermark);

  return { changes, statuses };
}
```

**Hot metrics**

```typescript
async function fetchGoogleHotMetricsForStore(storeId: string) {
  const hotIds = await getHotCampaignIds(storeId, 'google');
  if (hotIds.length === 0) return [];

  const query = `
    SELECT campaign.id, segments.date,
           metrics.cost_micros, metrics.impressions, metrics.clicks,
           metrics.conversions, metrics.conversions_value
    FROM campaign
    WHERE campaign.id IN (${hotIds.join(",")})
      AND segments.date DURING LAST_2_DAYS
  `;
  // Single op regardless of list size — up to 20k IDs
  return searchStream(customerId, query);
}
```

### TikTok

**Status discovery (list-and-diff).** No delta endpoint — full list with `primary_status=STATUS_ALL`. The list returns `modify_time` as a response field; we diff client-side against the registry's `status_updated_at`. ⚠ **Pre-Phase A discovery Task 0.2** confirms which rate-limit headers TikTok actually returns on `200 OK` responses — pre-emptive throttling is only possible if `X-RateLimit-Remaining` (or equivalent) is present on success. If not, we fall back to react-on-429 with `Retry-After`.

**Status discovery body:**

```typescript
async function fetchTikTokStatusForStore(storeId: string) {
  const advertiserId = process.env[`${storeId.toUpperCase()}_TIKTOK_ADVERTISER_ID`];

  // No delta endpoint — full list with primary_status=STATUS_ALL
  let page = 1;
  const all = [];
  while (true) {
    const res = await fetchTikTok(`/campaign/get/`, {
      advertiser_id: advertiserId,
      filtering: { primary_status: "STATUS_ALL" },
      fields: ["campaign_id", "campaign_name", "operation_status", "secondary_status",
               "objective_type", "modify_time", "create_time", "budget"],
      page,
      page_size: 1000,
    });
    const data = await res.json();
    all.push(...data.data.list);
    if (data.data.page_info.page >= data.data.page_info.total_page) break;
    page++;
  }
  return all;
  // Diff against registry happens in worker step.run('write-status-events')
}
```

**Hot metrics**

```typescript
async function fetchTikTokHotMetricsForStore(storeId: string) {
  const hotIds = await getHotCampaignIds(storeId, 'tiktok');
  if (hotIds.length === 0) return [];

  // TikTok IN cap = 100 per call
  const chunks = chunk(hotIds, 100);
  const results = [];
  for (const ids of chunks) {
    const res = await fetchTikTok(`/report/integrated/get/`, {
      advertiser_id: advertiserId,
      report_type: "BASIC",
      data_level: "AUCTION_CAMPAIGN",
      dimensions: ["campaign_id", "stat_time_day"],
      metrics: ["spend", "impressions", "clicks", "conversion",
                "complete_payment_roas", "cpc", "ctr"],
      filtering: [{ field_name: "campaign_ids", filter_type: "IN", filter_value: JSON.stringify(ids) }],
      start_date: yesterday,
      end_date: today,
      page_size: 1000,
    });
    results.push(...await res.json().then(r => r.data.list));
  }
  return results;
}
```

### Shopify

**Live product sync** (new in Phase D):

```typescript
async function fetchShopifyHotProductsForStore(storeId: string) {
  const hotProductIds = await getHotProductIds(storeId);
  // hot products = products with orders today UNION products in active campaigns UNION top revenue 7d
  if (hotProductIds.length === 0) return [];

  // GraphQL bulk query: products[hot_set] -> orders today aggregated
  return fetchShopifyProductsLive(storeId, hotProductIds);
}
```

## Dashboard UI changes

### `CampaignsTable.tsx` — new columns

```
| Name | Configured | Effective | Delivery | Spend | ROAS | Status fresh | Metrics fresh |
| ABC  | ACTIVE     | ACTIVE    | DELIVERING | $123 | 2.4  | 2 min ago    | 4 min ago     |
| DEF  | ACTIVE     | PENDING_REVIEW | NOT_DELIVERING | $0 | — | 1 min ago | n/a (status only) |
| GHI  | PAUSED     | CAMPAIGN_PAUSED | NOT_DELIVERING | $456 (today, pre-pause) | 1.8 | 1 min ago | 4 min ago |
| JKL  | ACTIVE     | UNKNOWN   | UNKNOWN | — | — | stale 35 min (Meta budget) | stale |
```

- **Configured** chip: ACTIVE (green) / PAUSED (gray) / DELETED (red strike-through) / ARCHIVED (gray).
- **Effective** chip: platform-native enum (Meta: ACTIVE / PAUSED / PENDING_REVIEW / DISAPPROVED / WITH_ISSUES / IN_PROCESS / CAMPAIGN_PAUSED / ADSET_PAUSED / ARCHIVED, etc.).
- **Delivery** chip: normalized vocabulary — DELIVERING (green), LEARNING (blue), LIMITED (amber), NOT_DELIVERING (gray), PENDING_REVIEW (amber), REJECTED (red), UNKNOWN (gray).
- **Status fresh** = `now() - registry.last_status_success_at`. Tooltip: "Last status update at HH:MM, source: Meta status sync."
- **Metrics fresh** = `now() - campaigns_daily.last_live_tick_at`. Tooltip: "Last live tick at HH:MM, source: hot metrics sync. Finalized after nightly reconcile at 00:05."

### `CampaignDrawer.tsx` — status + freshness section

New section at the top of the drawer:
```
┌─ Status ──────────────────────────────────────────────┐
│ Configured: ACTIVE                                     │
│ Effective:  ACTIVE                                     │
│ Delivery:   DELIVERING (learning phase: SUCCESS)       │
│                                                        │
│ Status last refreshed: 2 min ago (Meta status sync)    │
│ Metrics last refreshed: 4 min ago (Meta hot metrics)   │
│ Yesterday reconciled: 06:23 ✓                          │
│                                                        │
│ Recent status changes (last 24h):                      │
│  • 11:42 PENDING_REVIEW → ACTIVE                       │
│  • 09:15 (created)                                     │
└────────────────────────────────────────────────────────┘
```

### `FreshnessChip.tsx` — extended

```typescript
type FreshnessSignal =
  | { kind: 'fresh', ageMinutes: number }
  | { kind: 'stale', ageMinutes: number, reason?: string }
  | { kind: 'skipped_budget', minutesUntilRetry: number }
  | { kind: 'unreconciled', date: string }
  | { kind: 'auth_error', advice: string };
```

Each chip renders:
- Green dot + "fresh, 2 min" when ageMinutes < 10.
- Amber + "stale 25 min" + tooltip with reason.
- Red + "Meta budget paused, ETA 12 min" when budget_skip.
- Blue + "live (provisional)" badge on today's rows.
- Gray + "reconciled" badge on yesterday's rows (after 00:05 + ~5 min).

### `TodayLive.tsx` — live/reconciled distinction

Banner under the live KPIs:
```
[Live] Updated 3 min ago · KPIs from cron-live · Will reconcile after midnight.
```

### `/api/campaigns`, `/api/data`, `/api/products` — return shape additions

```typescript
type CampaignRow = {
  // ... existing fields ...

  // NEW
  source: 'live_tick' | 'daily_reconcile' | 'weekly_reconcile' | 'backfill' | 'manual_override';
  isFinalized: boolean;
  reconciledAt: string | null;
  lastLiveTickAt: string | null;

  // Registry-sourced status (overrides campaigns_daily.effective_status when present)
  configuredStatus: string | null;
  effectiveStatus: string | null;
  deliveryStatus: 'DELIVERING' | 'LEARNING' | 'LIMITED' | 'NOT_DELIVERING' | 'PENDING_REVIEW' | 'REJECTED' | 'UNKNOWN' | null;
  statusLastUpdatedAt: string | null;
  metricsLastSuccessAt: string | null;
  statusLastSuccessAt: string | null;

  // Status events in last 24h, capped at 5
  recentStatusEvents: Array<{ occurredAt: string, fromStatus: string | null, toStatus: string }>;
};
```

## `/operator` changes

### New panels

1. **Meta BUC budget panel** (per-store)
   - 3 progress bars per store × 2 BUCs (ads_insights + ads_management)
   - Color: green <60%, amber 60-80%, red ≥80%
   - "Last updated 2 min ago, ETA full budget recovery: 12 min"

2. **Freshness matrix**
   - Table with rows: (store × platform × scope), columns: status / lag / last_success / next_retry
   - Sortable by lag desc to surface staleness

3. **Status events feed**
   - Last 50 status changes across all stores
   - Filters by store, platform, change_kind

4. **Failed reconciles panel**
   - From data_freshness where scope='daily_reconcile' AND status != 'success'
   - Surfaces: store, platform, table, date affected, last successful reconcile, retry button
   - Retry triggers `event.sync-now` for the missing date

5. **Tick observability**
   - Last 24 cron-tick snapshots: tick_id, fan_out_count, completed/skipped/failed, duration

## Test surface

### New tests (Phase A-E)

**Phase A:**
- `data_freshness.test.ts` — upsert idempotency, lag computation.
- `metaBucUsage.test.ts` — BUC header parsing for ads_insights / ads_management.
- `metaBucUsageParityWithGlobals.test.ts` — parity test (every store with Meta has a row).
- `dailyReconcileMarksFinalized.test.ts` — cron-daily writes source='daily_reconcile' + is_finalized=true + reconciled_at.
- `liveTickNotFinalized.test.ts` — cron-live writes source='live_tick' + is_finalized=false.

**Phase B:**
- `cronTickOrchestrator.test.ts` — tick_id stability + idempotent fan-out + event payload shape.
- `metaWorkerBudgetSkip.test.ts` — budget probe + emit budget.exceeded + record freshness.
- `metaWorkerCancelOnBudget.test.ts` — cancelOn triggers when sibling worker emits exceeded.
- `registryUpsertIdempotency.test.ts` — discovery sync runs twice → same registry rows (missed_seen_count resets to 0).
- `registryMissedSeenIncrement.test.ts` — campaign in tick 1 but absent in tick 2 → missed_seen_count = 1, is_removed = false.
- `registryMissedSeenThreshold.test.ts` — 3 consecutive misses → is_removed = true; status_event with change_kind='removed'.
- `registryReEmergence.test.ts` — is_removed=true campaign reappears in next discovery → is_removed reset to false; status_event change_kind='re_emerged'.
- `statusEventsOnDelta.test.ts` — status change writes campaign_status_events.
- `statusEventsFirstSeen.test.ts` — new campaign writes first_seen event.
- `statusEventsReEnabled.test.ts` — PAUSED → ACTIVE writes re-enabled event.
- `statusEventsDedupe.test.ts` — same transition observed twice within the dedupe bucket inserts only one row (ON CONFLICT DO NOTHING).
- `statusEventsCrossBucket.test.ts` — same transition observed 2 min apart inserts two rows (each its own bucket).
- `activeCampaignWithoutSpendVisible.test.ts` — registry shows ACTIVE campaign with zero campaigns_daily metrics.

**Phase C:**
- `hotSetBuilder.test.ts` — UNION returns active + recent + spending + paused-with-spend.
- `hotSetIncludesRecentlyEnabledWithZeroSpend.test.ts` — campaign re-enabled 10 min ago with zero spend MUST appear in hot set (branch 2).
- `hotSetIncludesNewlyCreatedWithZeroSpend.test.ts` — campaign first_seen 2 hours ago with zero spend MUST appear (branch 3).
- `hotSetExcludesCold.test.ts` — long-paused campaign (status_updated_at > 24h ago, no recent spend) NOT in hot set.
- `hotSetExcludesRemoved.test.ts` — registry rows with is_removed=true filtered out.
- `cronHotMetricsCancelsHeavy.test.ts` — canary check: heavy + hot run in parallel, then heavy decommissioned.

**Phase D:**
- `productsLiveSync.test.ts` — products with orders today refreshed within 10 min.
- `dashboardSeparatesLiveFromReconciled.test.ts` — UI shows "live" badge on today's rows, "reconciled" on yesterday's.
- `tabFreshnessSeparate.test.ts` — campaigns table shows status_fresh + metrics_fresh independently.

**Phase E:**
- `rollingReconcileT2T3.test.ts` — cron-daily also re-fetches T-2 and T-3.
- `weeklyReconcileBackfill.test.ts` — weekly job re-fetches T-7..T-14 with source='weekly_reconcile'.
- `failedReconcileSurfacesInOperator.test.ts` — failed cron-daily writes freshness row queryable by /operator.

## Pre-Phase A discovery (header truth verification)

Some claims in the platform-specific recipes above are derived from Meta / Google / TikTok documentation + community reports. Before we wire them into production code, we must verify against **real responses from our actual API calls**, not just docs.

This is a 1-day spike that gates Phase A code:

### Task 0.1: Log Meta `x-business-use-case-usage` headers from live traffic (4 hours)

- Temporarily wrap an existing Meta fetcher (`fetchMetaAdSetInsights` from `cronLive` is a good candidate — runs every 15 min and hits `/insights`) so it logs **the full response headers** including `x-app-usage`, `x-business-use-case-usage`, `x-fb-ads-insights-throttle`, and `x-ad-account-usage`. Deploy this as a non-functional debug commit to production.
- After 4 hours of live traffic (covers both heavy and light periods), pull the Sentry / Vercel logs and extract 20+ actual header values across both `/insights` and `/campaigns` endpoints for all 3 stores.
- Write a fixture file at `dashboard-web/src/lib/fetchers/__fixtures__/meta-buc-headers-real.json` containing the actual JSON shapes.
- **Decision gate:** the spec's claim "ads_insights and ads_management are separate pools, x-business-use-case-usage reports per-BUC with `type` field" must hold in our real data. If our calls return ONLY `x-app-usage` and not `x-business-use-case-usage` for some reason (small accounts can have this), the spec must be adjusted to use `x-app-usage` as the primary signal.
- Remove the debug logging commit before Phase A code starts.

### Task 0.2: Log TikTok rate-limit headers (2 hours)

- Same approach: wrap `fetchTikTokAdInsights` to log full response headers.
- Confirm exact header names: is it `X-RateLimit-Remaining` or `X-Tt-Logid` or both? Does TikTok send the headers on `200 OK` responses or only on `429`?
- Document in `dashboard-web/src/lib/fetchers/__fixtures__/tiktok-rate-limit-headers-real.json`.
- **Decision gate:** if TikTok does NOT send `X-RateLimit-Remaining` on successful responses, we can only react after 429 (via `Retry-After`), not pre-emptively. Spec must be adjusted to reflect this — `meta_buc_usage`-like proactive tracking is impossible without successful-response headers.

### Task 0.3: Verify Google Ads `change_status` two-step model end-to-end (2 hours)

- Run an ad-hoc GAQL query against uzoshop:
  1. `SELECT change_status.resource_name, change_status.last_change_date_time, change_status.resource_type, change_status.resource_status FROM change_status WHERE change_status.last_change_date_time > 'NOW - 1 day' LIMIT 100`
  2. For each `change_status.resource_name` that points at a campaign, extract the campaign ID.
  3. `SELECT campaign.id, campaign.name, campaign.status FROM campaign WHERE campaign.id IN (...)`
- Confirm:
  - The 2-query pattern works (change_status returns delta only, then hydration query returns current state).
  - The 3-min latency Google documents is observed (compare `last_change_date_time` to a pause action you took 3+ min ago).
  - Resource names parse cleanly into campaign IDs (`customers/{cid}/campaigns/{id}` format).
- Document findings in a code comment in `fetchGoogleStatusForStore`.

### Task 0.4: Real Meta status flap audit (1 hour)

- Pull 24 hours of `effective_status` values for one active campaign across 3 stores via the existing `fetchMetaBudgets` output.
- Confirm: do we see status flapping (ACTIVE → PENDING_REVIEW → ACTIVE within minutes) at platform-internal review boundaries? This determines whether the minute-granularity dedupe on `campaign_status_events.dedupe_key` is the right window.
- If we see sub-minute flap noise, tighten the dedupe bucket to 5-minute (and document why).

**Output:** all 4 fixture files committed to `dashboard-web/src/lib/fetchers/__fixtures__/` + a 1-page summary doc at `docs/superpowers/specs/2026-05-29-platform-header-spike-findings.md`. Phase A doesn't start until this is complete.

## Phasing (rollout plan)

### Phase A — Foundation: budget gate + freshness skeleton + finalization columns

**Duration:** 6-8 days (1 day Pre-Phase A spike + 5-7 days Phase A work)
**Branch:** `freshness-redesign-phase-a` (created from main)
**Gating:** Pre-Phase A discovery (Tasks 0.1-0.4) must complete first — all 4 fixture files committed + findings doc published. If the spike surfaces material spec corrections, Phase A re-plans before code starts.

**Deliverables:**
1. Migration: `meta_buc_usage` (per-store) + `data_freshness` + 4 column additions (source / is_finalized / reconciled_at / last_live_tick_at) on data_daily / campaigns_daily / ads_daily / products_daily.
2. `fetchMeta` wrapper around `fetchWithBackoff`, parses x-business-use-case-usage (ads_insights + ads_management BUCs), writes to `meta_buc_usage`, throws `MetaBudgetHighError` at threshold.
3. `recordFreshness()` + `getFreshness()` helpers.
4. Pre-flight skip in `cron-live-heavy` + `cron-daily`: read meta_buc_usage, skip Meta if recent budget high, persist budget_skip to data_freshness.
5. `MetaBudgetHighError` substring in `isRateLimitError` → routes to `cron_live_heavy_budget_skip` operation in token_failures (no WhatsApp send).
6. Cron stagger: cron-live-heavy uzoshop=`0,30`, zolplus=`10,40`, usmile=`20,50`.
7. cron-daily writes source='daily_reconcile' + is_finalized=true + reconciled_at on yesterday's rows.
8. cron-live (rolling Shopify) writes source='live_tick' + last_live_tick_at on touched rows.
9. `/operator` Meta BUC panel + freshness panel (read-only display, no retry actions yet).
10. User Manual 2.1.14 → 2.1.15 changelog: "Meta API budget tracking + reconciliation finalization columns added."

**Acceptance:**
1. Pre-Phase A discovery findings doc + 4 fixture files merged before any Phase A code.
2. No more `cron_live_heavy_rate_limit` panic WhatsApps from the live cron.
3. `/operator` shows per-(store, ad_account_id) BUC panel + per-(store, platform, scope) freshness panel.
4. cron-daily writes is_finalized=true + source='daily_reconcile' on every yesterday row.
5. cron-live writes last_live_tick_at on touched rows.
6. All 5 new Phase A tests pass + existing 1,307 tests still pass.

### Phase B — Registries + status discovery + Meta worker skeleton

**Duration:** 5-7 days

**Deliverables:**
1. Migration: `campaign_registry` + `adset_registry` + `ad_registry` + `campaign_status_events` + `cron_tick_snapshots`.
2. `cron-tick-orchestrator` (10-min cron, fans out events).
3. `meta-worker`, `google-worker`, `tiktok-worker`, `shopify-worker` (skeletons consuming events, scope='status' only in this phase).
4. `fetchMetaStatusForStore` (batch API) + `fetchGoogleStatusForStore` (change_status) + `fetchTikTokStatusForStore` (list-all).
5. `upsertRegistryFromX()` helpers per platform — normalizes raw enums → configured / effective / delivery vocabulary.
6. `writeStatusEventsFromDiff()` — diffs new vs registry, appends to campaign_status_events.
7. `data_freshness` rows for status scopes populated.
8. /operator: status events feed (last 50) + freshness matrix.
9. cron-live-heavy unchanged (still runs as before — Phase C decommissions it).

**Acceptance:** Newly created campaign visible in CampaignsTable within 10 min (read from registry, not campaigns_daily). Re-enabled campaign writes status event. Operator can browse status changes feed.

### Phase C — Hot metrics + decommission cron-live-heavy

**Duration:** 5-7 days

**Deliverables:**
1. `getHotCampaignIds()` + `getHotAdsetIds()` + `getHotAdIds()` SQL helpers.
2. `fetchMetaHotMetricsForStore` + `fetchGoogleHotMetricsForStore` + `fetchTikTokHotMetricsForStore`.
3. Workers gain scope='hot_metrics' handler that fetches + writes to campaigns_daily/ads_daily with source='live_tick'.
4. 3-day canary: cron-live-heavy AND cron-hot-metrics both run, output compared via `npm run audit:reconcile`. If matches, proceed.
5. Decommission cron-live-heavy (delete the Inngest functions).
6. CampaignsTable extended with last_live_tick_at column.
7. CampaignDrawer extended with status + freshness section.

**Acceptance:** Campaigns table refreshes within 10 min instead of 30. `audit:reconcile` shows no drift between hot metrics and reconciled metrics on T-1.

### Phase D — Live products + dashboard UI integration

**Duration:** 5-7 days

**Deliverables:**
1. `getHotProductIds()` SQL — products with orders today, products in active campaigns (via product map), top revenue last 7d.
2. `fetchShopifyHotProductsForStore` GraphQL helper.
3. shopify-worker gains scope='products_live'.
4. ProductsTable + ProductCentricView read from products_daily with mixed live/reconciled rows.
5. CampaignsTable + CampaignDrawer fully wired to registry-based status (not campaigns_daily.effective_status).
6. `FreshnessChip` extended with new states (skipped_budget, unreconciled).
7. TodayLive shows "live (provisional)" banner.
8. cron-live (existing) reviewed — replaced by orchestrator fan-out for KPI scope.

**Acceptance:** Every user-visible surface shows freshness state. Products with activity today refresh within 10 min. Newly created campaign visible without spend.

### Phase E — Rolling reconcile + observability polish

**Duration:** 3-5 days

**Deliverables:**
1. cron-daily extended to also reconcile T-2 and T-3 (rolling 3-day window).
2. `cron-weekly-reconcile` Sundays 02:00: T-7..T-14 with attribution-lag aware insights call (28-day attribution if data_daily revenue revisions detected).
3. /operator: failed-reconcile panel with retry button (fires event.sync-now for missing date).
4. Sentry breadcrumbs added to every step.run for full traceability.
5. cron_tick_snapshots viewer in /operator.
6. Retention policy: `campaign_status_events` rows older than 90d archived to cold storage.
7. Comprehensive freshness contract test suite (15+ tests above).
8. User Manual bumped to 2.1.16-2.1.19 across phases.

**Acceptance:** Rolling reconcile catches attribution lag. Operator can retry failed reconciles from /operator. 90-day audit trail of every status change.

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| BUC header parsing fails silently | Try/catch around JSON.parse; log warning; default pct=0; test covers malformed header. **Pre-Phase A Task 0.1** captures real header fixtures before code is written, so the parser is built against actual shapes. |
| Meta `x-business-use-case-usage` not returned by all calls (small accounts may get only `x-app-usage`) | Pre-Phase A Task 0.1 verifies. If BUC absent for our accounts, fall back to `x-app-usage` as primary signal (less precise but functional). Spec adjusted accordingly before Phase A starts. |
| TikTok `X-RateLimit-Remaining` not on 200 OK responses | Pre-Phase A Task 0.2 verifies. If absent, design degrades gracefully: no pre-emptive throttle, only reactive `Retry-After` on 429 responses. Document the limitation. |
| meta_buc_usage primary key locks us into per-store BUCs (future multi-account-per-store breaks) | Composite key `(store_id, ad_account_id)` allows multiple ad accounts per store. Today there's a 1:1 mapping; tomorrow there isn't. |
| Per-store/account row race when multiple workers upsert simultaneously | Per-row upsert with last-writer-wins on the snapshot fields is the correct semantic — we want the latest BUC observation, not history. Index does not contend across rows. |
| Pre-flight read sees stale value, skips wrongly | `lastUpdatedAt < 15 min` gate on the pre-flight check. Stale → proceed optimistically; in-flight throw catches. |
| Single API hiccup marks a campaign as deleted | Registry has `missed_seen_count` + `is_removed`. `is_removed` only flips true after 3 consecutive missed discovery ticks (= 30 min) OR explicit platform DELETE / ARCHIVE status. Single hiccup increments counter but keeps the campaign visible. |
| Status event flapping floods the audit log | `campaign_status_events.dedupe_key` (GENERATED column) + UNIQUE constraint. Two observations of the same transition within the same minute coalesce. Writers MUST use `INSERT … ON CONFLICT (dedupe_key) DO NOTHING`. If we see sub-minute flap noise in production (Pre-Phase A Task 0.4), tighten the bucket to 5-min. |
| Recently-enabled campaign with zero spend invisible from hot metrics fetch | Hot set SQL UNION branches (2) "recently status-changed" and (3) "recently first-seen" explicitly **do not** require `spend > 0`. A campaign that was just enabled 5 min ago enters the hot set even with all-zero metrics, so the next hot_metrics tick refreshes its zeros into actuals as soon as Meta reports delivery. Test `hotSetIncludesRecentlyEnabledWithZeroSpend` enforces this. |
| Removed entities re-appear (campaign undeleted by operator) | `is_removed=true` rows still upsert on next observation (the upsert resets `missed_seen_count=0` AND `is_removed=false`). Status event emitted with `change_kind='re_emerged'`. |
| Daily reconcile rolling window (Phase E) overwrites a `live_tick` row with stale `daily_reconcile` data when same-day Inngest retry runs after midnight crosses | cron-daily filters `WHERE date < CURRENT_DATE` so it never touches today's row. Phase E rolling re-checks T-2/T-3 only — those rows are >=2 days old, all in is_finalized=true territory. |
| Pre-Phase A discovery (Task 0.1-0.4) takes longer than 1 day and blocks Phase A | The spike is intentionally read-only and adds zero production risk (just logging). If it spills into 2 days, that's still cheaper than building Phase A against wrong assumptions. |
| Stagger gives uzoshop unfair advantage (always fetches first) | Operator approves the order. Recommend uzoshop first (highest traffic, most likely to push budget). |
| Inngest cron-tick re-fires on retry → duplicate fan-out | Event id = `${platform}:${storeId}:${scope}:${tickId}` enforces 24h dedup. tick_id is the 10-min bucket. |
| Hot set SQL too expensive at scale | Indexes on `(store_id, platform, is_serving)`, `(store_id, platform, status_updated_at)`, `(date, store_id, spend_cad)`. Hot set runs in <100ms on current data volume. |
| Meta API version pinned to v23.0 in spec | Phase A introduces `META_API_VERSION` constant. All fetchers read from it. Future bump = one-file change. |
| Status enum drift across platforms | Normalization layer (`delivery_status` derived field) absorbs platform-native enums. Raw stays in `effective_status` for forensics. |
| dashboard reads from registry might miss campaigns that never went through discovery (legacy data) | Backfill registry from existing campaigns_daily rows in Phase B migration. |
| cron-live-heavy decommission breaks something we forgot | 3-day canary in Phase C. Audit harness diffs output. Decommission only after green. |
| Inngest `concurrency` + `throttle` combined behavior at limits | Documented in Inngest docs; we use defaults. If at-limit issues surface, fall back to throttle-only + Supabase advisory lock. |
| Daily reconcile fails for several days in a row → unreconciled rows pile up | Phase E adds /operator failed-reconcile panel + retry button. Email alert if >2 days unreconciled. |
| Rolling reconcile T-2/T-3 (Phase E) re-fetches with same data → wastes quota | Skip the T-2/T-3 fetch if `is_finalized=true AND no Shopify line-item changes` (cheap check on orders_attribution updated_at). |

## Out of scope

- WebSockets / SSE for sub-10-min UI updates.
- Meta Webhooks subscription (not useful for pause/unpause per Meta docs; revisit if Meta adds the event).
- Per-platform retry queue across deploys (rely on Inngest retries for now).
- Real-time Sentry alerts on budget breach (use the existing 6h-throttled WhatsApp pipeline; alert only when freshness lag exceeds 60 min).
- Adaptive threshold tuning based on observed quota churn (the META_BUDGET_THRESHOLD_PCT constant is hand-tuned).
- Per-store cron tick (one orchestrator fans out to all stores).
- Per-platform quota budgets in Google / TikTok (only Meta has the immediate pain point).
- Cross-tier developer-token request to Google (current Basic tier handles change_status comfortably).
- Multi-tenant evolution (this is still single-tenant; the registry/freshness design is forward-compatible if we ever add a 2nd operator).

## File touchpoints (Phase A only — Phases B-E in their own plans)

```
docs/superpowers/specs/
  2026-05-29-platform-header-spike-findings.md         NEW (~1 page, output of Pre-Phase A spike)

dashboard-web/src/lib/fetchers/__fixtures__/
  meta-buc-headers-real.json                           NEW (Pre-Phase A Task 0.1)
  meta-app-usage-headers-real.json                     NEW (Pre-Phase A Task 0.1)
  tiktok-rate-limit-headers-real.json                  NEW (Pre-Phase A Task 0.2)
  google-change-status-sample.json                     NEW (Pre-Phase A Task 0.3)

supabase/migrations/
  20260530100000_add_meta_buc_usage.sql               NEW (~30 lines, composite PK store_id+ad_account_id)
  20260530100001_add_data_freshness.sql               NEW (~40 lines)
  20260530100002_add_finalization_columns.sql         NEW (~50 lines)
  20260530100003_backfill_finalization_cols.sql       NEW (~10 lines)

dashboard-web/src/lib/fetchers/
  fetchMeta.ts                                         NEW (~120 lines)
  meta.ts                                              ~6 lines edit (swap fetchWithBackoff → fetchMeta)

dashboard-web/src/lib/notifications/
  metaBucUsage.ts                                      NEW (~80 lines)
  detectAuthError.ts                                   ~2 lines edit
  tokenFailures.ts                                     ~5 lines edit (budget_skip op)

dashboard-web/src/lib/inngest/
  freshness.ts                                         NEW (~60 lines: recordFreshness + getFreshness)
  persistCampaignsLive.ts                              ~10 lines edit (source/is_finalized/last_live_tick_at on UPSERT)

dashboard-web/src/inngest/functions/
  cronLiveHeavy.ts                                     ~40 lines edit (pre-flight + stagger factory + freshness writes)
  cronDaily.ts                                         ~30 lines edit (finalization writes)
  cronLive.ts                                          ~15 lines edit (last_live_tick_at writes)

dashboard-web/src/app/operator/
  page.tsx                                             ~80 lines edit (Meta BUC panel + freshness panel)
  metaBucPanel.tsx                                     NEW (~120 lines)
  freshnessPanel.tsx                                   NEW (~100 lines)

dashboard-web/src/lib/fetchers/__tests__/
  fetchMeta.test.ts                                    NEW (~160 lines)

dashboard-web/src/lib/notifications/__tests__/
  metaBucUsage.test.ts                                 NEW (~100 lines)
  detectAuthError.test.ts                              ~15 lines added

dashboard-web/src/lib/inngest/__tests__/
  freshness.test.ts                                    NEW (~80 lines)

dashboard-web/src/inngest/functions/__tests__/
  cronLiveHeavyBudgetSkip.test.ts                      NEW (~120 lines)
  cronDailyMarksFinalized.test.ts                      NEW (~80 lines)
  cronLiveLiveTickAt.test.ts                           NEW (~60 lines)

docs/ROAS-Dashboard-User-Manual.md                     1 changelog (2.1.14 → 2.1.15)
```

**Estimated effort:**
- Pre-Phase A spike (Tasks 0.1-0.4): ~1 day (4h Meta + 2h TikTok + 2h Google + 1h flap audit)
- Phase A code: ~5-7 days focused work
- Visual verification: ~30 min
- Total Phase A delivery: 6-8 days

Phases B-E touchpoints will be detailed in their own plan documents when scheduled.
