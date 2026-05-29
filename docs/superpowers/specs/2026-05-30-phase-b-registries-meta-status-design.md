# Phase B — Registries + Meta status discovery

**Date:** 2026-05-30
**Status:** Approved (operator-confirmed scope + acceptance)
**Parent umbrella spec:** [`2026-05-29-freshness-contract-incremental-sync-design.md`](2026-05-29-freshness-contract-incremental-sync-design.md)
**Predecessor phases:**
- Phase A (foundation: stagger + Meta BUC tracker + data_freshness skeleton + finalization columns) — shipped 2026-05-29, commit `683c017`.
- Phase A.5 v2 (campaign↔store mapping, DELETE-then-UPSERT, agg RPC) — shipped 2026-05-29 evening, commit `10a3f11` + evening hotfixes through `036cdf5`.

## Why this scoped spec exists

The umbrella spec covers Phases A–E and has two internal inconsistencies for Phase B (line 387 vs 1318 — workers in Phase B vs Phase C; acceptance "read from registry" vs Phase D "fully wired to registry"). This spec resolves both by sticking with the cron-jobs table at line 387 as authoritative and tightening Phase B's acceptance to a backend-only deliverable. Phase D handles the CampaignsTable / CampaignDrawer integration as originally planned.

## Goals

1. Build the perpetual entity registries (`campaign_registry` + `adset_registry` + `ad_registry`) that hold one row per Meta entity, decoupled from `campaigns_daily`'s spend-row-per-day model.
2. Add the `campaign_status_events` append-only audit log so every status transition (`PAUSED → ACTIVE`, `first_seen`, etc) is observable.
3. Ship `cron-tick-orchestrator` (10-min cron) + `meta-worker` (event-triggered, scope='status' only). Google / TikTok / Shopify workers stay deferred to Phase C / D.
4. Expose the new layer through `/operator` only — Freshness Matrix, Status Events Feed, Cron-tick snapshots viewer.

## Non-goals

- CampaignsTable / CampaignDrawer / FreshnessChip changes (→ Phase D).
- Hot-metrics scope on any worker (→ Phase C).
- Google / TikTok / Shopify workers (→ Phase C / D).
- Decommissioning `cron-live` or `cron-live-heavy` (→ Phase C / D).
- Registry backfill from `campaigns_daily` — registries start empty; first status tick populates them within 10 minutes of deploy.

## Acceptance

- A newly-created Meta campaign (any of the 3 stores) appears in `campaign_registry` within 10 minutes of creation in Meta Ads Manager, observable via `/operator` Status Events Feed (entry with `change_kind = 'first_seen'`).
- An existing Meta campaign paused via Meta Ads Manager appears in `campaign_status_events` within 10 minutes with `change_kind = 'paused'` and `to_status` matching the platform-native value.
- `/operator` shows the Freshness Matrix populated for all 3 stores × 3 status scopes (`campaign_status`, `adset_status`, `ad_status`) with green dots when `lag_minutes < 15`.
- `cron_tick_snapshots` has 6 ticks/hour for the first 24 hours post-deploy, each with `events_completed_count = events_fan_out_count` (no failures, no unexpected skips).

## Final architecture (Phase B slice)

```
EVERY 10 MIN
  cron-tick-orchestrator
    ├── step 1: floor tick_id to 10-min bucket
    ├── step 2: load stores + data_freshness + meta_buc_usage
    ├── step 3: compute (store × scope='status') priorities → events
    ├── step 4: step.sendEvent fan-out (Meta only this phase)
    └── step 5: INSERT cron_tick_snapshots row

  meta-worker (per event {store_id, scope='status', tick_id})
    ├── step 1: BUC probe — skip + emit budget.exceeded if pct ≥ 80
    ├── step 2: fetch /campaigns + /adsets + /ads (batched, ads_management BUC)
    ├── step 3: parse x-business-use-case-usage → upsert meta_buc_usage
    ├── step 4: diff vs registries → insert campaign_status_events
    │           ON CONFLICT (dedupe_key) DO NOTHING
    ├── step 5: upsert {campaign,adset,ad}_registry
    └── step 6: mark data_freshness success for 3 scopes
```

`cron-live` (every 10 min, existing) and `cron-live-heavy` (every 30 min, existing) keep running unchanged. They write to `data_daily` / `campaigns_daily` / `ads_daily` / `products_daily`. The new tables (`*_registry`, `campaign_status_events`, `cron_tick_snapshots`) are written only by the meta-worker. No write conflicts.

## Data shapes — design decisions

Schema is copied verbatim from the umbrella spec §"NEW tables" (lines 175–342). Key local decisions:

1. **Registry PK = `(store_id, platform, entity_id)`.** Identical across all three registries. `platform` stays in the PK even though Phase B only writes `'meta'` rows, so Phase C can add Google / TikTok rows without a schema migration.

2. **Four timestamps per registry row** with distinct semantics:
   - `first_seen_at` — set on INSERT only, never overwritten. Drives `change_kind='first_seen'` event.
   - `last_seen_at` — bumped on every status tick, used by `missed_seen_count` logic.
   - `platform_updated_at` — bumped on any platform-side edit (name / budget / creative / status). Used by Phase C hot-set as a coarse "did anything change" signal.
   - `status_changed_at` — bumped ONLY when `configured_status` or `effective_status` differs from the prior observation. Used by Phase C hot-set to flag "real status change" without inflating the set with cosmetic edits.

3. **Soft-delete via `missed_seen_count` + `is_removed`.** When a COMPLETE status listing returns and the entity is absent, increment `missed_seen_count`. At `>=3`, set `is_removed = true`. This protects against TikTok's known behavior of intermittently omitting still-active campaigns from list responses, which would otherwise generate false `removed` events.

4. **`campaign_status_events.dedupe_key`** is a STORED column = `store::platform::type::id::from::to::occurred-at-minute`. Insert uses `ON CONFLICT (dedupe_key) DO NOTHING`. Bucketing `occurred_at` to the minute coalesces flapping observations near review-state edges (Meta is known to emit the same effective_status transition twice within 30s on PENDING_REVIEW exits).

5. **`cron_tick_snapshots.tick_id`** = ISO `YYYY-MM-DDTHH:MM` floored to the 10-min bucket. Critically, the floor must use `Math.floor(Date.now() / TEN_MIN_MS) * TEN_MIN_MS` — NOT `slice(0, 16)` which gives a 1-minute bucket and would generate a different `tick_id` on retry 90 seconds later, defeating idempotency.

## Meta worker — implementation contract

**Concurrency:** `[{ key: 'ad_account_id', limit: 2 }, { key: 'store_id', limit: 1 }]`. The account-level cap protects the BUC; the store cap prevents two simultaneous events for the same store from racing the registry diff.

**Throttle:** 540 calls/h per ad-account = 90% of the Meta ceiling. The `cron-live` + `cron-live-heavy` budget for Meta status calls is preserved alongside.

**Fetch shape:** `fetchMetaStatusForStore(storeId)` returns a normalized object:
```typescript
{
  campaigns: Array<{ id, name, configured_status, effective_status, platform_updated_at }>,
  adsets:    Array<{ id, campaign_id, name, configured_status, effective_status, daily_budget_cad, lifetime_budget_cad, platform_updated_at }>,
  ads:       Array<{ id, adset_id, campaign_id, name, configured_status, effective_status, platform_updated_at }>,
  bucHeader: ParsedBucUsage,
}
```
Uses Meta Graph API Batch (single HTTPS round-trip for the three sub-requests). Budget-cad conversion uses the same `getFxRate` helper as `cron-live-heavy`.

**Diff logic** (`writeStatusEventsFromDiff`): for each fetched entity, look up the prior registry row. If absent → emit `first_seen`. If `configured_status` changed → emit `paused` / `enabled` / `archived` per the transition. If only `effective_status` changed → emit `effective_only`. If only `delivery_status` changed → emit `delivery_only`. All events go through the same `INSERT ... ON CONFLICT DO NOTHING` path.

## Operator UI

Three new sections at `/operator`, below the existing Phase A panels.

### Freshness Matrix
- Grid: row per store × column per `data_freshness.scope`.
- Cell = `{ green if lag<15m, yellow if 15-60m, red if >60m or status≠'success' }` + lag-minutes badge.
- Click → modal with full row (status, error_code, error_message, budget_skip, last_url).
- Source: `SELECT * FROM data_freshness ORDER BY store_id, scope`.

### Status Events Feed
- Last 50 entries from `campaign_status_events ORDER BY occurred_at DESC LIMIT 50`.
- Each row: `relative-time · store · platform · entity_type "name" · from → to` with icon per `change_kind`.
- Click → grayed-out "available after Phase D" link (CampaignDrawer drill-down comes with the registry-status wiring).

### Cron-tick Snapshots — full viewer
- Table: last 144 ticks (24h × 6/h) from `cron_tick_snapshots ORDER BY tick_id DESC LIMIT 144`.
- Columns: `tick_id | fan_out | completed | skipped | failed | duration_seconds`.
- Sortable / clickable row → modal with full snapshot detail (event ids, per-event status, error messages).

No DOM tests in Phase B — the new components are simple list/table renders. Vitest pure-helper tests cover the priority-builder, diff logic, BUC-header parser, and freshness-cell color function.

## Out of scope (deferred to subsequent phases)

| Item | Phase |
|---|---|
| `google-worker` / `tiktok-worker` / `shopify-worker` (status scope) | C / D |
| `hot_metrics` scope on any worker | C |
| Decommission of `cron-live-heavy` | C |
| `last_live_tick_at` column on CampaignsTable | C |
| `FreshnessChip` new states (`skipped_budget`, `unreconciled`) | D |
| CampaignDrawer registry-status wiring | D |
| TodayLive "live (provisional)" banner | D |
| Rolling reconcile (`T-2..T-14`) | E |
| `cron-weekly-reconcile` | E |

## Dependencies

- **Phase A.5 v2 (TikTok mapping):** none. Phase B touches only Meta; the campaign-store-map and the agg RPC are TikTok-specific.
- **Phase A foundation:** `meta_buc_usage` table, `data_freshness` table, cron stagger, finalization columns. All in place.
- **`getFxRate` helper:** existing; reused for budget CAD conversion.

## Risks + mitigations

| Risk | Mitigation |
|---|---|
| Meta status fetch fan-out doubles call volume on top of `cron-live` + `cron-live-heavy` → BUC pressure | Pre-flight BUC probe with 80% threshold; orchestrator priority reads `data_freshness` so already-fresh scopes skip |
| First-tick storm — 3 stores × 3 entity types × N campaigns each → bursty INSERT into `campaign_status_events` (every entity emits `first_seen`) | Acceptable one-time cost; index `idx_status_events_recent` handles the read load; dedupe_key UNIQUE prevents retry-storms |
| `cron-tick-orchestrator` and existing `cron-live` both run on `*/10 * * * *` — Inngest concurrency may queue them | Orchestrator is fan-out only (no Meta calls itself) — completes in <2s. No conflict. |
| Registry stays empty for the 10-min window between Phase B deploy and first successful tick | Acceptable. `/operator` shows the empty state cleanly; no public-facing surface depends on the registry in Phase B. |
| `meta-worker` fails mid-batch (e.g., adsets succeed, ads fail) → registry inconsistency | Inngest retries the failed step; per-step `step.run` granularity means the upserts that did succeed stick. |

## Migration order + rollback

1. Apply migration `<timestamp>_phase_b_registries.sql` (additive: 5 new tables + indexes). Safe — no destructive changes.
2. Deploy worker code with the orchestrator behind an Inngest feature toggle (disabled). Confirms build.
3. Enable orchestrator. First tick at next 10-min boundary. Verify `cron_tick_snapshots` row appears.
4. Monitor `/operator` for 1 hour:
   - Freshness Matrix populates green
   - Status Events Feed accumulates `first_seen` entries during the registry warm-up
   - `meta_buc_usage` pct stays below 80%

**Rollback path:** disable orchestrator (feature toggle). New tables remain but are no longer written. No effect on existing pipelines.
