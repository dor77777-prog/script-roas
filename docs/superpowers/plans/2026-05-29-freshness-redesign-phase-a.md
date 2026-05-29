# Freshness Redesign — Phase A: Foundation + Meta budget gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the foundation layer of the 10-min freshness redesign: header-aware Meta budget tracking (per-ad-account BUC), per-scope data_freshness, provenance columns (source / is_finalized / reconciled_at / last_live_tick_at) on the 4 daily tables, cron stagger for cron-live-heavy, and an /operator panel that surfaces all of this. After Phase A, the production `cron_live_heavy_rate_limit` panic WhatsApps stop firing, the dashboard's hidden staleness becomes visible, and the schema is ready for Phase B (registries + workers).

**Architecture:** Phase A code (Tasks 4-15) adds the schema, wraps Meta fetches with `fetchMeta` (parses `x-business-use-case-usage`), adds pre-flight budget skip to cron-live-heavy + cron-daily, staggers the 3 store crons, marks cron-daily output as `daily_reconcile/is_finalized=true`, and surfaces everything in /operator. cron-live (already `*/10`) gets only one minor edit: write `last_live_tick_at` on touched rows.

> **⚠ Pre-Phase A spike (Tasks 0-3): SKIPPED** by operator decision 2026-05-29. The dashboard has been running in production for a week+; the only reason to instrument was to confirm the exact JSON shape of `x-business-use-case-usage`. Research agents already documented 3 canonical shapes (`x-app-usage`, `x-business-use-case-usage` BUC, `x-fb-ads-insights-throttle`). Instead of waiting for fixtures, the `fetchMeta` parser (Task 8) is built **defensive across all 3 documented shapes** with a runtime warning to Sentry if a 4th unknown shape appears in production. If anything is surprising post-deploy, a quick Phase A.6 follow-up adjusts the parser. Tasks 0-3 below remain in the plan for historical reference but are explicitly **NOT** required before Task 4 starts.

**Tech Stack:** Next.js 15 + React 19, Inngest, Supabase Postgres + RPC functions, Vitest, OKLCH design tokens (reused from chart palette work).

**Reference spec:** [docs/superpowers/specs/2026-05-29-freshness-contract-incremental-sync-design.md](../specs/2026-05-29-freshness-contract-incremental-sync-design.md) (v3)

---

## File Structure

**New (Pre-Phase A spike outputs):**
- `docs/superpowers/specs/2026-05-29-platform-header-spike-findings.md` — 1-page summary of what real headers showed vs spec assumptions
- `dashboard-web/src/lib/fetchers/__fixtures__/meta-buc-headers-real.json` — captured BUC JSON shapes
- `dashboard-web/src/lib/fetchers/__fixtures__/meta-app-usage-headers-real.json` — captured x-app-usage JSON shapes
- `dashboard-web/src/lib/fetchers/__fixtures__/tiktok-rate-limit-headers-real.json` — captured TikTok headers
- `dashboard-web/src/lib/fetchers/__fixtures__/google-change-status-sample.json` — captured change_status response

**New (Phase A code):**
- `supabase/migrations/20260530100000_add_meta_buc_usage.sql` — `meta_buc_usage` table with `(store_id, ad_account_id)` composite PK
- `supabase/migrations/20260530100001_add_data_freshness.sql` — per-scope freshness tracker
- `supabase/migrations/20260530100002_add_finalization_columns.sql` — `source` / `reconciled_at` / `is_finalized` / `last_live_tick_at` on 4 existing daily tables
- `supabase/migrations/20260530100003_backfill_finalization_cols.sql` — mark historical rows as finalized
- `dashboard-web/src/lib/fetchers/fetchMeta.ts` — wraps `fetchWithBackoff`, parses BUC headers, throws `MetaBudgetHighError`
- `dashboard-web/src/lib/notifications/metaBucUsage.ts` — `recordMetaBucUsage` (write per-ad-account row) + `getMetaBucUsageForStore` (read MAX across rows)
- `dashboard-web/src/lib/inngest/freshness.ts` — `recordFreshness` / `getFreshness` helpers
- `dashboard-web/src/app/operator/metaBucPanel.tsx` — per-ad-account BUC display with progress bars
- `dashboard-web/src/app/operator/freshnessPanel.tsx` — per-(store, platform, scope) freshness matrix

**Modified (Phase A code):**
- `dashboard-web/src/lib/fetchers/meta.ts` — swap the 4 `fetchWithBackoff` calls for `fetchMeta`
- `dashboard-web/src/lib/notifications/detectAuthError.ts` — add `META_BUDGET_HIGH` substring to `isRateLimitError`
- `dashboard-web/src/lib/notifications/tokenFailures.ts` — skip WhatsApp send for `cron_*_budget_skip` operation
- `dashboard-web/src/lib/inngest/persistCampaignsLive.ts` — write `source='live_tick'` + `last_live_tick_at`
- `dashboard-web/src/inngest/functions/cronLiveHeavy.ts` — pre-flight skip + stagger factory
- `dashboard-web/src/inngest/functions/cronDaily.ts` — write `is_finalized=true` + `source='daily_reconcile'` + `reconciled_at` on yesterday's upserts; also pre-flight skip
- `dashboard-web/src/inngest/functions/cronLive.ts` — write `last_live_tick_at` on touched data_daily rows
- `dashboard-web/src/app/operator/page.tsx` — mount the 2 new panels
- `docs/ROAS-Dashboard-User-Manual.md` — bump 2.1.14 → 2.1.15 with Phase A changelog

**Out of scope (Phases B-E):**
- `campaign_registry` / `adset_registry` / `ad_registry` / `campaign_status_events` / `cron_tick_snapshots` tables (Phase B)
- `cron-tick-orchestrator` + workers (Phase B)
- Hot metrics + `getHotCampaignIds` SQL (Phase C)
- Live products + dashboard UI integration (Phase D)
- Rolling reconcile (Phase E)

---

## Task 0: Pre-Phase A spike — Meta BUC + x-app-usage headers (4h) — SKIPPED

> ⚠ Skipped. See plan header. Kept for historical reference.

## ~~Task 0: Pre-Phase A spike~~ (skipped)

**Files:**
- Create: `dashboard-web/src/lib/fetchers/__fixtures__/meta-buc-headers-real.json`
- Create: `dashboard-web/src/lib/fetchers/__fixtures__/meta-app-usage-headers-real.json`
- Modify temporarily: `dashboard-web/src/lib/fetchers/withBackoff.ts` (log headers — REMOVED at end of task)

- [ ] **Step 1: Add temporary header-logging block to `withBackoff.ts`**

In `dashboard-web/src/lib/fetchers/withBackoff.ts`, immediately after the `fetch(url, init)` call returns and before any other handling, add:

```typescript
// HEADER SPIKE 2026-05-29 — REMOVE AFTER TASK 0 COMPLETE
if (url.includes('graph.facebook.com') && res.status === 200) {
  const allHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => { allHeaders[k] = v; });
  console.log('[HEADER-SPIKE-META]', JSON.stringify({
    timestamp: new Date().toISOString(),
    url: url.split('?')[0],          // strip query for privacy
    method: init?.method ?? 'GET',
    'x-app-usage': res.headers.get('x-app-usage'),
    'x-business-use-case-usage': res.headers.get('x-business-use-case-usage'),
    'x-fb-ads-insights-throttle': res.headers.get('x-fb-ads-insights-throttle'),
    'x-ad-account-usage': res.headers.get('x-ad-account-usage'),
    allHeaders,
  }));
}
```

- [ ] **Step 2: Commit + deploy the spike**

```bash
git add dashboard-web/src/lib/fetchers/withBackoff.ts
git commit -m "spike(headers): temporary Meta header logging for Pre-Phase A discovery

NOT FOR LONG-TERM RETENTION. Reverted in the next commit after enough
real samples have been captured to verify the freshness redesign spec's
BUC claims against production data.

Spec: docs/superpowers/specs/2026-05-29-freshness-contract-incremental-sync-design.md
(Pre-Phase A discovery section, Task 0.1)"
git push origin main
```

Wait for Vercel deploy (~2 min).

- [ ] **Step 3: Wait for 4 hours of production traffic**

cron-live runs every 10 min × 3 stores × ~6 platform calls/tick ≈ 108 Meta calls/h. Across 4 hours: ~432 samples. Plenty of variety.

- [ ] **Step 4: Pull the logs + extract samples**

From the local terminal:

```bash
# Pull Vercel function logs from the last 4 hours
vercel logs --since=4h | grep '[HEADER-SPIKE-META]' > /tmp/header-spike-raw.log
wc -l /tmp/header-spike-raw.log  # should be 400+
```

- [ ] **Step 5: Write the fixture files**

Create `dashboard-web/src/lib/fetchers/__fixtures__/meta-buc-headers-real.json`. Pick 20 representative samples across:
- 3 stores
- `/insights` endpoint (heavy)
- `/campaigns` endpoint (light)
- High-budget periods (>50% usage) and low-budget periods (<20% usage)

The file structure:

```json
{
  "captured_at": "2026-05-30T08:00:00Z",
  "purpose": "Verify x-business-use-case-usage shape against production data before writing fetchMeta wrapper",
  "samples": [
    {
      "store_id": "uzoshop",
      "endpoint_pattern": "act_<id>/insights",
      "x_app_usage": { "call_count": 28, "total_time": 25, "total_cputime": 25 },
      "x_business_use_case_usage": {
        "<ad_account_id>": [
          { "type": "ads_insights", "call_count": 100, "total_cputime": 25, "total_time": 25, "estimated_time_to_regain_access": 19, "ads_api_access_tier": "standard_access" },
          { "type": "ads_management", "call_count": 12, "total_cputime": 14, "total_time": 11, "estimated_time_to_regain_access": 0, "ads_api_access_tier": "standard_access" }
        ]
      },
      "x_fb_ads_insights_throttle": { "app_id_util_pct": 100, "acc_id_util_pct": 10, "ads_api_access_tier": "standard_access" }
    }
    // ... 19 more
  ]
}
```

Create `dashboard-web/src/lib/fetchers/__fixtures__/meta-app-usage-headers-real.json` for the `x-app-usage`-only samples (useful if BUC is absent for some calls).

- [ ] **Step 6: Decision gate — write findings doc**

Create `docs/superpowers/specs/2026-05-29-platform-header-spike-findings.md`. Document:

1. Did EVERY 200 response carry `x-business-use-case-usage`? Or only some?
2. Were BOTH `ads_insights` AND `ads_management` BUCs present, or sometimes one alone?
3. What were the observed maxima for `call_count`, `total_cputime`, `total_time` during the spike window?
4. Did we hit `estimated_time_to_regain_access > 0` at any point? At what `call_count` percentage?
5. Was `x-fb-ads-insights-throttle` always present alongside BUC, or did one replace the other?

**Decision:** if BUC was absent or unreliable, the spec is amended to fall back to `x-app-usage` as the primary signal. Write the amendment as a delta to the spec in the same findings doc.

- [ ] **Step 7: Revert the spike commit**

```bash
git revert HEAD --no-edit
git push origin main
```

(Don't squash — we want the spike commit to remain in history for auditability.)

- [ ] **Step 8: Commit the fixtures + findings**

```bash
git add dashboard-web/src/lib/fetchers/__fixtures__/meta-buc-headers-real.json \
        dashboard-web/src/lib/fetchers/__fixtures__/meta-app-usage-headers-real.json \
        docs/superpowers/specs/2026-05-29-platform-header-spike-findings.md
git commit -m "$(cat <<'EOF'
spike(headers): Meta BUC header fixtures + Pre-Phase A findings

Captured 4 hours of production Meta API response headers across 3 stores
and both /insights + /campaigns endpoints. Fixtures shape the fetchMeta
parser tests we'll write in Task 6.

Findings (see findings doc):
  - x-business-use-case-usage present on EVERY 200 / ABSENT on EVERY 200
  - Both ads_insights AND ads_management BUCs in same response / SOMETIMES JUST ONE
  - Peak call_count observed: XX% (during business hours, store=X)
  - estimated_time_to_regain_access non-zero at call_count >= XX%

Spec amendments noted in the findings doc; carried into Phase A code.

Spec: docs/superpowers/specs/2026-05-29-freshness-contract-incremental-sync-design.md
EOF
)"
```

---

## Task 1: Pre-Phase A spike — TikTok rate-limit headers (2h)

**Files:**
- Create: `dashboard-web/src/lib/fetchers/__fixtures__/tiktok-rate-limit-headers-real.json`
- Modify temporarily: `dashboard-web/src/lib/fetchers/withBackoff.ts`

- [ ] **Step 1: Add TikTok header logging**

Modify the spike block from Task 0:

```typescript
if (url.includes('business-api.tiktok.com')) {
  const allHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => { allHeaders[k] = v; });
  console.log('[HEADER-SPIKE-TIKTOK]', JSON.stringify({
    timestamp: new Date().toISOString(),
    url: url.split('?')[0],
    status: res.status,
    'x-ratelimit-remaining': res.headers.get('x-ratelimit-remaining'),
    'x-ratelimit-reset': res.headers.get('x-ratelimit-reset'),
    'x-tt-logid': res.headers.get('x-tt-logid'),
    'retry-after': res.headers.get('retry-after'),
    allHeaders,
  }));
}
```

- [ ] **Step 2: Commit + deploy + wait 2h + pull logs + write fixtures**

Same procedure as Task 0 steps 2-5. Look for:
- Does TikTok send `X-RateLimit-Remaining` on **200 OK** responses, or **only on 429**?
- Are header names case-sensitive in Node's `res.headers.get(...)` (HTTP/2 lowercases everything)?
- Does `X-Tt-Logid` appear on every response and could it be useful for debugging?

- [ ] **Step 3: Write findings into the same findings doc (append section "TikTok")**

**Decision gate:** if `X-RateLimit-Remaining` is absent on 200 responses (which is the most likely outcome per the research agent's caveat), the spec degrades gracefully to react-on-429-only. No new code needed in Phase A — we already have `fetchWithBackoff` retry on 429.

- [ ] **Step 4: Revert spike + commit fixtures**

Same procedure as Task 0 steps 7-8.

---

## Task 2: Pre-Phase A spike — Google Ads change_status latency (2h)

**Files:**
- Create: `dashboard-web/src/lib/fetchers/__fixtures__/google-change-status-sample.json`

- [ ] **Step 1: Open Google Ads UI for uzoshop, pause one campaign manually**

Note the exact time of the pause.

- [ ] **Step 2: Run ad-hoc GAQL query via a one-shot Node script**

Create a throwaway script `scripts/google-change-status-spike.ts`:

```typescript
import { fetchGoogleAdsAdGroupInsights } from '@/lib/fetchers/googleAds';
// ... reuse the OAuth + query infra

const customerId = process.env.UZOSHOP_GOOGLEADS_CUSTOMER_ID!;
const query = `
  SELECT change_status.resource_name,
         change_status.last_change_date_time,
         change_status.resource_type,
         change_status.resource_status,
         change_status.campaign,
         change_status.ad_group,
         change_status.ad_group_ad
  FROM change_status
  WHERE change_status.last_change_date_time > '${new Date(Date.now() - 1000*60*60).toISOString().slice(0,19).replace('T', ' ')}'
  ORDER BY change_status.last_change_date_time DESC
  LIMIT 100
`;

const result = await searchStream(customerId, query);
console.log(JSON.stringify(result, null, 2));
```

Run every 30 sec for 10 min, watching for the pause action to appear in `change_status`.

- [ ] **Step 3: Note the observed latency**

Confirm: Google's documented "~3 min latency" matches reality? Capture the actual latency in seconds.

- [ ] **Step 4: Save the response sample + write findings**

Create `dashboard-web/src/lib/fetchers/__fixtures__/google-change-status-sample.json` with one full response payload, and document findings in the findings doc.

- [ ] **Step 5: Delete the throwaway script + commit fixtures**

```bash
rm scripts/google-change-status-spike.ts
git add dashboard-web/src/lib/fetchers/__fixtures__/google-change-status-sample.json
git commit -m "spike(headers): Google Ads change_status latency sample + findings

Documented observed latency from pause action to change_status row appearance.
Used to size Phase C's google-worker watermark advancement strategy.

Spec: docs/superpowers/specs/2026-05-29-freshness-contract-incremental-sync-design.md"
```

---

## Task 3: Pre-Phase A spike — Meta status flap audit (1h)

**Files:** No new files (just findings appended to the doc)

- [ ] **Step 1: Query existing campaigns_daily for status flapping**

Run via psql or Supabase SQL editor:

```sql
SELECT date, store_id, campaign_id, effective_status, updated_at
  FROM campaigns_daily
 WHERE store_id = 'uzoshop' AND platform = 'meta'
   AND date >= CURRENT_DATE - 1
 ORDER BY campaign_id, updated_at DESC;
```

Look for: same campaign_id with effective_status flipping ACTIVE → PENDING_REVIEW → ACTIVE within a single day.

- [ ] **Step 2: Decide dedupe window**

If sub-minute flaps observed: tighten `campaign_status_events.dedupe_key` to 5-min bucket. Update the spec accordingly.

If only multi-minute flaps: keep the 1-min bucket as specified.

- [ ] **Step 3: Append findings to the findings doc + commit**

```bash
git add docs/superpowers/specs/2026-05-29-platform-header-spike-findings.md
git commit -m "spike(headers): Meta status flap audit findings (1-min vs 5-min dedupe)

Documented observed flap cadence for campaign_status_events.dedupe_key
bucket sizing. [Outcome: 1-min OK | tightened to 5-min].

Spec: docs/superpowers/specs/2026-05-29-freshness-contract-incremental-sync-design.md"
```

---

## ✋ Phase A code gate: all 4 spike fixtures + findings doc merged before Task 4

Before Task 4, the implementer MUST confirm:

- [ ] `dashboard-web/src/lib/fetchers/__fixtures__/meta-buc-headers-real.json` exists
- [ ] `dashboard-web/src/lib/fetchers/__fixtures__/meta-app-usage-headers-real.json` exists
- [ ] `dashboard-web/src/lib/fetchers/__fixtures__/tiktok-rate-limit-headers-real.json` exists
- [ ] `dashboard-web/src/lib/fetchers/__fixtures__/google-change-status-sample.json` exists
- [ ] `docs/superpowers/specs/2026-05-29-platform-header-spike-findings.md` exists and contains amendments (or "no amendments needed")
- [ ] The spec was updated with any amendments before Phase A code starts

---

## Task 4: Migration — `meta_buc_usage` table + RPCs

**Files:**
- Create: `supabase/migrations/20260530100000_add_meta_buc_usage.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260530100000_add_meta_buc_usage.sql`:

```sql
-- Phase A: Meta BUC usage tracker.
-- Composite PK (store_id, ad_account_id) — today 1:1, tomorrow potentially N:1.
-- See: docs/superpowers/specs/2026-05-29-freshness-contract-incremental-sync-design.md

CREATE TABLE IF NOT EXISTS meta_buc_usage (
  store_id text NOT NULL,
  ad_account_id text NOT NULL,
  ads_insights_call_pct numeric(5,2) NOT NULL DEFAULT 0,
  ads_insights_cputime_pct numeric(5,2) NOT NULL DEFAULT 0,
  ads_insights_time_pct numeric(5,2) NOT NULL DEFAULT 0,
  ads_insights_eta_minutes integer DEFAULT 0,
  ads_management_call_pct numeric(5,2) NOT NULL DEFAULT 0,
  ads_management_cputime_pct numeric(5,2) NOT NULL DEFAULT 0,
  ads_management_time_pct numeric(5,2) NOT NULL DEFAULT 0,
  ads_management_eta_minutes integer DEFAULT 0,
  last_url text,
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, ad_account_id)
);

CREATE INDEX idx_meta_buc_usage_store ON meta_buc_usage (store_id);

COMMENT ON TABLE meta_buc_usage IS 'Latest x-business-use-case-usage snapshot per (store, ad_account_id). Read by getMetaBucUsageForStore which aggregates MAX across rows for a store.';
```

- [ ] **Step 2: Apply migration locally**

```bash
cd dashboard-web && npx supabase db push
```

Verify with:

```bash
psql $DATABASE_URL -c "\d meta_buc_usage"
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260530100000_add_meta_buc_usage.sql
git commit -m "feat(schema): add meta_buc_usage table (composite PK store+ad_account)

Per-ad-account BUC tracker for Phase A budget gating. Composite primary key
allows multi-account-per-store evolution without schema change. Indexed
by store_id for the per-store MAX aggregation read pattern.

Spec: docs/superpowers/specs/2026-05-29-freshness-contract-incremental-sync-design.md"
```

---

## Task 5: Migration — `data_freshness` table

**Files:**
- Create: `supabase/migrations/20260530100001_add_data_freshness.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Phase A: per-scope data freshness tracker.

CREATE TABLE IF NOT EXISTS data_freshness (
  store_id text NOT NULL,
  platform text NOT NULL,
  scope text NOT NULL,
  table_name text NOT NULL,
  last_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_success_at timestamptz,
  status text NOT NULL,
  lag_minutes integer,
  error_code text,
  error_message text,
  budget_skip boolean DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, platform, scope, table_name)
);

CREATE INDEX idx_data_freshness_stale ON data_freshness (lag_minutes DESC NULLS LAST)
  WHERE status != 'success';

CREATE INDEX idx_data_freshness_budget_skip ON data_freshness (last_updated_at DESC)
  WHERE budget_skip = true;

COMMENT ON COLUMN data_freshness.scope IS 'kpi_daily | campaign_status | campaign_metrics | adset_status | adset_metrics | ad_status | ad_metrics | product_live | product_daily | daily_reconcile | weekly_reconcile';
```

- [ ] **Step 2-3: Apply + commit** (same pattern as Task 4)

---

## Task 6: Migration — finalization columns on 4 daily tables

**Files:**
- Create: `supabase/migrations/20260530100002_add_finalization_columns.sql`
- Create: `supabase/migrations/20260530100003_backfill_finalization_cols.sql`

- [ ] **Step 1: Write the ALTER migration**

```sql
-- Phase A: add provenance + finalization columns to all 4 daily tables.
-- 'source' enum (text-encoded, not Postgres ENUM to allow future values):
--   'live_tick' | 'daily_reconcile' | 'weekly_reconcile' | 'backfill' | 'manual_override'

ALTER TABLE data_daily
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'live_tick',
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_finalized boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_live_tick_at timestamptz;

ALTER TABLE campaigns_daily
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'live_tick',
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_finalized boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_live_tick_at timestamptz;

ALTER TABLE ads_daily
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'live_tick',
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_finalized boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_live_tick_at timestamptz;

ALTER TABLE products_daily
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'live_tick',
  ADD COLUMN IF NOT EXISTS reconciled_at timestamptz,
  ADD COLUMN IF NOT EXISTS is_finalized boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_live_tick_at timestamptz;
```

- [ ] **Step 2: Write the backfill migration**

```sql
-- Backfill: anything strictly before yesterday is treated as finalized by cron-daily.
-- This is a one-shot backfill; new rows are written with explicit source values by
-- cron-daily / cron-live.

UPDATE data_daily       SET is_finalized = true, source = 'daily_reconcile', reconciled_at = updated_at WHERE date < CURRENT_DATE - 1 AND is_finalized = false;
UPDATE campaigns_daily  SET is_finalized = true, source = 'daily_reconcile', reconciled_at = updated_at WHERE date < CURRENT_DATE - 1 AND is_finalized = false;
UPDATE ads_daily        SET is_finalized = true, source = 'daily_reconcile', reconciled_at = updated_at WHERE date < CURRENT_DATE - 1 AND is_finalized = false;
UPDATE products_daily   SET is_finalized = true, source = 'daily_reconcile', reconciled_at = updated_at WHERE date < CURRENT_DATE - 1 AND is_finalized = false;
```

- [ ] **Step 3: Apply both migrations**

```bash
cd dashboard-web && npx supabase db push
```

- [ ] **Step 4: Sanity-check the backfill**

```bash
psql $DATABASE_URL -c "SELECT source, COUNT(*) FROM data_daily WHERE date < CURRENT_DATE - 1 GROUP BY source;"
# Expected: all rows source = 'daily_reconcile'
```

- [ ] **Step 5: Commit both migrations together**

```bash
git add supabase/migrations/20260530100002_add_finalization_columns.sql \
        supabase/migrations/20260530100003_backfill_finalization_cols.sql
git commit -m "feat(schema): add source + reconciled_at + is_finalized + last_live_tick_at to 4 daily tables

Phase A foundation for dashboard distinction between live/reconciled/finalized
data. Backfill marks all historical rows (date < yesterday) as already finalized
via daily_reconcile, so the dashboard's 'live vs reconciled' UI in Phase D
already has historical data labelled correctly.

Spec: docs/superpowers/specs/2026-05-29-freshness-contract-incremental-sync-design.md"
```

---

## Task 7: `metaBucUsage.ts` helpers + tests (TDD)

**Files:**
- Create: `dashboard-web/src/lib/notifications/metaBucUsage.ts`
- Create: `dashboard-web/src/lib/notifications/__tests__/metaBucUsage.test.ts`

- [ ] **Step 1: Write the failing tests first**

Create `dashboard-web/src/lib/notifications/__tests__/metaBucUsage.test.ts`:

```typescript
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { recordMetaBucUsage, getMetaBucUsageForStore } from '../metaBucUsage';

vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: vi.fn(),
}));

describe('metaBucUsage', () => {
  // ... full test bodies covering:
  //   - recordMetaBucUsage upserts with composite key (store_id, ad_account_id)
  //   - getMetaBucUsageForStore returns MAX across rows
  //   - getMetaBucUsageForStore returns null when store has no rows
  //   - getMetaBucUsageForStore swallows Supabase errors
  //   - recordMetaBucUsage swallows Supabase errors
});
```

(Full test bodies in [the spec's test surface section](../specs/2026-05-29-freshness-contract-incremental-sync-design.md#test-surface).)

- [ ] **Step 2: Run tests — confirm RED**

```bash
cd dashboard-web && npm test -- src/lib/notifications/__tests__/metaBucUsage.test.ts
# Expected: all 5 tests FAIL (module not found)
```

- [ ] **Step 3: Implement `metaBucUsage.ts`**

```typescript
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

export async function recordMetaBucUsage(snapshot: {
  store_id: string;
  ad_account_id: string;
  ads_insights_call_pct: number;
  ads_insights_cputime_pct: number;
  ads_insights_time_pct: number;
  ads_insights_eta_minutes: number;
  ads_management_call_pct: number;
  ads_management_cputime_pct: number;
  ads_management_time_pct: number;
  ads_management_eta_minutes: number;
  last_url: string;
}): Promise<void> {
  try {
    const sb = getSupabaseAdmin();
    await sb.from('meta_buc_usage').upsert({
      ...snapshot,
      last_updated_at: new Date().toISOString(),
    }, { onConflict: 'store_id,ad_account_id' });
  } catch (e) {
    console.warn('[recordMetaBucUsage] upsert failed:', e);
  }
}

export async function getMetaBucUsageForStore(storeId: string): Promise<{
  max_ads_insights_call_pct: number;
  max_ads_insights_cputime_pct: number;
  max_ads_insights_time_pct: number;
  max_ads_management_call_pct: number;
  max_ads_management_cputime_pct: number;
  max_ads_management_time_pct: number;
  max_eta_minutes: number;
  rows: Array<Record<string, unknown>>;
} | null> {
  try {
    const sb = getSupabaseAdmin();
    const { data } = await sb.from('meta_buc_usage').select('*').eq('store_id', storeId);
    if (!data?.length) return null;
    return {
      max_ads_insights_call_pct: Math.max(...data.map(r => r.ads_insights_call_pct ?? 0)),
      max_ads_insights_cputime_pct: Math.max(...data.map(r => r.ads_insights_cputime_pct ?? 0)),
      max_ads_insights_time_pct: Math.max(...data.map(r => r.ads_insights_time_pct ?? 0)),
      max_ads_management_call_pct: Math.max(...data.map(r => r.ads_management_call_pct ?? 0)),
      max_ads_management_cputime_pct: Math.max(...data.map(r => r.ads_management_cputime_pct ?? 0)),
      max_ads_management_time_pct: Math.max(...data.map(r => r.ads_management_time_pct ?? 0)),
      max_eta_minutes: Math.max(...data.map(r => Math.max(
        r.ads_insights_eta_minutes ?? 0,
        r.ads_management_eta_minutes ?? 0
      ))),
      rows: data,
    };
  } catch (e) {
    console.warn('[getMetaBucUsageForStore] read failed:', e);
    return null;
  }
}
```

- [ ] **Step 4: Run tests — confirm GREEN**

```bash
cd dashboard-web && npm test -- src/lib/notifications/__tests__/metaBucUsage.test.ts
# Expected: 5/5 PASS
```

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/lib/notifications/metaBucUsage.ts \
        dashboard-web/src/lib/notifications/__tests__/metaBucUsage.test.ts
git commit -m "feat(notifications): metaBucUsage helpers (per-ad-account BUC tracking)

recordMetaBucUsage upserts per (store_id, ad_account_id) composite key.
getMetaBucUsageForStore returns MAX(pct) across rows — worker uses this to
gate the whole store on the WORST ad-account's BUC (pessimistic but correct).

Tests: 5/5 covering upsert, MAX aggregation, null-when-empty, error swallow.

Spec: docs/superpowers/specs/2026-05-29-freshness-contract-incremental-sync-design.md"
```

---

## Task 8: `fetchMeta.ts` wrapper + tests (TDD)

**Files:**
- Create: `dashboard-web/src/lib/fetchers/fetchMeta.ts`
- Create: `dashboard-web/src/lib/fetchers/__tests__/fetchMeta.test.ts`

(Full task body follows the same TDD red-green-commit shape as Task 7. Tests cover: parses `x-business-use-case-usage` correctly across the captured fixture shapes; throws `MetaBudgetHighError` when relevant BUC >= 80; doesn't throw when BUC < 80; falls back to `x-app-usage` if BUC absent — based on findings doc; persists per-ad-account via `recordMetaBucUsage`; resolves `ad_account_id` from URL via `extractAdAccountIdFromUrl` helper.)

- [ ] **Step 1: Write the failing tests**
- [ ] **Step 2: Run RED**
- [ ] **Step 3: Implement `fetchMeta.ts`** (full code in spec section "Meta - fetchMeta wrapper")
- [ ] **Step 4: Run GREEN**
- [ ] **Step 5: Commit**

(Plan body abbreviated here — implementer reads the spec's `fetchMeta` snippet and the captured fixtures, writes the parser to handle BOTH shapes the spike captured.)

---

## Task 9: Wire `meta.ts` to use `fetchMeta`

**Files:**
- Modify: `dashboard-web/src/lib/fetchers/meta.ts`

- [ ] **Step 1: Swap the 4 `fetchWithBackoff` calls for `fetchMeta`** (lines ~349, ~541, ~685, ~766 per the codebase map)
- [ ] **Step 2: Run full suite — confirm no regressions**

```bash
cd dashboard-web && npm test
```

- [ ] **Step 3: Commit**

---

## Task 10: `freshness.ts` helpers + tests (TDD)

**Files:**
- Create: `dashboard-web/src/lib/inngest/freshness.ts`
- Create: `dashboard-web/src/lib/inngest/__tests__/freshness.test.ts`

(Body: `recordFreshness(storeId, platform, scope, status, errorMsg)` upserts per `(store, platform, scope, table)`; `getFreshness(scope?)` reads. Tests cover idempotency + lag computation. Same TDD shape as Task 7.)

---

## Task 11: `detectAuthError` + `tokenFailures` — add budget_skip path

**Files:**
- Modify: `dashboard-web/src/lib/notifications/detectAuthError.ts`
- Modify: `dashboard-web/src/lib/notifications/tokenFailures.ts`

(Body: add `META_BUDGET_HIGH` substring to `isRateLimitError`. Add gate in `notifyTokenFailure` that skips WhatsApp send for operations matching `/_budget_skip$/`. Tests in the existing `detectAuthError.test.ts`.)

---

## Task 12: `cronLiveHeavy.ts` — pre-flight skip + stagger factory

**Files:**
- Modify: `dashboard-web/src/inngest/functions/cronLiveHeavy.ts`
- Create: `dashboard-web/src/inngest/functions/__tests__/cronLiveHeavyBudgetSkip.test.ts`

(Body: add pre-flight `getMetaBucUsageForStore` check + skip Meta block if usage >= 80 within last 15 min. Stagger factory: uzoshop `0,30 * * * *`, zolplus `10,40 * * * *`, usmile360 `20,50 * * * *`. Test covers: when usage row is high, Meta NOT fetched, Google + TikTok ARE fetched, `data_freshness` gets `budget_skip` row.)

---

## Task 13: `cronDaily.ts` — finalization writes + pre-flight skip

**Files:**
- Modify: `dashboard-web/src/inngest/functions/cronDaily.ts`
- Create: `dashboard-web/src/inngest/functions/__tests__/cronDailyMarksFinalized.test.ts`

(Body: pre-flight check (same shape as Task 12). Add `source: 'daily_reconcile'`, `is_finalized: true`, `reconciled_at: new Date()` to every upsert payload in `persistDayForStore`. Test: cron-daily output for yesterday is marked finalized.)

---

## Task 14: `cronLive.ts` + `persistCampaignsLive.ts` — write `last_live_tick_at`

**Files:**
- Modify: `dashboard-web/src/inngest/functions/cronLive.ts`
- Modify: `dashboard-web/src/lib/inngest/persistCampaignsLive.ts`
- Create: `dashboard-web/src/inngest/functions/__tests__/cronLiveLiveTickAt.test.ts`

(Body: add `last_live_tick_at: new Date()` to the data_daily upsert in cron-live and the campaigns_daily upsert in persistCampaignsLive. Source stays default `'live_tick'`. Test: rows touched by cron-live have `last_live_tick_at` set.)

---

## Task 15: /operator panels (Meta BUC + freshness matrix)

**Files:**
- Create: `dashboard-web/src/app/operator/metaBucPanel.tsx`
- Create: `dashboard-web/src/app/operator/freshnessPanel.tsx`
- Modify: `dashboard-web/src/app/operator/page.tsx`

(Body: 2 new server components. metaBucPanel reads from `meta_buc_usage` directly (server-side) and renders progress bars per (store, ad_account_id). freshnessPanel reads from `data_freshness` and renders the matrix. Mount both in page.tsx between the existing TokenFailuresTable and JobsTable sections.)

---

## Task 16: User Manual 2.1.15 bump + full verification gate

**Files:**
- Modify: `docs/ROAS-Dashboard-User-Manual.md`

- [ ] **Step 1: User Manual changelog**

Bump 2.1.14 → 2.1.15. Add a section: "Phase A: Meta budget tracking + /operator visibility + reconciliation finalization."

- [ ] **Step 2: Full verification gate**

```bash
cd dashboard-web && npm test && npm run typecheck && npm run build
```

Expected: ~1,320 tests pass (1,307 + ~13 new from this plan). typecheck clean. build clean.

- [ ] **Step 3: Production deploy**

```bash
git push origin main
```

Wait for Vercel. Then:

1. Visit `https://roas-dashboard-smoky.vercel.app/operator` — confirm the 2 new panels render.
2. Wait 10 min for the first cron-live cycle — confirm `meta_buc_usage` rows appear with non-zero pct values.
3. Confirm `last_live_tick_at` is being written on touched `data_daily` rows.
4. Wait until midnight UTC + 30 min — confirm cron-daily writes `source='daily_reconcile'` + `is_finalized=true` on yesterday's rows.
5. Watch for any `cron_live_heavy_rate_limit` WhatsApp alerts over the next 24h. Acceptance is: zero alerts (or at most one, if a transient spike happens before the budget-skip gate engages).

- [ ] **Step 4: Update memory**

Add to `~/.claude/projects/-Users-dorperetz-script-roas/memory/MEMORY.md`:

```markdown
- [Freshness redesign Phase A SHIPPED 2026-XX-XX](project_freshness_phase_a_shipped.md) — meta_buc_usage + data_freshness + finalization cols + /operator panels. Spec docs/superpowers/specs/2026-05-29-freshness-contract-incremental-sync-design.md. Phases B-E pending.
```

---

## Acceptance summary (Phase A complete when)

1. ✅ All 4 Pre-Phase A fixture files + findings doc committed; spec amended if needed.
2. ✅ 4 migrations applied to production Supabase; backfill confirmed.
3. ✅ 16 task commits on main; all pre-push gates green.
4. ✅ ~1,320 tests pass (1,307 baseline + ~13 new); typecheck + build clean.
5. ✅ /operator panel shows live Meta BUC values for all 3 stores within 10 min of deploy.
6. ✅ /operator freshness panel populated by every cron tick.
7. ✅ Yesterday's data_daily rows marked `source='daily_reconcile'` + `is_finalized=true` after midnight + 30 min.
8. ✅ Today's data_daily rows marked `source='live_tick'` + `last_live_tick_at` non-null.
9. ✅ Zero `cron_live_heavy_rate_limit` panic WhatsApps over the next 24h (or at most 1 transient).
10. ✅ User Manual 2.1.15 published.

Phase B plan written and reviewed before Phase B code starts.
