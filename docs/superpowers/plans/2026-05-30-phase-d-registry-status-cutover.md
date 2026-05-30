# Phase D — Registry-Status Cutover — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut over every UI surface that displays campaign / adset / ad **status** from reading `effective_status` on the 3 `*_daily` tables (which lag by up to one `cron-live-heavy` cycle = ~30 min) to reading `effective_status` / `configured_status` / `delivery_status` from the 3 registries written by Phase B/C workers (which refresh every ~10 min via `cron-tick-orchestrator`).

**Architecture:** 4 layers — (1) one-time SQL **backfill** brings `campaign_registry` / `adset_registry` / `ad_registry` to parity with the underlying daily tables; (2) PostgreSQL `AFTER INSERT` **triggers** keep parity going forward (zero-window) when cron-daily / cron-live invents a brand-new tuple; (3) 3 database `VIEW`s — `campaigns_enriched`, `adsets_enriched`, `ads_enriched` — `LEFT JOIN` the daily to the registry server-side and expose `reg_*` columns; (4) all reads (`postgresReaders.ts`, downstream aggregators, components) flip from the bare daily to the enriched view and from `effectiveStatus` to `regEffectiveStatus` / `regDeliveryStatus`. Writers (Inngest workers + cron-daily + cron-live) are **untouched** — they continue writing to `*_daily` and the registries exactly as they do today.

**Schema reality** (verified 2026-05-30 against `supabase/migrations/`): there is no `adsets_daily` table — ad-set data lives **inside `campaigns_daily`**, whose PK is `(date, store_id, platform, campaign_id, ad_set_id)`. `ads_daily` exists but has **no `effective_status` column** — only `campaigns_daily` does (added in migration `20260522180000`). Consequently: `adset_registry` is backfilled from `campaigns_daily` (grouped by `ad_set_id`); `ad_registry` backfill is **keys-only** because there's no source `effective_status` to copy (status workers fill it going forward); triggers on `ads_daily` populate `ad_registry` rows with NULL status fields.

**Tech Stack:** Same as Phase B/C — Next.js 15 + Inngest 4.4 + Supabase + TypeScript + Vitest + Hebrew RTL UI tokens.

**Spec:** [`docs/superpowers/specs/2026-05-30-phase-d-registry-status-cutover-design.md`](../specs/2026-05-30-phase-d-registry-status-cutover-design.md).

---

## File structure

### New files

```
supabase/migrations/
├── 20260530250000_phase_d_backfill_registries.sql                    # Task 1
├── 20260530260000_phase_d_auto_coverage_triggers.sql                 # Task 2
└── 20260530270000_phase_d_enriched_views.sql                         # Task 3

dashboard-web/src/lib/registries/
└── statusClassification.ts                                           # Task 8 (shared mapper)
└── __tests__/statusClassification.test.ts

dashboard-web/src/lib/audit/__tests__/
└── registryCoverageParity.live.test.ts                               # Task 14

dashboard-web/src/components/__tests__/
└── campaignDrawerStatusSectionFull.test.tsx                          # Task 13
```

### Modified files

```
dashboard-web/src/lib/postgresReaders.ts                              # Task 5, 6, 7
dashboard-web/src/lib/campaigns.ts                                    # Task 5 (CampaignRow shape)
dashboard-web/src/lib/campaignsAggregator.ts                          # Task 9 (Aggregated shape + plumbing)
dashboard-web/src/components/CampaignsTableRow.tsx                    # Task 10
dashboard-web/src/components/CampaignDrawer.tsx                       # Task 11
dashboard-web/src/components/CampaignDrawerStatusSection.tsx          # Task 13
dashboard-web/src/components/ProductCentricView.tsx                   # Task 12
dashboard-web/src/components/CohortComparisonPanel.tsx                # Task 12

docs/ARCHITECTURE.md                                                  # Task 15
docs/ROAS-Dashboard-User-Manual.md                                    # Task 15
```

### Untouched (writers stay on daily tables)

```
dashboard-web/src/inngest/functions/{cronDaily,cronLive,metaWorker,googleWorker,tiktokWorker}.ts
dashboard-web/src/lib/inngest/persistCampaignsLive.ts
dashboard-web/src/lib/registries/{upsert,diff,types,hotSet,priorityBuilder}.ts
```

---

## Sequencing & rollback

**Order of operations.** Tasks **1 → 4** ship the DB layer in a single PR (3 migrations) and apply to prod **before** any code is changed. This way, at the moment the code cutover lands, every campaign / adset / ad already has a `reg_*` row (backfill) and any brand-new row inserted will get one within the same transaction (trigger). Tasks **5 → 13** ship the code cutover. Task **14** extends the live reconcile harness. Tasks **15 → 16** ship docs + deploy.

**Per-task commit.** Each task ends with `git commit`. Smaller commits make Phase C-style "find which commit broke the operator panel" debugging trivial.

**Rollback.** If post-deploy a regression is observed, revert the Task 10 / 11 / 12 commits (frontend) and / or Task 5-7 commits (postgresReaders). VIEWs + triggers + backfilled rows stay in the DB — they harm nothing while idle and let us roll forward again instantly. See §6 of the spec.

---

## Task 1: Migration A — backfill the 3 registries from the dailies

**Files:**
- Create: `supabase/migrations/20260530250000_phase_d_backfill_registries.sql`

The migration runs `INSERT ... ON CONFLICT DO NOTHING` against the 3 registries. `LATERAL` subquery picks the chronologically-latest `effective_status` per `(store_id, platform, entity_id)`. `configured_status` is filled with the sentinel `'BACKFILL_UNKNOWN'` so Task 13's UI can tell the operator "platform value not yet observed; will populate within ~10 min".

- [ ] **Step 1: Create the migration file**

```sql
-- supabase/migrations/20260530250000_phase_d_backfill_registries.sql
--
-- Phase D (2026-05-30) — One-time backfill of the 3 registries from their
-- matching *_daily tables. Brings campaign_registry / adset_registry /
-- ad_registry to parity with the active dailies so the upcoming
-- campaigns_enriched / adsets_enriched / ads_enriched VIEWs never expose
-- NULL reg_* columns to the UI.
--
-- See docs/superpowers/specs/2026-05-30-phase-d-registry-status-cutover-design.md §3.1.
--
-- Idempotent: ON CONFLICT DO NOTHING. Safe to re-run.
-- Order matters: campaign_registry → adset_registry → ad_registry, because
-- adset and ad rows logically depend on their parent campaign row existing.

-- ---------------------------------------------------------------------------
-- 1. campaign_registry
-- ---------------------------------------------------------------------------
INSERT INTO campaign_registry (
  store_id, platform, campaign_id, name,
  configured_status, effective_status, delivery_status,
  is_enabled, is_serving,
  first_seen_at, last_seen_at,
  platform_updated_at, status_changed_at,
  last_metrics_success_at, last_status_success_at,
  raw_status_payload, missed_seen_count, is_removed
)
SELECT
  cd.store_id,
  cd.platform,
  cd.campaign_id,
  MAX(cd.campaign_name)                            AS name,
  'BACKFILL_UNKNOWN'                               AS configured_status,
  latest.effective_status,
  latest.delivery_status,
  latest.is_enabled,
  latest.is_serving,
  MIN(cd.date)::timestamptz                        AS first_seen_at,
  MAX(cd.date)::timestamptz                        AS last_seen_at,
  NULL::timestamptz                                AS platform_updated_at,
  NULL::timestamptz                                AS status_changed_at,
  NULL::timestamptz                                AS last_metrics_success_at,
  NULL::timestamptz                                AS last_status_success_at,
  '{}'::jsonb                                      AS raw_status_payload,
  0                                                AS missed_seen_count,
  FALSE                                            AS is_removed
FROM campaigns_daily cd
CROSS JOIN LATERAL (
  SELECT
    cd2.effective_status,
    CASE
      WHEN cd2.effective_status IN ('ACTIVE','ENABLED','ADGROUP_STATUS_DELIVERY_OK')
        THEN 'DELIVERING'
      WHEN cd2.effective_status IN (
        'PAUSED','DISABLED','REMOVED','ARCHIVED','DELETE',
        'ADGROUP_STATUS_DISABLE','ADGROUP_STATUS_ARCHIVED','ADGROUP_STATUS_DELETE',
        'ADGROUP_STATUS_TIMEDOUT','ADGROUP_STATUS_FROZEN',
        'ADGROUP_STATUS_CAMPAIGN_DISABLE'
      ) THEN 'NOT_DELIVERING'
      WHEN cd2.effective_status IN (
        'PENDING','PENDING_REVIEW','ADGROUP_STATUS_AUDIT','ADGROUP_STATUS_REVIEWING'
      ) THEN 'PENDING_REVIEW'
      WHEN cd2.effective_status IN ('ADGROUP_STATUS_BUDGET_EXCEED','LIMITED')
        THEN 'LIMITED'
      WHEN cd2.effective_status IN ('LEARNING') THEN 'LEARNING'
      ELSE 'UNKNOWN'
    END                                            AS delivery_status,
    CASE
      WHEN cd2.effective_status IN ('ACTIVE','ENABLED') THEN TRUE
      WHEN cd2.effective_status IS NULL THEN NULL
      ELSE FALSE
    END                                            AS is_enabled,
    CASE
      WHEN cd2.effective_status IN ('ACTIVE','ENABLED','ADGROUP_STATUS_DELIVERY_OK')
        THEN TRUE
      WHEN cd2.effective_status IS NULL THEN NULL
      ELSE FALSE
    END                                            AS is_serving
  FROM campaigns_daily cd2
  WHERE cd2.store_id    = cd.store_id
    AND cd2.platform    = cd.platform
    AND cd2.campaign_id = cd.campaign_id
    AND cd2.effective_status IS NOT NULL
  ORDER BY cd2.date DESC
  LIMIT 1
) AS latest
GROUP BY
  cd.store_id, cd.platform, cd.campaign_id,
  latest.effective_status, latest.delivery_status,
  latest.is_enabled, latest.is_serving
ON CONFLICT (store_id, platform, campaign_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. adset_registry — sourced from campaigns_daily (NOT a separate adsets_daily;
--    campaigns_daily has ad-set granularity per its PK
--    `(date, store_id, platform, campaign_id, ad_set_id)`).
-- ---------------------------------------------------------------------------
INSERT INTO adset_registry (
  store_id, platform, campaign_id, adset_id, name,
  configured_status, effective_status, delivery_status,
  is_enabled, is_serving,
  daily_budget_cad, lifetime_budget_cad,
  first_seen_at, last_seen_at,
  platform_updated_at, status_changed_at,
  last_metrics_success_at, last_status_success_at,
  raw_status_payload, missed_seen_count, is_removed
)
SELECT
  cd.store_id,
  cd.platform,
  cd.campaign_id,
  cd.ad_set_id                                     AS adset_id,
  MAX(cd.ad_set_name)                              AS name,
  'BACKFILL_UNKNOWN'                               AS configured_status,
  latest.effective_status,
  latest.delivery_status,
  latest.is_enabled,
  latest.is_serving,
  NULL::numeric                                    AS daily_budget_cad,
  NULL::numeric                                    AS lifetime_budget_cad,
  MIN(cd.date)::timestamptz                        AS first_seen_at,
  MAX(cd.date)::timestamptz                        AS last_seen_at,
  NULL::timestamptz, NULL::timestamptz,
  NULL::timestamptz, NULL::timestamptz,
  '{}'::jsonb, 0, FALSE
FROM campaigns_daily cd
CROSS JOIN LATERAL (
  SELECT
    cd2.effective_status,
    CASE
      WHEN cd2.effective_status IN ('ACTIVE','ENABLED','ADGROUP_STATUS_DELIVERY_OK')
        THEN 'DELIVERING'
      WHEN cd2.effective_status IN (
        'PAUSED','DISABLED','REMOVED','ARCHIVED','DELETE',
        'ADGROUP_STATUS_DISABLE','ADGROUP_STATUS_ARCHIVED','ADGROUP_STATUS_DELETE',
        'ADGROUP_STATUS_TIMEDOUT','ADGROUP_STATUS_FROZEN',
        'ADGROUP_STATUS_CAMPAIGN_DISABLE'
      ) THEN 'NOT_DELIVERING'
      WHEN cd2.effective_status IN (
        'PENDING','PENDING_REVIEW','ADGROUP_STATUS_AUDIT','ADGROUP_STATUS_REVIEWING'
      ) THEN 'PENDING_REVIEW'
      WHEN cd2.effective_status IN ('ADGROUP_STATUS_BUDGET_EXCEED','LIMITED')
        THEN 'LIMITED'
      WHEN cd2.effective_status IN ('LEARNING') THEN 'LEARNING'
      ELSE 'UNKNOWN'
    END                                            AS delivery_status,
    CASE
      WHEN cd2.effective_status IN ('ACTIVE','ENABLED') THEN TRUE
      WHEN cd2.effective_status IS NULL THEN NULL
      ELSE FALSE
    END                                            AS is_enabled,
    CASE
      WHEN cd2.effective_status IN ('ACTIVE','ENABLED','ADGROUP_STATUS_DELIVERY_OK')
        THEN TRUE
      WHEN cd2.effective_status IS NULL THEN NULL
      ELSE FALSE
    END                                            AS is_serving
  FROM campaigns_daily cd2
  WHERE cd2.store_id   = cd.store_id
    AND cd2.platform   = cd.platform
    AND cd2.ad_set_id  = cd.ad_set_id
    AND cd2.effective_status IS NOT NULL
  ORDER BY cd2.date DESC
  LIMIT 1
) AS latest
GROUP BY
  cd.store_id, cd.platform, cd.campaign_id, cd.ad_set_id,
  latest.effective_status, latest.delivery_status,
  latest.is_enabled, latest.is_serving
ON CONFLICT (store_id, platform, adset_id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3. ad_registry — keys-only backfill. `ads_daily` has NO `effective_status`
--    column, so we can only seed the keys + name and leave status fields NULL.
--    The Phase B/C ad-level status workers populate the rest going forward;
--    until they do, the UI classifier treats `regDeliveryStatus IS NULL` as
--    fall-through-to-legacy. configured_status is the BACKFILL_UNKNOWN
--    sentinel so the dashboard can render the "טוען מ-Platform" chip.
-- ---------------------------------------------------------------------------
INSERT INTO ad_registry (
  store_id, platform, campaign_id, adset_id, ad_id, name,
  configured_status, effective_status, delivery_status,
  is_enabled, is_serving,
  first_seen_at, last_seen_at,
  platform_updated_at, status_changed_at,
  last_metrics_success_at, last_status_success_at,
  raw_status_payload, missed_seen_count, is_removed
)
SELECT
  a.store_id,
  a.platform,
  a.campaign_id,
  a.ad_set_id                                      AS adset_id,
  a.ad_id,
  MAX(a.ad_name)                                   AS name,
  'BACKFILL_UNKNOWN'                               AS configured_status,
  NULL::text                                       AS effective_status,
  NULL::text                                       AS delivery_status,
  NULL::boolean                                    AS is_enabled,
  NULL::boolean                                    AS is_serving,
  MIN(a.date)::timestamptz                         AS first_seen_at,
  MAX(a.date)::timestamptz                         AS last_seen_at,
  NULL::timestamptz, NULL::timestamptz,
  NULL::timestamptz, NULL::timestamptz,
  '{}'::jsonb, 0, FALSE
FROM ads_daily a
GROUP BY a.store_id, a.platform, a.campaign_id, a.ad_set_id, a.ad_id
ON CONFLICT (store_id, platform, ad_id) DO NOTHING;
```

- [ ] **Step 2: Sanity-check the SQL by reading it back**

Run:
```bash
grep -cE "^ON CONFLICT \(" /Users/dorperetz/script-roas/supabase/migrations/20260530250000_phase_d_backfill_registries.sql
```
Expected: `3` (three real SQL `ON CONFLICT (...)` clauses, one per INSERT — header-comment lines starting with `--` won't match the anchored regex).

Run:
```bash
grep -cE "^INSERT INTO (campaign_registry|adset_registry|ad_registry)" /Users/dorperetz/script-roas/supabase/migrations/20260530250000_phase_d_backfill_registries.sql
```
Expected: `3` (one INSERT per registry, in that order).

Run:
```bash
grep -c "FROM adsets_daily" /Users/dorperetz/script-roas/supabase/migrations/20260530250000_phase_d_backfill_registries.sql
```
Expected: `0`. **`adsets_daily` does NOT exist in this project** — ad-set data lives inside `campaigns_daily` (whose PK is `(date, store_id, platform, campaign_id, ad_set_id)`). The `adset_registry` backfill MUST source from `campaigns_daily`, grouped by `ad_set_id`. Catches a recurrence of the schema-mismatch bug that broke the first attempt at this task.

Run:
```bash
grep -cE "a2\.effective_status|FROM ads_daily a2" /Users/dorperetz/script-roas/supabase/migrations/20260530250000_phase_d_backfill_registries.sql
```
Expected: `0`. **`ads_daily` has NO `effective_status` column**, so the ad_registry backfill is keys-only — no LATERAL subquery against `ads_daily` for status derivation.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260530250000_phase_d_backfill_registries.sql
git commit -m "$(cat <<'EOF'
feat(phase-d-migration-a): backfill 3 registries from real source tables

INSERT … ON CONFLICT DO NOTHING brings campaign_registry /
adset_registry / ad_registry to parity with their underlying source.

Schema reality: there is no `adsets_daily` table — ad-set data lives
inside campaigns_daily (PK includes ad_set_id). adset_registry
backfill therefore groups campaigns_daily by ad_set_id. ads_daily has
no effective_status column, so ad_registry backfill is keys-only;
status workers fill the rest going forward.

LATERAL picks chronologically-latest effective_status per entity for
the two registries that have a source. configured_status seeded with
sentinel 'BACKFILL_UNKNOWN' across all three; Phase B/C workers
replace it within ~10 min of the next orchestrator tick.

Spec: docs/superpowers/specs/2026-05-30-phase-d-registry-status-cutover-design.md §3.1
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Migration B — `AFTER INSERT` triggers on the 2 source dailies

**Files:**
- Create: `supabase/migrations/20260530260000_phase_d_auto_coverage_triggers.sql`

Triggers close the 10-min orchestrator gap for **brand-new** tuples: the row appears in the daily on its first spend and the matching registry rows are inserted within the same transaction. **Triggers never UPDATE registry rows** — that's Phase C workers' job; triggers only `INSERT … ON CONFLICT DO NOTHING` missing keys.

**Schema-aware layout (per Task 1's revised structure):**
- `AFTER INSERT ON campaigns_daily` → one trigger function that does **two** inserts (one each into `campaign_registry` and `adset_registry`), since ad-set data lives on `campaigns_daily` rows.
- `AFTER INSERT ON ads_daily` → one trigger function that does a **keys-only** insert into `ad_registry` with NULL status fields (`ads_daily` has no `effective_status` to derive from).
- **No trigger on `adsets_daily`** — the table doesn't exist.

- [ ] **Step 1: Create the migration**

```sql
-- supabase/migrations/20260530260000_phase_d_auto_coverage_triggers.sql
--
-- Phase D (2026-05-30) — AFTER INSERT triggers on the 2 source dailies
-- (campaigns_daily + ads_daily) that ensure registry parity within the
-- same transaction as the daily insert. Closes the 10-min orchestrator
-- gap for newly-spending entities.
--
-- Strict invariant: triggers ONLY insert missing registry rows. They do
-- NOT update existing ones. UPDATEs of *_daily do not fire them (triggers
-- are AFTER INSERT only). This guarantees we never clobber richer data
-- that Phase B/C workers have written.

-- ---------------------------------------------------------------------------
-- 1. ensure_campaign_and_adset_registry_rows
--    Fires AFTER INSERT ON campaigns_daily. Each row inserts BOTH the
--    campaign-level registry row AND the ad-set-level registry row, since
--    campaigns_daily rows are ad-set-granular (PK includes ad_set_id).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_campaign_and_adset_registry_rows()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- (a) campaign_registry
  INSERT INTO campaign_registry (
    store_id, platform, campaign_id, name,
    configured_status, effective_status, delivery_status,
    is_enabled, is_serving,
    first_seen_at, last_seen_at,
    raw_status_payload, missed_seen_count, is_removed
  )
  VALUES (
    NEW.store_id, NEW.platform, NEW.campaign_id, NEW.campaign_name,
    'BACKFILL_UNKNOWN',
    NEW.effective_status,
    CASE
      WHEN NEW.effective_status IN ('ACTIVE','ENABLED','ADGROUP_STATUS_DELIVERY_OK')
        THEN 'DELIVERING'
      WHEN NEW.effective_status IN (
        'PAUSED','DISABLED','REMOVED','ARCHIVED','DELETE',
        'CAMPAIGN_PAUSED','ADSET_PAUSED','DISAPPROVED',
        'ADGROUP_STATUS_DISABLE','ADGROUP_STATUS_ARCHIVED','ADGROUP_STATUS_DELETE',
        'ADGROUP_STATUS_TIMEDOUT','ADGROUP_STATUS_FROZEN',
        'ADGROUP_STATUS_CAMPAIGN_DISABLE'
      ) THEN 'NOT_DELIVERING'
      WHEN NEW.effective_status IN (
        'PENDING','PENDING_REVIEW',
        'ADGROUP_STATUS_AUDIT','ADGROUP_STATUS_REVIEWING'
      ) THEN 'PENDING_REVIEW'
      WHEN NEW.effective_status IN ('REJECTED') THEN 'REJECTED'
      WHEN NEW.effective_status IN ('ADGROUP_STATUS_BUDGET_EXCEED','LIMITED') THEN 'LIMITED'
      WHEN NEW.effective_status IN ('LEARNING') THEN 'LEARNING'
      ELSE 'UNKNOWN'
    END,
    -- is_enabled here is gated on effective_status because configured_status
    -- is the BACKFILL_UNKNOWN sentinel. Phase B/C status workers overwrite
    -- this with the platform's real configured_status within ~10 min.
    CASE
      WHEN NEW.effective_status IN ('ACTIVE','ENABLED') THEN TRUE
      WHEN NEW.effective_status IS NULL THEN NULL
      ELSE FALSE
    END,
    CASE
      WHEN NEW.effective_status IN ('ACTIVE','ENABLED','ADGROUP_STATUS_DELIVERY_OK')
        THEN TRUE
      WHEN NEW.effective_status IS NULL THEN NULL
      ELSE FALSE
    END,
    NEW.date::timestamptz, NEW.date::timestamptz,
    '{}'::jsonb, 0, FALSE
  )
  ON CONFLICT (store_id, platform, campaign_id) DO NOTHING;

  -- (b) adset_registry — same row, ad-set view.
  INSERT INTO adset_registry (
    store_id, platform, campaign_id, adset_id, name,
    configured_status, effective_status, delivery_status,
    is_enabled, is_serving,
    first_seen_at, last_seen_at,
    raw_status_payload, missed_seen_count, is_removed
  )
  VALUES (
    NEW.store_id, NEW.platform, NEW.campaign_id, NEW.ad_set_id, NEW.ad_set_name,
    'BACKFILL_UNKNOWN',
    NEW.effective_status,
    CASE
      WHEN NEW.effective_status IN ('ACTIVE','ENABLED','ADGROUP_STATUS_DELIVERY_OK')
        THEN 'DELIVERING'
      WHEN NEW.effective_status IN (
        'PAUSED','DISABLED','REMOVED','ARCHIVED','DELETE',
        'CAMPAIGN_PAUSED','ADSET_PAUSED','DISAPPROVED',
        'ADGROUP_STATUS_DISABLE','ADGROUP_STATUS_ARCHIVED','ADGROUP_STATUS_DELETE',
        'ADGROUP_STATUS_TIMEDOUT','ADGROUP_STATUS_FROZEN',
        'ADGROUP_STATUS_CAMPAIGN_DISABLE'
      ) THEN 'NOT_DELIVERING'
      WHEN NEW.effective_status IN (
        'PENDING','PENDING_REVIEW',
        'ADGROUP_STATUS_AUDIT','ADGROUP_STATUS_REVIEWING'
      ) THEN 'PENDING_REVIEW'
      WHEN NEW.effective_status IN ('REJECTED') THEN 'REJECTED'
      WHEN NEW.effective_status IN ('ADGROUP_STATUS_BUDGET_EXCEED','LIMITED') THEN 'LIMITED'
      WHEN NEW.effective_status IN ('LEARNING') THEN 'LEARNING'
      ELSE 'UNKNOWN'
    END,
    -- is_enabled here is gated on effective_status because configured_status
    -- is the BACKFILL_UNKNOWN sentinel. Phase B/C status workers overwrite
    -- this with the platform's real configured_status within ~10 min.
    CASE
      WHEN NEW.effective_status IN ('ACTIVE','ENABLED') THEN TRUE
      WHEN NEW.effective_status IS NULL THEN NULL
      ELSE FALSE
    END,
    CASE
      WHEN NEW.effective_status IN ('ACTIVE','ENABLED','ADGROUP_STATUS_DELIVERY_OK')
        THEN TRUE
      WHEN NEW.effective_status IS NULL THEN NULL
      ELSE FALSE
    END,
    NEW.date::timestamptz, NEW.date::timestamptz,
    '{}'::jsonb, 0, FALSE
  )
  ON CONFLICT (store_id, platform, adset_id) DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS campaigns_daily_ensure_registry ON campaigns_daily;
CREATE TRIGGER campaigns_daily_ensure_registry
  AFTER INSERT ON campaigns_daily
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_campaign_and_adset_registry_rows();

-- ---------------------------------------------------------------------------
-- 2. ensure_ad_registry_row — keys-only.
--    ads_daily has no effective_status column, so the registry row is
--    seeded with NULL status fields and configured_status =
--    'BACKFILL_UNKNOWN'. Phase B/C ad-level status workers fill the rest.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ensure_ad_registry_row()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO ad_registry (
    store_id, platform, campaign_id, adset_id, ad_id, name,
    configured_status, effective_status, delivery_status,
    is_enabled, is_serving,
    first_seen_at, last_seen_at,
    raw_status_payload, missed_seen_count, is_removed
  )
  VALUES (
    NEW.store_id, NEW.platform, NEW.campaign_id, NEW.ad_set_id, NEW.ad_id, NEW.ad_name,
    'BACKFILL_UNKNOWN',
    NULL::text,
    NULL::text,
    NULL::boolean,
    NULL::boolean,
    NEW.date::timestamptz, NEW.date::timestamptz,
    '{}'::jsonb, 0, FALSE
  )
  ON CONFLICT (store_id, platform, ad_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ads_daily_ensure_registry ON ads_daily;
CREATE TRIGGER ads_daily_ensure_registry
  AFTER INSERT ON ads_daily
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_ad_registry_row();
```

- [ ] **Step 2: Sanity-check**

Run:
```bash
grep -cE "^DROP TRIGGER IF EXISTS" /Users/dorperetz/script-roas/supabase/migrations/20260530260000_phase_d_auto_coverage_triggers.sql
```
Expected: `2`. **Only 2 triggers exist** — one on `campaigns_daily` (which seeds both `campaign_registry` and `adset_registry`), one on `ads_daily`. There is no `adsets_daily` table to attach a third trigger to.

Run:
```bash
grep -cE "^  ON CONFLICT" /Users/dorperetz/script-roas/supabase/migrations/20260530260000_phase_d_auto_coverage_triggers.sql
```
Expected: `3` — 1× in the campaigns_daily trigger function for `campaign_registry`, 1× for `adset_registry` (same function, second INSERT), 1× in the ads_daily trigger function for `ad_registry`.

Run:
```bash
grep -c "ON adsets_daily" /Users/dorperetz/script-roas/supabase/migrations/20260530260000_phase_d_auto_coverage_triggers.sql
```
Expected: `0`. Catches a recurrence of the schema-mismatch bug.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260530260000_phase_d_auto_coverage_triggers.sql
git commit -m "$(cat <<'EOF'
feat(phase-d-migration-b): AFTER INSERT triggers seed registries on first-spend

Two AFTER INSERT triggers. The one on campaigns_daily fires a single
plpgsql function that performs TWO inserts (campaign_registry +
adset_registry) per daily row, since campaigns_daily is ad-set-granular
and there is no separate adsets_daily table. The one on ads_daily
seeds ad_registry keys-only (no effective_status to derive from).

Both triggers are INSERT-only with ON CONFLICT DO NOTHING — they
never overwrite rows the Phase B/C status workers wrote.

Spec: docs/superpowers/specs/2026-05-30-phase-d-registry-status-cutover-design.md §3.2
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Migration C — `campaigns_enriched` / `adsets_enriched` / `ads_enriched` VIEWs

**Files:**
- Create: `supabase/migrations/20260530270000_phase_d_enriched_views.sql`

`LEFT JOIN` on `(store_id, platform, entity_id)`. Every column of the daily passes through unchanged; the registry contributes 11 `reg_*` columns. Because of Tasks 1+2 the `LEFT` side never has a NULL match in practice, but the join semantics stay conservative.

- [ ] **Step 1: Create the migration**

```sql
-- supabase/migrations/20260530270000_phase_d_enriched_views.sql
--
-- Phase D (2026-05-30) — 3 read-only VIEWs that LEFT JOIN each daily to its
-- registry server-side. App layer SELECTs from the view instead of the
-- daily; status fields arrive as reg_* columns alongside the daily's
-- existing columns.
--
-- After Migrations A + B run, the LEFT side never has a NULL match in
-- production; LEFT JOIN is kept (rather than INNER) for defensive semantics
-- against the unlikely edge case of a registry row being deleted out-of-band.
--
-- Performance: planner picks a hash join on the shared 3-tuple PK; cost
-- stays sub-50ms over 1k rows on production data.

-- ---------------------------------------------------------------------------
-- 1. campaigns_enriched
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW campaigns_enriched AS
SELECT
  cd.*,
  cr.configured_status         AS reg_configured_status,
  cr.effective_status          AS reg_effective_status,
  cr.delivery_status           AS reg_delivery_status,
  cr.is_enabled                AS reg_is_enabled,
  cr.is_serving                AS reg_is_serving,
  cr.first_seen_at             AS reg_first_seen_at,
  cr.last_seen_at              AS reg_last_seen_at,
  cr.status_changed_at         AS reg_status_changed_at,
  cr.last_status_success_at    AS reg_last_status_success_at,
  cr.last_metrics_success_at   AS reg_last_metrics_success_at,
  cr.missed_seen_count         AS reg_missed_seen_count,
  cr.is_removed                AS reg_is_removed
FROM campaigns_daily cd
LEFT JOIN campaign_registry cr
  ON  cr.store_id    = cd.store_id
  AND cr.platform    = cd.platform
  AND cr.campaign_id = cd.campaign_id;

-- ---------------------------------------------------------------------------
-- 2. adsets_enriched — sourced from campaigns_daily (ad-set-granular)
--    LEFT JOINed to adset_registry by ad_set_id. Created but NOT consumed
--    by Phase D Task 5/6 (the existing reader stays on campaigns_enriched
--    + uses the campaign-level reg_*). Available for future ad-set-only
--    consumers that want the adset_registry's status fields instead.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW adsets_enriched AS
SELECT
  cd.*,
  ar.configured_status         AS reg_configured_status,
  ar.effective_status          AS reg_effective_status,
  ar.delivery_status           AS reg_delivery_status,
  ar.is_enabled                AS reg_is_enabled,
  ar.is_serving                AS reg_is_serving,
  ar.first_seen_at             AS reg_first_seen_at,
  ar.last_seen_at              AS reg_last_seen_at,
  ar.status_changed_at         AS reg_status_changed_at,
  ar.last_status_success_at    AS reg_last_status_success_at,
  ar.last_metrics_success_at   AS reg_last_metrics_success_at,
  ar.missed_seen_count         AS reg_missed_seen_count,
  ar.is_removed                AS reg_is_removed
FROM campaigns_daily cd
LEFT JOIN adset_registry ar
  ON  ar.store_id  = cd.store_id
  AND ar.platform  = cd.platform
  AND ar.adset_id  = cd.ad_set_id;

-- ---------------------------------------------------------------------------
-- 3. ads_enriched
-- ---------------------------------------------------------------------------
CREATE OR REPLACE VIEW ads_enriched AS
SELECT
  a.*,
  arr.configured_status        AS reg_configured_status,
  arr.effective_status         AS reg_effective_status,
  arr.delivery_status          AS reg_delivery_status,
  arr.is_enabled               AS reg_is_enabled,
  arr.is_serving               AS reg_is_serving,
  arr.first_seen_at            AS reg_first_seen_at,
  arr.last_seen_at             AS reg_last_seen_at,
  arr.status_changed_at        AS reg_status_changed_at,
  arr.last_status_success_at   AS reg_last_status_success_at,
  arr.last_metrics_success_at  AS reg_last_metrics_success_at,
  arr.missed_seen_count        AS reg_missed_seen_count,
  arr.is_removed               AS reg_is_removed
FROM ads_daily a
LEFT JOIN ad_registry arr
  ON  arr.store_id = a.store_id
  AND arr.platform = a.platform
  AND arr.ad_id    = a.ad_id;

-- ---------------------------------------------------------------------------
-- Grants — anon needs SELECT to mirror the existing pattern for *_daily.
-- ---------------------------------------------------------------------------
GRANT SELECT ON campaigns_enriched, adsets_enriched, ads_enriched TO anon;
```

- [ ] **Step 2: Sanity-check**

Run:
```bash
grep -c "CREATE OR REPLACE VIEW" /Users/dorperetz/script-roas/supabase/migrations/20260530270000_phase_d_enriched_views.sql
```
Expected: `3`.

Run:
```bash
grep -c "LEFT JOIN" /Users/dorperetz/script-roas/supabase/migrations/20260530270000_phase_d_enriched_views.sql
```
Expected: `3`.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260530270000_phase_d_enriched_views.sql
git commit -m "$(cat <<'EOF'
feat(phase-d-migration-c): create campaigns/adsets/ads enriched VIEWs

3 LEFT JOIN views (campaigns_enriched, adsets_enriched, ads_enriched)
expose 11 reg_* columns from the matching registry next to every
daily column. App-layer selects move from from('X_daily') to
from('X_enriched') with no payload-shape impact otherwise.

Spec: docs/superpowers/specs/2026-05-30-phase-d-registry-status-cutover-design.md §3.3
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Apply migrations to production and verify

**Files:**
- (Operator action — no file changes)

This task is **operator-gated** because it modifies production state. The plan-executor MUST pause and ask the operator before proceeding past Step 2.

- [ ] **Step 1: Print the migration plan summary for the operator**

Run:
```bash
git log --oneline -3 | head -3
ls -la supabase/migrations/20260530{25,26,27}* 2>/dev/null
```
Expected: 3 new migrations listed with the new commits.

- [ ] **Step 2: Ask the operator to apply the migrations to production**

Print this verbatim to the operator and **wait for confirmation** before continuing:

> Phase D migrations A + B + C are committed. Please apply to production now via:
> `cd supabase && supabase db push --linked`
>
> Then confirm by sharing the row counts:
> ```sql
> SELECT 'campaign_registry' tbl, COUNT(*) FROM campaign_registry
> UNION ALL SELECT 'adset_registry',    COUNT(*) FROM adset_registry
> UNION ALL SELECT 'ad_registry',       COUNT(*) FROM ad_registry
> UNION ALL SELECT 'campaigns_daily_distinct',
>        COUNT(DISTINCT (store_id, platform, campaign_id)) FROM campaigns_daily
> UNION ALL SELECT 'adsets_daily_distinct',
>        COUNT(DISTINCT (store_id, platform, ad_set_id))   FROM adsets_daily
> UNION ALL SELECT 'ads_daily_distinct',
>        COUNT(DISTINCT (store_id, platform, ad_id))       FROM ads_daily;
> ```
>
> Acceptance: `campaign_registry >= campaigns_daily_distinct`; same for adsets and ads.
> Confirm before proceeding to Task 5.

- [ ] **Step 3: After operator confirms, smoke-test the enriched views**

Operator runs:
```sql
SELECT date, store_id, platform, campaign_id,
       effective_status, reg_effective_status, reg_delivery_status,
       reg_configured_status, reg_status_changed_at
FROM campaigns_enriched
WHERE date = CURRENT_DATE
ORDER BY platform, store_id
LIMIT 10;
```
Expected: 10 rows; `reg_effective_status` non-null on all of them; `reg_configured_status` mostly `'BACKFILL_UNKNOWN'` on freshly-backfilled rows, real platform values on rows the workers have already touched since the orchestrator's last tick.

- [ ] **Step 4: No code changes — commit not applicable** (skip)

---

## Task 5: Backend — `fetchCampaignsFromPostgres` cuts over to `campaigns_enriched`

**Files:**
- Modify: `dashboard-web/src/lib/postgresReaders.ts` (fetchCampaignsFromPostgres, lines 601-735)
- Modify: `dashboard-web/src/lib/campaigns.ts` (CampaignRow type — add `reg*` fields)
- Test: `dashboard-web/src/lib/__tests__/postgresReadersCampaignsEnriched.test.ts` (new)

`CampaignRow` gains 6 fields: `regConfiguredStatus`, `regEffectiveStatus`, `regDeliveryStatus`, `regFirstSeenAt`, `regStatusChangedAt`, `regLastStatusSuccessAt`. The legacy `effectiveStatus` field STAYS (it still mirrors `campaigns_daily.effective_status`) — Task 10 deletes its last reader, Task 16's cleanup pass deletes the field. Surgical approach prevents a cross-PR plumbing break.

- [ ] **Step 1: Write the failing test**

Create `dashboard-web/src/lib/__tests__/postgresReadersCampaignsEnriched.test.ts`:

```typescript
// dashboard-web/src/lib/__tests__/postgresReadersCampaignsEnriched.test.ts
//
// Phase D Task 5 — fetchCampaignsFromPostgres should select from
// campaigns_enriched (not campaigns_daily) and surface the 6 reg_* columns
// onto each CampaignRow.

import { describe, expect, it, vi, beforeEach } from 'vitest';

// Hoist + capture so we can assert which table .from() was called with.
const fromMock = vi.fn();
vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({ from: fromMock }),
}));

import { fetchCampaignsFromPostgres } from '@/lib/postgresReaders';

function buildSupabaseChain(rows: Record<string, unknown>[]) {
  const chain: Record<string, unknown> = {};
  // The reader uses paginate() which calls .select().gte().lte() and pages
  // by .range(). Minimal stub: every chained method returns `chain` and
  // .range() resolves to { data: rows, error: null }.
  for (const m of ['select','gte','lte','order','not','eq']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.range = vi.fn(() => Promise.resolve({ data: rows, error: null }));
  return chain;
}

describe('fetchCampaignsFromPostgres → campaigns_enriched', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects from 'campaigns_enriched' (not campaigns_daily)", async () => {
    fromMock.mockReturnValue(buildSupabaseChain([]));
    await fetchCampaignsFromPostgres();
    expect(fromMock).toHaveBeenCalledWith('campaigns_enriched');
  });

  it('threads reg_* columns onto CampaignRow as camelCase reg* fields', async () => {
    fromMock.mockReturnValue(buildSupabaseChain([{
      date: '2026-05-30',
      store_id: 'uzoshop',
      platform: 'meta',
      campaign_id: 'C1',
      campaign_name: 'Test',
      ad_set_id: 'A1',
      ad_set_name: 'AS',
      spend_cad: 10,
      impressions: 100,
      clicks: 5,
      conversions: 1,
      conversion_value_cad: 25,
      campaign_budget_cad: null,
      ad_set_budget_cad: null,
      budget_type: null,
      effective_status: 'ACTIVE',
      last_live_tick_at: '2026-05-30T10:00:00Z',
      reg_configured_status: 'ENABLED',
      reg_effective_status: 'ACTIVE',
      reg_delivery_status: 'DELIVERING',
      reg_first_seen_at: '2026-05-20T00:00:00Z',
      reg_status_changed_at: '2026-05-28T12:00:00Z',
      reg_last_status_success_at: '2026-05-30T09:50:00Z',
    }]));

    const rows = await fetchCampaignsFromPostgres({ range: { from: '2026-05-30', to: '2026-05-30' }});
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.effectiveStatus).toBe('ACTIVE');           // legacy field preserved
    expect(r.regConfiguredStatus).toBe('ENABLED');
    expect(r.regEffectiveStatus).toBe('ACTIVE');
    expect(r.regDeliveryStatus).toBe('DELIVERING');
    expect(r.regFirstSeenAt).toBe('2026-05-20T00:00:00Z');
    expect(r.regStatusChangedAt).toBe('2026-05-28T12:00:00Z');
    expect(r.regLastStatusSuccessAt).toBe('2026-05-30T09:50:00Z');
  });

  it('returns null for reg_* when the LEFT JOIN missed (defensive path)', async () => {
    fromMock.mockReturnValue(buildSupabaseChain([{
      date: '2026-05-30', store_id: 'uzoshop', platform: 'meta',
      campaign_id: 'C2', campaign_name: 'Missing',
      ad_set_id: 'A', ad_set_name: 'A',
      spend_cad: 1, impressions: 1, clicks: 1, conversions: 0,
      conversion_value_cad: 0,
      effective_status: 'ACTIVE',
      reg_configured_status: null,
      reg_effective_status: null,
      reg_delivery_status: null,
      reg_first_seen_at: null,
      reg_status_changed_at: null,
      reg_last_status_success_at: null,
    }]));
    const rows = await fetchCampaignsFromPostgres({ range: { from: '2026-05-30', to: '2026-05-30' }});
    expect(rows[0].regEffectiveStatus).toBeNull();
    expect(rows[0].regDeliveryStatus).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails for the right reason**

Run:
```bash
cd /Users/dorperetz/script-roas/dashboard-web && npx vitest run src/lib/__tests__/postgresReadersCampaignsEnriched.test.ts
```
Expected: FAIL — `fromMock` was called with `'campaigns_daily'` (not `'campaigns_enriched'`) and `r.regEffectiveStatus` is `undefined`.

- [ ] **Step 3: Extend CampaignRow in `dashboard-web/src/lib/campaigns.ts`**

Find the existing `export type CampaignRow = { … }` (around line 16) and add these 6 fields **at the end of the type, immediately before the closing `};`**:

```typescript
  /**
   * Phase D (2026-05-30) — registry-backed status fields. Joined server-side
   * via the `campaigns_enriched` VIEW. Always non-null in production after
   * Migration B's trigger guarantees coverage, but typed as nullable for
   * defensive parsing.
   */
  regConfiguredStatus: string | null;
  regEffectiveStatus: string | null;
  regDeliveryStatus: string | null;
  regFirstSeenAt: string | null;
  regStatusChangedAt: string | null;
  regLastStatusSuccessAt: string | null;
```

- [ ] **Step 4: Update `fetchCampaignsFromPostgres` in `postgresReaders.ts`**

Locate the `.from('campaigns_daily')` call (line ~612) and the `.select(...)` chain immediately after it. Make these two changes:

**Change A — table name:**

```typescript
// before
.from('campaigns_daily')
// after
.from('campaigns_enriched')
```

**Change B — append the 6 reg_* columns to the SELECT list** (the SELECT string ends with `'last_live_tick_at'` on line ~627). Replace that exact terminating line with:

```typescript
            'last_live_tick_at, ' +
            // Phase D (2026-05-30) — registry-backed status columns, joined
            // server-side via the campaigns_enriched VIEW. The 11-column
            // bundle from campaign_registry — we project only the 6 the UI
            // consumes; the other 5 are reachable via SELECT * on the view
            // if a future caller needs them.
            'reg_configured_status, reg_effective_status, reg_delivery_status, ' +
            'reg_first_seen_at, reg_status_changed_at, reg_last_status_success_at',
```

**Change C — populate the new fields on every pushed row.** Inside the `rows.push({ … })` block (line ~691), immediately **before** the closing `});` add the 6 mappers (right after `lastLiveTickAt`):

```typescript
      regConfiguredStatus: ((): string | null => {
        const v = (r as { reg_configured_status?: unknown }).reg_configured_status;
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        return s || null;
      })(),
      regEffectiveStatus: ((): string | null => {
        const v = (r as { reg_effective_status?: unknown }).reg_effective_status;
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        return s || null;
      })(),
      regDeliveryStatus: ((): string | null => {
        const v = (r as { reg_delivery_status?: unknown }).reg_delivery_status;
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        return s || null;
      })(),
      regFirstSeenAt: ((): string | null => {
        const v = (r as { reg_first_seen_at?: unknown }).reg_first_seen_at;
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        return s || null;
      })(),
      regStatusChangedAt: ((): string | null => {
        const v = (r as { reg_status_changed_at?: unknown }).reg_status_changed_at;
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        return s || null;
      })(),
      regLastStatusSuccessAt: ((): string | null => {
        const v = (r as { reg_last_status_success_at?: unknown }).reg_last_status_success_at;
        if (v === null || v === undefined) return null;
        const s = String(v).trim();
        return s || null;
      })(),
```

- [ ] **Step 5: Run the test — confirm it passes**

Run:
```bash
cd /Users/dorperetz/script-roas/dashboard-web && npx vitest run src/lib/__tests__/postgresReadersCampaignsEnriched.test.ts
```
Expected: 3/3 PASS.

- [ ] **Step 6: Confirm typecheck + full suite still passes**

Run:
```bash
cd /Users/dorperetz/script-roas/dashboard-web && npx tsc --noEmit
```
Expected: no errors. (CampaignRow has 6 new fields; existing test fixtures that build CampaignRow inline need updating — Step 7.)

- [ ] **Step 7: Patch every test fixture that constructs a literal CampaignRow**

Run:
```bash
cd /Users/dorperetz/script-roas/dashboard-web && grep -rln "effectiveStatus:" src/ | xargs grep -l "lastLiveTickAt" | head -30
```

For each file the search returns, find the `{ … effectiveStatus: …, lastLiveTickAt: … }` literal and append the 6 new fields with `null` defaults. Example patch:

```typescript
// before:
{ … effectiveStatus: 'ACTIVE', lastLiveTickAt: null }
// after:
{
  … effectiveStatus: 'ACTIVE', lastLiveTickAt: null,
  regConfiguredStatus: null, regEffectiveStatus: null, regDeliveryStatus: null,
  regFirstSeenAt: null, regStatusChangedAt: null, regLastStatusSuccessAt: null,
}
```

Re-run `npx tsc --noEmit` until clean. (Expect ~5-15 fixtures to need touching; this is mechanical.)

- [ ] **Step 8: Run the full Vitest suite**

Run:
```bash
cd /Users/dorperetz/script-roas/dashboard-web && npm test
```
Expected: all green (zero new failures vs. main).

- [ ] **Step 9: Commit**

```bash
git add dashboard-web/src/lib/postgresReaders.ts \
        dashboard-web/src/lib/campaigns.ts \
        dashboard-web/src/lib/__tests__/postgresReadersCampaignsEnriched.test.ts \
        $(git diff --name-only -- '*.ts' '*.tsx')
git commit -m "$(cat <<'EOF'
feat(phase-d-task-5): fetchCampaignsFromPostgres reads campaigns_enriched + 6 reg_* fields

postgresReaders.fetchCampaignsFromPostgres now SELECTs from the
campaigns_enriched VIEW (Migration C) and surfaces reg_configured_status,
reg_effective_status, reg_delivery_status, reg_first_seen_at,
reg_status_changed_at, reg_last_status_success_at as camelCase reg*
fields on CampaignRow. The legacy effectiveStatus field stays — its
last reader gets cut over in Task 10 and the field itself is removed
in the cleanup pass.

Test fixtures across the codebase patched with the 6 new null defaults
so tsc stays clean.

Spec: docs/superpowers/specs/2026-05-30-phase-d-registry-status-cutover-design.md §3.4 (Backend)
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Backend — `fetchAdsFromPostgres` cuts over to `ads_enriched`

**Files:**
- Modify: `dashboard-web/src/lib/postgresReaders.ts` (fetchAdsFromPostgres, lines ~848 onward)
- Modify: `dashboard-web/src/lib/ads.ts` (or wherever `AdRow` is defined)
- Test: `dashboard-web/src/lib/__tests__/postgresReadersAdsEnriched.test.ts` (new)

Same pattern as Task 5 applied to the ads pipeline. Same 6 `reg*` fields land on `AdRow`.

- [ ] **Step 1: Find where AdRow is defined**

Run:
```bash
cd /Users/dorperetz/script-roas/dashboard-web && grep -rn "export type AdRow\|export interface AdRow" src/ | head -5
```
Open the file the search returns; it's the source of truth for the AdRow shape.

- [ ] **Step 2: Write the failing test**

Create `dashboard-web/src/lib/__tests__/postgresReadersAdsEnriched.test.ts`:

```typescript
// dashboard-web/src/lib/__tests__/postgresReadersAdsEnriched.test.ts
//
// Phase D Task 6 — fetchAdsFromPostgres selects from ads_enriched and
// surfaces 6 reg_* columns onto AdRow.

import { describe, expect, it, vi, beforeEach } from 'vitest';

const fromMock = vi.fn();
vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({ from: fromMock }),
}));

import { fetchAdsFromPostgres } from '@/lib/postgresReaders';

function buildSupabaseChain(rows: Record<string, unknown>[]) {
  const chain: Record<string, unknown> = {};
  for (const m of ['select','gte','lte','order','not','eq']) {
    chain[m] = vi.fn(() => chain);
  }
  chain.range = vi.fn(() => Promise.resolve({ data: rows, error: null }));
  return chain;
}

describe('fetchAdsFromPostgres → ads_enriched', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("selects from 'ads_enriched' (not ads_daily)", async () => {
    fromMock.mockReturnValue(buildSupabaseChain([]));
    await fetchAdsFromPostgres();
    expect(fromMock).toHaveBeenCalledWith('ads_enriched');
  });

  it('threads reg_* columns onto AdRow', async () => {
    fromMock.mockReturnValue(buildSupabaseChain([{
      date: '2026-05-30',
      store_id: 'uzoshop',
      platform: 'meta',
      campaign_id: 'C1',
      campaign_name: 'C',
      ad_set_id: 'A1',
      ad_set_name: 'AS',
      ad_id: 'AD1',
      ad_name: 'A',
      spend_cad: 10,
      impressions: 100,
      clicks: 5,
      conversions: 1,
      conversion_value_cad: 25,
      reg_configured_status: 'ENABLED',
      reg_effective_status: 'ACTIVE',
      reg_delivery_status: 'DELIVERING',
      reg_first_seen_at: '2026-05-20T00:00:00Z',
      reg_status_changed_at: '2026-05-28T12:00:00Z',
      reg_last_status_success_at: '2026-05-30T09:50:00Z',
    }]));
    const rows = await fetchAdsFromPostgres({ range: { from: '2026-05-30', to: '2026-05-30' }});
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r.regEffectiveStatus).toBe('ACTIVE');
    expect(r.regDeliveryStatus).toBe('DELIVERING');
    expect(r.regConfiguredStatus).toBe('ENABLED');
  });
});
```

- [ ] **Step 3: Run the test — confirm it fails**

Run:
```bash
cd /Users/dorperetz/script-roas/dashboard-web && npx vitest run src/lib/__tests__/postgresReadersAdsEnriched.test.ts
```
Expected: FAIL — wrong table, missing fields.

- [ ] **Step 4: Add `reg*` fields to AdRow type**

Open the file from Step 1 and append 6 fields to the AdRow type, with the same comment + structure as Task 5 Step 3:

```typescript
  regConfiguredStatus: string | null;
  regEffectiveStatus: string | null;
  regDeliveryStatus: string | null;
  regFirstSeenAt: string | null;
  regStatusChangedAt: string | null;
  regLastStatusSuccessAt: string | null;
```

- [ ] **Step 5: Patch fetchAdsFromPostgres**

In `postgresReaders.ts`, find `.from('ads_daily')` (line ~855) and apply the same 3-change pattern as Task 5: (A) rename `'ads_daily'` → `'ads_enriched'`; (B) append 6 reg_* columns to the SELECT string; (C) add 6 mapper IIFEs to the `rows.push({…})` block.

- [ ] **Step 6: Re-run test, then full suite + tsc**

Run:
```bash
cd /Users/dorperetz/script-roas/dashboard-web && \
  npx vitest run src/lib/__tests__/postgresReadersAdsEnriched.test.ts && \
  npx tsc --noEmit && \
  npm test
```
Expected: ads test green; tsc clean (patch any AdRow fixtures that fail); full suite green.

- [ ] **Step 7: Commit**

```bash
git add dashboard-web/src/lib/postgresReaders.ts \
        dashboard-web/src/lib/__tests__/postgresReadersAdsEnriched.test.ts \
        $(git diff --name-only)
git commit -m "$(cat <<'EOF'
feat(phase-d-task-6): fetchAdsFromPostgres reads ads_enriched + 6 reg_* fields

Same pattern as Task 5 applied to fetchAdsFromPostgres. AdRow gains
the 6 reg_* fields. Test fixtures patched.

Spec: docs/superpowers/specs/2026-05-30-phase-d-registry-status-cutover-design.md §3.4 (Backend)
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Backend — `fetchCurrentCampaignStatuses` reads `campaign_registry` directly

**Files:**
- Modify: `dashboard-web/src/lib/postgresReaders.ts` (fetchCurrentCampaignStatuses, lines ~784-835)
- Test: `dashboard-web/src/lib/__tests__/fetchCurrentCampaignStatusesRegistry.test.ts` (new)

This 60-day-lookback override helper is **no longer needed in its current form** — `campaign_registry.effective_status` IS the canonical absolute-latest value. Refactor: read 1 row per `(store, platform, campaign, ad_set)` directly from the registry. Drop the 60-day filter (registry rows don't expire). Map shape stays identical so callers don't change.

There's no per-`ad_set` in `campaign_registry` (registry PK is `(store, platform, campaign_id)`); the existing map key includes `adSetId` because the daily-derived data was per-adset. After Phase D the override is per-campaign — so emit the same campaign value under every `adSetId` we observed in `adsets_daily` for that campaign (preserves the caller's key-shape contract).

- [ ] **Step 1: Write the failing test**

Create `dashboard-web/src/lib/__tests__/fetchCurrentCampaignStatusesRegistry.test.ts`:

```typescript
// dashboard-web/src/lib/__tests__/fetchCurrentCampaignStatusesRegistry.test.ts
//
// Phase D Task 7 — fetchCurrentCampaignStatuses reads campaign_registry
// (not campaigns_daily) and broadcasts each campaign's status to all of
// its adsets via adsets_daily lookup.

import { describe, expect, it, vi, beforeEach } from 'vitest';

const fromMock = vi.fn();
vi.mock('@/lib/supabaseAdmin', () => ({
  getSupabaseAdmin: () => ({ from: fromMock }),
}));

import { fetchCurrentCampaignStatuses } from '@/lib/postgresReaders';

describe('fetchCurrentCampaignStatuses → campaign_registry', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("reads campaign_registry (not campaigns_daily)", async () => {
    // First call (registry): 1 row.
    // Second call (adsets_daily distinct ad_set_ids): 2 rows.
    const registryChain = {
      select: vi.fn().mockReturnThis(),
      not:    vi.fn().mockReturnThis(),
      range:  vi.fn().mockResolvedValue({ data: [{
        store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1',
        effective_status: 'PAUSED',
        last_seen_at: '2026-05-30T10:00:00Z',
      }], error: null }),
    };
    const adsetsChain = {
      select: vi.fn().mockReturnThis(),
      eq:     vi.fn().mockReturnThis(),
      range:  vi.fn().mockResolvedValue({ data: [
        { store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1', ad_set_id: 'AS1' },
        { store_id: 'uzoshop', platform: 'meta', campaign_id: 'C1', ad_set_id: 'AS2' },
      ], error: null }),
    };
    fromMock
      .mockReturnValueOnce(registryChain)
      .mockReturnValueOnce(adsetsChain);

    const result = await fetchCurrentCampaignStatuses();
    expect(fromMock).toHaveBeenNthCalledWith(1, 'campaign_registry');
    // Result map key shape is `${storeId}::${TitlePlatform}::${campaignId}::${adSetId}`.
    expect(result['uzoshop::Meta::C1::AS1']).toEqual({
      status: 'PAUSED',
      updatedAt: '2026-05-30T10:00:00Z',
    });
    expect(result['uzoshop::Meta::C1::AS2']).toEqual({
      status: 'PAUSED',
      updatedAt: '2026-05-30T10:00:00Z',
    });
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

Run:
```bash
cd /Users/dorperetz/script-roas/dashboard-web && npx vitest run src/lib/__tests__/fetchCurrentCampaignStatusesRegistry.test.ts
```
Expected: FAIL — current impl still selects from `campaigns_daily`.

- [ ] **Step 3: Refactor `fetchCurrentCampaignStatuses`**

Replace the entire function body (lines ~784-835 in `postgresReaders.ts`) with:

```typescript
export async function fetchCurrentCampaignStatuses(): Promise<
  Record<string, CurrentEffectiveStatusEntry>
> {
  const out: Record<string, CurrentEffectiveStatusEntry> = {};
  // 1. Read absolute-latest status for every campaign from the registry.
  //    Phase D (2026-05-30) — previously this was a 60-day SELECT over
  //    campaigns_daily ordered by updated_at DESC. Registry IS the
  //    authoritative source post-Phase-B: every (store, platform,
  //    campaign_id) has exactly one row whose effective_status was
  //    last refreshed by the status-scope worker (≤10 min lag).
  let registry: DbRow[];
  try {
    registry = await paginate<DbRow>(() => {
      return getSupabase()
        .from('campaign_registry')
        .select('store_id, platform, campaign_id, effective_status, last_seen_at')
        .not('effective_status', 'is', null);
    });
  } catch (e) {
    console.warn(`postgresReaders.fetchCurrentCampaignStatuses (registry): ${(e as Error).message}`);
    return out;
  }

  // 2. Build a campaign-level map of status → updatedAt.
  type CampaignStatus = { status: string; updatedAt: string };
  const byCampaign = new Map<string, CampaignStatus>();
  for (const r of registry) {
    const storeId    = String(r.store_id ?? '');
    const platform   = titleCasePlatform(r.platform);
    const campaignId = String(r.campaign_id ?? '');
    if (!storeId || !campaignId) continue;
    const status = String(r.effective_status ?? '').trim();
    if (!status) continue;
    const updatedAt = r.last_seen_at ? String(r.last_seen_at) : '';
    if (!updatedAt) continue;
    byCampaign.set(`${storeId}::${platform}::${campaignId}`, { status, updatedAt });
  }

  // 3. For every (store, platform, campaign) we have a status for, look up
  //    all of its ad_set_ids from adsets_daily and broadcast the campaign
  //    status to each. Keeps the existing key shape so callers don't change.
  let adsets: DbRow[];
  try {
    adsets = await paginate<DbRow>(() => {
      return getSupabase()
        .from('adsets_daily')
        .select('store_id, platform, campaign_id, ad_set_id');
    });
  } catch (e) {
    console.warn(`postgresReaders.fetchCurrentCampaignStatuses (adsets): ${(e as Error).message}`);
    return out;
  }
  const seen = new Set<string>();
  for (const r of adsets) {
    const storeId    = String(r.store_id ?? '');
    const platform   = titleCasePlatform(r.platform);
    const campaignId = String(r.campaign_id ?? '');
    const adSetId    = String(r.ad_set_id ?? '');
    if (!storeId || !campaignId || !adSetId) continue;
    const campaignKey = `${storeId}::${platform}::${campaignId}`;
    const status = byCampaign.get(campaignKey);
    if (!status) continue;
    const key = `${campaignKey}::${adSetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out[key] = { status: status.status, updatedAt: status.updatedAt };
  }
  return out;
}
```

- [ ] **Step 4: Run the test + suite**

Run:
```bash
cd /Users/dorperetz/script-roas/dashboard-web && \
  npx vitest run src/lib/__tests__/fetchCurrentCampaignStatusesRegistry.test.ts && \
  npm test
```
Expected: new test green; existing fetchCurrentCampaignStatuses callers don't break (key shape preserved).

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/lib/postgresReaders.ts \
        dashboard-web/src/lib/__tests__/fetchCurrentCampaignStatusesRegistry.test.ts
git commit -m "$(cat <<'EOF'
refactor(phase-d-task-7): fetchCurrentCampaignStatuses reads campaign_registry

Registry is authoritative for absolute-latest status post-Phase-B.
Drops the 60-day campaigns_daily ordered scan in favor of a 2-query
read: 1) registry one row per campaign; 2) adsets_daily distinct
ad_set_ids; broadcast campaign status to every ad_set. Returned-map
key shape preserved so callers don't change.

Spec: docs/superpowers/specs/2026-05-30-phase-d-registry-status-cutover-design.md §3.4 (Backend)
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: Frontend — shared `statusClassification.ts` helper

**Files:**
- Create: `dashboard-web/src/lib/registries/statusClassification.ts`
- Test: `dashboard-web/src/lib/registries/__tests__/statusClassification.test.ts`

A pure module that the chip in `CampaignsTableRow` and the section in `CampaignDrawerStatusSection` both consume. One source of truth for the {`regDeliveryStatus` × fallback chain} → {label, tone, isOff} mapping. Avoids duplicating the rules in two render sites.

- [ ] **Step 1: Write the failing test**

Create `dashboard-web/src/lib/registries/__tests__/statusClassification.test.ts`:

```typescript
// dashboard-web/src/lib/registries/__tests__/statusClassification.test.ts
//
// Phase D Task 8 — single source of truth for translating
// (regDeliveryStatus, regEffectiveStatus, legacyEffectiveStatus,
//  platform, lastActiveDate, today) → { label, tone, isOff }.

import { describe, expect, it } from 'vitest';
import { classifyCampaignStatus } from '@/lib/registries/statusClassification';

describe('classifyCampaignStatus', () => {
  const TODAY = '2026-05-30';

  it("DELIVERING → 'מציג' chip + isOff=false (green tone)", () => {
    const r = classifyCampaignStatus({
      regDeliveryStatus: 'DELIVERING', regEffectiveStatus: 'ACTIVE',
      regConfiguredStatus: 'ENABLED',
      legacyEffectiveStatus: 'ACTIVE', platform: 'Meta',
      lastActiveDate: TODAY, today: TODAY,
    });
    expect(r.isOff).toBe(false);
    expect(r.tone).toBe('green');
  });

  it("NOT_DELIVERING → 'כבוי' chip + isOff=true (gray)", () => {
    const r = classifyCampaignStatus({
      regDeliveryStatus: 'NOT_DELIVERING', regEffectiveStatus: 'PAUSED',
      regConfiguredStatus: 'PAUSED',
      legacyEffectiveStatus: 'PAUSED', platform: 'Meta',
      lastActiveDate: TODAY, today: TODAY,
    });
    expect(r.isOff).toBe(true);
    expect(r.tone).toBe('gray');
  });

  it("LIMITED (BUDGET_EXCEED) → 'מוגבל' chip + isOff=false (orange)", () => {
    const r = classifyCampaignStatus({
      regDeliveryStatus: 'LIMITED', regEffectiveStatus: 'ADGROUP_STATUS_BUDGET_EXCEED',
      regConfiguredStatus: 'ENABLED',
      legacyEffectiveStatus: 'ADGROUP_STATUS_BUDGET_EXCEED', platform: 'TikTok',
      lastActiveDate: TODAY, today: TODAY,
    });
    expect(r.isOff).toBe(false);
    expect(r.tone).toBe('orange');
  });

  it("PENDING_REVIEW → 'בבדיקה' (blue) + isOff=false", () => {
    const r = classifyCampaignStatus({
      regDeliveryStatus: 'PENDING_REVIEW', regEffectiveStatus: 'PENDING_REVIEW',
      regConfiguredStatus: 'ENABLED',
      legacyEffectiveStatus: 'PENDING_REVIEW', platform: 'Meta',
      lastActiveDate: TODAY, today: TODAY,
    });
    expect(r.isOff).toBe(false);
    expect(r.tone).toBe('blue');
  });

  it("BACKFILL_UNKNOWN configured → special 'טוען מ-Platform' chip flag", () => {
    const r = classifyCampaignStatus({
      regDeliveryStatus: 'DELIVERING', regEffectiveStatus: 'ACTIVE',
      regConfiguredStatus: 'BACKFILL_UNKNOWN',
      legacyEffectiveStatus: 'ACTIVE', platform: 'Meta',
      lastActiveDate: TODAY, today: TODAY,
    });
    expect(r.isBackfillUnknown).toBe(true);
  });

  it('reg fields null → falls back to legacyEffectiveStatus + 2-day heuristic', () => {
    const r = classifyCampaignStatus({
      regDeliveryStatus: null, regEffectiveStatus: null,
      regConfiguredStatus: null,
      legacyEffectiveStatus: 'PAUSED', platform: 'Meta',
      lastActiveDate: '2026-05-26', today: '2026-05-30',
    });
    expect(r.isOff).toBe(true);                                 // legacy heuristic + Meta PAUSED
  });

  it("UNKNOWN reg + null legacy + 4-day-old lastActive → isOff=true", () => {
    const r = classifyCampaignStatus({
      regDeliveryStatus: 'UNKNOWN', regEffectiveStatus: null,
      regConfiguredStatus: null,
      legacyEffectiveStatus: null, platform: 'Meta',
      lastActiveDate: '2026-05-26', today: '2026-05-30',
    });
    expect(r.isOff).toBe(true);                                 // 4-day heuristic
  });
});
```

- [ ] **Step 2: Run the test — confirm it fails**

Run:
```bash
cd /Users/dorperetz/script-roas/dashboard-web && npx vitest run src/lib/registries/__tests__/statusClassification.test.ts
```
Expected: FAIL — `classifyCampaignStatus` is not defined.

- [ ] **Step 3: Create `statusClassification.ts`**

Create `dashboard-web/src/lib/registries/statusClassification.ts`:

```typescript
// dashboard-web/src/lib/registries/statusClassification.ts
//
// Phase D (2026-05-30) — Single source of truth for translating registry-
// backed status fields into a UI-ready {label, tone, isOff, isBackfillUnknown}
// triple. Consumed by CampaignsTableRow (chip) and CampaignDrawerStatusSection
// (panel).
//
// Decision precedence:
//   1. regConfiguredStatus === 'BACKFILL_UNKNOWN' → flag for the
//      "טוען מ-Platform — ימולא תוך 10 דק׳" badge.
//   2. regDeliveryStatus !== null and !== 'UNKNOWN' → use it directly
//      (DELIVERING / NOT_DELIVERING / LIMITED / PENDING_REVIEW / LEARNING /
//      REJECTED).
//   3. regEffectiveStatus !== null → classify via platform-specific rules
//      (Meta ACTIVE, Google ENABLED, TikTok TIKTOK_OFF / TIKTOK_ACTIVE_ENOUGH).
//   4. legacyEffectiveStatus → classify via the same Phase-05.7.x rules
//      (kept as fallback for the surgical Task 5 / Task 10 sequencing).
//   5. lastActiveDate heuristic — older than today − OFF_RECENCY_DAYS → off.
//
// The fallback chain (3 → 4) deliberately collapses regEffectiveStatus and
// legacyEffectiveStatus to the same classifier because they're the same
// platform-native enum.

import { TIKTOK_ACTIVE_ENOUGH, TIKTOK_OFF_STATUSES } from '@/lib/registries/tiktokStatusSets';

/** 2-day inactivity threshold for the lastActiveDate heuristic. */
export const OFF_RECENCY_DAYS = 2;

export type DeliveryTone = 'green' | 'orange' | 'red' | 'blue' | 'gray';

export type CampaignStatusInputs = {
  regDeliveryStatus: string | null;
  regEffectiveStatus: string | null;
  regConfiguredStatus: string | null;
  legacyEffectiveStatus: string | null;
  platform: string;
  lastActiveDate: string | null;
  today: string;
};

export type CampaignStatusVerdict = {
  /** Hebrew label for the chip / panel row. */
  label: string;
  /** Tone bucket — maps to tailwind via the consumer's `TONE_BG` table. */
  tone: DeliveryTone;
  /** True when the operator should treat this campaign as "currently off". */
  isOff: boolean;
  /**
   * True when configured_status is the backfill sentinel — UI should show
   * a tiny secondary chip ("טוען מ-Platform — ימולא תוך ~10 דק׳") so the
   * operator knows the platform-native value hasn't been observed yet.
   */
  isBackfillUnknown: boolean;
};

function isOffFromLegacyEffectiveStatus(
  effective: string,
  platform: string,
): boolean | null {
  const norm = effective.trim().toUpperCase();
  switch ((platform || '').toLowerCase()) {
    case 'meta':   return norm !== 'ACTIVE';
    case 'google': return norm !== 'ENABLED';
    case 'tiktok':
      if (TIKTOK_OFF_STATUSES.has(norm))    return true;
      if (TIKTOK_ACTIVE_ENOUGH.has(norm))   return false;
      return null;                                            // unknown TT enum → caller falls back
    default: return null;
  }
}

function isOffFromLastActive(lastActiveDate: string | null, today: string): boolean {
  if (!lastActiveDate) return false;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) return false;
  const [yyyy, mm, dd] = today.split('-').map(Number);
  const todayMs = Date.UTC(yyyy, mm - 1, dd);
  const thresholdMs = todayMs - OFF_RECENCY_DAYS * 86_400_000;
  const threshold = new Date(thresholdMs).toISOString().slice(0, 10);
  return lastActiveDate < threshold;
}

export function classifyCampaignStatus(p: CampaignStatusInputs): CampaignStatusVerdict {
  const isBackfillUnknown = p.regConfiguredStatus === 'BACKFILL_UNKNOWN';

  // 2. Use registry delivery_status if it's resolved (i.e. not UNKNOWN/null).
  if (p.regDeliveryStatus && p.regDeliveryStatus !== 'UNKNOWN') {
    switch (p.regDeliveryStatus) {
      case 'DELIVERING':
        return { label: 'מציג',    tone: 'green',  isOff: false, isBackfillUnknown };
      case 'NOT_DELIVERING':
        return { label: 'כבוי',    tone: 'gray',   isOff: true,  isBackfillUnknown };
      case 'LIMITED':
        return { label: 'מוגבל',   tone: 'orange', isOff: false, isBackfillUnknown };
      case 'PENDING_REVIEW':
        return { label: 'בבדיקה',  tone: 'blue',   isOff: false, isBackfillUnknown };
      case 'LEARNING':
        return { label: 'בלמידה',  tone: 'blue',   isOff: false, isBackfillUnknown };
      case 'REJECTED':
        return { label: 'נדחה',    tone: 'red',    isOff: true,  isBackfillUnknown };
    }
  }

  // 3. → 4. Classify via the platform-native enum.
  const native = p.regEffectiveStatus ?? p.legacyEffectiveStatus;
  if (native) {
    const off = isOffFromLegacyEffectiveStatus(native, p.platform);
    if (off === true)  return { label: 'כבוי',  tone: 'gray',  isOff: true,  isBackfillUnknown };
    if (off === false) return { label: 'מציג',  tone: 'green', isOff: false, isBackfillUnknown };
    // off === null: unknown TT enum or unknown platform → fall through.
  }

  // 5. Heuristic.
  const heuristicOff = isOffFromLastActive(p.lastActiveDate, p.today);
  return {
    label: heuristicOff ? 'כבוי' : 'לא ידוע',
    tone:  heuristicOff ? 'gray' : 'gray',
    isOff: heuristicOff,
    isBackfillUnknown,
  };
}
```

- [ ] **Step 4: Create the TikTok status sets module if it doesn't yet exist**

Run:
```bash
cd /Users/dorperetz/script-roas/dashboard-web && ls src/lib/registries/tiktokStatusSets.ts 2>/dev/null
```

If missing, create it:

```typescript
// dashboard-web/src/lib/registries/tiktokStatusSets.ts
//
// Shared TikTok ad-group status sets. Previously lived in
// CampaignsTableRow.tsx (TIKTOK_OFF_STATUSES + TIKTOK_ACTIVE_ENOUGH).
// Extracted here so statusClassification.ts can reuse them.

export const TIKTOK_OFF_STATUSES = new Set([
  'ADGROUP_STATUS_DISABLE',
  'ADGROUP_STATUS_TIMEDOUT',
  'ADGROUP_STATUS_FROZEN',
  'ADGROUP_STATUS_ARCHIVED',
  'ADGROUP_STATUS_DELETE',
  'ADGROUP_STATUS_CAMPAIGN_DISABLE',
  'ADGROUP_STATUS_ADVERTISER_AUDIT_DENY',
  'ADGROUP_STATUS_ADVERTISER_FROZEN',
  'ADGROUP_STATUS_ADVERTISER_BUDGET_EXCEED',
  'ADGROUP_STATUS_BALANCE_EXCEED',
  'ADGROUP_STATUS_AUDIT_DENY',
]);

export const TIKTOK_ACTIVE_ENOUGH = new Set([
  'ADGROUP_STATUS_DELIVERY_OK',
  'ADGROUP_STATUS_BUDGET_EXCEED',
  'ADGROUP_STATUS_AUDIT',
  'ADGROUP_STATUS_REVIEWING',
  'ADGROUP_STATUS_NOT_START',
]);
```

If it already exists, skip creation but confirm both Sets are exported with identical names.

- [ ] **Step 5: Run the test + suite**

Run:
```bash
cd /Users/dorperetz/script-roas/dashboard-web && \
  npx vitest run src/lib/registries/__tests__/statusClassification.test.ts && \
  npx tsc --noEmit
```
Expected: 7/7 PASS; tsc clean.

- [ ] **Step 6: Commit**

```bash
git add dashboard-web/src/lib/registries/statusClassification.ts \
        dashboard-web/src/lib/registries/tiktokStatusSets.ts \
        dashboard-web/src/lib/registries/__tests__/statusClassification.test.ts
git commit -m "$(cat <<'EOF'
feat(phase-d-task-8): shared classifyCampaignStatus for chip + panel reuse

Pure module that translates (regDelivery, regEffective, legacy, platform,
lastActive, today) → {label, tone, isOff, isBackfillUnknown}. Consumed
by CampaignsTableRow (chip) and CampaignDrawerStatusSection (panel) so
the rules don't fork. Extracted TIKTOK_OFF_STATUSES + TIKTOK_ACTIVE_ENOUGH
into tiktokStatusSets.ts for the same reuse.

Spec: docs/superpowers/specs/2026-05-30-phase-d-registry-status-cutover-design.md §3.4 (Frontend)
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Frontend — `campaignsAggregator` passes `reg*` through to `Aggregated`

**Files:**
- Modify: `dashboard-web/src/lib/campaignsAggregator.ts`
- Test: `dashboard-web/src/lib/__tests__/campaignsAggregatorPassesRegFields.test.ts` (new)

`Aggregated` (line ~108 onward) gains the same 6 `reg*` fields. The aggregator's first-row seed copies them from the seed row; subsequent rows for the same key inherit unchanged (registry values are constant per campaign — the per-day variance lives only on `effective_status` in the daily, which we no longer aggregate over).

- [ ] **Step 1: Write the failing test**

Create `dashboard-web/src/lib/__tests__/campaignsAggregatorPassesRegFields.test.ts`:

```typescript
// dashboard-web/src/lib/__tests__/campaignsAggregatorPassesRegFields.test.ts

import { describe, expect, it } from 'vitest';
import { aggregate, type CampaignRow } from '@/lib/campaignsAggregator';

const baseRow = (overrides: Partial<CampaignRow>): CampaignRow => ({
  date: '2026-05-30',
  storeId: 'uzoshop',
  storeName: 'uzoshop',
  platform: 'Meta',
  campaignId: 'C1',
  campaignName: 'Test',
  adSetId: 'AS1',
  adSetName: 'AS',
  spend: 10,
  impressions: 100,
  clicks: 5,
  conversions: 1,
  conversionValue: 25,
  campaignBudgetCad: null,
  adSetBudgetCad: null,
  budgetType: '',
  effectiveStatus: null,
  lastLiveTickAt: null,
  regConfiguredStatus: null,
  regEffectiveStatus: null,
  regDeliveryStatus: null,
  regFirstSeenAt: null,
  regStatusChangedAt: null,
  regLastStatusSuccessAt: null,
  ...overrides,
});

describe('aggregate threads reg* fields through to Aggregated', () => {
  it('seeds the aggregate from the first matching CampaignRow', () => {
    const rows = [baseRow({
      regConfiguredStatus: 'ENABLED',
      regEffectiveStatus: 'ACTIVE',
      regDeliveryStatus: 'DELIVERING',
      regFirstSeenAt: '2026-05-20T00:00:00Z',
      regStatusChangedAt: '2026-05-28T12:00:00Z',
      regLastStatusSuccessAt: '2026-05-30T09:50:00Z',
    })];
    const out = aggregate(rows, 'campaign', 'All', 'all', { from: '2026-05-30', to: '2026-05-30' });
    expect(out).toHaveLength(1);
    expect(out[0].regConfiguredStatus).toBe('ENABLED');
    expect(out[0].regEffectiveStatus).toBe('ACTIVE');
    expect(out[0].regDeliveryStatus).toBe('DELIVERING');
    expect(out[0].regFirstSeenAt).toBe('2026-05-20T00:00:00Z');
    expect(out[0].regStatusChangedAt).toBe('2026-05-28T12:00:00Z');
    expect(out[0].regLastStatusSuccessAt).toBe('2026-05-30T09:50:00Z');
  });
});
```

- [ ] **Step 2: Run — confirm it fails**

Run:
```bash
cd /Users/dorperetz/script-roas/dashboard-web && npx vitest run src/lib/__tests__/campaignsAggregatorPassesRegFields.test.ts
```
Expected: FAIL — `regConfiguredStatus` is `undefined` on the aggregate.

- [ ] **Step 3: Extend `Aggregated` type in `campaignsAggregator.ts`**

Find the `Aggregated` type definition (around line 75-119). Add 6 fields after `lastLiveTickAt: string | null;`:

```typescript
  /**
   * Phase D (2026-05-30) — registry-backed status. Constant across the
   * per-day rows that fold into this aggregate; seeded from the first row
   * and never overwritten because the registry doesn't vary by day.
   */
  regConfiguredStatus: string | null;
  regEffectiveStatus: string | null;
  regDeliveryStatus: string | null;
  regFirstSeenAt: string | null;
  regStatusChangedAt: string | null;
  regLastStatusSuccessAt: string | null;
```

- [ ] **Step 4: Wire seed-pass to copy the 6 reg* fields**

In `aggregate(...)` (line ~167 onward), find the `if (!map.has(key)) { map.set(key, { … }); }` block and add the 6 fields right after `lastLiveTickAt: r.lastLiveTickAt ?? null,`:

```typescript
        regConfiguredStatus: r.regConfiguredStatus,
        regEffectiveStatus: r.regEffectiveStatus,
        regDeliveryStatus: r.regDeliveryStatus,
        regFirstSeenAt: r.regFirstSeenAt,
        regStatusChangedAt: r.regStatusChangedAt,
        regLastStatusSuccessAt: r.regLastStatusSuccessAt,
```

- [ ] **Step 5: Run the test + full suite + tsc**

Run:
```bash
cd /Users/dorperetz/script-roas/dashboard-web && \
  npx vitest run src/lib/__tests__/campaignsAggregatorPassesRegFields.test.ts && \
  npx tsc --noEmit && \
  npm test
```
Expected: new test green; tsc clean; full suite green (a few fixtures may need the 6 reg* nulls — patch them mechanically as in Task 5 Step 7).

- [ ] **Step 6: Commit**

```bash
git add dashboard-web/src/lib/campaignsAggregator.ts \
        dashboard-web/src/lib/__tests__/campaignsAggregatorPassesRegFields.test.ts \
        $(git diff --name-only)
git commit -m "$(cat <<'EOF'
feat(phase-d-task-9): campaignsAggregator threads 6 reg* fields onto Aggregated

Aggregated gains regConfiguredStatus, regEffectiveStatus,
regDeliveryStatus, regFirstSeenAt, regStatusChangedAt,
regLastStatusSuccessAt. Seeded from the first matching CampaignRow;
not overwritten by subsequent rows because the registry is constant
across days for a (store, platform, campaign).

Spec: docs/superpowers/specs/2026-05-30-phase-d-registry-status-cutover-design.md §3.4 (Frontend)
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 10: Frontend — `CampaignsTableRow` consumes the classifier

**Files:**
- Modify: `dashboard-web/src/components/CampaignsTableRow.tsx`

Today the row computes `isCurrentlyOff = isCampaignOff(a.effectiveStatus, a.platform, a.lastActiveDate, today)` (line 315). Replace with `classifyCampaignStatus({...})` from Task 8. Render the BACKFILL_UNKNOWN secondary chip when the classifier says so.

- [ ] **Step 1: Rewrite the off-detection block**

In `dashboard-web/src/components/CampaignsTableRow.tsx`:

**Replace line 315:**
```typescript
const isCurrentlyOff = isCampaignOff(a.effectiveStatus, a.platform, a.lastActiveDate, today);
```

**With:**
```typescript
// Phase D (2026-05-30) — single classifier consumes registry + legacy +
// heuristic precedence. Returns a 4-tuple the chip rendering below uses.
const statusVerdict = classifyCampaignStatus({
  regDeliveryStatus: a.regDeliveryStatus,
  regEffectiveStatus: a.regEffectiveStatus,
  regConfiguredStatus: a.regConfiguredStatus,
  legacyEffectiveStatus: a.effectiveStatus,
  platform: a.platform,
  lastActiveDate: a.lastActiveDate,
  today,
});
const isCurrentlyOff = statusVerdict.isOff;
```

- [ ] **Step 2: Add the import at top of file (line 17)**

Add to imports near `import { CampaignFreshnessChip } …`:
```typescript
import { classifyCampaignStatus } from '@/lib/registries/statusClassification';
```

- [ ] **Step 3: Render the BACKFILL_UNKNOWN secondary chip**

Find the closing `</div>` of the chip row in CampaignsTableRow (immediately after the `<CampaignFreshnessChip … />` element, around line 486). **Before** that closing `</div>`, add:

```typescript
              {/* Phase D (2026-05-30) — surfaces the moment a registry row's
                  configured_status is still the BACKFILL_UNKNOWN sentinel
                  (i.e. the platform's native value hasn't been observed
                  since the Phase D backfill). Disappears within ~10 min
                  once the next orchestrator tick runs the status worker. */}
              {statusVerdict.isBackfillUnknown && (
                <span
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold tracking-wider shrink-0 bg-amber-50 text-amber-700 border border-amber-200"
                  title="הסטטוס המוגדר עדיין לא נדגם מה-platform — ימולא בעוד עד 10 דק׳."
                >
                  ⏳ טוען מ-Platform
                </span>
              )}
```

- [ ] **Step 4: Delete the dead `isCampaignOff` export and helper**

The exported `isCampaignOff` function (lines 258-286) is now only consumed by `CampaignsTableRow.tsx` itself, which uses `classifyCampaignStatus` instead. Search to confirm:

```bash
cd /Users/dorperetz/script-roas/dashboard-web && grep -rn "isCampaignOff" src/ | grep -v __tests__ | grep -v CampaignsTableRow.tsx
```

If the search returns 0 lines, delete `isCampaignOff`, `TIKTOK_OFF_STATUSES`, and `TIKTOK_ACTIVE_ENOUGH` (lines 204-286 + line 147) from `CampaignsTableRow.tsx`. The TT sets are now exclusively in `lib/registries/tiktokStatusSets.ts` (Task 8 Step 4). The `OFF_RECENCY_DAYS` export is still consumed by its own DOM test — keep it.

If the search returns hits, just leave the helpers in place; Task 16 cleanup will trim.

- [ ] **Step 5: Update any tests that directly imported `isCampaignOff`**

If you deleted the helper in Step 4, patch any test that imported it to import `classifyCampaignStatus` instead. Run:

```bash
cd /Users/dorperetz/script-roas/dashboard-web && grep -rn "isCampaignOff\|TIKTOK_OFF_STATUSES" src/__tests__ src/lib/__tests__ src/components/__tests__ 2>/dev/null | head -10
```

Mechanically replace any `isCampaignOff(es, plat, last, today)` call with the matching `classifyCampaignStatus({...}).isOff` shape.

- [ ] **Step 6: Run tsc + suite**

Run:
```bash
cd /Users/dorperetz/script-roas/dashboard-web && npx tsc --noEmit && npm test
```
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add dashboard-web/src/components/CampaignsTableRow.tsx $(git diff --name-only)
git commit -m "$(cat <<'EOF'
feat(phase-d-task-10): CampaignsTableRow uses classifyCampaignStatus

Row now derives isOff + tone + label via the shared classifier
(reg_delivery_status → reg_effective_status → legacy → heuristic).
BACKFILL_UNKNOWN configured_status surfaces a small "טוען מ-Platform"
secondary chip. Dead local TT sets + isCampaignOff helper removed
(both now live in lib/registries/{tiktokStatusSets,statusClassification}).

Spec: docs/superpowers/specs/2026-05-30-phase-d-registry-status-cutover-design.md §3.4 (Frontend)
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 11: Frontend — `ProductCentricView` + `CohortComparisonPanel` swap to registry fields

**Files:**
- Modify: `dashboard-web/src/components/ProductCentricView.tsx` (lines 627-629)
- Modify: `dashboard-web/src/components/CohortComparisonPanel.tsx` (line 191)

Both have a single-spot consumer of `m.effectiveStatus` / `metrics?.effectiveStatus`. Swap to `regEffectiveStatus` and fall back to legacy.

- [ ] **Step 1: Patch ProductCentricView.tsx**

Find lines 626-630 (the `is_active` derivation):

**Before:**
```typescript
                      m.effectiveStatus === 'ACTIVE' ||
                      m.effectiveStatus === 'ENABLED' ||
                      m.effectiveStatus === 'ADGROUP_STATUS_DELIVERY_OK';
```

**After:**
```typescript
                      // Phase D (2026-05-30) — prefer registry-backed
                      // delivery_status (always-fresh ≤10 min); fall back
                      // to legacy effectiveStatus when null.
                      (m.regDeliveryStatus
                        ? m.regDeliveryStatus === 'DELIVERING'
                        : m.effectiveStatus === 'ACTIVE' ||
                          m.effectiveStatus === 'ENABLED' ||
                          m.effectiveStatus === 'ADGROUP_STATUS_DELIVERY_OK');
```

- [ ] **Step 2: Patch CohortComparisonPanel.tsx**

Line 191:

**Before:**
```typescript
        <StatusBadge status={metrics?.effectiveStatus ?? null} />
```

**After:**
```typescript
        {/* Phase D (2026-05-30) — prefer reg_effective_status; fall back
            to legacy. */}
        <StatusBadge status={metrics?.regEffectiveStatus ?? metrics?.effectiveStatus ?? null} />
```

- [ ] **Step 3: tsc + suite**

Run:
```bash
cd /Users/dorperetz/script-roas/dashboard-web && npx tsc --noEmit && npm test
```
Expected: green. The metrics type already gained the field in Task 9.

- [ ] **Step 4: Commit**

```bash
git add dashboard-web/src/components/ProductCentricView.tsx \
        dashboard-web/src/components/CohortComparisonPanel.tsx
git commit -m "$(cat <<'EOF'
feat(phase-d-task-11): ProductCentricView + CohortComparisonPanel prefer reg_*

Both call-sites now prefer regDeliveryStatus / regEffectiveStatus
with legacy fallback. Mirrors the Task 10 chip cutover for the
two remaining single-spot status consumers in the dashboard.

Spec: docs/superpowers/specs/2026-05-30-phase-d-registry-status-cutover-design.md §3.4 (Frontend)
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 12: Frontend — `CampaignDrawer` threads reg_* into `CampaignDrawerStatusSection`

**Files:**
- Modify: `dashboard-web/src/components/CampaignDrawer.tsx` (lines 740-865)

Today's drawer derives `effectiveStatus` + `lastLiveTickAt` from the row sweep (lines 758-774) and passes `configuredStatus={null}` / `deliveryStatus={null}` to the section (lines 857-863). Phase D: pull all 5 status fields from the first CampaignRow that has them (they're constant per campaign, by Task 9's seed-only invariant).

- [ ] **Step 1: Replace the `statusSectionData` IIFE**

Locate the block at lines 758-774 (the `const statusSectionData = (() => { … })();` IIFE). Replace it entirely with:

```typescript
  // Phase D (2026-05-30) — every CampaignRow has the same reg_* values
  // (registry is constant per (store, platform, campaign)). Pick from
  // the first row that has them; fall back to per-row sweep for any
  // field still on the legacy daily-only path.
  const statusSectionData = (() => {
    let regConfiguredStatus: string | null = null;
    let regEffectiveStatus: string | null = null;
    let regDeliveryStatus: string | null = null;
    let regFirstSeenAt: string | null = null;
    let regStatusChangedAt: string | null = null;
    let regLastStatusSuccessAt: string | null = null;
    let lastLiveTickAt: string | null = null;
    let lastLiveTickDate = '';
    for (const r of rows) {
      // Registry is constant across rows for this campaign — copy once
      // from the first row that has it.
      regConfiguredStatus    ??= r.regConfiguredStatus;
      regEffectiveStatus     ??= r.regEffectiveStatus;
      regDeliveryStatus      ??= r.regDeliveryStatus;
      regFirstSeenAt         ??= r.regFirstSeenAt;
      regStatusChangedAt     ??= r.regStatusChangedAt;
      regLastStatusSuccessAt ??= r.regLastStatusSuccessAt;
      // lastLiveTickAt remains per-row (per-day truthiness varies).
      if (r.lastLiveTickAt && r.date > lastLiveTickDate) {
        lastLiveTickAt = r.lastLiveTickAt;
        lastLiveTickDate = r.date;
      }
    }
    return {
      regConfiguredStatus, regEffectiveStatus, regDeliveryStatus,
      regFirstSeenAt, regStatusChangedAt, regLastStatusSuccessAt,
      lastLiveTickAt,
    };
  })();
```

- [ ] **Step 2: Replace the `<CampaignDrawerStatusSection />` call**

Locate the JSX at lines 856-864. Replace with:

```typescript
          <CampaignDrawerStatusSection
            configuredStatus={statusSectionData.regConfiguredStatus}
            effectiveStatus={statusSectionData.regEffectiveStatus}
            deliveryStatus={statusSectionData.regDeliveryStatus}
            firstSeenAt={statusSectionData.regFirstSeenAt}
            statusChangedAt={statusSectionData.regStatusChangedAt}
            lastStatusSuccessAt={statusSectionData.regLastStatusSuccessAt}
            lastLiveTickAt={statusSectionData.lastLiveTickAt}
            metricsLagMinutes={null}
          />
```

(The new `lastStatusSuccessAt` prop is added in Task 13's expanded section.)

- [ ] **Step 3: tsc + suite**

Run:
```bash
cd /Users/dorperetz/script-roas/dashboard-web && npx tsc --noEmit && npm test
```
Expected: tsc complains about the new `lastStatusSuccessAt` prop on `CampaignDrawerStatusSectionProps` (added in next task). Continue.

- [ ] **Step 4: Commit (will be re-tested after Task 13)**

```bash
git add dashboard-web/src/components/CampaignDrawer.tsx
git commit -m "$(cat <<'EOF'
feat(phase-d-task-12): CampaignDrawer wires reg_* into status section

Drawer pulls regConfigured/regEffective/regDelivery/regFirstSeen/
regStatusChanged/regLastStatusSuccess from the first row that has
them (registry is constant per (store, platform, campaign)) and
forwards them to CampaignDrawerStatusSection. configuredStatus +
deliveryStatus no longer hardcoded null.

New lastStatusSuccessAt prop will be accepted by the expanded
section in Task 13 — tsc stays red until then.

Spec: docs/superpowers/specs/2026-05-30-phase-d-registry-status-cutover-design.md §3.4 (Frontend)
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 13: Frontend — `CampaignDrawerStatusSection` expands minimal → full

**Files:**
- Modify: `dashboard-web/src/components/CampaignDrawerStatusSection.tsx`
- Test: `dashboard-web/src/components/__tests__/campaignDrawerStatusSectionFull.test.tsx` (new)

Expand the Phase C "minimal" section to display all 5 status fields side-by-side + a tiny status-change timeline (first_seen → status_changed → last_status_success).

- [ ] **Step 1: Write the failing DOM test**

Create `dashboard-web/src/components/__tests__/campaignDrawerStatusSectionFull.test.tsx`:

```typescript
// dashboard-web/src/components/__tests__/campaignDrawerStatusSectionFull.test.tsx
//
// Phase D Task 13 — full status section renders 5 status fields, a
// 3-event timeline, and the BACKFILL_UNKNOWN warning when applicable.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CampaignDrawerStatusSection } from '@/components/CampaignDrawerStatusSection';

describe('CampaignDrawerStatusSection (Phase D — full)', () => {
  it('renders configured / effective / delivery side-by-side', () => {
    render(
      <CampaignDrawerStatusSection
        configuredStatus="ENABLED"
        effectiveStatus="ACTIVE"
        deliveryStatus="DELIVERING"
        firstSeenAt="2026-05-20T00:00:00Z"
        statusChangedAt="2026-05-28T12:00:00Z"
        lastStatusSuccessAt="2026-05-30T09:50:00Z"
        lastLiveTickAt="2026-05-30T10:00:00Z"
        metricsLagMinutes={5}
      />,
    );
    expect(screen.getByText('ENABLED')).toBeInTheDocument();
    expect(screen.getByText('ACTIVE')).toBeInTheDocument();
    expect(screen.getByText('DELIVERING')).toBeInTheDocument();
  });

  it('shows BACKFILL_UNKNOWN warning chip when configuredStatus is the sentinel', () => {
    render(
      <CampaignDrawerStatusSection
        configuredStatus="BACKFILL_UNKNOWN"
        effectiveStatus="ACTIVE"
        deliveryStatus="DELIVERING"
        firstSeenAt={null}
        statusChangedAt={null}
        lastStatusSuccessAt={null}
        lastLiveTickAt={null}
        metricsLagMinutes={null}
      />,
    );
    expect(screen.getByText(/טוען מ-Platform/)).toBeInTheDocument();
  });

  it('renders the 3-event timeline labels', () => {
    render(
      <CampaignDrawerStatusSection
        configuredStatus="ENABLED"
        effectiveStatus="ACTIVE"
        deliveryStatus="DELIVERING"
        firstSeenAt="2026-05-20T00:00:00Z"
        statusChangedAt="2026-05-28T12:00:00Z"
        lastStatusSuccessAt="2026-05-30T09:50:00Z"
        lastLiveTickAt="2026-05-30T10:00:00Z"
        metricsLagMinutes={5}
      />,
    );
    expect(screen.getByText(/נראה לראשונה/)).toBeInTheDocument();
    expect(screen.getByText(/שינוי סטטוס אחרון/)).toBeInTheDocument();
    expect(screen.getByText(/סטטוס נדגם בהצלחה/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run — confirm it fails**

Run:
```bash
cd /Users/dorperetz/script-roas/dashboard-web && npx vitest run src/components/__tests__/campaignDrawerStatusSectionFull.test.tsx
```
Expected: FAIL — the section doesn't render those strings yet (or props don't include `lastStatusSuccessAt`).

- [ ] **Step 3: Replace `CampaignDrawerStatusSection.tsx` with the full section**

Replace the file contents entirely:

```typescript
// dashboard-web/src/components/CampaignDrawerStatusSection.tsx
//
// Phase D (2026-05-30) — full status + freshness section. Expanded from
// the Phase C minimal panel. Displays the 3 status fields side-by-side
// (configured / effective / delivery), the BACKFILL_UNKNOWN sentinel
// warning when relevant, and a 3-event status-change timeline.
//
// Server-fetched on parent; receives props synchronously.

export type CampaignDrawerStatusSectionProps = {
  configuredStatus: string | null;
  effectiveStatus: string | null;
  deliveryStatus: string | null;
  firstSeenAt: string | null;
  statusChangedAt: string | null;
  lastStatusSuccessAt: string | null;
  lastLiveTickAt: string | null;
  metricsLagMinutes: number | null;
};

function relMin(min: number | null): string {
  if (min === null) return '—';
  if (min < 60)      return `${min} דק׳ לפני`;
  if (min < 60 * 24) return `${Math.floor(min / 60)} שע׳ לפני`;
  return `${Math.floor(min / 1440)} ימים לפני`;
}

function relIso(iso: string | null): string {
  if (!iso) return '—';
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  return relMin(min);
}

const DELIVERY_TONE: Record<string, string> = {
  DELIVERING:     'bg-status-greenBg text-status-greenFg',
  NOT_DELIVERING: 'bg-elevated2 text-ink-secondary',
  LIMITED:        'bg-status-orangeBg text-status-orangeFg',
  PENDING_REVIEW: 'bg-status-blueBg text-status-blueFg',
  LEARNING:       'bg-status-blueBg text-status-blueFg',
  REJECTED:       'bg-status-redBg text-status-redFg',
  UNKNOWN:        'bg-elevated2 text-ink-muted',
};

function deliveryClass(status: string | null): string {
  if (!status) return 'bg-elevated2 text-ink-muted';
  return DELIVERY_TONE[status] ?? 'bg-elevated2 text-ink-muted';
}

export function CampaignDrawerStatusSection(p: CampaignDrawerStatusSectionProps) {
  const isBackfillUnknown = p.configuredStatus === 'BACKFILL_UNKNOWN';

  return (
    <section className="border border-line-subtle rounded-lg p-4 my-3">
      <h3 className="text-sm font-medium text-ink-primary mb-3">סטטוס + טריות</h3>

      {/* Phase D — Top row: 3 status chips side by side. */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="flex flex-col items-start gap-1">
          <span className="text-[10px] text-ink-secondary">configured</span>
          <span className={
            'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ' +
            (isBackfillUnknown
              ? 'bg-amber-50 text-amber-700 border border-amber-200'
              : 'bg-elevated2 text-ink-primary')
          }>
            {isBackfillUnknown ? '⏳ טוען מ-Platform' : (p.configuredStatus ?? '—')}
          </span>
        </div>
        <div className="flex flex-col items-start gap-1">
          <span className="text-[10px] text-ink-secondary">effective</span>
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-elevated2 text-ink-primary">
            {p.effectiveStatus ?? '—'}
          </span>
        </div>
        <div className="flex flex-col items-start gap-1">
          <span className="text-[10px] text-ink-secondary">delivery</span>
          <span className={
            'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ' +
            deliveryClass(p.deliveryStatus)
          }>
            {p.deliveryStatus ?? '—'}
          </span>
        </div>
      </div>

      {/* BACKFILL_UNKNOWN explainer — only when active. */}
      {isBackfillUnknown && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1 mb-3">
          הסטטוס המוגדר מ-platform עדיין לא נדגם — המערכת מילאה את השדה
          באופן זמני מתוך הנתון היומי. הערך האמיתי ימולא בעוד עד 10 דקות
          ע״י ה-status worker.
        </p>
      )}

      {/* Phase D — 3-event timeline. */}
      <div className="border-t border-line-subtle pt-3">
        <h4 className="text-[11px] font-medium text-ink-secondary mb-2">היסטוריית סטטוס</h4>
        <div className="grid grid-cols-2 gap-y-1.5 text-xs">
          <span className="text-ink-secondary">נראה לראשונה</span>
          <span className="text-ink-primary">{relIso(p.firstSeenAt)}</span>
          <span className="text-ink-secondary">שינוי סטטוס אחרון</span>
          <span className="text-ink-primary">{relIso(p.statusChangedAt)}</span>
          <span className="text-ink-secondary">סטטוס נדגם בהצלחה</span>
          <span className="text-ink-primary">{relIso(p.lastStatusSuccessAt)}</span>
          <span className="text-ink-secondary">last_live_tick</span>
          <span className="text-ink-primary">{relIso(p.lastLiveTickAt)}</span>
          <span className="text-ink-secondary">metrics lag</span>
          <span className="text-ink-primary">{relMin(p.metricsLagMinutes)}</span>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 4: Run the test + tsc + full suite**

Run:
```bash
cd /Users/dorperetz/script-roas/dashboard-web && \
  npx vitest run src/components/__tests__/campaignDrawerStatusSectionFull.test.tsx && \
  npx tsc --noEmit && \
  npm test
```
Expected: new DOM test green; tsc clean (Task 12's new prop is now valid); full suite green.

- [ ] **Step 5: Commit**

```bash
git add dashboard-web/src/components/CampaignDrawerStatusSection.tsx \
        dashboard-web/src/components/__tests__/campaignDrawerStatusSectionFull.test.tsx
git commit -m "$(cat <<'EOF'
feat(phase-d-task-13): expand CampaignDrawerStatusSection to full layout

Phase D full section displays configured / effective / delivery
side-by-side with delivery_status tone chip, BACKFILL_UNKNOWN
explainer, and 3-event timeline (first_seen → status_changed →
last_status_success → last_live_tick). New lastStatusSuccessAt prop
fed by Task 12's drawer wiring.

Spec: docs/superpowers/specs/2026-05-30-phase-d-registry-status-cutover-design.md §3.4 (Frontend)
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 14: Live integrity — extend reconcile harness with coverage parity

**Files:**
- Create: `dashboard-web/src/lib/audit/__tests__/registryCoverageParity.live.test.ts`

A new live test that asserts the spec's acceptance criterion: every active campaign in `campaigns_daily` has a `campaign_registry` row, and same for adsets + ads. Gated by `AUDIT_LIVE=1`; runs in the same npm script as the Phase C.5 harness.

- [ ] **Step 1: Create the test file**

```typescript
// dashboard-web/src/lib/audit/__tests__/registryCoverageParity.live.test.ts
//
// AUDIT_LIVE=1 npm run audit:reconcile:hot-vs-heavy
//
// Phase D — verifies the acceptance criterion that triggers + backfill
// keep the 3 dailies in coverage parity with the 3 registries.
//
// Distinct-tuple coverage: every (store, platform, campaign_id) present
// in campaigns_daily has a row in campaign_registry. Same for adsets and
// ads. Tolerates registry having EXTRA rows (campaigns that retired
// before any daily activity — registry still has the row from status
// discovery).

import { describe, expect, it } from 'vitest';
import { getSupabaseAdmin } from '@/lib/supabaseAdmin';

const RUN = process.env.AUDIT_LIVE === '1';

(RUN ? describe : describe.skip)('Phase D coverage parity (registry ⊇ dailies)', () => {
  it('every campaigns_daily campaign has a campaign_registry row', async () => {
    const sb = getSupabaseAdmin();
    const [{ data: daily }, { data: registry }] = await Promise.all([
      sb.from('campaigns_daily').select('store_id, platform, campaign_id'),
      sb.from('campaign_registry').select('store_id, platform, campaign_id'),
    ]);
    const dailyKeys = new Set(
      (daily ?? []).map(r => `${r.store_id}/${r.platform}/${r.campaign_id}`),
    );
    const registryKeys = new Set(
      (registry ?? []).map(r => `${r.store_id}/${r.platform}/${r.campaign_id}`),
    );
    const missing: string[] = [];
    for (const k of dailyKeys) if (!registryKeys.has(k)) missing.push(k);
    if (missing.length > 0) {
      console.warn(`[coverage] missing campaign_registry rows for ${missing.length} tuples:\n` +
        missing.slice(0, 10).map(m => `  ${m}`).join('\n'));
    }
    expect(missing).toEqual([]);
  });

  it('every campaigns_daily ad_set has an adset_registry row', async () => {
    // adset-level coverage is derived from campaigns_daily, since there is
    // no separate adsets_daily table — campaigns_daily PK includes ad_set_id.
    const sb = getSupabaseAdmin();
    const [{ data: daily }, { data: registry }] = await Promise.all([
      sb.from('campaigns_daily').select('store_id, platform, ad_set_id'),
      sb.from('adset_registry').select('store_id, platform, adset_id'),
    ]);
    const dailyKeys = new Set(
      (daily ?? []).map(r => `${r.store_id}/${r.platform}/${r.ad_set_id}`),
    );
    const registryKeys = new Set(
      (registry ?? []).map(r => `${r.store_id}/${r.platform}/${r.adset_id}`),
    );
    const missing: string[] = [];
    for (const k of dailyKeys) if (!registryKeys.has(k)) missing.push(k);
    expect(missing).toEqual([]);
  });

  it('every ads_daily ad has an ad_registry row', async () => {
    const sb = getSupabaseAdmin();
    const [{ data: daily }, { data: registry }] = await Promise.all([
      sb.from('ads_daily').select('store_id, platform, ad_id'),
      sb.from('ad_registry').select('store_id, platform, ad_id'),
    ]);
    const dailyKeys = new Set(
      (daily ?? []).map(r => `${r.store_id}/${r.platform}/${r.ad_id}`),
    );
    const registryKeys = new Set(
      (registry ?? []).map(r => `${r.store_id}/${r.platform}/${r.ad_id}`),
    );
    const missing: string[] = [];
    for (const k of dailyKeys) if (!registryKeys.has(k)) missing.push(k);
    expect(missing).toEqual([]);
  });

  it('campaigns_enriched VIEW returns reg_* on at least 1 row from today', async () => {
    const sb = getSupabaseAdmin();
    const today = new Date().toISOString().slice(0, 10);
    const { data } = await sb
      .from('campaigns_enriched')
      .select('store_id, platform, campaign_id, reg_effective_status, reg_delivery_status')
      .eq('date', today)
      .limit(5);
    const rows = (data ?? []) as Array<{
      reg_effective_status: string | null;
      reg_delivery_status: string | null;
    }>;
    if (rows.length === 0) {
      console.warn(`[coverage] campaigns_enriched returned 0 rows for ${today} — no spend today yet`);
      return; // not a failure — no spend today
    }
    const haveReg = rows.filter(r => r.reg_effective_status !== null).length;
    expect(haveReg).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Confirm the harness picks up the new file**

Run:
```bash
cd /Users/dorperetz/script-roas/dashboard-web && grep -n "audit:reconcile:hot-vs-heavy" package.json
```
Expected: the npm script already exists from Phase C.5. The new live file matches the `*.live.test.ts` pattern so it runs in the same invocation. If it doesn't, run `cat package.json | grep -A1 audit:` and confirm the pattern includes `.live.test.ts`.

- [ ] **Step 3: Smoke-test the harness LOCALLY against the prod DB** (operator action)

Print to the operator:

> Phase D coverage harness ready. Please run:
> `cd dashboard-web && AUDIT_LIVE=1 npm run audit:reconcile:hot-vs-heavy`
>
> Expected: all 4 new "Phase D coverage parity" tests pass. The 3 existing
> Phase C tests should also still pass. Confirm before continuing.

Wait for confirmation.

- [ ] **Step 4: Commit**

```bash
git add dashboard-web/src/lib/audit/__tests__/registryCoverageParity.live.test.ts
git commit -m "$(cat <<'EOF'
test(phase-d-task-14): coverage parity live harness — registry ⊇ dailies

4 new AUDIT_LIVE=1 tests assert every campaigns_daily / adsets_daily /
ads_daily distinct tuple has a matching registry row, and that
campaigns_enriched returns non-null reg_effective_status on today's
rows. Belongs to the same npm run audit:reconcile:hot-vs-heavy
invocation as the Phase C.5 harness.

Spec: docs/superpowers/specs/2026-05-30-phase-d-registry-status-cutover-design.md §4.4 + §8
Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 15: Docs — Architecture + User Manual

**Files:**
- Modify: `docs/ARCHITECTURE.md` (append a Phase D section)
- Modify: `docs/ROAS-Dashboard-User-Manual.md` (bump to 2.2.0 + Phase D entry)

- [ ] **Step 1: Append a Phase D section to ARCHITECTURE.md**

Open `docs/ARCHITECTURE.md` and find the heading for the most recent Phase (likely "Phase C soak fixes" or "Phase C — Hot metrics"). After the closing of that section, insert:

```markdown

## Phase D — Registry-Status Cutover (2026-05-30)

The dashboard now reads campaign / adset / ad **status** from the 3
registries written by the Phase B/C orchestrator (≤10 min refresh)
instead of from `effective_status` on the 3 `*_daily` tables (~30 min
refresh via `cron-live-heavy`).

### What changed
- **3 SQL migrations** added under `supabase/migrations/`:
  - `20260530250000_phase_d_backfill_registries.sql` — one-time backfill,
    idempotent, `ON CONFLICT DO NOTHING`.
  - `20260530260000_phase_d_auto_coverage_triggers.sql` — `AFTER INSERT`
    triggers on the 3 dailies, insert-only, never overwrite worker data.
  - `20260530270000_phase_d_enriched_views.sql` — `campaigns_enriched`
    / `adsets_enriched` / `ads_enriched` `LEFT JOIN` views.
- **postgresReaders.ts** — `fetchCampaignsFromPostgres` / `fetchAdsFromPostgres`
  select from the enriched views; `CampaignRow` / `AdRow` carry 6
  `reg*` fields. `fetchCurrentCampaignStatuses` rebuilt to read
  `campaign_registry` directly (was: 60-day scan of `campaigns_daily`).
- **statusClassification.ts** (`lib/registries/`) — single source of
  truth for the (`regDeliveryStatus` × fallback chain) → {label, tone,
  isOff, isBackfillUnknown} mapping. Consumed by `CampaignsTableRow`
  (chip) + `CampaignDrawerStatusSection` (panel).
- **CampaignDrawerStatusSection** expanded from "minimal" (Phase C) to
  "full": 3 status chips side-by-side, BACKFILL_UNKNOWN explainer,
  3-event timeline.
- **ProductCentricView** + **CohortComparisonPanel** swap to `reg*`
  fields with legacy fallback.

### What didn't change
Writers (cronDaily / cronLive / metaWorker / googleWorker / tiktokWorker)
continue writing to `*_daily` and registries exactly as before. The
cutover is read-side only.

### Sentinel
`configured_status = 'BACKFILL_UNKNOWN'` marks rows that the backfill
seeded from daily data alone (i.e. no platform-native operator-set value
has been observed yet). The next status-scope worker tick (~10 min)
replaces it with the real platform value. The UI surfaces a small
"⏳ טוען מ-Platform" chip and an explainer block while the sentinel
is active.

### Rollback
Revert the frontend / postgresReaders commits. The DB layer
(VIEWs + triggers + backfilled rows) stays in place — it harms nothing
while idle and lets us roll forward instantly. See spec §6.
```

- [ ] **Step 2: Bump User Manual to 2.2.0 and add a Phase D entry**

Open `docs/ROAS-Dashboard-User-Manual.md`. Find the version banner at the top (search for the current `2.1.x` string). Bump it to `2.2.0`. Find the changelog section and add an entry:

```markdown

## v2.2.0 — 2026-05-30 — Phase D: Registry-Status Cutover

- Campaign/adset/ad status chips in the table now reflect the latest
  platform-native value within **10 min** (was: ~30 min via `cron-live-heavy`).
- New תפעוliz delivery-status chip on rows displays one of:
  - **מציג** (green) — actively serving impressions.
  - **כבוי** (gray) — paused/disabled/archived.
  - **מוגבל** (orange) — daily budget exceeded; resumes tomorrow.
  - **בבדיקה** (blue) — under platform review.
  - **בלמידה** (blue) — Meta learning phase.
  - **נדחה** (red) — TikTok review denied.
- Campaign drawer's "סטטוס + טריות" panel is now the **full** Phase D
  layout: 3 status fields side-by-side + 3-event timeline (נראה
  לראשונה / שינוי סטטוס אחרון / סטטוס נדגם בהצלחה).
- A new "⏳ טוען מ-Platform" chip appears briefly on freshly-backfilled
  campaigns until the orchestrator's status worker observes them
  (~10 min). Operator action: none — it disappears automatically.
```

- [ ] **Step 3: Commit**

```bash
git add docs/ARCHITECTURE.md docs/ROAS-Dashboard-User-Manual.md
git commit -m "$(cat <<'EOF'
docs(phase-d-task-15): ARCHITECTURE §Phase D + User Manual 2.2.0

ARCHITECTURE.md gains a Phase D section: 3 migrations, postgresReaders
cutover, shared classifier, expanded drawer panel, what didn't change,
sentinel handling, rollback. User Manual bumped to 2.2.0 with the
new delivery-status chip vocabulary and the drawer's expanded panel.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 16: Deploy + 24h soak verification

**Files:**
- (Operator action)

Final deploy. Verify the 9 acceptance criteria from spec §8.

- [ ] **Step 1: Confirm final pre-deploy state**

Run:
```bash
cd /Users/dorperetz/script-roas && git status && git log --oneline origin/main..HEAD | head -20
```
Expected: clean tree; 9-12 commits ahead of origin/main (the per-task commits from Tasks 1-15).

- [ ] **Step 2: Run the full local validation pass**

Run:
```bash
cd /Users/dorperetz/script-roas/dashboard-web && \
  npx tsc --noEmit && \
  npm test
```
Expected: tsc clean; suite green.

- [ ] **Step 3: Push to main**

Operator action — confirm before running:

```bash
git push origin main
```

After Vercel finishes the build, ask the operator to load the dashboard and confirm:
1. The Campaigns table chips render with new tones (green/gray/orange/blue/red).
2. Opening any campaign drawer surfaces the full 3-side-by-side status panel + timeline.
3. `/operator` is still 45/45 freshness green.

- [ ] **Step 4: 24h soak verification**

After 24 h, operator runs the spec's last acceptance check (§8.9 — BACKFILL_UNKNOWN drops 90%+):

```sql
SELECT
  platform,
  COUNT(*) FILTER (WHERE configured_status = 'BACKFILL_UNKNOWN') AS still_unknown,
  COUNT(*)                                                       AS total,
  ROUND(
    100.0 * COUNT(*) FILTER (WHERE configured_status = 'BACKFILL_UNKNOWN') / NULLIF(COUNT(*), 0),
    1
  ) AS pct_unknown
FROM campaign_registry
GROUP BY platform
ORDER BY platform;
```

Acceptance: `pct_unknown < 10` on every platform. If a platform stays high, the status-scope worker for that platform isn't catching backfilled campaigns — file a follow-up (spec §7).

Operator also runs the coverage harness:

```bash
cd dashboard-web && AUDIT_LIVE=1 npm run audit:reconcile:hot-vs-heavy
```

Expected: all Phase D + Phase C tests green.

- [ ] **Step 5: Record the soak result in a follow-up memory entry**

After the 24h soak passes, save a memory note documenting:
- Final HEAD SHA
- BACKFILL_UNKNOWN drop percentage per platform
- Any follow-up issues for next session

(No commit — this is a memory-system action only.)

---

## Self-review

**Spec coverage check (acceptance criteria from spec §8):**
1. ✅ 3 backfill migrations + COUNT parity test — Tasks 1, 4, 14
2. ✅ 3 triggers fire on INSERT — Task 2
3. ✅ 3 VIEWs return reg_* — Tasks 3, 14
4. ✅ Every route handler / reader using effective_status moves to enriched — Tasks 5, 6, 7 (the only readers in the app)
5. ✅ Every frontend component using `effectiveStatus` swaps to `reg*` — Tasks 9, 10, 11, 12, 13
6. ✅ Suite green (tsc + Vitest + DOM tests + live harness) — Tasks 5-14, gated at Task 16
7. ✅ Operator panel 45/45 green — Task 16 Step 3
8. ✅ ARCHITECTURE.md §Phase D + User Manual 2.2.0 — Task 15
9. ✅ BACKFILL_UNKNOWN drops 90%+ in 24h — Task 16 Step 4

**Placeholder scan:** no TBDs / "implement later" / unspecified error handling.

**Type consistency:** the 6 `reg*` field names are defined identically in `CampaignRow` (Task 5), `AdRow` (Task 6), `Aggregated` (Task 9), and consumed identically in `classifyCampaignStatus` (Task 8) + every consumer (Tasks 10-13).

**Sequencing safety:** migrations land before code; per-task commits allow per-commit rollback; sentinel + fallback chain prevent UI breakage during the brief window between migration A applying and the trigger seeing its first INSERT.
